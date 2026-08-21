import { Session } from './model'
import * as claudeCode from './claude-code'
import * as goose from './goose'

export * from './model'

const adapters = [
  { name: 'Claude Code', ...claudeCode },
  { name: 'goose', ...goose },
]

export class UnknownSessionError extends Error {}

export function parseSessionText(text: string, fileName: string): Session {
  const input = decode(text)
  const adapter = adapters.find((a) => a.detect(input))
  if (!adapter) {
    throw new UnknownSessionError(
      'Not a session we recognize yet. Drop a Claude Code .jsonl transcript or a goose .json session.',
    )
  }
  return adapter.parse(input, fileName)
}

export async function readSessionFile(file: File): Promise<Session> {
  return parseSessionText(await file.text(), file.name)
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function decode(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new UnknownSessionError('That file is empty.')
  const whole = tryJson(trimmed)
  if (whole !== undefined) return whole
  const records = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const value = tryJson(line)
      return value === undefined ? [] : [value]
    })
  if (!records.length) throw new UnknownSessionError('That file is neither JSON nor JSONL.')
  return records
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const load = async (name: string) => {
    const { readFileSync } = await import('node:fs')
    return parseSessionText(readFileSync(`example-sessions/${name}`, 'utf8'), name)
  }
  it('parses a Claude Code transcript', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    expect(s.agent).toBe('Claude Code')
    expect(s.model).toBe('claude-opus-5')
    expect(s.steps.filter((x) => x.kind === 'tool').length).toBe(4)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
    expect(s.tokens.total).toBe(174050)
    expect(s.contributed.output).toBe(9204)
  })

  it('sizes a step by what it adds, not by the context re-sent with it', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    const biggest = [...s.steps].sort((a, b) => b.tokens.total - a.tokens.total)[0]!
    const lastPrompt = s.steps.filter((x) => x.kind === 'prompt').at(-1)!
    expect(biggest.label).toBe('Bash')
    expect(lastPrompt.preview).toBe('open it')
    expect(lastPrompt.tokens.total).toBeLessThan(20)
    expect(s.steps.every((x) => x.tokens.total <= x.tokens.input + x.tokens.output)).toBe(true)
    expect(s.contributed.total).toBeLessThan(s.tokens.total)
  })
  it('parses a goose session', async () => {
    const s = await load('goose-threejs-earth-session.json')
    expect(s.agent).toBe('goose')
    expect(s.title).toBe('ThreeJS spinning Earth')
    expect(s.steps.filter((x) => x.kind === 'tool').length).toBe(14)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
    expect(Math.round(s.costUsd * 100) / 100).toBe(0.65)
    expect(s.tokens.total).toBe(306659)
    expect(s.contributed.output).toBe(14366)
    expect(Math.round(s.durationMs / 1000)).toBe(321)
  })
  it('rejects files it cannot recognize', () => {
    expect(() => parseSessionText('{"hello":"world"}', 'x.json')).toThrow(UnknownSessionError)
  })
}

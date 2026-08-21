import { Session } from './model'
import { Harness, SessionFile } from './harness'
import { buildSession } from './build'
import { claudeCode } from './claude-code'
import { goose } from './goose'

export * from './model'
export * from './harness'

const harnesses: Harness[] = [claudeCode, goose]

export class UnknownSessionError extends Error {}

export function parseSessionText(text: string, fileName: string): Session {
  const file: SessionFile = { name: fileName, data: decode(text) }
  const harness = harnesses.find((h) => h.recognizes(file))
  if (!harness) {
    throw new UnknownSessionError(
      `Not a session we recognize yet. Drop a ${harnesses.map((h) => h.agent).join(' or ')} session file.`,
    )
  }
  return buildSession(harness, file)
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
    expect(Math.round(s.durationMs / 1000)).toBe(120)
  })

  it('sizes a step by what it adds, not by the context re-sent with it', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    const biggest = [...s.steps].sort((a, b) => b.tokens.total - a.tokens.total)[0]!
    const lastPrompt = s.steps.filter((x) => x.kind === 'prompt').at(-1)!
    expect(biggest.label).toBe('Bash')
    expect(lastPrompt.preview).toBe('open it')
    expect(lastPrompt.tokens.total).toBeLessThan(20)
    expect(s.contributed.total).toBeLessThan(s.tokens.total)
  })

  it('parses a goose session', async () => {
    const s = await load('goose-threejs-earth-session.json')
    expect(s.agent).toBe('goose')
    expect(s.title).toBe('Spinning earth')
    expect(s.steps.filter((x) => x.kind === 'tool').length).toBe(14)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
    expect(Math.round(s.costUsd * 100) / 100).toBe(0.65)
    expect(s.tokens.total).toBe(306659)
    expect(s.contributed.output).toBe(14366)
    expect(Math.round(s.durationMs / 1000)).toBe(321)
  })

  it('survives records that break the usual shape', () => {
    const usage = { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 1000 }
    const base = { sessionId: 's', cwd: '/w', isSidechain: false }
    const jsonl = [
      { ...base, type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'hi' }, origin: { kind: 'human' } },
      { ...base, uuid: 'u1', type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { model: 'x', content: 'API Error: 500', usage } },
      { ...base, uuid: 'u2', type: 'assistant', timestamp: '2026-01-01T00:00:02.000Z', message: { model: 'x', content: [], usage } },
      { ...base, uuid: 'u3', type: 'assistant', timestamp: '2026-01-01T00:00:03.000Z', message: { id: 'r', model: 'x', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }], usage } },
      { ...base, type: 'user', timestamp: '2026-01-01T00:00:04.000Z', message: { content: [null, { type: 'tool_result', tool_use_id: 't', content: 'ok' }, { type: 'text', text: 'note' }] } },
    ]
    const s = parseSessionText(jsonl.map((r) => JSON.stringify(r)).join('\n'), 'edge.jsonl')

    expect(s.steps.map((x) => x.label)).toEqual(['Prompt', 'Assistant', 'Bash', 'User context'])
    expect(s.steps[1]!.preview).toBe('API Error: 500')
    expect(s.tokens.total).toBe(1022 * 3)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
  })

  it('does not let a message without a timestamp stretch the timeline', () => {
    const s = parseSessionText(
      JSON.stringify({
        id: 'g',
        working_dir: '/w',
        name: 'n',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:05:00Z',
        conversation: [
          { id: 'u', role: 'user', created: 1767225600, content: [{ type: 'text', text: 'hi' }], metadata: {} },
          { id: 'a', role: 'assistant', content: [{ type: 'text', text: 'undated' }], metadata: {} },
        ],
      }),
      'g.json',
    )
    expect(s.steps.every((x) => x.start >= s.startedAt && x.durationMs <= s.durationMs)).toBe(true)
  })

  it('rejects files it cannot recognize', () => {
    expect(() => parseSessionText('{"hello":"world"}', 'x.json')).toThrow(UnknownSessionError)
  })
}

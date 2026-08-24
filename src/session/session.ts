import { duration } from '../format'
import { Fact, Harness, ResponseBlock, SessionEvent, SessionFile, Usage, oneLine } from './harness'
import { claudeCode } from './claude-code'
import { goose } from './goose'

export type StepType = 'prompt' | 'response' | 'thinking' | 'tool' | 'idle' | 'meta'

export interface Tokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface Field {
  label: string
  value: string
  format: 'text' | 'code' | 'json'
}

export interface Step {
  id: string
  index: number
  type: StepType
  label: string
  preview: string
  start: number
  end: number
  durationMs: number
  tokens: Tokens
  request?: Tokens
  injectedTokens: number
  costUsd: number
  isError: boolean
  model?: string
  fields: Field[]
  raw: unknown
}

export interface Session {
  id: string
  title: string
  agent: string
  // NOTE: A session can switch models mid-conversation (eg /model in claude)
  // TODO: A thing I would do beyond today would be to look whether harnesses store model change events in
  // in a uniform enough way in their session/conversation data models to track them and make Step.model
  // meaningful. This would also be important if we want to add cost attribution per step, but there are
  // other things to that as well. Keeping a simple representation at the Session level of last model seen
  // for display at the top for now.
  model: string
  cwd: string
  startedAt: number
  endedAt: number
  durationMs: number
  steps: Step[]
  tokens: Tokens
  contributed: Tokens
  costUsd: number
  facts: Fact[]
  fileName: string
}

export class UnknownSessionError extends Error {}

const harnesses: Harness[] = [claudeCode, goose]

export function parseSessionText(text: string, fileName: string): Session {
  const file: SessionFile = { name: fileName, data: decode(text) }
  const harness = harnesses.find((h) => h.recognizes(file))
  if (!harness) {
    throw new UnknownSessionError(
      `Not a session we recognize yet. Drop a ${harnesses.map((h) => h.agent).join(' or ')} session file.`,
    )
  }
  return build(harness, file)
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

const IDLE_MS = 1500

type DraftStep = Omit<Step, 'index' | 'end' | 'durationMs' | 'tokens' | 'costUsd' | 'isError' | 'injectedTokens'> &
  Partial<Pick<Step, 'end' | 'tokens' | 'costUsd' | 'isError' | 'injectedTokens'>>

interface BlockDraft {
  id: string
  type: StepType
  label: string
  preview: string
  fields: Field[]
  raw: unknown
  weight: number
  thinking?: boolean
  model?: string
  end?: number
}

interface Allocation {
  tokens: Tokens
  request?: Tokens
  costUsd: number
}

interface RequestMark {
  at: number
  context: number
  output: number
}

function build(harness: Harness, file: SessionFile): Session {
  const summary = harness.summarize(file)
  const events = harness.timeline(file)
  const blocksOf = new Map<number, BlockDraft[]>()
  events.forEach((e, i) => {
    if (e.type === 'response') blocksOf.set(i, e.blocks.map((b, bi) => blockDraft(b, `${i}.${bi}`, e)))
  })

  const drafts: DraftStep[] = []
  const pending = new Map<string, DraftStep>()
  const marks: RequestMark[] = []
  const marked = new Set<string>()
  const billing = bill(events, blocksOf)
  let cursor = summary.startedAt

  events.forEach((event, i) => {
    const at = Math.max(event.at, summary.startedAt)
    if (event.type === 'response') {
      const blocks = blocksOf.get(i) ?? []
      const end = Math.max(cursor, at)
      const start = event.startedAt ? Math.min(Math.max(event.startedAt, cursor), end) : Math.min(cursor, at)
      if (start > cursor) extendLast(drafts, start)
      const key = requestKey(event, i)
      if (!marked.has(key)) {
        marked.add(key)
        const charged = billing.request(key)
        if (charged) marks.push({ at: start, context: contextOf(charged), output: charged.output })
      }
      spanBlocks(blocks, start, end).forEach((span, k) => {
        const block = blocks[k]!
        const step = toDraft(block, span, billing.of(block.id))
        drafts.push(step)
        const source = event.blocks[k]
        if (source?.type === 'call') pending.set(source.id, step)
      })
      cursor = end
      return
    }

    if (event.type === 'result') {
      const step = pending.get(event.callId)
      if (step) {
        const wrote = step.end ?? step.start
        step.end = Math.max(wrote, at)
        step.isError = event.failed
        step.injectedTokens = estimateTokens(event.text)
        step.fields.push({
          label: event.failed ? 'Error' : 'Result',
          value: event.text || '(empty)',
          format: event.text.includes('\n') ? 'code' : 'text',
        })
        if (at > wrote) {
          step.fields.push({
            label: 'Timing',
            value: `${duration(wrote - step.start)} writing the call, ${duration(at - wrote)} running it`,
            format: 'text',
          })
        }
        pending.delete(event.callId)
      }
      cursor = Math.max(cursor, at)
      return
    }

    if (event.type === 'prompt') {
      if (at - cursor > IDLE_MS) drafts.push(idleDraft(`${i}.idle`, cursor, at))
      drafts.push({
        id: String(i),
        type: 'prompt',
        label: 'Prompt',
        preview: oneLine(event.text),
        start: at,
        end: at,
        injectedTokens: estimateTokens(event.text),
        fields: [{ label: 'Prompt', value: event.text, format: 'text' }],
        raw: event.raw ?? event,
      })
      cursor = Math.max(cursor, at)
      return
    }

    drafts.push({
      id: String(i),
      type: 'meta',
      label: event.label,
      preview: event.preview ?? oneLine(event.context ?? JSON.stringify(event.detail ?? null)),
      start: Math.min(cursor, at),
      end: at,
      injectedTokens: estimateTokens(event.context ?? ''),
      fields: valueFields(noteLabel(event.label, event.detail), event.detail),
      raw: event.raw ?? event.detail,
    })
    cursor = Math.max(cursor, at)
  })

  extendLast(drafts, summary.endedAt)
  const steps = attributeInput(finalizeSteps(drafts, summary.endedAt), marks)
  return {
    ...summary,
    agent: harness.agent,
    durationMs: summary.endedAt - summary.startedAt,
    steps,
    tokens: billing.charged,
    contributed: sumTokens(steps),
    costUsd: billing.costUsd,
    fileName: file.name,
  }
}

const requestKey = (event: SessionEvent & { type: 'response' }, index: number) => event.requestId ?? `#${index}`

interface Billing {
  of(blockId: string): Allocation | undefined
  request(key: string): Tokens | undefined
  charged: Tokens
  costUsd: number
}

function bill(events: SessionEvent[], blocksOf: Map<number, BlockDraft[]>): Billing {
  const requests = new Map<string, { blocks: BlockDraft[]; usage?: Usage }>()
  events.forEach((event, i) => {
    if (event.type !== 'response') return
    const key = requestKey(event, i)
    const entry = requests.get(key) ?? { blocks: [] }
    entry.blocks.push(...(blocksOf.get(i) ?? []))
    entry.usage = entry.usage ?? event.usage
    requests.set(key, entry)
  })

  const allocations = new Map<string, Allocation>()
  const charged = new Map<string, Tokens>()
  let total = noTokens()
  let costUsd = 0
  requests.forEach(({ blocks, usage }, key) => {
    if (!usage) return
    const tokens = tokensOf(usage)
    charged.set(key, tokens)
    total = addTokens(total, tokens)
    costUsd += usage.costUsd
    if (!blocks.length) return
    allocateTokens(blocks, { tokens, reasoning: usage.reasoning, costUsd: usage.costUsd }).forEach((allocation, i) =>
      allocations.set(blocks[i]!.id, allocation),
    )
  })

  return {
    of: (blockId) => allocations.get(blockId),
    request: (key) => charged.get(key),
    charged: total,
    costUsd,
  }
}

function blockDraft(block: ResponseBlock, id: string, response: SessionEvent & { type: 'response' }): BlockDraft {
  const prefix = response.sidechain ? 'Subagent · ' : ''
  const common = { id, model: response.model, end: block.at, raw: block.raw ?? block }

  if (block.type === 'call') {
    const { label, source } = splitToolName(block.name)
    return {
      ...common,
      type: 'tool',
      label: prefix + label,
      preview: argPreview(block.args),
      weight: JSON.stringify(block.args ?? {}).length,
      fields: [...argFields(block.args), ...(source ? [{ label: 'Tool', value: source, format: 'text' as const }] : [])],
    }
  }

  const thinking = block.type === 'thinking'
  const stored = block.text.trim().length > 0
  return {
    ...common,
    type: thinking ? 'thinking' : 'response',
    label: prefix + (thinking ? 'Thinking' : 'Assistant'),
    preview: stored ? oneLine(block.text) : 'Reasoning was not stored in this transcript',
    weight: block.text.length || 1,
    thinking,
    fields: [
      {
        label: thinking ? 'Reasoning' : 'Message',
        value: stored ? block.text : 'This transcript keeps an encrypted signature in place of the reasoning text.',
        format: 'text',
      },
    ],
  }
}

function splitToolName(name: string): { label: string; source: string } {
  const parts = name.split('__')
  const label = parts[parts.length - 1] as string
  return { label, source: parts.length > 1 ? `${parts.slice(0, -1).join(' · ')} → ${label}` : '' }
}

function extendLast(drafts: DraftStep[], to: number) {
  const last = drafts[drafts.length - 1]
  if (last && (last.end ?? last.start) < to) last.end = to
}

const noteLabel = (label: string, detail: unknown): string =>
  detail && typeof detail === 'object' && !Array.isArray(detail) ? '' : label

function idleDraft(id: string, start: number, end: number): DraftStep {
  return {
    id,
    type: 'idle',
    label: 'Waiting for you',
    preview: 'Nothing ran while the session waited for the next prompt',
    start,
    end,
    fields: [
      {
        label: 'Gap',
        value: `${duration(end - start)} between the last reply and the next prompt`,
        format: 'text',
      },
    ],
    raw: null,
  }
}

function toDraft(block: BlockDraft, span: { start: number; end: number }, alloc?: Allocation): DraftStep {
  return {
    id: block.id,
    type: block.type,
    label: block.label,
    preview: block.preview,
    fields: block.fields,
    raw: block.raw,
    model: block.model,
    start: span.start,
    end: span.end,
    tokens: alloc?.tokens,
    request: alloc?.request,
    costUsd: alloc?.costUsd,
  }
}

function finalizeSteps(drafts: DraftStep[], sessionEnd: number): Step[] {
  const sorted = [...drafts].sort((a, b) => a.start - b.start)
  return sorted.map((d, i) => {
    const next = sorted[i + 1]
    const end = Math.max(d.start, d.end ?? (next ? next.start : sessionEnd))
    return {
      ...d,
      index: i,
      end,
      durationMs: end - d.start,
      tokens: d.tokens ?? noTokens(),
      injectedTokens: d.injectedTokens ?? 0,
      costUsd: d.costUsd ?? 0,
      isError: d.isError ?? false,
    }
  })
}

function spanBlocks(blocks: BlockDraft[], start: number, end: number): { start: number; end: number }[] {
  const ends = spanEnds(blocks, start, end)
  return blocks.map((_, i) => ({ start: i === 0 ? start : (ends[i - 1] as number), end: ends[i] as number }))
}

function spanEnds(blocks: BlockDraft[], start: number, end: number): number[] {
  const ends: number[] = new Array(blocks.length)
  let prev = start
  let i = 0
  while (i < blocks.length) {
    const known = blocks[i]!.end
    if (known != null) {
      ends[i] = Math.max(prev, known)
      prev = ends[i] as number
      i++
      continue
    }
    let j = i
    while (j < blocks.length && blocks[j]!.end == null) j++
    const timed = j < blocks.length
    const boundary = Math.max(prev, timed ? (blocks[j]!.end as number) : end)
    const run = blocks.slice(i, timed ? j + 1 : j)
    let acc = prev
    share(
      boundary - prev,
      run.map((b) => Math.max(1, b.weight)),
    ).forEach((slice, k) => {
      if (i + k >= j) return
      acc += slice
      ends[i + k] = acc
    })
    prev = acc
    i = j
  }
  return ends
}

const noTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

const tokensOf = (t: Partial<Tokens>): Tokens => {
  const input = t.input ?? 0
  const output = t.output ?? 0
  const cacheRead = t.cacheRead ?? 0
  const cacheWrite = t.cacheWrite ?? 0
  return { input, output, cacheRead, cacheWrite, total: t.total ?? input + output + cacheRead + cacheWrite }
}

const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  total: a.total + b.total,
})

const sumTokens = (steps: Step[]): Tokens => steps.reduce((a, s) => addTokens(a, s.tokens), noTokens())

const contextOf = (t: Tokens): number => t.input + t.cacheRead + t.cacheWrite

const share = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => (total * w) / sum)
}

function distribute(total: number, weights: number[]): number[] {
  if (!weights.length) return []
  const out = share(total, weights).map((v) => Math.floor(v))
  const heaviest = weights.indexOf(Math.max(...weights))
  out[heaviest] = (out[heaviest] as number) + (total - out.reduce((a, b) => a + b, 0))
  return out
}

interface Charge {
  tokens: Tokens
  reasoning: number
  costUsd: number
}

function allocateTokens(blocks: BlockDraft[], charge: Charge): Allocation[] {
  const thinkers = blocks.map((b, i) => (b.thinking ? i : -1)).filter((i) => i >= 0)
  const others = blocks.map((b, i) => (b.thinking ? -1 : i)).filter((i) => i >= 0)
  const weightsOf = (idx: number[]) => idx.map((i) => Math.max(1, blocks[i]!.weight))
  const output = charge.tokens.output
  const outputs: number[] = new Array(blocks.length).fill(0)

  if (!others.length) {
    distribute(output, weightsOf(thinkers)).forEach((v, k) => (outputs[thinkers[k]!] = v))
  } else {
    const reasoned = thinkers.length ? Math.min(charge.reasoning, output) : 0
    distribute(reasoned, weightsOf(thinkers)).forEach((v, k) => (outputs[thinkers[k]!] = v))
    distribute(output - reasoned, weightsOf(others)).forEach((v, k) => (outputs[others[k]!] = v))
  }

  return blocks.map((_, i) => ({
    tokens: tokensOf({ output: outputs[i] as number }),
    request: i === 0 ? charge.tokens : undefined,
    costUsd: i === 0 ? charge.costUsd : 0,
  }))
}

function attributeInput(steps: Step[], requests: RequestMark[]): Step[] {
  const marks = [...requests].sort((a, b) => a.at - b.at)
  const groups = new Map<number, Step[]>()
  for (const step of steps) {
    if (step.injectedTokens <= 0) continue
    const index = marks.findIndex((m) => m.at >= step.end)
    if (index < 0) continue
    groups.set(index, [...(groups.get(index) ?? []), step])
  }
  groups.forEach((members, index) => {
    const mark = marks[index] as RequestMark
    const previous = marks[index - 1]
    const budget = Math.max(0, mark.context - (previous ? previous.context + previous.output : 0))
    const estimates = members.map((s) => s.injectedTokens)
    const estimated = estimates.reduce((a, b) => a + b, 0)
    const scale = budget > 0 ? Math.min(1, budget / estimated) : 1
    members.forEach((step, i) => {
      step.tokens = tokensOf({ input: Math.round((estimates[i] as number) * scale), output: step.tokens.output })
    })
  })
  return steps
}

const CHARS_PER_TOKEN = 2.5

const estimateTokens = (text: string): number => (text ? Math.max(1, Math.round(text.length / CHARS_PER_TOKEN)) : 0)

const PREVIEW_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'description', 'content', 'text']

function argPreview(args: unknown): string {
  if (typeof args === 'string') return oneLine(args)
  if (!args || typeof args !== 'object') return ''
  const rec = args as Record<string, unknown>
  for (const key of PREVIEW_KEYS) {
    const v = rec[key]
    if (typeof v === 'string' && v.trim()) return oneLine(v)
  }
  const first = Object.entries(rec).find(([, v]) => typeof v === 'string' || typeof v === 'number')
  return first ? oneLine(`${first[0]} ${String(first[1])}`) : oneLine(JSON.stringify(rec))
}

const isBlock = (v: string) => v.includes('\n') || v.length > 96

function valueFields(label: string, value: unknown): Field[] {
  if (value == null) return []
  if (typeof value === 'string') {
    return value.trim() ? [{ label, value, format: isBlock(value) ? 'code' : 'text' }] : []
  }
  if (typeof value !== 'object') return [{ label, value: String(value), format: 'text' }]
  if (Array.isArray(value)) return [{ label, value: JSON.stringify(value, null, 2), format: 'json' }]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    valueFields(label ? `${label} · ${k}` : k, v),
  )
}

function argFields(args: unknown): Field[] {
  if (args == null) return []
  if (typeof args === 'object' && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>).flatMap(([k, v]) => valueFields(k, v))
  }
  return valueFields('Arguments', args)
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest

  const load = async (name: string) => {
    const { readFileSync } = await import('node:fs')
    return parseSessionText(readFileSync(`example-sessions/${name}`, 'utf8'), name)
  }

  const block = (id: string, weight: number, thinking = false): BlockDraft => ({
    id,
    type: 'response',
    label: '',
    preview: '',
    fields: [],
    raw: null,
    weight,
    thinking,
  })

  const step = (end: number, injectedTokens: number): Step => ({
    id: String(end),
    index: 0,
    type: 'meta',
    label: '',
    preview: '',
    start: end,
    end,
    durationMs: 0,
    tokens: noTokens(),
    injectedTokens,
    costUsd: 0,
    isError: false,
    fields: [],
    raw: null,
  })

  it('reconstructs a Claude Code transcript', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    expect(s.agent).toBe('Claude Code')
    expect(s.model).toBe('claude-opus-5')
    expect(s.steps.filter((x) => x.type === 'tool').length).toBe(4)
    expect(s.tokens.total).toBe(174050)
    expect(s.contributed.output).toBe(9204)
    expect(Math.round(s.durationMs / 1000)).toBe(120)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
  })

  it('reconstructs a goose session', async () => {
    const s = await load('goose-threejs-earth-session.json')
    expect(s.agent).toBe('goose')
    expect(s.title).toBe('Spinning earth')
    expect(s.steps.filter((x) => x.type === 'tool').length).toBe(14)
    expect(s.tokens.total).toBe(306659)
    expect(s.contributed.output).toBe(14366)
    expect(Math.round(s.costUsd * 100) / 100).toBe(0.65)
    expect(Math.round(s.durationMs / 1000)).toBe(321)
    expect(s.steps.every((x) => x.durationMs >= 0)).toBe(true)
  })

  it('sizes a step by what it adds, not by the context re-sent with it', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    const biggest = [...s.steps].sort((a, b) => b.tokens.total - a.tokens.total)[0]!
    const lastPrompt = s.steps.filter((x) => x.type === 'prompt').at(-1)!
    expect(biggest.label).toBe('Bash')
    expect(lastPrompt.preview).toBe('open it')
    expect(lastPrompt.tokens.total).toBeLessThan(20)
    expect(s.contributed.total).toBeLessThan(s.tokens.total)
  })

  it('reports configuration as a session fact rather than a step', async () => {
    const s = await load('claude-code-threejs-earth-session.jsonl')
    expect(s.steps.some((x) => x.label === 'Auto Mode')).toBe(false)
    expect(s.facts.find((f) => f.label === 'Auto mode')?.value).toBe('On · bash first · steer only')
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

  it('splits one response output across its blocks exactly', () => {
    const tokens = tokensOf({ input: 5, output: 1000, cacheRead: 200 })
    const blocks = [block('t', 10, true), block('a', 30), block('b', 70)]
    const allocations = allocateTokens(blocks, { tokens, reasoning: 300, costUsd: 0 })
    expect(allocations.map((a) => a.tokens.output)).toEqual([300, 210, 490])
    expect(allocations[0]!.request?.cacheRead).toBe(200)
    expect(allocations[1]!.request).toBeUndefined()
  })

  it('leaves a timed block room when the blocks before it carry no timestamps', () => {
    expect(spanBlocks([block('a', 1), block('b', 3)], 0, 100)).toEqual([
      { start: 0, end: 25 },
      { start: 25, end: 100 },
    ])
    expect(spanBlocks([block('a', 1), { ...block('b', 1), end: 100 }], 0, 200)).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 100 },
    ])
  })

  it('charges injected content against the context the request actually grew by', () => {
    const late = step(300, 10)
    attributeInput(
      [step(100, 100), late],
      [
        { at: 100, context: 20000, output: 500 },
        { at: 300, context: 40000, output: 200 },
      ],
    )
    expect(late.tokens.total).toBe(10)

    const scaled = step(10, 1000)
    attributeInput([scaled], [{ at: 10, context: 100, output: 0 }])
    expect(scaled.tokens.input).toBe(100)

    const unmeasured = step(10, 1000)
    attributeInput([unmeasured], [{ at: 10, context: 0, output: 0 }])
    expect(unmeasured.tokens.input).toBe(1000)
  })

  it('previews the most meaningful argument and flattens nested ones', () => {
    expect(argPreview({ description: 'run it', command: 'ls -la' })).toBe('ls -la')
    expect(argPreview({ limit: 5 })).toBe('limit 5')
    expect(argFields({ edits: { old: 'a' } })).toEqual([{ label: 'edits · old', value: 'a', format: 'text' }])
  })
}

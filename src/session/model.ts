export type StepKind = 'prompt' | 'response' | 'thinking' | 'tool' | 'idle' | 'meta'

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
  kind: StepKind
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

export interface Fact {
  label: string
  value: string
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

export type DraftStep = Omit<
  Step,
  'index' | 'end' | 'durationMs' | 'tokens' | 'costUsd' | 'isError' | 'injectedTokens'
> &
  Partial<Pick<Step, 'end' | 'tokens' | 'costUsd' | 'isError' | 'injectedTokens'>>

export const noTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

export const tokensOf = (t: Partial<Tokens>): Tokens => {
  const input = t.input ?? 0
  const output = t.output ?? 0
  const cacheRead = t.cacheRead ?? 0
  const cacheWrite = t.cacheWrite ?? 0
  return { input, output, cacheRead, cacheWrite, total: t.total ?? input + output + cacheRead + cacheWrite }
}

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  total: a.total + b.total,
})

export const sumTokens = (steps: Step[]): Tokens => steps.reduce((a, s) => addTokens(a, s.tokens), noTokens())

export const sumRequests = (steps: Step[]): Tokens =>
  steps.reduce((a, s) => (s.request ? addTokens(a, s.request) : a), noTokens())

export function finalizeSteps(drafts: DraftStep[], sessionEnd: number): Step[] {
  const sorted = [...drafts].sort((a, b) => a.start - b.start)
  return sorted.map((d, i) => {
    const next = sorted[i + 1]
    const fallback = next ? next.start : sessionEnd
    const end = Math.max(d.start, d.end ?? fallback)
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

export const oneLine = (s: string, max = 140): string => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('fills step ends from the next step and preserves explicit ends', () => {
    const base = { id: '', kind: 'meta' as const, label: '', preview: '', fields: [], raw: null }
    const steps = finalizeSteps(
      [
        { ...base, id: 'b', start: 100, end: 150 },
        { ...base, id: 'a', start: 0 },
        { ...base, id: 'c', start: 200 },
      ],
      500,
    )
    expect(steps.map((s) => [s.id, s.start, s.end, s.durationMs])).toEqual([
      ['a', 0, 100, 100],
      ['b', 100, 150, 50],
      ['c', 200, 500, 300],
    ])
  })
  it('derives token totals when not supplied', () => {
    expect(tokensOf({ input: 3, output: 4, cacheRead: 1 }).total).toBe(8)
    expect(tokensOf({ input: 3, output: 4, total: 99 }).total).toBe(99)
  })
}

export function idleDraft(id: string, start: number, end: number): DraftStep {
  return {
    id,
    kind: 'idle',
    label: 'Waiting for you',
    preview: 'Nothing ran while the session waited for the next prompt',
    start,
    end,
    fields: [
      {
        label: 'Gap',
        value: `${((end - start) / 1000).toFixed(1)}s between the last reply and the next prompt`,
        format: 'text',
      },
    ],
    raw: null,
  }
}

export interface BlockDraft {
  id: string
  kind: StepKind
  label: string
  preview: string
  fields: Field[]
  raw: unknown
  weight: number
  thinking?: boolean
  isError?: boolean
  model?: string
  end?: number
  injectedTokens?: number
}

export interface GroupUsage {
  tokens: Tokens
  thinkingTokens: number
  costUsd: number
}

export function distribute(total: number, weights: number[]): number[] {
  if (!weights.length) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    const each = Math.floor(total / weights.length)
    const out = weights.map(() => each)
    out[out.length - 1] = each + (total - each * weights.length)
    return out
  }
  const out = weights.map((w) => Math.floor((total * w) / sum))
  const used = out.reduce((a, b) => a + b, 0)
  const heaviest = weights.indexOf(Math.max(...weights))
  out[heaviest] = (out[heaviest] ?? 0) + (total - used)
  return out
}

const share = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  return sum > 0 ? weights.map((w) => (total * w) / sum) : weights.map(() => total / weights.length)
}

export interface Allocation {
  tokens: Tokens
  request?: Tokens
  costUsd: number
}

export function allocateTokens(blocks: BlockDraft[], usage: GroupUsage): Allocation[] {
  const thinkers = blocks.map((b, i) => (b.thinking ? i : -1)).filter((i) => i >= 0)
  const others = blocks.map((b, i) => (b.thinking ? -1 : i)).filter((i) => i >= 0)
  const output = usage.tokens.output
  const weightsOf = (idx: number[]) => idx.map((i) => Math.max(1, blocks[i]!.weight))
  const outputs: number[] = new Array(blocks.length).fill(0)
  if (!others.length) {
    distribute(output, weightsOf(thinkers)).forEach((v, k) => (outputs[thinkers[k]!] = v))
  } else {
    const thinkingTotal = thinkers.length ? Math.min(usage.thinkingTokens, output) : 0
    distribute(thinkingTotal, weightsOf(thinkers)).forEach((v, k) => (outputs[thinkers[k]!] = v))
    distribute(output - thinkingTotal, weightsOf(others)).forEach((v, k) => (outputs[others[k]!] = v))
  }
  return blocks.map((_, i) => ({
    tokens: tokensOf({ output: outputs[i] as number }),
    request: i === 0 ? usage.tokens : undefined,
    costUsd: i === 0 ? usage.costUsd : 0,
  }))
}

export function spanBlocks(blocks: BlockDraft[], start: number, end: number): { start: number; end: number }[] {
  const ends = spanEnds(blocks, start, end)
  return blocks.map((_, i) => ({ start: i === 0 ? start : (ends[i - 1] as number), end: ends[i] as number }))
}

export function toDraft(block: BlockDraft, span: { start: number; end: number }, alloc?: Allocation): DraftStep {
  return {
    id: block.id,
    kind: block.kind,
    label: block.label,
    preview: block.preview,
    fields: block.fields,
    raw: block.raw,
    model: block.model,
    isError: block.isError ?? false,
    injectedTokens: block.injectedTokens ?? 0,
    start: span.start,
    end: span.end,
    tokens: alloc?.tokens,
    request: alloc?.request,
    costUsd: alloc?.costUsd,
  }
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

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const block = (id: string, weight: number, thinking = false): BlockDraft => ({
    id,
    kind: 'response',
    label: '',
    preview: '',
    fields: [],
    raw: null,
    weight,
    thinking,
  })
  it('splits output tokens across the blocks of one response, exactly', () => {
    const allocations = allocateTokens([block('t', 10, true), block('a', 30), block('b', 70)], {
      tokens: tokensOf({ input: 5, output: 1000, cacheRead: 200 }),
      thinkingTokens: 300,
      costUsd: 0,
    })
    expect(allocations.map((a) => a.tokens.output)).toEqual([300, 210, 490])
    expect(allocations.map((a) => a.tokens.total)).toEqual([300, 210, 490])
    expect(allocations[0]!.request?.cacheRead).toBe(200)
    expect(allocations[1]!.request).toBeUndefined()
  })
  it('spreads a span over blocks that have no timestamps of their own', () => {
    expect(spanBlocks([block('a', 1), block('b', 3)], 0, 100)).toEqual([
      { start: 0, end: 25 },
      { start: 25, end: 100 },
    ])
  })

  it('leaves a timed block room when the blocks before it carry no timestamps', () => {
    expect(spanBlocks([block('a', 1), { ...block('b', 1), end: 100 }], 0, 200)).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 100 },
    ])
  })
}

export interface RequestMark {
  at: number
  context: number
  output: number
}

export function attributeInput(steps: Step[], requests: RequestMark[]): Step[] {
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

export const contextOf = (t: Tokens): number => t.input + t.cacheRead + t.cacheWrite

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const step = (id: string, end: number, injectedTokens: number, output = 0): Step => ({
    id,
    index: 0,
    kind: 'meta',
    label: '',
    preview: '',
    start: end,
    end,
    durationMs: 0,
    tokens: tokensOf({ output }),
    injectedTokens,
    costUsd: 0,
    isError: false,
    fields: [],
    raw: null,
  })

  it('charges a step only for the content it adds, never for re-sent context', () => {
    const late = step('late-prompt', 300, 10)
    attributeInput(
      [step('first-prompt', 100, 100), late],
      [
        { at: 100, context: 20000, output: 500 },
        { at: 300, context: 40000, output: 200 },
      ],
    )
    expect(late.tokens.total).toBe(10)
  })

  it('scales estimates down when the measured context grew by less', () => {
    const a = step('a', 10, 1000)
    attributeInput([a], [{ at: 10, context: 100, output: 0 }])
    expect(a.tokens.input).toBe(100)
  })

  it('falls back to the size estimate when the measured growth is unusable', () => {
    const a = step('a', 10, 1000)
    attributeInput([a], [{ at: 10, context: 0, output: 0 }])
    expect(a.tokens.input).toBe(1000)
  })

  it('leaves the unexplained baseline unattributed rather than inflating a step', () => {
    const a = step('a', 10, 100)
    attributeInput([a], [{ at: 10, context: 26000, output: 0 }])
    expect(a.tokens.input).toBe(100)
  })
}

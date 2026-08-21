import { Harness, ResponseBlock, SessionEvent, SessionFile, Usage } from './harness'
import {
  Allocation,
  BlockDraft,
  DraftStep,
  RequestMark,
  Session,
  Tokens,
  addTokens,
  allocateTokens,
  attributeInput,
  contextOf,
  noTokens,
  finalizeSteps,
  idleDraft,
  oneLine,
  spanBlocks,
  sumTokens,
  toDraft,
  tokensOf,
} from './model'
import { estimateTokens } from './estimate'
import { argFields, argPreview, valueFields } from './render'

const IDLE_MS = 1500

export function buildSession(harness: Harness, file: SessionFile): Session {
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
      const start = event.startedAt
        ? Math.min(Math.max(event.startedAt, cursor), end)
        : Math.min(cursor, at)
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
            value: `${secs(wrote - step.start)} writing the call, ${secs(at - wrote)} running it`,
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
        kind: 'prompt',
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
      kind: 'meta',
      label: event.label,
      preview: event.preview ?? oneLine(event.context ?? JSON.stringify(event.detail ?? null)),
      start: Math.min(cursor, at),
      end: at,
      injectedTokens: estimateTokens(event.context ?? ''),
      fields: valueFields(event.label, event.detail),
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
    allocateTokens(blocks, { tokens, thinkingTokens: usage.reasoning, costUsd: usage.costUsd }).forEach(
      (allocation, i) => allocations.set(blocks[i]!.id, allocation),
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
      kind: 'tool',
      label: prefix + label,
      preview: argPreview(block.args),
      weight: JSON.stringify(block.args ?? {}).length,
      fields: [
        ...argFields(block.args),
        ...(source ? [{ label: 'Tool', value: source, format: 'text' as const }] : []),
      ],
    }
  }

  const thinking = block.type === 'thinking'
  const stored = block.text.trim().length > 0
  return {
    ...common,
    kind: thinking ? 'thinking' : 'response',
    label: prefix + (thinking ? 'Thinking' : 'Assistant'),
    preview: stored ? oneLine(block.text) : 'Reasoning was not stored in this transcript',
    weight: block.text.length || 1,
    thinking,
    fields: [
      {
        label: thinking ? 'Reasoning' : 'Message',
        value: stored
          ? block.text
          : 'This transcript keeps an encrypted signature in place of the reasoning text.',
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

const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

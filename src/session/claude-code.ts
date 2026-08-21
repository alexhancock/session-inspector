import {
  Allocation,
  BlockDraft,
  DraftStep,
  Fact,
  Session,
  allocateTokens,
  finalizeSteps,
  idleDraft,
  oneLine,
  spanBlocks,
  sumTokens,
  toDraft,
  tokensOf,
} from './model'
import { argFields, argPreview, textOf, valueFields } from './render'

type Rec = Record<string, any>

const IDLE_MS = 1500

const ts = (r: Rec): number => Date.parse(r.timestamp)

const isEvent = (r: Rec) =>
  typeof r?.timestamp === 'string' && ['user', 'assistant', 'attachment', 'system'].includes(r.type)

export function detect(input: unknown): boolean {
  return (
    Array.isArray(input) &&
    input.some((r: Rec) => r && typeof r === 'object' && r.sessionId && (r.type === 'assistant' || r.type === 'user'))
  )
}

export function parse(input: unknown, fileName: string): Session {
  const records = (input as Rec[]).filter((r) => r && typeof r === 'object')
  const events = records.filter(isEvent).sort((a, b) => ts(a) - ts(b))
  const startedAt = events.length ? ts(events[0]!) : Date.now()
  const endedAt = events.length ? ts(events[events.length - 1]!) : startedAt

  const blocksByEvent = new Map<number, BlockDraft[]>()
  const byRequest = new Map<string, BlockDraft[]>()
  events.forEach((r, idx) => {
    if (r.type !== 'assistant') return
    const content: Rec[] = Array.isArray(r.message?.content) ? r.message.content : []
    const list = content.map((b, bi) =>
      blockDraft(b, `${r.uuid ?? idx}-${bi}`, r.message?.model, Boolean(r.isSidechain), ts(r)),
    )
    blocksByEvent.set(idx, list)
    const key = String(r.message?.id ?? r.uuid ?? idx)
    byRequest.set(key, [...(byRequest.get(key) ?? []), ...list])
  })

  const allocations = new Map<string, Allocation>()
  byRequest.forEach((list, key) => {
    const u = events.find((r) => String(r.message?.id ?? '') === key)?.message?.usage ?? {}
    allocateTokens(list, {
      tokens: tokensOf({
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      }),
      thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
      costUsd: 0,
    }).forEach((a, i) => allocations.set(list[i]!.id, a))
  })

  const drafts: DraftStep[] = []
  const pendingTools = new Map<string, DraftStep>()
  let cursor = startedAt
  let model = ''
  let i = 0

  while (i < events.length) {
    const r = events[i]!
    const at = ts(r)

    if (r.type === 'assistant') {
      const msgId = r.message?.id
      let j = i
      const blocks: BlockDraft[] = []
      let groupEnd = at
      while (j < events.length && events[j]!.type === 'assistant' && events[j]!.message?.id === msgId) {
        blocks.push(...(blocksByEvent.get(j) ?? []))
        groupEnd = ts(events[j]!)
        j++
      }
      model = r.message?.model || model
      spanBlocks(blocks, Math.min(cursor, at), groupEnd).forEach((span, k) => {
        const block = blocks[k]!
        const step = toDraft(block, span, allocations.get(block.id))
        drafts.push(step)
        const raw = block.raw as Rec
        if (raw?.type === 'tool_use' && raw.id) pendingTools.set(raw.id, step)
      })
      cursor = groupEnd
      i = j
      continue
    }

    if (r.type === 'user') {
      const content = r.message?.content
      const contentBlocks: Rec[] = Array.isArray(content) ? content : []
      const results = contentBlocks.filter((b) => b.type === 'tool_result')
      if (results.length) {
        results.forEach((b) => {
          const step = pendingTools.get(b.tool_use_id)
          const body = textOf(b.content)
          if (!step) return
          const wrote = step.end ?? step.start
          step.end = Math.max(wrote, at)
          step.isError = Boolean(b.is_error)
          step.fields.push({
            label: b.is_error ? 'Error' : 'Result',
            value: body || '(empty)',
            format: body.includes('\n') ? 'code' : 'text',
          })
          step.fields.push({
            label: 'Timing',
            value: `${secs(wrote - step.start)} writing the call, ${secs(at - wrote)} running it`,
            format: 'text',
          })
          pendingTools.delete(b.tool_use_id)
        })
        cursor = at
        i++
        continue
      }
      const body = textOf(content)
      const human = r.origin?.kind === 'human' || r.promptSource === 'typed'
      if (human && at - cursor > IDLE_MS) drafts.push(idleDraft(`${r.uuid}-idle`, cursor, at))
      drafts.push({
        id: String(r.uuid ?? i),
        kind: human ? 'prompt' : 'meta',
        label: human ? 'Prompt' : 'User context',
        preview: oneLine(body),
        start: human ? at : Math.min(cursor, at),
        end: at,
        fields: [{ label: human ? 'Prompt' : 'Content', value: body, format: 'text' }],
        raw: r,
      })
      cursor = at
      i++
      continue
    }

    const a = r.attachment
    drafts.push({
      id: String(r.uuid ?? i),
      kind: 'meta',
      label: humanize(String(a ? (a.type ?? 'attachment') : (r.subtype ?? 'system'))),
      preview: a
        ? attachmentPreview(a)
        : r.subtype === 'turn_duration'
          ? `Turn completed in ${(r.durationMs / 1000).toFixed(1)}s across ${r.messageCount} messages`
          : oneLine(JSON.stringify(r)),
      start: Math.min(cursor, at),
      end: at,
      fields: valueFields(a ? 'Attachment' : 'Event', a ?? r),
      raw: r,
    })
    cursor = at
    i++
  }

  const steps = finalizeSteps(drafts, endedAt)
  const first = events[0] ?? {}
  const meta = (type: string) => records.find((r) => r.type === type) ?? {}
  const firstPrompt = steps.find((s) => s.kind === 'prompt')

  const facts: Fact[] = fact([
    ['Agent', 'Claude Code'],
    ['Model', model],
    ['Working directory', first.cwd],
    ['Git branch', first.gitBranch],
    ['Version', first.version],
    ['Permission mode', meta('permission-mode').permissionMode],
    ['Session ID', first.sessionId],
  ])

  return {
    id: first.sessionId ?? fileName,
    title: meta('ai-title').aiTitle || (firstPrompt ? oneLine(firstPrompt.preview, 64) : fileName),
    agent: 'Claude Code',
    model: model || 'unknown',
    cwd: first.cwd ?? '',
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    steps,
    tokens: sumTokens(steps),
    costUsd: 0,
    facts,
    fileName,
  }
}

function blockDraft(b: Rec, id: string, model: string | undefined, sidechain: boolean, end: number): BlockDraft {
  const prefix = sidechain ? 'Subagent · ' : ''
  const common = { id, model, end, raw: b }
  if (b.type === 'thinking' || b.type === 'redacted_thinking') {
    const body = String(b.thinking ?? '')
    return {
      ...common,
      kind: 'thinking',
      label: `${prefix}Thinking`,
      preview: body ? oneLine(body) : 'Reasoning was not stored in this transcript',
      weight: body.length || 1,
      thinking: true,
      fields: [
        {
          label: 'Reasoning',
          value: body || 'This transcript keeps an encrypted signature in place of the reasoning text.',
          format: 'text',
        },
      ],
    }
  }
  if (b.type === 'text') {
    const body = String(b.text ?? '')
    return {
      ...common,
      kind: 'response',
      label: `${prefix}Assistant`,
      preview: oneLine(body),
      weight: body.length,
      fields: [{ label: 'Message', value: body, format: 'text' }],
    }
  }
  if (b.type === 'tool_use') {
    return {
      ...common,
      kind: 'tool',
      label: `${prefix}${b.name}`,
      preview: argPreview(b.input),
      weight: JSON.stringify(b.input ?? {}).length,
      fields: argFields(b.input),
    }
  }
  return {
    ...common,
    kind: 'meta',
    label: `${prefix}${humanize(String(b.type ?? 'block'))}`,
    preview: oneLine(JSON.stringify(b)),
    weight: 1,
    fields: valueFields('Block', b),
  }
}

const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

const humanize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const fact = (rows: (string | undefined)[][]): Fact[] =>
  rows.filter((r) => r[1]).map(([label, value]) => ({ label: label as string, value: String(value) }))

function attachmentPreview(a: Rec): string {
  if (Array.isArray(a.addedNames)) return `${a.addedNames.length} tools available`
  if (typeof a.content === 'string') return oneLine(a.content)
  if (typeof a.text === 'string') return oneLine(a.text)
  return oneLine(JSON.stringify(a))
}

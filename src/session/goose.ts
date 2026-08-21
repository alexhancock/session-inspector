import {
  BlockDraft,
  DraftStep,
  Fact,
  Session,
  expandGroup,
  finalizeSteps,
  idleDraft,
  oneLine,
  sumTokens,
  tokensOf,
} from './model'
import { argFields, argPreview, textOf, valueFields } from './render'

type Rec = Record<string, any>

const IDLE_MS = 1500

export function detect(input: unknown): boolean {
  const d = input as Rec
  return Boolean(d && typeof d === 'object' && Array.isArray(d.conversation) && d.working_dir !== undefined)
}

export function parse(input: unknown, fileName: string, fileBytes: number): Session {
  const d = input as Rec
  const messages: Rec[] = d.conversation.filter((m: Rec) => m && Array.isArray(m.content))
  const startedAt = Date.parse(d.created_at) || (messages[0]?.created ?? 0) * 1000
  const endedAt = Math.max(Date.parse(d.updated_at) || 0, startedAt)

  const drafts: DraftStep[] = []
  const pendingTools = new Map<string, DraftStep>()
  let cursor = startedAt
  let i = 0

  while (i < messages.length) {
    const m = messages[i]!
    const at = (m.created ?? 0) * 1000

    if (m.role === 'assistant') {
      let j = i + 1
      while (j < messages.length && messages[j]!.role === 'assistant' && !messages[j]!.metadata?.usage) j++
      const group = messages.slice(i, j)
      const usage = m.metadata?.usage
      const groupEnd = (group[group.length - 1]!.created ?? 0) * 1000
      const span = Math.min(usage?.elapsedMs ?? groupEnd - cursor, Math.max(0, groupEnd - cursor))
      const start = Math.max(cursor, groupEnd - span)
      if (start > cursor) extendPrevious(drafts, start)

      const blocks: BlockDraft[] = group.flatMap((msg, gi) =>
        (msg.content as Rec[]).map((b, bi) => blockDraft(b, `${msg.id}-${gi}-${bi}`, msg)),
      )
      const steps = expandGroup(blocks, start, groupEnd, {
        tokens: tokensOf({
          input: Math.max(0, (usage?.inputTokens ?? 0) - (usage?.cacheReadTokens ?? 0) - (usage?.cacheWriteTokens ?? 0)),
          output: usage?.outputTokens ?? 0,
          cacheRead: usage?.cacheReadTokens ?? 0,
          cacheWrite: usage?.cacheWriteTokens ?? 0,
        }),
        thinkingTokens: 0,
        costUsd: usage?.cost ?? 0,
      })
      steps.forEach((s, k) => {
        drafts.push(s)
        const raw = blocks[k]!.raw as Rec
        if (raw?.type === 'toolRequest' && raw.id) pendingTools.set(raw.id, s)
      })
      cursor = groupEnd
      i = j
      continue
    }

    const blocks: Rec[] = m.content
    const responses = blocks.filter((b) => b.type === 'toolResponse')
    if (responses.length) {
      responses.forEach((b) => {
        const step = pendingTools.get(b.id)
        const result = b.toolResult?.value ?? {}
        const failed = b.toolResult?.status === 'error' || result.isError === true
        const body = result.content ? textOf(result.content) : textOf(b.toolResult?.error ?? result)
        if (!step) return
        step.isError = step.isError || failed
        step.fields.push({
          label: failed ? 'Error' : 'Result',
          value: body || '(empty)',
          format: body.includes('\n') ? 'code' : 'text',
        })
        pendingTools.delete(b.id)
      })
      cursor = Math.max(cursor, at)
      i++
      continue
    }

    const visible = m.metadata?.userVisible !== false
    const body = textOf(blocks)
    if (visible && at - cursor > IDLE_MS) {
      drafts.push(idleDraft(`${m.id}-idle`, cursor, at))
      cursor = at
    }
    drafts.push({
      id: String(m.id ?? i),
      kind: visible ? 'prompt' : 'meta',
      label: visible ? 'Prompt' : 'Turn context',
      preview: oneLine(body),
      start: visible ? at : Math.min(cursor, at),
      end: at,
      fields: [{ label: visible ? 'Prompt' : 'Content', value: body, format: 'text' }],
      raw: m,
    })
    cursor = Math.max(cursor, at)
    i++
  }

  extendPrevious(drafts, endedAt)
  const steps = finalizeSteps(drafts, endedAt)
  const model = d.model_config?.model_name ?? ''
  const extensions: string[] = (d.extension_data?.['enabled_extensions.v0']?.extensions ?? []).map(
    (e: Rec) => e.display_name ?? e.name,
  )

  const facts: Fact[] = [
    ['Agent', 'goose'],
    ['Model', model],
    ['Provider', d.provider_name],
    ['Working directory', d.working_dir],
    ['Mode', d.goose_mode],
    ['Context limit', d.model_config?.context_limit?.toLocaleString()],
    ['Extensions', extensions.join(', ')],
    ['Session ID', d.id],
  ]
    .filter((r) => r[1])
    .map(([label, value]) => ({ label: label as string, value: String(value) }))

  return {
    id: String(d.id ?? fileName),
    title: d.name || fileName,
    agent: 'goose',
    model,
    cwd: d.working_dir ?? '',
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    steps,
    tokens: sumTokens(steps),
    costUsd: steps.reduce((a, s) => a + s.costUsd, 0) || d.accumulated_cost || 0,
    facts,
    fileName,
    fileBytes,
  }
}

function blockDraft(b: Rec, id: string, m: Rec): BlockDraft {
  const common = { id, model: m.metadata?.inference?.requestedModel, raw: b }
  if (b.type === 'text') {
    const body = String(b.text ?? '')
    return {
      ...common,
      kind: 'response',
      label: 'Assistant',
      preview: oneLine(body),
      weight: body.length,
      fields: [{ label: 'Message', value: body, format: 'text' }],
    }
  }
  if (b.type === 'toolRequest') {
    const call = b.toolCall?.value ?? {}
    const failed = b.toolCall?.status === 'error'
    const name = String(call.name ?? 'tool')
    const parts = name.split('__')
    return {
      ...common,
      kind: 'tool',
      label: parts[parts.length - 1] as string,
      preview: failed ? oneLine(String(b.toolCall?.error ?? 'Tool call rejected')) : argPreview(call.arguments),
      weight: JSON.stringify(call.arguments ?? {}).length,
      isError: failed,
      fields: [
        ...argFields(call.arguments),
        {
          label: 'Tool',
          value: parts.length > 1 ? `${parts.slice(0, -1).join(' · ')} → ${parts[parts.length - 1]}` : name,
          format: 'text',
        },
      ],
    }
  }
  return {
    ...common,
    kind: 'meta',
    label: String(b.type ?? 'block'),
    preview: oneLine(JSON.stringify(b)),
    weight: 1,
    fields: valueFields('Block', b),
  }
}

function extendPrevious(drafts: DraftStep[], to: number) {
  const prev = drafts[drafts.length - 1]
  if (prev && (prev.end ?? prev.start) < to) prev.end = to
}

import { Fact } from './model'
import { Harness, ResponseBlock, SessionEvent, SessionFile, Summary, Usage } from './harness'
import { oneLine } from './model'
import { textOf } from './render'

type Rec = Record<string, any>

const KINDS = ['user', 'assistant', 'attachment', 'system']

const at = (r: Rec): number => Date.parse(r.timestamp)

const ordered = (file: SessionFile): Rec[] =>
  (file.data as Rec[])
    .filter((r) => r && typeof r === 'object' && typeof r.timestamp === 'string' && KINDS.includes(r.type))
    .sort((a, b) => at(a) - at(b))

const records = (file: SessionFile): Rec[] => (file.data as Rec[]).filter((r) => r && typeof r === 'object')

const contentBlocks = (content: unknown): Rec[] =>
  Array.isArray(content)
    ? content.filter((b): b is Rec => Boolean(b) && typeof b === 'object')
    : typeof content === 'string' && content
      ? [{ type: 'text', text: content }]
      : []

export const claudeCode: Harness = {
  agent: 'Claude Code',

  recognizes(file) {
    return (
      Array.isArray(file.data) &&
      file.data.some((r: Rec) => r && typeof r === 'object' && r.sessionId && ['user', 'assistant'].includes(r.type))
    )
  },

  summarize(file): Summary {
    const events = ordered(file)
    const first = events[0] ?? {}
    const last = events[events.length - 1] ?? first
    const meta = (type: string) => [...records(file)].reverse().find((r) => r.type === type) ?? {}
    const prompt = events.find((r) => r.type === 'user' && typeof r.message?.content === 'string')
    const model = [...events].reverse().find((r) => r.message?.model)?.message.model ?? 'unknown'

    return {
      id: first.sessionId ?? file.name,
      title: meta('ai-title').aiTitle || oneLine(textOf(prompt?.message?.content) || file.name, 64),
      model,
      cwd: first.cwd ?? '',
      startedAt: events.length ? at(first) : Date.now(),
      endedAt: events.length ? at(last) : Date.now(),
      facts: facts([
        ['Agent', 'Claude Code'],
        ['Model', model],
        ['Working directory', first.cwd],
        ['Git branch', first.gitBranch],
        ['Version', first.version],
        ['Permission mode', meta('permission-mode').permissionMode],
        ['Session ID', first.sessionId],
      ]),
    }
  },

  timeline(file): SessionEvent[] {
    const events = ordered(file)
    const out: SessionEvent[] = []
    let i = 0

    while (i < events.length) {
      const record = events[i] as Rec
      const when = at(record)

      if (record.type === 'assistant') {
        const requestId = record.message?.id
        const blocks: ResponseBlock[] = []
        let end = when
        do {
          const part = events[i] as Rec
          end = at(part)
          for (const block of contentBlocks(part.message?.content)) blocks.push(toBlock(block, end))
          i++
        } while (
          requestId != null &&
          i < events.length &&
          events[i]!.type === 'assistant' &&
          events[i]!.message?.id === requestId
        )
        out.push({
          type: 'response',
          at: end,
          blocks,
          requestId: String(requestId ?? record.uuid ?? when),
          model: record.message?.model,
          usage: toUsage(record.message?.usage),
          sidechain: Boolean(record.isSidechain),
          raw: record,
        })
        continue
      }

      if (record.type === 'user') {
        const parts = contentBlocks(record.message?.content)
        for (const result of parts.filter((b) => b.type === 'tool_result')) {
          out.push({
            type: 'result',
            at: when,
            callId: result.tool_use_id,
            text: textOf(result.content),
            failed: Boolean(result.is_error),
            raw: result,
          })
        }
        const rest = parts.filter((b) => b.type !== 'tool_result')
        if (rest.length) {
          const text = textOf(rest)
          const typed = record.origin?.kind === 'human' || record.promptSource === 'typed'
          out.push(
            typed
              ? { type: 'prompt', at: when, text, raw: record }
              : { type: 'note', at: when, label: 'User context', detail: text, context: text, raw: record },
          )
        }
        i++
        continue
      }

      const attachment = record.attachment
      out.push({
        type: 'note',
        at: when,
        label: humanize(attachment ? (attachment.type ?? 'attachment') : (record.subtype ?? 'system')),
        detail: attachment ?? record,
        context: attachment ? JSON.stringify(attachment) : undefined,
        preview: attachment ? attachmentPreview(attachment) : systemPreview(record),
        raw: record,
      })
      i++
    }

    return out
  },
}

function toBlock(block: Rec, when: number): ResponseBlock {
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return { type: 'thinking', text: String(block.thinking ?? ''), at: when, raw: block }
  }
  if (block.type === 'tool_use') {
    return { type: 'call', id: block.id, name: block.name, args: block.input, at: when, raw: block }
  }
  return { type: 'message', text: String(block.text ?? JSON.stringify(block)), at: when, raw: block }
}

const toUsage = (u: Rec = {}): Usage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  reasoning: u.output_tokens_details?.thinking_tokens ?? 0,
  costUsd: 0,
})

const humanize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const facts = (rows: (string | undefined)[][]): Fact[] =>
  rows.filter((r) => r[1]).map(([label, value]) => ({ label: label as string, value: String(value) }))

function attachmentPreview(a: Rec): string {
  if (Array.isArray(a.addedNames)) return `${a.addedNames.length} tools available`
  if (typeof a.content === 'string') return oneLine(a.content)
  if (typeof a.text === 'string') return oneLine(a.text)
  return oneLine(JSON.stringify(a))
}

const systemPreview = (r: Rec): string =>
  r.subtype === 'turn_duration'
    ? `Turn completed in ${(r.durationMs / 1000).toFixed(1)}s across ${r.messageCount} messages`
    : oneLine(JSON.stringify(r))

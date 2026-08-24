import { Fact, Harness, ResponseBlock, SessionEvent, SessionFile, Summary, Usage, textOf } from './harness'

type Rec = Record<string, any>

const messages = (file: SessionFile): Rec[] =>
  ((file.data as Rec).conversation as Rec[]).filter((m) => m && Array.isArray(m.content))

const at = (m: Rec): number => (Number.isFinite(m.created) ? m.created : 0) * 1000

export const goose: Harness = {
  agent: 'goose',

  recognizes(file) {
    const d = file.data as Rec
    return Boolean(d && typeof d === 'object' && Array.isArray(d.conversation) && d.working_dir !== undefined)
  },

  summarize(file): Summary {
    const d = file.data as Rec
    const list = messages(file)
    const startedAt = Date.parse(d.created_at) || at(list[0] ?? {})
    const extensions: string[] = (d.extension_data?.['enabled_extensions.v0']?.extensions ?? []).map(
      (e: Rec) => e.display_name ?? e.name,
    )
    const model = d.model_config?.model_name ?? 'unknown'

    return {
      id: String(d.id ?? file.name),
      title: d.name || file.name,
      model,
      cwd: d.working_dir ?? '',
      startedAt,
      endedAt: Math.max(Date.parse(d.updated_at) || 0, startedAt),
      facts: facts([
        ['Provider', d.provider_name],
        ['Working directory', d.working_dir],
        ['Mode', d.goose_mode],
        ['Context limit', d.model_config?.context_limit?.toLocaleString()],
        ['Extensions', extensions.join(', ')],
        ['Session ID', d.id],
      ]),
    }
  },

  timeline(file): SessionEvent[] {
    const list = messages(file)
    const out: SessionEvent[] = []
    let i = 0

    while (i < list.length) {
      const message = list[i] as Rec
      const when = at(message)

      if (message.role === 'assistant') {
        const usage = message.metadata?.usage
        const blocks: ResponseBlock[] = []
        let end = when
        let j = i
        while (j < list.length && list[j]!.role === 'assistant' && (j === i || !list[j]!.metadata?.usage)) {
          const part = list[j] as Rec
          end = at(part)
          for (const block of part.content as Rec[]) blocks.push(toBlock(block))
          j++
        }
        out.push({
          type: 'response',
          at: end,
          blocks,
          requestId: String(message.id ?? when),
          model: message.metadata?.inference?.requestedModel,
          usage: usage ? toUsage(usage) : undefined,
          startedAt: usage?.elapsedMs ? end - usage.elapsedMs : undefined,
          raw: message,
        })
        for (const rejected of rejectedCalls(list.slice(i, j)))
          out.push({ type: 'result', at: end, ...rejected, raw: rejected })
        i = j
        continue
      }

      const responses = (message.content as Rec[]).filter((b) => b.type === 'toolResponse')
      if (responses.length) {
        for (const response of responses) {
          const value = response.toolResult?.value ?? {}
          out.push({
            type: 'result',
            at: when,
            callId: response.id,
            text: value.content ? textOf(value.content) : textOf(response.toolResult?.error ?? value),
            failed: response.toolResult?.status === 'error' || value.isError === true,
            raw: response,
          })
        }
        i++
        continue
      }

      const text = textOf(message.content)
      out.push(
        message.metadata?.userVisible === false
          ? { type: 'note', at: when, label: 'Turn context', detail: text, context: text, raw: message }
          : { type: 'prompt', at: when, text, raw: message },
      )
      i++
    }

    return out
  },
}

const rejectedCalls = (group: Rec[]) =>
  group
    .flatMap((m) => m.content as Rec[])
    .filter((b) => b.type === 'toolRequest' && b.toolCall?.status === 'error')
    .map((b) => ({
      callId: String(b.id),
      text: String(b.toolCall?.error ?? 'The harness rejected this tool call'),
      failed: true as const,
    }))

function toBlock(block: Rec): ResponseBlock {
  if (block.type === 'toolRequest') {
    const call = block.toolCall?.value ?? {}
    return { type: 'call', id: block.id, name: String(call.name ?? 'tool'), args: call.arguments, raw: block }
  }
  return { type: 'message', text: String(block.text ?? JSON.stringify(block)), raw: block }
}

const toUsage = (u: Rec): Usage => ({
  input: Math.max(0, (u.inputTokens ?? 0) - (u.cacheReadTokens ?? 0) - (u.cacheWriteTokens ?? 0)),
  output: u.outputTokens ?? 0,
  cacheRead: u.cacheReadTokens ?? 0,
  cacheWrite: u.cacheWriteTokens ?? 0,
  reasoning: 0,
  costUsd: u.cost ?? 0,
})

const facts = (rows: (string | undefined)[][]): Fact[] =>
  rows.filter((r) => r[1]).map(([label, value]) => ({ label: label as string, value: String(value) }))

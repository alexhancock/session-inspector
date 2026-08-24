# Session Inspector

Drop in an agentic session and see every step, token, and second of it. Runs entirely
in the browser — the file is parsed locally and nothing is uploaded.

Deployed to **sessioninspector.ai**.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run test` | In-source unit tests (vitest) |
| `npm run build` | Typecheck, then build `dist/index.html` — one self-contained file |
| `npm run preview` | Serve the built file |
| `npm run deploy` | `vercel deploy --prod` |

## Supported sessions

| Agent | File | Detected by |
| --- | --- | --- |
| Claude Code | `.jsonl` transcript from `~/.claude/projects/<project>/` | records carrying `sessionId` with `type: user \| assistant` |
| goose | `.json` session | top-level `conversation` array plus `working_dir` |

Both demo files under `example-sessions/` are the same task ("render a spinning earth
with Three.js") run through each agent, so the two shapes are directly comparable.

## Adding an agent

A harness describes its own format and nothing else. Implement `Harness` from
`src/session/harness.ts` — three methods — and add it to the list in
`src/session/session.ts`:

```ts
export const myAgent: Harness = {
  agent: 'My Agent',
  recognizes(file) { ... },   // is this file ours?
  summarize(file) { ... },    // title, model, working directory, span, facts
  timeline(file) { ... },     // everything that happened, oldest first
}
```

`timeline` returns `SessionEvent[]`, a small union that says what happened without
saying how to draw it:

| Event | Means |
| --- | --- |
| `prompt` | A person typed something. The gap before it is reported as idle. |
| `response` | One model response, or the part of one that arrived before a tool ran. Carries its blocks (`thinking`, `message`, `call`), its `usage`, and a `requestId` so blocks split across several responses are billed once. |
| `result` | What a tool returned, matched to its `call` by id. |
| `note` | Everything else: injected context, attachments, harness events. |

The split between the two methods is the split between what a session *is* and what
*happened in it*. Configuration a harness records as a record — Claude Code writes auto
mode as an attachment — belongs in `summarize`'s `facts`, shown in the top bar. Only
things that occupied time or context belong in `timeline`.

`src/session/session.ts` turns that stream into the `Session` the interface reads, and
every harness gets the same treatment for free: block timings, token attribution, tool
call/result pairing, idle gaps, session totals, and field rendering. A harness never
builds a `Step`. That file is the whole of session handling — reconstruction, token
accounting, estimation, field rendering — behind six exports: `Session`, `Step`,
`StepType`, `parseSessionText`, `readSessionFile`, and `UnknownSessionError`. Nothing
else about how a session is put together is visible to the interface.

Two optional fields exist for things only a harness can know: `Response.startedAt`,
when the format records how long generation took, and `Response.sidechain`, when the
work belongs to a subagent.

## How the numbers are worked out

Both agents log a transcript, not a profile, so timings and token counts are
reconstructed. The rules:

- **A step is one content block** — a prompt, a thinking block, an assistant message, or
  a tool call merged with its result.
- **Time is attributed to the block that was being produced.** A block's span runs from
  the previous event to its own timestamp, so the 47 seconds spent streaming a long
  `Bash` heredoc land on that tool call rather than on the message before it. Tool steps
  extend to their result and record the split in a `Timing` field
  ("46.7s writing the call, 2.5s running it").
- **A step is sized by what it contributes, not by what it was charged.** An agent
  re-sends the whole conversation on every request, so per-request usage makes every
  late step look enormous — a three-word follow-up prompt would outrank the tool call
  that wrote a 10KB file. Each step is instead credited with the tokens it *added*:
  what the model generated for that block, plus what the block injected into the
  context (a prompt's text, a tool result, an attachment).
  - Output is exact, split across a response's blocks by size, with reasoning tokens
    going to thinking blocks.
  - Input is estimated from text length, then calibrated against how much
    the measured context actually grew between consecutive requests. If the measured
    growth is smaller than the estimate, the estimate scales down; if it's larger, the
    excess (the system prompt and tool definitions, which no step represents) is left
    unattributed rather than inflating a step. Where an agent's own numbers make the
    growth unusable, the estimate stands on its own.

    The estimator is one line — characters ÷ 2.5 — and that divisor is measured, not
    guessed. Against the 11 request gaps in the demo sessions where the transcripts
    record real context growth, it lands within 15% (median), mean ratio 0.99. A real
    BPE tokenizer was tried and rejected: `gpt-tokenizer`'s `cl100k_base` scored *worse*
    on the same gaps (21% median, mean 0.84) while adding 449 KB gzipped to a 115 KB
    bundle. It measures the text precisely but still misses the per-message framing —
    role tokens, content-block JSON, tool-result wrappers — that the divisor absorbs.
    Anthropic also documents that OpenAI tokenizers are simply wrong for Claude. It
    lives behind one function, `estimateTokens`, if it ever needs to be swapped.
- **The billed totals are still reported, at the session level.** The stat band shows
  `Conversation` (the whole conversation counted once — the sum of every step's
  contribution) next to `Consumed` (what it cost to send that conversation once per
  request, cache included). A step's detail reports only its own contribution. The two
  demo sessions consume 174,050 and 306,659 tokens — matching their own files — while
  the conversations themselves are about 15k and 20k.

- **Gaps before a human prompt become explicit `Waiting for you` steps**, so idle time is
  visible instead of inflating whatever ran last.

Token accounting is normalized to Anthropic semantics: `input` excludes cache, and
`total = input + output + cacheRead + cacheWrite`.

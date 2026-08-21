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

Everything downstream of parsing works against one shape, so a new agent only has to
produce it. Write a module in `src/session/` exporting:

```ts
export function detect(input: unknown): boolean
export function parse(input: unknown, fileName: string): Session
```

and add it to the `adapters` list in `src/session/index.ts`. `input` is already decoded
from JSON or JSONL. `src/session/model.ts` carries the shared primitives an adapter
needs — most importantly `allocateTokens` and `spanBlocks`, which split one model
response's usage and wall-clock time across the content blocks it produced.

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
- **Usage is per API request, split across the blocks it produced.** Output tokens are
  divided by block size, with reasoning tokens going to thinking blocks; input and cache
  tokens sit on the request's first block. Totals stay exact — the two demo sessions sum
  to the totals their own files report (174,050 and 306,659 tokens; $0.6549).
- **Gaps before a human prompt become explicit `Waiting for you` steps**, so idle time is
  visible instead of inflating whatever ran last.

Token accounting is normalized to Anthropic semantics: `input` excludes cache, and
`total = input + output + cacheRead + cacheWrite`.

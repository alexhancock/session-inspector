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

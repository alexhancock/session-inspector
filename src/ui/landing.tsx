import { DragEvent, useEffect, useRef, useState } from 'react'
import { mountBackdrop } from './backdrop'

export interface Demo {
  id: string
  agent: string
  name: string
  fileName: string
  text: string
}

interface Props {
  demos: Demo[]
  error: string | null
  busy: boolean
  onFiles: (files: File[]) => void
  onDemo: (demo: Demo) => void
}

const DEMO_MIME = 'application/x-session-demo'

const GUIDES = [
  {
    agent: 'Claude Code',
    steps: [
      'Transcripts are written as you work to `~/.claude/projects/<project>/<session-id>.jsonl`.',
      'Copy that file out and drop it here. `/export` writes readable text, not this format.',
    ],
    href: 'https://code.claude.com/docs/en/sessions#export-and-locate-session-data',
  },
  {
    agent: 'goose',
    steps: [
      'Desktop: open Session History, hover a session, and export it as JSON.',
      'Terminal: run `goose session export` and choose the JSON format.',
    ],
    href: 'https://goose-docs.ai/docs/guides/sessions/session-management#export-sessions',
  },
]

export function Landing({ demos, error, busy, onFiles, onDemo }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [guide, setGuide] = useState(false)

  useEffect(() => (canvas.current ? mountBackdrop(canvas.current) : undefined), [])

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const demo = demos.find((d) => d.id === e.dataTransfer.getData(DEMO_MIME))
    if (demo) return onDemo(demo)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }

  return (
    <div className="landing">
      <canvas ref={canvas} aria-hidden />
      <div
        className={`sheet${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
        }}
        onDrop={drop}
      >
        <div className="masthead">
          <h1>
            Session
            <br />
            <em>Inspector</em>
          </h1>
          <span className="label masthead-note">
            Every step, token,
            <br />
            and second of an
            <br />
            agentic session
          </span>
        </div>

        <button type="button" className="drop" onClick={() => input.current?.click()}>
          <span className="drop-grid" aria-hidden>
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="drop-zone">
            <span className="drop-head">{busy ? 'Reading' : over ? 'Release to open' : 'Drop a session file'}</span>
            <span className="label drop-formats">Claude Code .jsonl · goose .json</span>
          </span>
        </button>

        <input
          ref={input}
          type="file"
          accept=".json,.jsonl,application/json"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) onFiles(files)
          }}
        />

        {error && <p className="error">{error}</p>}

        {guide && (
          <div className="guide">
            {GUIDES.map((g) => (
              <div className="guide-col" key={g.agent}>
                <div className="label">{g.agent}</div>
                {g.steps.map((step) => (
                  <p key={step}>
                    {step.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
                  </p>
                ))}
                <a href={g.href} target="_blank" rel="noreferrer noopener">
                  Docs ↗
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="sheet-foot">
          <button
            type="button"
            className="info"
            aria-expanded={guide}
            aria-label="Where to find your session file"
            title="Where to find your session file"
            onClick={() => setGuide(!guide)}
          >
            i
          </button>
          <div className="demos">
            <span className="label">Try one</span>
            {demos.map((d) => (
              <button
                key={d.id}
                type="button"
                className="demo"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DEMO_MIME, d.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onDemo(d)}
              >
                <span className="label">{d.agent}</span>
                <span className="demo-name">{d.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

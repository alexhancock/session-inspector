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

export function Landing({ demos, error, busy, onFiles, onDemo }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

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
          <span className="label">
            Claude Code
            <br />
            goose
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
          <span className="label">{busy ? 'Reading the file' : over ? 'Release to open' : 'Drop a session file'}</span>
          <span className="drop-head">
            Every step, token, and second
            <br />
            of an agentic session.
          </span>
          <p className="drop-sub">
            Drag in a <span className="mono">.jsonl</span> transcript or a <span className="mono">.json</span> session —
            or click to browse.
          </p>
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

        <div className="sheet-foot">
          <span className="label">Parsed in your browser · nothing is uploaded</span>
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

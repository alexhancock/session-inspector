import { useEffect } from 'react'
import { Session, Step } from '../session'
import { clock, compact, count, cost, duration, offset } from '../format'
import { KIND_COLOR, KIND_NAME } from './palette'

interface Props {
  session: Session
  step: Step
  hasPrev: boolean
  hasNext: boolean
  onMove: (delta: number) => void
  onClose: () => void
}

export function Detail({ session, step, hasPrev, hasNext, onMove, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && hasPrev) onMove(-1)
      if (e.key === 'ArrowRight' && hasNext) onMove(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onMove, hasPrev, hasNext])

  const t = step.tokens
  const meta: [string, string][] = [
    ['Kind', KIND_NAME[step.kind]],
    ['Step', `${step.index + 1} of ${session.steps.length}`],
    ['Started', `${clock(step.start)} · ${offset(step.start - session.startedAt)} in`],
    ['Duration', duration(step.durationMs)],
    ['Share of session', `${((step.durationMs / Math.max(1, session.durationMs)) * 100).toFixed(1)}%`],
    ['Tokens', t.total ? count(t.total) : '—'],
    ['Output', t.output ? count(t.output) : '—'],
    ['Input', t.input ? count(t.input) : '—'],
    ['Cache read', t.cacheRead ? count(t.cacheRead) : '—'],
    ['Cache write', t.cacheWrite ? count(t.cacheWrite) : '—'],
    ['Cost', step.costUsd ? cost(step.costUsd) : '—'],
    ['Model', step.model ?? session.model],
  ]

  return (
    <div className="detail" role="dialog" aria-modal aria-label={`${step.label} detail`}>
      <div className="detail-top">
        <span className="chip" style={{ background: KIND_COLOR[step.kind] }} aria-hidden />
        <h2>{step.label}</h2>
        <span className="mono detail-sub">
          {compact(step.tokens.total)} tok · {duration(step.durationMs)}
        </span>
        <div className="nav">
          <button type="button" onClick={() => onMove(-1)} disabled={!hasPrev}>
            ← Prev
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!hasNext}>
            Next →
          </button>
          <button type="button" className="close" onClick={onClose}>
            Close ⎋
          </button>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-meta">
          {meta
            .filter(([, v]) => v && v !== '—')
            .map(([label, value]) => (
              <div className="meta-row" key={label}>
                <div className="label">{label}</div>
                <div className="meta-value">{value}</div>
              </div>
            ))}
        </div>

        <div className="detail-fields">
          {step.preview && step.fields.length === 0 && (
            <div className="field">
              <div className="label">Summary</div>
              <div className="field-body">{step.preview}</div>
            </div>
          )}
          {step.fields.map((f, i) => (
            <div className="field" key={`${f.label}-${i}`}>
              <div className="label">{f.label}</div>
              <div className={`field-body ${f.format}`}>{f.value}</div>
            </div>
          ))}
          <div className="field">
            <div className="label">Raw record</div>
            <div className="field-body json">{JSON.stringify(step.raw, null, 2)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

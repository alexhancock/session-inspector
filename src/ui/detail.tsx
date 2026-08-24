import { useEffect } from 'react'
import { Session, Step } from '../session/session'
import { clock, compact, count, cost, duration, offset } from '../format'
import { TYPE_COLOR, TYPE_NAME } from './palette'

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
  const share = (part: number, whole: number) => `${((part / Math.max(1, whole)) * 100).toFixed(1)}% of session`
  const meta: [string, string][] = [
    ['Type', TYPE_NAME[step.type]],
    ['Step', `${step.index + 1} of ${session.steps.length}`],
    ['Started', `${clock(step.start)} · ${offset(step.start - session.startedAt)} in`],
    ['Duration', `${duration(step.durationMs)} · ${share(step.durationMs, session.durationMs)}`],
    ['Tokens', t.total ? `${count(t.total)} · ${share(t.total, session.contributed.total)}` : '—'],
    ['Cost', step.costUsd ? cost(step.costUsd) : '—'],
    ['Model', step.model ?? session.model],
  ]

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="detail"
        role="dialog"
        aria-modal
        aria-label={`${step.label} detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`detail-top${step.isError ? ' err' : ''}`}>
          <span className="chip" style={{ background: TYPE_COLOR[step.type] }} aria-hidden />
          <h2>{step.label}</h2>
          <span className="mono detail-sub">
            {compact(step.tokens.total)} tok · {duration(step.durationMs)}
          </span>
          <div className="nav">
            <button type="button" onClick={() => onMove(-1)} disabled={!hasPrev} aria-label="Previous step">
              ←
            </button>
            <button type="button" onClick={() => onMove(1)} disabled={!hasNext} aria-label="Next step">
              →
            </button>
          </div>
          <button type="button" className="dismiss" onClick={onClose} aria-label="Close">
            ✕
          </button>
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
    </div>
  )
}

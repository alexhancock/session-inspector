import { useEffect, useMemo, useRef, useState } from 'react'
import { Session, Step } from '../session/session'
import { clock, compact, count, cost, day, duration } from '../format'
import { TYPE_COLOR, TYPE_NAME, TYPE_ORDER } from './palette'
import { Treemap } from './treemap'
import { Detail } from './detail'

type Sort = 'chronological' | 'duration' | 'tokens'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'chronological', label: 'Chronological' },
  { id: 'duration', label: 'Duration' },
  { id: 'tokens', label: 'Tokens' },
]

export function Inspector({ session, onReset }: { session: Session; onReset: () => void }) {
  const [sort, setSort] = useState<Sort>('chronological')
  const [showMeta, setShowMeta] = useState(true)
  const [panel, setPanel] = useState(() => window.innerWidth >= 900)
  const [hovered, setHovered] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState(false)

  const metric = sort === 'tokens' ? 'tokens' : 'duration'
  const measure = (s: Step) => (metric === 'tokens' ? s.tokens.total : s.durationMs)

  const visible = useMemo(() => {
    const kept = session.steps.filter((s) => showMeta || s.type !== 'meta')
    if (sort === 'chronological') return kept
    return [...kept].sort((a, b) => measure(b) - measure(a) || a.index - b.index)
  }, [session, sort, showMeta])

  const peak = Math.max(1, ...visible.map(measure))
  const openIndex = visible.findIndex((s) => s.id === openId)
  const open = openIndex >= 0 ? visible[openIndex] : undefined
  const metaCount = session.steps.filter((s) => s.type === 'meta').length
  const errors = session.steps.filter((s) => s.isError).length
  const tools = session.steps.filter((s) => s.type === 'tool').length
  const requests = session.steps.filter((s) => s.request).length
  const cached = session.tokens.cacheRead

  const stats: [string, string, string][] = [
    ['Duration', duration(session.durationMs), `${day(session.startedAt)} · ${clock(session.startedAt)}`],
    ['Steps', count(session.steps.length), `${metaCount} system events`],
    ['Tool calls', count(tools), errors ? `${errors} returned an error` : 'all succeeded'],
    ['Conversation', `${compact(session.contributed.total)} tokens`, 'the whole conversation, counted once'],
    [
      'Consumed',
      `${compact(session.tokens.total)} tokens`,
      cached
        ? `${count(requests)} requests · ${compact(cached)} read from cache`
        : `${count(requests)} requests, each resending the conversation`,
    ],
  ]
  if (session.costUsd) stats.push(['Cost', cost(session.costUsd), 'as reported by the agent'])

  return (
    <div className="app">
      <header className="top">
        <button type="button" className="wordmark" onClick={onReset} title="Back to the start">
          Session<em>Inspector</em>
        </button>
        <span className="badge solid label">{session.agent}</span>
        <span className="model mono">{session.model}</span>
        <button
          type="button"
          className="info"
          aria-expanded={details}
          aria-label="Session details"
          title="Session details"
          onClick={() => setDetails(!details)}
        >
          i
        </button>
        <div className="session-name">
          <span className="label">Session title</span>
          <span className="session-title" title={session.fileName}>
            {session.title}
          </span>
        </div>
        <button type="button" className="close" onClick={onReset}>
          New session
        </button>
      </header>

      {details && (
        <div className="facts">
          {session.facts.map((f) => (
            <div className="fact" key={f.label}>
              <div className="label">{f.label}</div>
              <div className="fact-value mono">{f.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="stats">
        {stats.map(([label, value, note]) => (
          <div className="stat" key={label}>
            <div className="label">{label}</div>
            <div className="stat-value">{value}</div>
            <div className="stat-note">{note}</div>
          </div>
        ))}
      </div>

      <div className={`body${panel ? ' split' : ''}`}>
        <section className="timeline">
          <div className="controls">
            <span className="label">Sort</span>
            <div className="segmented">
              {SORTS.map((s) => (
                <button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" className="toggle" aria-pressed={showMeta} onClick={() => setShowMeta(!showMeta)}>
              System events {showMeta ? 'shown' : 'hidden'}
            </button>
            <button
              type="button"
              className="toggle"
              style={{ marginLeft: 'auto' }}
              aria-pressed={panel}
              onClick={() => setPanel(!panel)}
            >
              {panel ? 'Hide' : 'Show'} treemap
            </button>
          </div>

          <div className="rows">
            {visible.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`row${s.isError ? ' err' : ''}${s.type === 'meta' ? ' dim' : ''}${
                  hovered === s.id ? ' hot' : ''
                }`}
                onMouseEnter={() => setHovered(s.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setOpenId(s.id)}
              >
                <span className="row-index">{String(s.index + 1).padStart(2, '0')}</span>
                <span className="row-type">
                  <span className="chip" style={{ background: TYPE_COLOR[s.type] }} aria-hidden />
                  <span className="row-label">{s.label}</span>
                </span>
                <span className="row-preview">{s.preview}</span>
                <span className="row-metric">
                  {measure(s) > 0 ? (
                    <span className="meter">
                      <i style={{ width: `${(measure(s) / peak) * 100}%`, background: TYPE_COLOR[s.type] }} />
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="row-value">
                    {metric === 'tokens' ? (s.tokens.total ? compact(s.tokens.total) : '—') : duration(s.durationMs)}
                  </span>
                </span>
              </button>
            ))}
            {!visible.length && <p className="empty">No steps match this filter.</p>}
          </div>
        </section>

        {panel && (
          <Panel
            steps={visible}
            metric={metric}
            hovered={hovered}
            onHover={setHovered}
            onOpen={(s) => setOpenId(s.id)}
            facts={session}
          />
        )}
      </div>

      {open && (
        <Detail
          session={session}
          step={open}
          hasPrev={openIndex > 0}
          hasNext={openIndex < visible.length - 1}
          onMove={(d) => setOpenId(visible[openIndex + d]?.id ?? open.id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function Panel({
  steps,
  metric,
  hovered,
  onHover,
  onOpen,
  facts,
}: {
  steps: Step[]
  metric: 'duration' | 'tokens'
  hovered: string | null
  onHover: (id: string | null) => void
  onOpen: (s: Step) => void
  facts: Session
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const types = TYPE_ORDER.filter((k) => steps.some((s) => s.type === k))

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="label">{metric === 'tokens' ? 'Tokens by step' : 'Duration by step'}</span>
        <span className="label mono">{steps.length} tiles</span>
      </div>
      <div className="panel-body" ref={box}>
        {size.w > 0 && (
          <Treemap
            steps={steps}
            metric={metric}
            width={size.w}
            height={size.h}
            hovered={hovered}
            onHover={onHover}
            onOpen={onOpen}
          />
        )}
      </div>
      <div className="panel-foot">
        {types.map((k) => (
          <span className="legend" key={k}>
            <span className="chip" style={{ background: TYPE_COLOR[k] }} aria-hidden />
            {TYPE_NAME[k]}
          </span>
        ))}
        <span className="legend" style={{ width: '100%' }}>
          {facts.cwd}
        </span>
      </div>
    </aside>
  )
}

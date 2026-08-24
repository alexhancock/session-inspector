import { useMemo, useState } from 'react'
import { Step } from '../session/session'
import { compact, duration } from '../format'
import { TYPE_COLOR, onDark } from './palette'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tile<T> extends Rect {
  item: T
  value: number
}

export function squarify<T>(items: T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const entries = items
    .map((item) => ({ item, v: Math.max(0, value(item)) }))
    .filter((e) => e.v > 0)
    .sort((a, b) => b.v - a.v)
  const total = entries.reduce((a, e) => a + e.v, 0)
  const out: Tile<T>[] = []
  if (!total || rect.w <= 0 || rect.h <= 0) return out

  const scale = (rect.w * rect.h) / total
  let free: Rect = { ...rect }
  let row: { item: T; v: number; a: number }[] = []

  const worst = (r: typeof row, side: number) => {
    const sum = r.reduce((a, e) => a + e.a, 0)
    if (sum <= 0) return Infinity
    const max = Math.max(...r.map((e) => e.a))
    const min = Math.min(...r.map((e) => e.a))
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  const flush = () => {
    const sum = row.reduce((a, e) => a + e.a, 0)
    if (sum <= 0) {
      row = []
      return
    }
    const column = free.w >= free.h
    const thickness = Math.min(column ? free.w : free.h, sum / (column ? free.h : free.w))
    let pos = column ? free.y : free.x
    for (const e of row) {
      const len = e.a / thickness
      out.push(
        column
          ? { item: e.item, value: e.v, x: free.x, y: pos, w: thickness, h: len }
          : { item: e.item, value: e.v, x: pos, y: free.y, w: len, h: thickness },
      )
      pos += len
    }
    free = column
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness }
    row = []
  }

  for (const e of entries) {
    const next = { ...e, a: e.v * scale }
    const side = Math.max(1e-9, Math.min(free.w, free.h))
    if (row.length && worst([...row, next], side) > worst(row, side)) flush()
    row.push(next)
  }
  flush()
  return out
}

interface Props {
  steps: Step[]
  metric: 'duration' | 'tokens'
  width: number
  height: number
  hovered: string | null
  onHover: (id: string | null) => void
  onOpen: (step: Step) => void
}

export function Treemap({ steps, metric, width, height, hovered, onHover, onOpen }: Props) {
  const [focus, setFocus] = useState<string | null>(null)
  const value = (s: Step) => (metric === 'tokens' ? s.tokens.total : s.durationMs)
  const tiles = useMemo(
    () => squarify(steps, value, { x: 0, y: 0, w: width, h: height }),
    [steps, metric, width, height],
  )
  const format = (n: number) => (metric === 'tokens' ? `${compact(n)} tok` : duration(n))

  return (
    <svg width={width} height={height} role="list" onMouseLeave={() => onHover(null)}>
      {tiles.map((t) => {
        const active = hovered === t.item.id || focus === t.item.id
        const fill = TYPE_COLOR[t.item.type]
        const text = onDark(t.item.type) ? '#fbfbf6' : '#121212'
        const room = t.w > 62 && t.h > 26
        return (
          <g
            key={t.item.id}
            role="listitem"
            tabIndex={0}
            onMouseEnter={() => onHover(t.item.id)}
            onFocus={() => {
              setFocus(t.item.id)
              onHover(t.item.id)
            }}
            onBlur={() => setFocus(null)}
            onClick={() => onOpen(t.item)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(t.item)}
            style={{ cursor: 'pointer' }}
          >
            <title>{`${t.item.label} — ${format(t.value)}`}</title>
            <rect
              x={t.x}
              y={t.y}
              width={Math.max(0, t.w - 1)}
              height={Math.max(0, t.h - 1)}
              fill={fill}
              stroke={active ? '#121212' : 'rgba(18,18,18,.2)'}
              strokeWidth={active ? 2.5 : 1}
            />
            {t.item.isError && (
              <path
                d={`M${t.x + t.w - 1} ${t.y} L${t.x + t.w - 1} ${t.y + Math.min(16, t.h)} L${t.x + t.w - 1 - Math.min(16, t.w)} ${t.y} Z`}
                fill="#121212"
              />
            )}
            {room && (
              <>
                <text className="tile-label" x={t.x + 7} y={t.y + 15} fill={text}>
                  {t.item.label}
                </text>
                <text className="tile-value" x={t.x + 7} y={t.y + 27} fill={text} opacity={0.75}>
                  {format(t.value)}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('tiles the whole rectangle without overlapping', () => {
    const items = [5, 3, 2, 1, 8, 13].map((v, i) => ({ id: String(i), v }))
    const tiles = squarify(items, (i) => i.v, { x: 0, y: 0, w: 200, h: 100 })
    const area = tiles.reduce((a, t) => a + t.w * t.h, 0)
    expect(tiles.length).toBe(6)
    expect(Math.round(area)).toBe(20000)
    expect(tiles.every((t) => t.x >= -0.001 && t.y >= -0.001 && t.x + t.w <= 200.001 && t.y + t.h <= 100.001)).toBe(true)
  })
  it('ignores steps with no measurable value', () => {
    expect(squarify([{ v: 0 }], (i) => i.v, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
}

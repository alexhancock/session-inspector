export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  if (m < 60) return `${m}:${rest.toFixed(1).padStart(4, '0')}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m - h * 60).padStart(2, '0')}:${String(Math.floor(rest)).padStart(2, '0')}`
}

export const count = (n: number): string => n.toLocaleString('en-US')

export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const cost = (usd: number): string => (usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`)

export const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const day = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })

export const offset = (ms: number): string => (ms < 1000 ? '0.0s' : duration(ms))

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('formats durations by magnitude', () => {
    expect(duration(420)).toBe('420ms')
    expect(duration(12_400)).toBe('12.4s')
    expect(duration(120_300)).toBe('2:00.3')
    expect(duration(3_725_000)).toBe('1:02:05')
  })
}

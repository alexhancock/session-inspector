export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const total = Math.round(ms / 1000)
  if (total < 60) return `${(ms / 1000).toFixed(1)}s`
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${s}s`
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
    expect(duration(120_300)).toBe('2m 0s')
    expect(duration(3_725_000)).toBe('1h 02m 05s')
  })
}

import { Field, oneLine } from './model'

const PREVIEW_KEYS = [
  'command',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
  'description',
  'content',
  'text',
]

export function argPreview(args: unknown): string {
  if (typeof args === 'string') return oneLine(args)
  if (!args || typeof args !== 'object') return ''
  const rec = args as Record<string, unknown>
  for (const key of PREVIEW_KEYS) {
    const v = rec[key]
    if (typeof v === 'string' && v.trim()) return oneLine(v)
  }
  const first = Object.entries(rec).find(([, v]) => typeof v === 'string' || typeof v === 'number')
  return first ? oneLine(`${first[0]} ${String(first[1])}`) : oneLine(JSON.stringify(rec))
}

const isBlock = (v: string) => v.includes('\n') || v.length > 96

export function valueFields(label: string, value: unknown): Field[] {
  if (value == null) return []
  if (typeof value === 'string') {
    return value.trim() ? [{ label, value, format: isBlock(value) ? 'code' : 'text' }] : []
  }
  if (typeof value !== 'object') return [{ label, value: String(value), format: 'text' }]
  if (Array.isArray(value)) return [{ label, value: JSON.stringify(value, null, 2), format: 'json' }]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    valueFields(`${label} · ${k}`, v),
  )
}

export function argFields(args: unknown): Field[] {
  if (args == null) return []
  if (typeof args === 'object' && !Array.isArray(args)) {
    const entries = Object.entries(args as Record<string, unknown>)
    if (entries.length === 0) return []
    return entries.flatMap(([k, v]) => valueFields(k, v))
  }
  return valueFields('Arguments', args)
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        const rec = b as Record<string, unknown>
        if (typeof rec.text === 'string') return rec.text
        return JSON.stringify(b)
      })
      .join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2)
  return content == null ? '' : String(content)
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('previews the most meaningful argument', () => {
    expect(argPreview({ description: 'run it', command: 'ls -la' })).toBe('ls -la')
    expect(argPreview({ limit: 5 })).toBe('limit 5')
  })
  it('flattens nested arguments into labelled fields', () => {
    expect(argFields({ edits: { old: 'a' } })).toEqual([{ label: 'edits · old', value: 'a', format: 'text' }])
  })
}

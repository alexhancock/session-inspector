type Shape = 'fill' | 'circle' | 'quarter' | 'diagonal' | 'empty'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Cell {
  from: Rect
  to: Rect
  color: string
  shape: Shape
  turn: number
}

const PALETTE = ['#f0402c', '#1b7fd0', '#f3b71c', '#121212', '#e6e5d8', '#fbfbf6']
const WEIGHTS = [0.18, 0.085, 0.07, 0.135, 0.28, 0.25]
const COUNT = 34
const MIN_AREA = 0.014
const MORPH_MS = 1500
const HOLD_MS = 3600

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function rng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function mountBackdrop(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const random = rng(Date.now())
  let cells: Cell[] = []
  let phase = 0
  let raf = 0
  let w = 0
  let h = 0

  const pick = () => {
    let r = random()
    for (let i = 0; i < PALETTE.length; i++) {
      r -= WEIGHTS[i] as number
      if (r <= 0) return PALETTE[i] as string
    }
    return PALETTE[4] as string
  }

  const shapeFor = (color: string, area: number): Shape => {
    if (color === '#e6e5d8' || color === '#fbfbf6') return 'empty'
    const r = random()
    if (area > 0.03 && r < 0.14) return 'circle'
    if (area > 0.025 && r < 0.36) return 'quarter'
    if (r < 0.46) return 'diagonal'
    return 'fill'
  }

  const partition = (n: number): Rect[] => {
    let rects: Rect[] = [{ x: 0, y: 0, w: 1, h: 1 }]
    const ratios = [0.5, 0.382, 0.618, 0.333, 0.667, 0.25]
    while (rects.length < n) {
      const weights = rects.map((r) => (r.w * r.h > MIN_AREA * 2 ? Math.pow(r.w * r.h, 1.35) : 0))
      if (!weights.some((v) => v > 0)) break
      let roll = random() * weights.reduce((a, b) => a + b, 0)
      let target = rects[rects.length - 1] as Rect
      for (let i = 0; i < rects.length; i++) {
        roll -= weights[i] as number
        if (roll <= 0) {
          target = rects[i] as Rect
          break
        }
      }
      const t = ratios[Math.floor(random() * ratios.length)] as number
      const vertical = target.w > target.h * 1.08 || (Math.abs(target.w - target.h) < 0.03 && random() < 0.5)
      const parts = vertical
        ? [
            { x: target.x, y: target.y, w: target.w * t, h: target.h },
            { x: target.x + target.w * t, y: target.y, w: target.w * (1 - t), h: target.h },
          ]
        : [
            { x: target.x, y: target.y, w: target.w, h: target.h * t },
            { x: target.x, y: target.y + target.h * t, w: target.w, h: target.h * (1 - t) },
          ]
      rects = rects.flatMap((r) => (r === target ? parts : [r]))
    }
    return rects.sort((a, b) => Math.round(a.y * 24) - Math.round(b.y * 24) || a.x - b.x)
  }

  const recompose = () => {
    const next = partition(COUNT)
    cells = next.map((to, i) => {
      const prev = cells[i]
      const keep = prev && random() > 0.3
      const color = keep ? (prev as Cell).color : pick()
      return {
        from: prev ? prev.to : to,
        to,
        color,
        shape: keep ? (prev as Cell).shape : shapeFor(color, to.w * to.h),
        turn: keep ? (prev as Cell).turn : Math.floor(random() * 4),
      }
    })
  }

  const paint = (t: number) => {
    ctx.clearRect(0, 0, w, h)
    const k = ease(Math.min(1, t))
    ctx.lineWidth = 1

    for (const c of cells) {
      const x = (c.from.x + (c.to.x - c.from.x) * k) * w
      const y = (c.from.y + (c.to.y - c.from.y) * k) * h
      const cw = (c.from.w + (c.to.w - c.from.w) * k) * w
      const ch = (c.from.h + (c.to.h - c.from.h) * k) * h
      if (cw < 1 || ch < 1) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cw, ch)
      ctx.clip()
      ctx.fillStyle = c.color

      if (c.shape === 'fill') {
        ctx.fillRect(x, y, cw, ch)
      } else if (c.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.38, 0, Math.PI * 2)
        ctx.fill()
      } else if (c.shape === 'quarter') {
        const corner = [
          [x, y, 0],
          [x + cw, y, Math.PI / 2],
          [x + cw, y + ch, Math.PI],
          [x, y + ch, -Math.PI / 2],
        ][c.turn % 4] as number[]
        ctx.beginPath()
        ctx.moveTo(corner[0] as number, corner[1] as number)
        ctx.arc(corner[0] as number, corner[1] as number, Math.min(cw, ch), corner[2] as number, (corner[2] as number) + Math.PI / 2)
        ctx.closePath()
        ctx.fill()
      } else if (c.shape === 'diagonal') {
        const p = [
          [x, y, x + cw, y, x, y + ch],
          [x + cw, y, x + cw, y + ch, x, y],
          [x + cw, y + ch, x, y + ch, x + cw, y],
          [x, y + ch, x, y, x + cw, y + ch],
        ][c.turn % 4] as number[]
        ctx.beginPath()
        ctx.moveTo(p[0] as number, p[1] as number)
        ctx.lineTo(p[2] as number, p[3] as number)
        ctx.lineTo(p[4] as number, p[5] as number)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillRect(x, y, cw, ch)
      }

      ctx.restore()
      ctx.strokeStyle = 'rgba(18,18,18,.18)'
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(cw) - 1, Math.round(ch) - 1)
    }
  }

  const frame = (now: number) => {
    if (!phase) phase = now
    const elapsed = now - phase
    if (elapsed > MORPH_MS + HOLD_MS) {
      recompose()
      phase = now
      paint(0)
    } else {
      paint(elapsed / MORPH_MS)
    }
    raf = requestAnimationFrame(frame)
  }

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint(1)
  }

  recompose()
  cells.forEach((c) => (c.from = c.to))
  resize()
  window.addEventListener('resize', resize)
  if (!still) raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
  }
}

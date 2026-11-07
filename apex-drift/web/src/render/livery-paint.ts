import type { Decals, Finish, LiveryDef, NumFont, Pattern } from '../data'

/**
 * Paints a livery onto the car's body texture. The texture has three bands,
 * each a third of its height: the right flank, the left flank and the top
 * (bonnet, roof, boot, seen from above). Every design is drawn in the car's
 * own coordinates, centimetres along the body (z, front positive) and up
 * from the road (y), so one drawing serves both flanks: the left one is the
 * same drawing reflected, with text flipped back so it reads correctly.
 *
 * The same drawing runs three times: in colour, as a material mask (decals
 * are satin vinyl even on chrome paint), and for the glass, which carries
 * the sunstrip and the driver's name on the rear side windows.
 */

export const TEX_W = 2048
export const TEX_H = 1536
const BAND = TEX_H / 3

/** The body's proportions, in metres, as car-model lays it out. */
export interface BodyFrame {
  L: number
  roof: number
  belt: number
  gc: number
  halfW: number
  /** Axle and glass stations along z (front is +L/2). */
  axF: number
  axR: number
  archR: number
  zF0: number
  zF1: number
  zR1: number
  zR0: number
}

export interface FinishSpec { rough: number; metal: number; clearcoat: number; ccRough: number; irid: number }
export const FINISH: Record<Finish, FinishSpec> = {
  gloss: { rough: 0.2, metal: 0.04, clearcoat: 1, ccRough: 0.04, irid: 0 },
  metallic: { rough: 0.32, metal: 0.72, clearcoat: 1, ccRough: 0.06, irid: 0 },
  pearl: { rough: 0.24, metal: 0.3, clearcoat: 1, ccRough: 0.04, irid: 0.6 },
  satin: { rough: 0.5, metal: 0.12, clearcoat: 0.3, ccRough: 0.4, irid: 0 },
  matte: { rough: 0.86, metal: 0.02, clearcoat: 0, ccRough: 0.6, irid: 0 },
  chrome: { rough: 0.07, metal: 1, clearcoat: 1, ccRough: 0.02, irid: 0 },
}
const VINYL = { rough: 0.45, metal: 0 }

const DEFAULT_DECALS: Decals = { panel: true, sponsors: true, pinstripe: true, roof: true, bonnet: true }
const SMALL_SPONSORS = ['VELA TYRES', 'OKTAN', 'KOMET', 'LIMEN', 'HALCYON', 'GRANIT', 'BRISA', 'TUNDRA', 'PIKKU', 'SOLSTICE']

export const hex = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0')
const lum = (n: number): number => {
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.04 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
/** Light ink on dark paint, dark ink on light paint. */
export const ink = (n: number): string => (lum(n) > 0.36 ? '#16181b' : '#f6f4ee')
export const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

type Region = 'R' | 'L' | 'T'
type Kind = 'paint' | 'decal'
type Mode = 'color' | 'mask' | 'glass'

const FONTS: Record<NumFont, (px: number) => string> = {
  block: (px) => `800 ${px}px "Barlow Condensed", sans-serif`,
  italic: (px) => `italic 800 ${px}px "Barlow Condensed", sans-serif`,
  outline: (px) => `800 ${px}px "Barlow Condensed", sans-serif`,
  stencil: (px) => `800 ${px}px "Barlow Condensed", sans-serif`,
  retro: (px) => `italic 700 ${px}px Georgia, "Times New Roman", serif`,
}

interface TextOpts {
  font?: string
  align?: CanvasTextAlign
  /** Extra rotation (rad), counter-clockwise as the text is read. */
  rot?: number
  outline?: string
  outlineW?: number
  maxW?: number
  /** Reads from in front of the car rather than from behind (top band only). */
  fromFront?: boolean
}

/** A 2D context that draws in the car's centimetres for one band at a time. */
class Brush {
  region: Region = 'R'
  constructor(readonly g: CanvasRenderingContext2D, readonly f: BodyFrame, readonly mode: Mode, readonly res: number, private readonly finish: FinishSpec) {}

  /** Ink for a layer: its colour, or in the mask its roughness (G) and metalness (B). */
  ink(color: string, kind: Kind = 'paint'): string {
    if (this.mode !== 'mask') return color
    const m = kind === 'decal' ? VINYL : this.finish
    return `rgb(255,${Math.round(m.rough * 255)},${Math.round(m.metal * 255)})`
  }

  enter(r: Region): void {
    const { g, f, res } = this
    this.region = r
    g.save()
    g.setTransform(res, 0, 0, res, 0, 0)
    const y0 = r === 'R' ? 0 : r === 'L' ? BAND : BAND * 2
    g.beginPath()
    g.rect(0, y0, TEX_W, BAND)
    g.clip()
    const kx = TEX_W / (f.L * 100), ky = BAND / (f.roof * 100), kb = BAND / (f.halfW * 200)
    const ox = f.L * 50 * kx
    if (r === 'R') g.setTransform(kx * res, 0, 0, -ky * res, ox * res, f.roof * 100 * ky * res)
    else if (r === 'L') g.setTransform(-kx * res, 0, 0, -ky * res, (TEX_W - ox) * res, (BAND + f.roof * 100 * ky) * res)
    else g.setTransform(kx * res, 0, 0, kb * res, ox * res, (BAND * 2.5) * res)
  }

  exit(): void {
    this.g.restore()
  }

  fill(color: string, kind: Kind = 'paint'): void {
    this.g.fillStyle = this.ink(color, kind)
    this.g.fill()
  }

  poly(pts: readonly (readonly [number, number])[], color: string, kind: Kind = 'paint'): void {
    const g = this.g
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    this.fill(color, kind)
  }

  rect(x: number, y: number, w: number, h: number, color: string, kind: Kind = 'paint'): void {
    this.g.fillStyle = this.ink(color, kind)
    this.g.fillRect(x, y, w, h)
  }

  round(x: number, y: number, w: number, h: number, r: number, color: string, kind: Kind = 'decal'): void {
    const g = this.g
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    this.fill(color, kind)
  }

  stroke(build: (g: CanvasRenderingContext2D) => void, width: number, color: string, kind: Kind = 'paint'): void {
    const g = this.g
    g.beginPath()
    build(g)
    g.lineWidth = width
    g.lineCap = 'butt'
    g.strokeStyle = this.ink(color, kind)
    g.stroke()
  }

  /** Text whose size is in centimetres, oriented to read correctly on this band. */
  text(s: string, x: number, y: number, size: number, color: string, o: TextOpts = {}): void {
    const g = this.g
    g.save()
    g.translate(x, y)
    if (this.region === 'R') g.transform(1, 0, 0, -1, 0, 0)
    else if (this.region === 'L') g.transform(-1, 0, 0, -1, 0, 0)
    else if (o.fromFront) g.transform(0, 1, 1, 0, 0, 0)
    else g.transform(0, -1, -1, 0, 0, 0)
    if (o.rot) g.rotate(-o.rot)
    g.font = o.font ?? FONTS.block(size)
    g.textAlign = o.align ?? 'center'
    g.textBaseline = 'middle'
    if (o.maxW) {
      const w = g.measureText(s).width
      if (w > o.maxW) g.scale(o.maxW / w, 1)
    }
    if (o.outline) {
      g.lineJoin = 'round'
      g.lineWidth = o.outlineW ?? size * 0.12
      g.strokeStyle = this.ink(o.outline, 'decal')
      g.strokeText(s, 0, 0)
    }
    g.fillStyle = this.ink(color, 'decal')
    g.fillText(s, 0, 0)
    g.restore()
  }
}

/** Centimetre landmarks of a body, shared by every design. */
function marks(f: BodyFrame) {
  const zr = -f.L * 50, zf = f.L * 50, Lc = f.L * 100
  const G = f.gc * 100 + 3, B = f.belt * 100
  const doorF = (f.zF0 - 0.02 * f.L) * 100
  const doorR = ((f.zF1 + f.zR1) / 2 - 0.05 * f.L) * 100
  return {
    zr, zf, Lc, G, B,
    top: f.roof * 100 + 10,
    low: -10,
    hw: f.halfW * 100 + 10,
    zt: (t: number) => zr + t * Lc,
    yb: (t: number) => G + t * (B - G),
    axF: f.axF * 100, axR: f.axR * 100, arch: f.archR * 100,
    zF0: f.zF0 * 100, zF1: f.zF1 * 100, zR1: f.zR1 * 100, zR0: f.zR0 * 100,
    doorF, doorR, doorC: (doorF + doorR) / 2,
  }
}
type Marks = ReturnType<typeof marks>

interface Inks { P: string; S: string; A: string; base: number; stripe: number; accent: number }

/** Each design: its flanks (drawn once per side) and its top. */
const DESIGNS: Record<Pattern, { side(b: Brush, m: Marks, c: Inks): void; top(b: Brush, m: Marks, c: Inks): void }> = {
  swoosh: {
    side(b, m, c) {
      const { zr, zf, zt, yb } = m
      const upper = (g: CanvasRenderingContext2D, dy: number) => {
        g.moveTo(zr - 30, yb(1.05) + dy)
        g.bezierCurveTo(zt(0.35), yb(0.62) + dy, zt(0.62), yb(0.2) + dy, zf + 30, yb(0.2) + dy)
      }
      const g = b.g
      g.beginPath()
      g.moveTo(zf + 30, yb(-0.4))
      g.bezierCurveTo(zt(0.75), yb(-0.08), zt(0.45), yb(0.06), zr - 30, yb(0.6))
      g.lineTo(zr - 30, yb(1.05))
      g.bezierCurveTo(zt(0.35), yb(0.62), zt(0.62), yb(0.2), zf + 30, yb(0.2))
      g.closePath()
      b.fill(c.S)
      b.stroke((g) => upper(g, 6), 3.5, c.A)
      b.stroke((g) => upper(g, 12), 1.4, c.S)
    },
    top(b, m, c) {
      const { zr, zf, hw, zF0, zF1, zR1 } = m
      const zm = zR1 + 0.3 * (zF1 - zR1)
      b.poly([[zr - 10, -hw], [zm, -hw], [zm + 45, 0], [zm, hw], [zr - 10, hw]], c.S)
      b.stroke((g) => {
        g.moveTo(zm + 6, -hw)
        g.lineTo(zm + 51, 0)
        g.lineTo(zm + 6, hw)
      }, 3.5, c.A)
      b.poly([[zf + 10, -hw * 0.55], [zf + 10, hw * 0.55], [zF0 + 10, 7], [zF0 + 10, -7]], c.S)
      for (const s of [1, -1]) b.stroke((g) => {
        g.moveTo(zf + 10, s * (hw * 0.55 + 5))
        g.lineTo(zF0 + 10, s * 12)
      }, 2.5, c.A)
    },
  },
  stripes: {
    side(b, m, c) {
      const { zr, yb, Lc } = m
      b.rect(zr - 10, yb(0.08), Lc + 20, yb(0.26) - yb(0.08), c.S)
      b.rect(zr - 10, yb(0.3), Lc + 20, 2.5, c.A)
    },
    top(b, m, c) {
      const { zr, Lc } = m
      for (const s of [1, -1]) {
        b.rect(zr - 10, s > 0 ? 4 : -24, Lc + 20, 20, c.S)
        b.rect(zr - 10, s > 0 ? 27 : -29, Lc + 20, 2.2, c.A)
      }
    },
  },
  chevron: {
    side(b, m, c) {
      const { top, low, yb, axF } = m
      const ym = yb(0.45), sl = 0.5
      const widths = [18, 12, 7]
      let zc = axF + 55
      widths.forEach((w, k) => {
        b.poly([[zc - sl * (top - ym), top], [zc, ym], [zc - sl * (ym - low), low], [zc - sl * (ym - low) - w, low], [zc - w, ym], [zc - sl * (top - ym) - w, top]], k === 2 ? c.A : c.S)
        zc -= w + 8
      })
      b.rect(m.zr - 10, yb(0.06), m.axF - 60 - m.zr, yb(0.2) - yb(0.06), c.S)
    },
    top(b, m, c) {
      const { zf, zF0, hw, zr, zR1 } = m
      const tip = zf - 15
      const v = (d: number, w: number, col: string) => b.poly([[tip - d, 0], [zF0 + 20 - d, -hw], [zF0 + 20 - d - w, -hw], [tip - d - w, 0], [zF0 + 20 - d - w, hw], [zF0 + 20 - d, hw]], col)
      v(0, 22, c.S)
      v(30, 8, c.A)
      b.rect(zr - 10, -hw, zR1 - zr + 10, hw * 2, c.S)
    },
  },
  fade: {
    side(b, m, c) {
      halftone(b, m.zt(0.3), m.zt(0.66), m.low, m.top, c.S, m.zr)
      b.rect(m.zr - 10, m.B - 6, m.Lc + 20, 2, c.A)
    },
    top(b, m, c) {
      halftone(b, m.zt(0.3), m.zt(0.66), -m.hw, m.hw, c.S, m.zr)
    },
  },
  split: {
    side(b, m, c) {
      const { zr, zf, yb, low } = m
      b.poly([[zf + 20, yb(0.16)], [zr - 20, yb(0.74)], [zr - 20, low], [zf + 20, low]], c.S)
      b.stroke((g) => {
        g.moveTo(zf + 20, yb(0.16) + 4)
        g.lineTo(zr - 20, yb(0.74) + 4)
      }, 4, c.A)
    },
    top(b, m, c) {
      const { zr, hw, zF1, zR1 } = m
      const z = (zF1 + zR1) / 2
      b.poly([[zr - 10, -hw], [z - 20, -hw], [z + 20, hw], [zr - 10, hw]], c.S)
      b.stroke((g) => {
        g.moveTo(z - 14, -hw)
        g.lineTo(z + 26, hw)
      }, 4, c.A)
    },
  },
  blocks: {
    side(b, m, c) {
      const { zr, zf, top, low, axF, axR, G, yb } = m
      b.poly([[zf + 20, low], [zf + 20, top], [axF - 5, top], [axF - 45, low]], c.S)
      b.poly([[zr - 20, low], [zr - 20, top], [axR + 25, top], [axR + 65, low]], c.S)
      b.poly([[axF - 70, G - 4], [axR + 85, G - 4], [axR + 97, yb(0.2)], [axF - 58, yb(0.2)]], c.A)
    },
    top(b, m, c) {
      const { zf, zF0, hw, zr, zF1, zR1, zR0 } = m
      const zb = zf - 0.55 * (zf - zF0)
      b.poly([[zf + 10, -hw], [zf + 10, hw], [zb - 10, hw], [zb + 10, -hw]], c.S)
      const zm = (zF1 + zR1) / 2
      b.rect(zm - 14, -hw, 28, hw * 2, c.A)
      b.rect(zr - 10, -hw, zR0 - zr + 10, hw * 2, c.S)
    },
  },
  band: {
    side(b, m, c) {
      const { zr, Lc, yb } = m
      b.rect(zr - 10, yb(0.4), Lc + 20, yb(0.66) - yb(0.4), c.S)
      b.rect(zr - 10, yb(0.4) - 5, Lc + 20, 1.6, c.A)
      b.rect(zr - 10, yb(0.66) + 3.4, Lc + 20, 1.6, c.A)
    },
    top(b, m, c) {
      const { zr, Lc } = m
      b.rect(zr - 10, -18, Lc + 20, 36, c.S)
      for (const s of [1, -1]) b.rect(zr - 10, s * 22 - 0.8, Lc + 20, 1.6, c.A)
    },
  },
  shards: {
    side(b, m, c) {
      const { zt, yb } = m
      const S: [number, number][][] = [
        [[-0.05, -0.4], [0.44, -0.4], [-0.05, 1.5]],
        [[0.12, 1.5], [0.48, 1.5], [0.3, 0.42]],
        [[0.53, -0.4], [0.66, -0.4], [0.58, 0.22]],
        [[0.63, 1.5], [0.71, 1.5], [0.66, 0.95]],
        [[0.74, -0.4], [0.79, -0.4], [0.76, 0.06]],
      ]
      const A: [number, number][][] = [
        [[0.4, -0.4], [0.55, -0.4], [0.31, 0.38]],
        [[0.48, 1.5], [0.6, 1.5], [0.5, 0.8]],
        [[0.68, -0.4], [0.73, -0.4], [0.69, 0.12]],
      ]
      for (const s of S) b.poly(s.map(([t, h]) => [zt(t), yb(h)] as const), c.S)
      for (const s of A) b.poly(s.map(([t, h]) => [zt(t), yb(h)] as const), c.A)
    },
    top(b, m, c) {
      const { zt, hw } = m
      b.poly([[zt(-0.05), -hw], [zt(0.3), -hw], [zt(0.12), 0], [zt(0.36), hw], [zt(-0.05), hw]], c.S)
      b.poly([[zt(0.3), -hw], [zt(0.42), -hw], [zt(0.16), -2]], c.A)
      b.poly([[zt(0.36), hw], [zt(0.46), hw], [zt(0.2), 4]], c.A)
    },
  },
  wave: {
    side(b, m, c) {
      const { zr, yb, Lc } = m
      const wave = (dy: number, amp: number, ph: number) => (g: CanvasRenderingContext2D) => {
        for (let i = 0; i <= 60; i++) {
          const t = i / 60
          const y = yb(0.42 + dy) + Math.sin(t * Math.PI * 2.2 + ph) * amp * (0.4 + t * 0.6)
          if (i) g.lineTo(zr - 10 + t * (Lc + 20), y)
          else g.moveTo(zr - 10, y)
        }
      }
      b.stroke(wave(0, 9, 0.4), 16, c.S)
      b.stroke(wave(0.2, 9, 0.9), 4, c.A)
      b.stroke(wave(-0.22, 7, 0.1), 3, c.S)
    },
    top(b, m, c) {
      const { zr, Lc } = m
      const w = (off: number, amp: number) => (g: CanvasRenderingContext2D) => {
        for (let i = 0; i <= 60; i++) {
          const t = i / 60
          const y = off + Math.sin(t * Math.PI * 3) * amp
          if (i) g.lineTo(zr - 10 + t * (Lc + 20), y)
          else g.moveTo(zr - 10, y)
        }
      }
      b.stroke(w(0, 10), 18, c.S)
      b.stroke(w(-16, 8), 3, c.A)
      b.stroke(w(16, 8), 3, c.A)
    },
  },
  tricolor: {
    side(b, m, c) {
      const { top, low, doorF } = m
      const sl = 0.35
      const band = (z: number, w: number, col: string) => b.poly([[z + sl * (top - 0), top], [z + sl * (top - 0) + w, top], [z + sl * low + w, low], [z + sl * low, low]], col)
      band(doorF - 60, 24, c.S)
      band(doorF - 30, 10, c.A)
      band(doorF - 16, 5, c.S)
    },
    top(b, m, c) {
      const { zf, zF0, hw } = m
      const z = (zf + zF0) / 2
      const band = (d: number, w: number, col: string) => b.poly([[z + d - 30, -hw], [z + d - 30 + w, -hw], [z + d + 30 + w, hw], [z + d + 30, hw]], col)
      band(-30, 24, c.S)
      band(0, 10, c.A)
      band(14, 5, c.S)
    },
  },
  dots: {
    side(b, m, c) {
      dots(b, m.zr, m.zf, m.low, m.top, c.S)
      b.rect(m.zr - 10, m.G - 4, m.Lc + 20, 8, c.A)
    },
    top(b, m, c) {
      dots(b, m.zr, m.zf, -m.hw, m.hw, c.S)
    },
  },
  plain: {
    side() {},
    top() {},
  },
}

/** Solid colour to the rear of z0, dissolving through shrinking dots to nothing at z1. */
function halftone(b: Brush, z0: number, z1: number, y0: number, y1: number, color: string, zr: number): void {
  b.rect(zr - 20, y0, z0 - zr + 20, y1 - y0, color)
  const step = 7
  const g = b.g
  g.beginPath()
  for (let z = z0 - step, row = 0; z < z1; z += step * 0.866, row++)
    for (let y = y0 + (row % 2) * step * 0.5; y < y1; y += step) {
      const t = Math.min(1, Math.max(0, (z - z0) / (z1 - z0)))
      const r = step * 0.62 * (1 - t) ** 1.15
      if (r < 0.35) continue
      g.moveTo(z + r, y)
      g.arc(z, y, r, 0, Math.PI * 2)
    }
  b.fill(color)
}

function dots(b: Brush, z0: number, z1: number, y0: number, y1: number, color: string): void {
  const g = b.g
  g.beginPath()
  for (let z = z0, row = 0; z < z1 + 14; z += 12, row++)
    for (let y = y0 + (row % 2) * 7; y < y1; y += 14) {
      g.moveTo(z + 4, y)
      g.arc(z, y, 4, 0, Math.PI * 2)
    }
  b.fill(color)
}

function number(b: Brush, s: string, x: number, y: number, size: number, font: NumFont, color: string, panel: string, accent: string): void {
  const f = FONTS[font](size)
  if (font === 'outline') b.text(s, x, y, size, accent, { font: f, outline: color, outlineW: size * 0.14 })
  else b.text(s, x, y, size, color, { font: f })
  if (font === 'stencil') {
    // The bridges that hold a stencil together: a gap across the middle of every figure.
    b.rect(x - size, y - size * 0.03, size * 2, size * 0.07, panel, 'decal')
  }
}

function decals(b: Brush, m: Marks, lv: LiveryDef, d: Decals, c: Inks): void {
  const font = lv.font ?? 'block'
  const small = [...SMALL_SPONSORS].sort((x, y) => hash(lv.id + x) - hash(lv.id + y)).filter((s) => s !== lv.sponsor)
  if (b.region !== 'T') {
    if (d.pinstripe) b.rect(m.zr - 10, m.B - 7, m.Lc + 20, 1.3, c.A)
    if (d.sponsors) {
      // Main sponsor over the rear wheel, small vinyl tags on the front wing and along the sill.
      const zs = (m.axR + m.doorR) / 2 + 4
      b.text(lv.sponsor, zs, m.yb(0.62), 12, ink(lv.base), { maxW: Math.max(40, m.doorR - m.axR + 30), outline: ink(lv.base) === '#16181b' ? '#f6f4ee' : '#16181b', outlineW: 0.9 })
      const tag = (txt: string, z: number, y: number, w: number) => {
        b.round(z - w / 2, y - 3.6, w, 7.2, 1.6, '#f4f2ec')
        b.text(txt, z, y + 0.2, 5.6, '#16181b', { maxW: w - 3 })
      }
      tag(small[0], m.axF - m.arch - 24, m.yb(0.38), 30)
      const z0 = m.axF - m.arch - 30, z1 = m.axR + m.arch + 30
      for (let i = 0; i < 3; i++) tag(small[1 + i], z0 + ((z1 - z0) * (i + 0.5)) / 3, m.G + 5, 22)
    }
    if (d.panel) {
      const pw = 50, ph = 40, x = m.doorC - pw / 2, y = m.yb(0.5) - ph / 2
      b.round(x, y, pw, ph, 4, '#f4f2ec')
      b.g.save()
      b.g.beginPath()
      b.g.roundRect(x, y, pw, ph, 4)
      b.g.clip()
      b.rect(x, y + ph - 9, pw, 9, '#c8231c', 'decal')
      b.g.restore()
      b.text('APEX DRIFT RALLY', m.doorC, y + ph - 4.4, 5.2, '#f6f4ee', { maxW: pw - 6 })
      number(b, lv.num, m.doorC, y + (ph - 9) / 2 + 0.6, 27, font, '#16181b', '#f4f2ec', hex(lv.stripe))
    }
  } else {
    if (d.bonnet && lv.bonnet !== '') {
      const zb = (m.zf + m.zF0) / 2 + 4
      // Ink for whatever the design puts in the middle of the bonnet.
      const col = ink(['swoosh', 'blocks', 'band', 'wave'].includes(lv.pattern) ? lv.stripe : lv.base)
      b.text(lv.bonnet ?? lv.sponsor, zb, 0, 20, col, { maxW: m.hw * 1.3, outline: col === '#16181b' ? '#f6f4ee' : '#16181b', outlineW: 1.2 })
    }
    if (d.roof) {
      // Behind the roof vent, which sits just aft of the windscreen.
      const zc = m.zR1 + 0.36 * (m.zF1 - m.zR1)
      b.round(zc - 22, -26, 44, 52, 3, '#f4f2ec')
      number(b, lv.num, zc, 0, 34, font, '#16181b', '#f4f2ec', hex(lv.stripe))
    }
  }
}

/** Glass: a smoky tint, the sunstrip across the top of the windscreen and the driver's name on the rear side windows. */
function glass(b: Brush, m: Marks, lv: LiveryDef): void {
  if (b.region === 'T') {
    const z0 = m.zF1, z1 = m.zF1 + 0.32 * (m.zF0 - m.zF1)
    b.rect(z0 - 6, -m.hw, z1 - z0 + 6, m.hw * 2, hex(lv.stripe))
    b.text(lv.sponsor, (z0 + z1) / 2 + 0.6, 0, (z1 - z0) * 0.62, ink(lv.stripe), { fromFront: true, maxW: m.hw * 1.2 })
    return
  }
  if (!lv.window) return
  const zc = (m.zR1 + (m.zF1 + m.zR1) / 2) / 2 + 4
  const y = m.B + 9
  b.text(lv.window.toUpperCase(), zc, y, 6.4, '#f6f4ee', { font: `italic 800 6.4px "Barlow Condensed", sans-serif`, maxW: 40 })
  b.rect(zc - 12, y - 5, 24, 0.9, hex(lv.accent === lv.base ? lv.stripe : lv.accent), 'decal')
}

export interface LiveryCanvases { color: HTMLCanvasElement; mask: HTMLCanvasElement; glass: HTMLCanvasElement }

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return [c, g]
}

export function makeLiveryCanvases(): LiveryCanvases {
  return { color: canvas(TEX_W, TEX_H)[0], mask: canvas(TEX_W / 2, TEX_H / 2)[0], glass: canvas(TEX_W / 2, TEX_H / 2)[0] }
}

/** Draws the livery into all three canvases (reused on repaint, so a texture can be updated in place). */
export function paintLivery(cv: LiveryCanvases, lv: LiveryDef, f: BodyFrame): void {
  const fin = FINISH[lv.finish ?? 'gloss']
  const d = { ...DEFAULT_DECALS, ...lv.decals }
  const c: Inks = { P: hex(lv.base), S: hex(lv.stripe), A: hex(lv.accent === lv.base ? lv.stripe : lv.accent), base: lv.base, stripe: lv.stripe, accent: lv.accent }
  const m = marks(f)
  const design = DESIGNS[lv.pattern] ?? DESIGNS.swoosh
  for (const mode of ['color', 'mask'] as const) {
    const cvs = mode === 'color' ? cv.color : cv.mask
    const g = cvs.getContext('2d')
    if (!g) continue
    const res = cvs.width / TEX_W
    g.setTransform(1, 0, 0, 1, 0, 0)
    const b = new Brush(g, f, mode, res, fin)
    g.fillStyle = b.ink(c.P)
    g.fillRect(0, 0, cvs.width, cvs.height)
    for (const r of ['R', 'L', 'T'] as const) {
      b.enter(r)
      if (r === 'T') design.top(b, m, c)
      else design.side(b, m, c)
      decals(b, m, lv, d, c)
      b.exit()
    }
  }
  const g = cv.glass.getContext('2d')
  if (!g) return
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, cv.glass.width, cv.glass.height)
  g.fillStyle = 'rgba(12,18,24,0.55)'
  g.fillRect(0, 0, cv.glass.width, cv.glass.height)
  const b = new Brush(g, f, 'glass', cv.glass.width / TEX_W, fin)
  for (const r of ['R', 'L', 'T'] as const) {
    b.enter(r)
    glass(b, m, lv)
    b.exit()
  }
}

/** A small side view of a design, for the paint shop's template buttons. */
export function patternThumb(pattern: Pattern, base: number, stripe: number, accent: number): string {
  const W = 240, H = 84
  const [c, g] = canvas(W, H)
  const f: BodyFrame = { L: 4, roof: 1.4, belt: 0.86, gc: 0.18, halfW: 0.9, axF: 1.3, axR: -1.2, archR: 0.38, zF0: 0.6, zF1: 0.12, zR1: -1.4, zR0: -1.8 }
  const m = marks(f)
  const b = new Brush(g, f, 'color', 1, FINISH.gloss)
  g.fillStyle = hex(base)
  g.fillRect(0, 0, W, H)
  g.save()
  // Show the body band only (sill to belt), stretched to fill the button.
  const kx = W / (f.L * 100), ky = H / (m.B - m.G + 20)
  g.setTransform(kx, 0, 0, -ky, f.L * 50 * kx, (m.B + 10) * ky)
  DESIGNS[pattern].side(b, m, { P: hex(base), S: hex(stripe), A: hex(accent), base, stripe, accent })
  g.restore()
  return c.toDataURL()
}

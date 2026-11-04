import * as THREE from 'three'
import { noise2, rng } from '../core/math'

/**
 * Surface textures are painted at load time instead of shipped as images:
 * no licensing to track, a few KB of code instead of megabytes of JPEG, and
 * every surface can be tinted per rally.
 */

const cache = new Map<string, THREE.Texture>()

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return [c, g]
}

function finish(c: HTMLCanvasElement, repeat: boolean, aniso: number): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = aniso
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

const hex = (n: number, mul = 1, add = 0): string => {
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * mul + add))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * mul + add))
  const b = Math.max(0, Math.min(255, (n & 255) * mul + add))
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

/** Tileable value noise: sample on a torus so the edges meet. */
function tileNoise(size: number, seed: number, cells: number): Float32Array {
  const n = noise2(seed)
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, norm = 0
      for (let o = 0, c = cells; o < 4; o++, c *= 2) {
        const fx = (x / size) * c, fy = (y / size) * c
        // Blend four samples so the pattern wraps at the canvas edge.
        const a = n(fx, fy), b = n(fx - c, fy), d = n(fx, fy - c), e = n(fx - c, fy - c)
        const tx = x / size, ty = y / size
        v += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty)
        norm += amp
        amp *= 0.5
      }
      out[y * size + x] = v / norm
    }
  return out
}

export type RoadKind = 'gravel' | 'tarmac' | 'snow' | 'red' | 'sand'

/**
 * Road surface along the U axis (across the road) and V (along it). The
 * centre carries a worn, darker racing line; the edges loosen into stones.
 */
export function roadTexture(kind: RoadKind, base: number, aniso: number): THREE.Texture {
  const key = `road:${kind}:${base}`
  const hit = cache.get(key)
  if (hit) return hit
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(base ^ 0x5eed)
  const tn = tileNoise(S, base & 0xffff, 6)
  const img = g.createImageData(S, S)
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S
      const n = tn[y * S + x]
      // Two wheel tracks per lane: compacted and slightly darker.
      const track = Math.exp(-(((u - 0.33) / 0.06) ** 2)) + Math.exp(-(((u - 0.67) / 0.06) ** 2))
      const edge = Math.min(1, Math.max(0, (Math.abs(u - 0.5) - 0.38) / 0.12))
      let k = 1 + n * 0.22 - track * (kind === 'tarmac' ? 0.1 : 0.14) + edge * 0.08
      if (kind === 'snow') k = 1 + n * 0.08 - track * 0.22
      const i = (y * S + x) * 4
      img.data[i] = Math.min(255, br * k)
      img.data[i + 1] = Math.min(255, bg * k)
      img.data[i + 2] = Math.min(255, bb * k)
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  // Stones and grit: denser toward the edges where they get thrown.
  if (kind !== 'tarmac' && kind !== 'snow') {
    for (let s = 0; s < 5200; s++) {
      const u = r()
      const edgeBias = Math.abs(u - 0.5) * 2
      if (r() > 0.35 + edgeBias * 0.65) continue
      const x = u * S, y = r() * S, rad = 0.6 + r() * (1.6 + edgeBias * 1.6)
      g.fillStyle = hex(base, 0.65 + r() * 0.75)
      g.beginPath()
      g.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2)
      g.fill()
    }
  }
  if (kind === 'tarmac') {
    // Patched cracks and a faded centre line: the road has been here a while.
    g.strokeStyle = hex(base, 0.62)
    g.lineWidth = 1.2
    for (let s = 0; s < 26; s++) {
      g.beginPath()
      let x = r() * S, y = r() * S
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 22
        y += r() * 18
        g.lineTo(x, y)
      }
      g.stroke()
    }
    g.fillStyle = 'rgba(236,230,205,0.55)'
    for (let y = 0; y < S; y += 64) g.fillRect(S / 2 - 3, y, 6, 34)
    g.fillStyle = 'rgba(236,230,205,0.6)'
    g.fillRect(S * 0.075, 0, 5, S)
    g.fillRect(S * 0.925 - 5, 0, 5, S)
  }
  const t = finish(c, true, aniso)
  cache.set(key, t)
  return t
}

/** Grey detail texture multiplied over vertex-coloured terrain: breaks up the flat look up close. */
export function detailTexture(aniso: number): THREE.Texture {
  const hit = cache.get('detail')
  if (hit) return hit
  const S = 256
  const [c, g] = canvas(S)
  const tn = tileNoise(S, 77, 8)
  const img = g.createImageData(S, S)
  const r = rng(91)
  for (let i = 0; i < S * S; i++) {
    const v = 200 + tn[i] * 40 + (r() - 0.5) * 26
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, v))
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  // Blades and pebbles.
  for (let s = 0; s < 2400; s++) {
    const x = r() * S, y = r() * S
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.06 + r() * 0.1})`
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4)
    g.stroke()
  }
  const t = finish(c, true, aniso)
  t.colorSpace = THREE.NoColorSpace
  cache.set('detail', t)
  return t
}

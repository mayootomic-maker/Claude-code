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

/**
 * Grey surface textures laid over vertex-coloured scenery. Each averages about
 * 200/255 so the shader's ×1.28 leaves the palette colour where it was and
 * only adds the surface: strata and cracks, bark furrows, clusters of leaves.
 */
function greyTexture(key: string, S: number, paint: (img: Uint8ClampedArray, g: CanvasRenderingContext2D, r: () => number) => void, aniso: number): THREE.Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const [c, g] = canvas(S)
  const img = g.createImageData(S, S)
  paint(img.data, g, rng(key.length * 977 + S))
  const t = finish(c, true, aniso)
  t.colorSpace = THREE.NoColorSpace
  cache.set(key, t)
  return t
}

export function rockTexture(aniso: number): THREE.Texture {
  return greyTexture('rock', 512, (d, g, r) => {
    const S = 512
    const a = tileNoise(S, 311, 4), b = tileNoise(S, 312, 16)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x
        // Bedding planes: bands that wander with the large noise.
        const strata = Math.sin((y / S) * Math.PI * 2 * 7 + a[i] * 9) * 0.5 + 0.5
        const v = 190 + a[i] * 46 + b[i] * 30 + (strata - 0.5) * 26 + (r() - 0.5) * 22
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
        d[i * 4 + 3] = 255
      }
    g.putImageData(new ImageData(d, S, S), 0, 0)
    // Cracks: dark hairlines with a lit lip on one side, wrapping at the edges.
    for (let k = 0; k < 70; k++) {
      let x = r() * S, y = r() * S
      const pts: [number, number][] = [[x, y]]
      const dir = r() * Math.PI * 2
      for (let s = 0; s < 8; s++) {
        x += Math.cos(dir + (r() - 0.5) * 1.4) * 9
        y += Math.sin(dir + (r() - 0.5) * 1.4) * 9
        pts.push([x, y])
      }
      for (const [ox, oy] of [[0, 0], [-S, 0], [S, 0], [0, -S], [0, S]]) {
        for (const [col, dx, w] of [['rgba(255,255,255,0.22)', 1, 1.2], ['rgba(0,0,0,0.5)', 0, 1 + r()]] as const) {
          g.strokeStyle = col
          g.lineWidth = w
          g.beginPath()
          pts.forEach(([px, py], j) => (j ? g.lineTo(px + ox + dx, py + oy + dx) : g.moveTo(px + ox + dx, py + oy + dx)))
          g.stroke()
        }
      }
    }
    // Lichen and pits.
    for (let k = 0; k < 900; k++) {
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.08 + r() * 0.12})` : `rgba(255,255,255,${0.05 + r() * 0.1})`
      g.beginPath()
      g.arc(r() * S, r() * S, 0.6 + r() * 2.4, 0, Math.PI * 2)
      g.fill()
    }
  }, aniso)
}

export function barkTexture(aniso: number): THREE.Texture {
  return greyTexture('bark', 256, (d, g, r) => {
    const S = 256
    const a = tileNoise(S, 421, 6)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x
        // Vertical furrows that meander a little, broken into plates.
        const furrow = Math.abs(Math.sin((x / S) * Math.PI * 2 * 9 + a[i] * 5))
        const plate = Math.sin((y / S) * Math.PI * 2 * 5 + a[i] * 7) * 0.5 + 0.5
        const v = 150 + furrow * 80 + plate * 20 + (r() - 0.5) * 24
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
        d[i * 4 + 3] = 255
      }
    g.putImageData(new ImageData(d, S, S), 0, 0)
  }, aniso)
}

export function leafTexture(aniso: number): THREE.Texture {
  return greyTexture('leaf', 256, (d, g, r) => {
    const S = 256
    const a = tileNoise(S, 521, 8)
    for (let i = 0; i < S * S; i++) {
      const v = 170 + a[i] * 50
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
      d[i * 4 + 3] = 255
    }
    g.putImageData(new ImageData(d, S, S), 0, 0)
    // Overlapping leaf shapes: lit tops, shaded gaps between them.
    for (let k = 0; k < 2600; k++) {
      const x = r() * S, y = r() * S, len = 2.5 + r() * 4, ang = r() * Math.PI
      const lit = r()
      g.fillStyle = lit < 0.35 ? `rgba(0,0,0,${0.18 + r() * 0.2})` : `rgba(255,255,255,${0.1 + r() * 0.18})`
      for (const [ox, oy] of [[0, 0], [-S, 0], [S, 0], [0, -S], [0, S]]) {
        g.beginPath()
        g.ellipse(x + ox, y + oy, len, len * 0.42, ang, 0, Math.PI * 2)
        g.fill()
      }
    }
  }, aniso)
}

/** Tangent-space ripple normals for lakes and fords, tiling. */
export function waterNormals(aniso: number): THREE.Texture {
  const hit = cache.get('waterN')
  if (hit) return hit
  const S = 256
  const [c, g] = canvas(S)
  const h = tileNoise(S, 611, 8), h2 = tileNoise(S, 612, 24)
  const H = (x: number, y: number) => {
    const i = ((y + S) % S) * S + ((x + S) % S)
    return h[i] * 1.0 + h2[i] * 0.35
  }
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 6, dy = (H(x, y + 1) - H(x, y - 1)) * 6
      const l = Math.hypot(dx, dy, 1)
      const i = (y * S + x) * 4
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255
      img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const t = finish(c, true, aniso)
  t.colorSpace = THREE.NoColorSpace
  cache.set('waterN', t)
  return t
}

/**
 * Ground detail for the terrain: clumps, blades and bare patches with real
 * contrast, so a meadow up close reads as grass rather than paint.
 */
export function groundTexture(aniso: number): THREE.Texture {
  return greyTexture('ground', 512, (d, g, r) => {
    const S = 512
    const a = tileNoise(S, 701, 5), b = tileNoise(S, 702, 20)
    for (let i = 0; i < S * S; i++) {
      const v = 196 + a[i] * 90 + b[i] * 60 + (r() - 0.5) * 24
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
      d[i * 4 + 3] = 255
    }
    g.putImageData(new ImageData(d, S, S), 0, 0)
    // Blades: short strokes leaning one way, light tips over dark roots.
    for (let k = 0; k < 9000; k++) {
      const x = r() * S, y = r() * S, len = 5 + r() * 9, lean = (r() - 0.5) * 5
      const lit = r() < 0.55
      g.strokeStyle = lit ? `rgba(255,255,255,${0.14 + r() * 0.2})` : `rgba(0,0,0,${0.16 + r() * 0.2})`
      g.lineWidth = 1.4 + r() * 1.4
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + lean, y - len)
      g.stroke()
    }
    // Pebbles and earth showing through.
    for (let k = 0; k < 500; k++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 + r() * 0.14})`
      g.beginPath()
      g.ellipse(r() * S, r() * S, 1 + r() * 2.5, 0.8 + r() * 1.6, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
  }, aniso)
}

/**
 * Tyre colour for the lathe UVs: u runs round the tyre, v across the profile
 * from one rim to the other. Block tread across the crown, a moulded ring and
 * worn grey lettering on the sidewalls.
 */
export function tyreTexture(aniso: number): THREE.Texture {
  const hit = cache.get('tyre')
  if (hit) return hit
  const W = 1024, H = 128
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  g.fillStyle = '#1d1d1f'
  g.fillRect(0, 0, W, H)
  // Crown: staggered blocks with dark grooves between them.
  const t0 = H * 0.36, t1 = H * 0.64
  g.fillStyle = '#262628'
  g.fillRect(0, t0, W, t1 - t0)
  g.fillStyle = '#0c0c0d'
  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * W
    g.fillRect(x, t0, 3, (t1 - t0) * 0.48)
    g.fillRect(x + W / 128, t0 + (t1 - t0) * 0.52, 3, (t1 - t0) * 0.48)
  }
  g.fillRect(0, (t0 + t1) / 2 - 1.5, W, 3)
  // Sidewalls: a raised ring and repeated lettering in faded grey.
  for (const y of [H * 0.17, H * 0.83]) {
    g.fillStyle = '#2b2b2e'
    g.fillRect(0, y - 9, W, 2)
    g.fillStyle = 'rgba(150,150,155,0.55)'
    g.font = 'bold 13px sans-serif'
    g.textBaseline = 'middle'
    for (let k = 0; k < 4; k++) g.fillText('APEX GRAVEL  205/65 R15', (k / 4) * W + 30, y)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = aniso
  cache.set('tyre', t)
  return t
}

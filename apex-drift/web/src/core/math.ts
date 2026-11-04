export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}
/** Frame-rate independent exponential approach: `rate` is 1/seconds. */
export const damp = (from: number, to: number, rate: number, dt: number): number =>
  lerp(from, to, 1 - Math.exp(-rate * dt))

/** Mulberry32: tiny, fast, and identical on every device, so a seed always builds the same stage. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const range = (r: () => number, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * r()

/** Value noise in 1D and 2D with smooth interpolation; deterministic per seed. */
export function noise2(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512)
  const r = rng(seed)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const val = new Float32Array(256)
  for (let i = 0; i < 256; i++) val[i] = r() * 2 - 1
  const h = (x: number, y: number) => val[perm[(perm[x & 255] + y) & 511]]
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
    return lerp(lerp(a, b, u), lerp(c, d, u), v)
  }
}
export function fbm2(n: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, f = 1, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += n(x * f, y * f) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

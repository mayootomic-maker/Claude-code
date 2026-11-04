import { clamp, fbm2, lerp, noise2, range, rng, smoothstep } from '../core/math'
import type { RallyDef } from '../data'

/** Distance between centreline samples, metres. */
export const STEP = 2

export type FeatureKind = 'bridge' | 'splash' | 'jump' | 'crest' | 'patch'
export interface Feature {
  kind: FeatureKind
  s0: number
  s1: number
  /** Surface override for 'patch' (ice, mud, sand). */
  surface?: string
}

export interface Closest {
  /** Index of the segment start sample. */
  i: number
  /** 0..1 along the segment. */
  t: number
  /** Distance along the route, metres. */
  s: number
  /** Unsigned distance from the centreline. */
  dist: number
  /** Signed lateral offset: positive = left of travel direction. */
  d: number
  /** Centreline height at the projection. */
  y: number
}

export interface StyleInput {
  seed: number
  km: number
  half: number
  style: RallyDef['style']
  relief: RallyDef['relief']
  water: RallyDef['water']
  patches?: RallyDef['patches']
}

const GRID = 24

export class Route {
  readonly n: number
  readonly x: Float32Array
  readonly z: Float32Array
  readonly y: Float32Array
  readonly heading: Float32Array
  readonly curv: Float32Array
  readonly length: number
  readonly half: number
  readonly features: Feature[]
  private readonly grid = new Map<number, number[]>()

  constructor(x: Float32Array, z: Float32Array, y: Float32Array, half: number, features: Feature[]) {
    this.n = x.length
    this.x = x
    this.z = z
    this.y = y
    this.half = half
    this.features = features
    this.length = (this.n - 1) * STEP
    this.heading = new Float32Array(this.n)
    this.curv = new Float32Array(this.n)
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1)
      this.heading[i] = Math.atan2(x[b] - x[a], z[b] - z[a])
    }
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(this.n - 1, i + 2)
      let dh = this.heading[b] - this.heading[a]
      while (dh > Math.PI) dh -= 2 * Math.PI
      while (dh < -Math.PI) dh += 2 * Math.PI
      this.curv[i] = dh / Math.max(STEP, (b - a) * STEP)
    }
    for (let i = 0; i < this.n - 1; i++) {
      // Index each segment in every cell its bounding box touches, so a query
      // only has to look at its own cell to find all nearby segments.
      const x0 = Math.min(x[i], x[i + 1]), x1 = Math.max(x[i], x[i + 1])
      const z0 = Math.min(z[i], z[i + 1]), z1 = Math.max(z[i], z[i + 1])
      for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++)
        for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) {
          const k = key(gx, gz)
          const list = this.grid.get(k)
          if (list) list.push(i)
          else this.grid.set(k, [i])
        }
    }
  }

  /** Interpolated centreline state at distance s. */
  at(s: number): { x: number; z: number; y: number; heading: number; curv: number; i: number } {
    const f = clamp(s / STEP, 0, this.n - 1.0001)
    const i = Math.floor(f), t = f - i
    let dh = this.heading[i + 1] - this.heading[i]
    while (dh > Math.PI) dh -= 2 * Math.PI
    while (dh < -Math.PI) dh += 2 * Math.PI
    return {
      x: lerp(this.x[i], this.x[i + 1], t),
      z: lerp(this.z[i], this.z[i + 1], t),
      y: lerp(this.y[i], this.y[i + 1], t),
      heading: this.heading[i] + dh * t,
      curv: lerp(this.curv[i], this.curv[i + 1], t),
      i,
    }
  }

  /**
   * True global nearest point on the centreline within `maxDist`.
   * Hairpins and crossings put several legs of road close together; returning
   * the nearest leg rather than "a" leg is what keeps scenery off the road.
   */
  closest(px: number, pz: number, maxDist = 400): Closest | null {
    let best = Infinity, bi = -1, bt = 0
    const cx = Math.floor(px / GRID), cz = Math.floor(pz / GRID)
    const rings = Math.ceil(maxDist / GRID)
    for (let ring = 0; ring <= rings; ring++) {
      // A segment found in ring k is at most (k+1)*GRID*sqrt2 away; anything in
      // ring k+1 or further is at least k*GRID away, so we can stop once the
      // best hit is closer than that.
      if (bi >= 0 && Math.sqrt(best) < (ring - 1) * GRID) break
      for (let gx = cx - ring; gx <= cx + ring; gx++)
        for (let gz = cz - ring; gz <= cz + ring; gz++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== ring) continue
          const list = this.grid.get(key(gx, gz))
          if (!list) continue
          for (const i of list) {
            const ax = this.x[i], az = this.z[i]
            const dx = this.x[i + 1] - ax, dz = this.z[i + 1] - az
            const len2 = dx * dx + dz * dz || 1
            const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1)
            const qx = ax + dx * t - px, qz = az + dz * t - pz
            const d2 = qx * qx + qz * qz
            if (d2 < best) {
              best = d2
              bi = i
              bt = t
            }
          }
        }
    }
    if (bi < 0 || best > maxDist * maxDist) return null
    const ax = this.x[bi], az = this.z[bi]
    const dx = this.x[bi + 1] - ax, dz = this.z[bi + 1] - az
    const len = Math.hypot(dx, dz) || 1
    // Left normal of travel direction (dx,dz) in the x/z plane is (dz,-dx).
    const d = ((px - ax) * dz - (pz - az) * dx) / len
    return {
      i: bi,
      t: bt,
      s: (bi + bt) * STEP,
      dist: Math.sqrt(best),
      d,
      y: lerp(this.y[bi], this.y[bi + 1], bt),
    }
  }

  /**
   * Distance from sample i to the nearest point of road that is *not* this
   * stretch (more than `skip` samples away along the route), up to maxDist.
   * Hairpin legs and crossings come close; this is how close.
   */
  otherLeg(i: number, skip: number, maxDist: number): number {
    const px = this.x[i], pz = this.z[i]
    let best = maxDist * maxDist
    const cx = Math.floor(px / GRID), cz = Math.floor(pz / GRID)
    const rings = Math.ceil(maxDist / GRID)
    for (let gx = cx - rings; gx <= cx + rings; gx++)
      for (let gz = cz - rings; gz <= cz + rings; gz++) {
        const list = this.grid.get(key(gx, gz))
        if (!list) continue
        for (const j of list) {
          if (Math.abs(j - i) < skip) continue
          const ax = this.x[j], az = this.z[j]
          const dx = this.x[j + 1] - ax, dz = this.z[j + 1] - az
          const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1)
          const d2 = (ax + dx * t - px) ** 2 + (az + dz * t - pz) ** 2
          if (d2 < best) best = d2
        }
      }
    return Math.sqrt(best)
  }

  featureAt(s: number, kind: FeatureKind): Feature | undefined {
    return this.features.find((f) => f.kind === kind && s >= f.s0 && s <= f.s1)
  }
}

const key = (gx: number, gz: number): number => (gx + 32768) * 65536 + (gz + 32768)

type Piece = { len: number; k: number }

/**
 * Builds a stage centreline from a rally's style. Curvature changes at a
 * limited rate, which gives every corner a natural entry and exit (an
 * approximate clothoid) instead of the kinks you get from joining raw arcs.
 */
export function buildRoute(input: StyleInput): Route {
  const r = rng(input.seed)
  const total = Math.max(600, input.km * 1000)
  const st = input.style
  const xs: number[] = [0], zs: number[] = [0]
  let x = 0, z = 0, h = 0, k = 0
  // Spatial hash of already-placed samples for overlap rejection.
  const placed = new Map<number, number[]>()
  // Two legs of road (a hairpin, a switchback) may run side by side, but never
  // closer than a road width plus a verge between them.
  const CLEAR = input.half * 2 + 10
  const mark = (i: number) => {
    const kk = key(Math.floor(xs[i] / CLEAR), Math.floor(zs[i] / CLEAR))
    const l = placed.get(kk)
    if (l) l.push(i)
    else placed.set(kk, [i])
  }
  mark(0)
  const collides = (px: number, pz: number, upTo: number): boolean => {
    const gx = Math.floor(px / CLEAR), gz = Math.floor(pz / CLEAR)
    for (let a = gx - 1; a <= gx + 1; a++)
      for (let b = gz - 1; b <= gz + 1; b++) {
        const l = placed.get(key(a, b))
        if (!l) continue
        for (const i of l) {
          if (i > upTo) continue
          if ((px - xs[i]) ** 2 + (pz - zs[i]) ** 2 < CLEAR * CLEAR) return true
        }
      }
    return false
  }
  const kRate = 0.0045 // max change of curvature per metre

  const simulate = (pieces: Piece[], commit: boolean): boolean => {
    let sx = x, sz = z, sh = h, sk = k
    const n0 = xs.length
    const pts: [number, number][] = []
    for (const p of pieces) {
      for (let d = 0; d < p.len; d += STEP) {
        sk += clamp(p.k - sk, -kRate * STEP, kRate * STEP)
        sh += sk * STEP
        sx += Math.sin(sh) * STEP
        sz += Math.cos(sh) * STEP
        // Ignore the most recent ~80 m: the road is always "near" itself there.
        if (collides(sx, sz, n0 - 1 - 40 + pts.length)) return false
        pts.push([sx, sz])
      }
    }
    if (commit) {
      for (const [px, pz] of pts) {
        xs.push(px)
        zs.push(pz)
        mark(xs.length - 1)
      }
      x = sx; z = sz; h = sh; k = sk
    }
    return true
  }

  const backtrack = (samples: number) => {
    const keep = Math.max(2, xs.length - samples)
    xs.length = keep
    zs.length = keep
    placed.clear()
    for (let i = 0; i < keep; i++) mark(i)
    x = xs[keep - 1]
    z = zs[keep - 1]
    h = Math.atan2(xs[keep - 1] - xs[keep - 2], zs[keep - 1] - zs[keep - 2])
    k = 0
  }
  const corner = (radius: number, angleDeg: number, dir: number): Piece[] => {
    const len = (Math.abs(angleDeg) * Math.PI) / 180 * radius
    return [{ len: Math.max(STEP * 2, len), k: dir / radius }]
  }
  // A slowly wandering preferred heading keeps the stage travelling somewhere
  // instead of curling up on itself.
  let wander = 0
  let stuck = 0
  let guard = 0
  while ((xs.length - 1) * STEP < total && guard++ < 20000) {
    wander += (r() - 0.5) * 0.6
    wander = clamp(wander, -1.2, 1.2)
    const bias = h - wander
    // Far off the general direction: always turn back, or the road spirals.
    const dir = Math.abs(bias) > 1.3 ? -Math.sign(bias) : r() < 0.5 + clamp(bias, -0.35, 0.35) ? -1 : 1
    const roll = r()
    let pieces: Piece[]
    if (roll < st.hairpin * 0.6) {
      pieces = [...corner(range(r, [11, 15]), range(r, [150, 180]), dir), { len: range(r, [20, 50]), k: 0 }]
    } else if (roll < st.hairpin * 0.6 + st.switchbacks * 0.35) {
      pieces = []
      const n = 2 + Math.floor(r() * 3)
      for (let j = 0; j < n; j++) {
        const d = j % 2 ? -dir : dir
        pieces.push(...corner(range(r, [11, 16]), range(r, [155, 178]), d), { len: range(r, [24, 60]), k: 0 })
      }
    } else if (roll < st.hairpin * 0.6 + st.switchbacks * 0.35 + st.esses) {
      pieces = []
      const n = 2 + Math.floor(r() * 3)
      for (let j = 0; j < n; j++)
        pieces.push(...corner(range(r, [st.radius[0] * 1.2, st.radius[1] * 0.8]), range(r, [25, 60]), j % 2 ? -dir : dir))
      pieces.push({ len: range(r, [10, 30]), k: 0 })
    } else if (roll < st.hairpin * 0.6 + st.switchbacks * 0.35 + st.esses + st.fast) {
      pieces = [...corner(range(r, [st.radius[1], st.radius[1] * 2.2]), range(r, [20, 70]), dir), { len: range(r, st.straight) * 0.5, k: 0 }]
    } else {
      pieces = [{ len: range(r, st.straight), k: 0 }, ...corner(range(r, st.radius), range(r, st.angle), dir)]
    }
    if (simulate(pieces, false)) {
      simulate(pieces, true)
      stuck = 0
    }    else if (simulate(pieces.map((p) => ({ ...p, k: -p.k })), false)) simulate(pieces.map((p) => ({ ...p, k: -p.k })), true)
    else {
      // Boxed in: try a fan of gentle arcs; if none fits, back up and re-roll.
      let ok = false
      for (const c of [0, 1 / 300, -1 / 300, 1 / 150, -1 / 150, 1 / 80, -1 / 80, 1 / 45, -1 / 45]) {
        const p: Piece[] = [{ len: 30, k: c }]
        if (simulate(p, false)) {
          simulate(p, true)
          ok = true
          break
        }
      }
      if (!ok) backtrack(60 * ++stuck)
      else stuck = 0
    }
  }
  const n = Math.min(xs.length, Math.floor(total / STEP) + 1)
  const X = new Float32Array(n), Z = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    X[i] = xs[i]
    Z[i] = zs[i]
  }

  const features: Feature[] = []
  const Y = elevation(X, Z, input, r, features)
  water(input, r, features, n)
  return new Route(X, Z, Y, input.half, features)
}

function elevation(X: Float32Array, Z: Float32Array, input: StyleInput, r: () => number, features: Feature[]): Float32Array {
  const n = X.length
  const rel = input.relief
  const nz = noise2(input.seed * 7 + 3)
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = fbm2(nz, X[i] / rel.scale, Z[i] / rel.scale, 4) * rel.amp
  // Smooth, then limit the grade so the road never becomes a wall.
  const win = Math.max(1, Math.round(rel.smooth / STEP))
  const sm = new Float32Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += raw[i]
    if (i >= win) acc -= raw[i - win]
    sm[i] = acc / Math.min(i + 1, win)
  }
  const Y = new Float32Array(n)
  Y[0] = sm[0]
  const maxDy = rel.grade * STEP
  for (let i = 1; i < n; i++) Y[i] = Y[i - 1] + clamp(sm[i] - Y[i - 1], -maxDy, maxDy)
  // Small bumps for texture, and the odd crest or jump on long straights.
  const bump = noise2(input.seed * 13 + 1)
  for (let i = 0; i < n; i++) Y[i] += bump((i * STEP) / 28, 0.5) * rel.bumps * 4
  const want = Math.floor((n * STEP) / 1000 * (rel.crest * 25 + rel.jump * 30))
  for (let tries = 0, made = 0; made < want && tries < 200; tries++) {
    const i = 40 + Math.floor(r() * (n - 120))
    let straight = true
    for (let j = i - 30; j < i + 30; j++) if (Math.abs(curvAt(X, Z, j)) > 1 / 220) straight = false
    if (!straight || features.some((f) => Math.abs(f.s0 / STEP - i) < 60)) continue
    const isJump = r() < rel.jump / Math.max(1e-6, rel.jump + rel.crest)
    const hgt = isJump ? range(r, [1.2, 2.2]) : range(r, [0.8, 1.5])
    const w = isJump ? 9 : 16
    for (let j = i - w * 2; j <= i + w; j++) {
      // Jumps ramp up slowly and drop sharply; that's what launches the car.
      const u = j < i ? smoothstep(i - w * 2, i, j) : 1 - smoothstep(i, i + (isJump ? 2 : w), j)
      Y[j] += hgt * u
    }
    features.push({ kind: isJump ? 'jump' : 'crest', s0: (i - 4) * STEP, s1: (i + 4) * STEP })
    made++
  }
  // Round off every convex crest so that only the deliberate, called jumps
  // can launch the car. A car at speed v leaves the ground where the road's
  // vertical curvature exceeds g/v²; 0.008/m holds it down to ~125 km/h.
  const lim = 0.008 * STEP * STEP
  const isJump = new Uint8Array(n)
  for (const f of features) if (f.kind === 'jump') for (let j = Math.floor(f.s0 / STEP) - 24; j <= f.s1 / STEP + 4; j++) if (j >= 0 && j < n) isJump[j] = 1
  for (let pass = 0; pass < 60; pass++) {
    let worst = 0
    for (let i = 1; i < n - 1; i++) {
      if (isJump[i]) continue
      const d2 = Y[i + 1] - 2 * Y[i] + Y[i - 1]
      if (d2 < -lim) {
        Y[i] -= (-d2 - lim) * 0.5
        worst = Math.max(worst, -d2 - lim)
      }
    }
    if (worst < 1e-3) break
  }
  return Y
}

function curvAt(X: Float32Array, Z: Float32Array, i: number): number {
  const n = X.length
  const a = clamp(i - 2, 0, n - 1), m = clamp(i, 0, n - 1), b = clamp(i + 2, 0, n - 1)
  const h1 = Math.atan2(X[m] - X[a], Z[m] - Z[a]), h2 = Math.atan2(X[b] - X[m], Z[b] - Z[m])
  let d = h2 - h1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d / 8
}

function water(input: StyleInput, r: () => number, features: Feature[], n: number): void {
  const len = n * STEP
  const place = (kind: FeatureKind, count: number, w: number, surface?: string) => {
    for (let c = 0, tries = 0; c < count && tries < 60; tries++) {
      const s = range(r, [300, len - 300])
      if (features.some((f) => Math.abs(f.s0 - s) < 160)) continue
      features.push({ kind, s0: s, s1: s + w, surface })
      c++
    }
  }
  place('bridge', Math.round((len / 1000) * input.water.bridge * 0.6), 24)
  place('splash', Math.round((len / 1000) * input.water.splash * 0.5), 14)
  const p = input.patches
  if (p) {
    for (let s = p.every * 0.5; s < len - 200; s += p.every)
      if (r() < p.p) features.push({ kind: 'patch', s0: s, s1: s + range(r, p.len), surface: p.kind })
  }
  features.sort((a, b) => a.s0 - b.s0)
}


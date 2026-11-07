import { clamp, lerp, wrapAngle } from '../core/math'
import type { CarPhys } from '../data'
import { DT, MU, wheelForce, type Car, type Input } from './car'
import { STEP, type Route } from './route'

const G = 9.81
/** Share of the friction circle the AI plans to use in a corner and under braking. */
const CORNER = 0.92, BRAKE = 0.76
/** Clearance from the line to the road edge: half a car and a little air. */
const EDGE = 1.15

/**
 * A racing line round one stage for one car, and the speed it can be driven
 * at. The line cuts every corner as far as the road allows; the speed comes
 * from the line's own curvature, the grip of whatever is under the wheels
 * there (ice patches, water splashes), and braking back from every corner
 * ahead. The same integration as the stage's ideal time, but on the line a
 * driver would take rather than the centreline.
 */
export interface RaceLine {
  route: Route
  /** Lateral offset of the line from the centreline at each route sample, + left. */
  off: Float32Array
  /** Signed curvature of the line at each sample, 1/m. */
  curv: Float32Array
  /** Fastest speed at each sample: the cornering limit, braked back from everything ahead. */
  vmax: Float32Array
  /** The same, also limited by how fast the car can accelerate out of each corner. */
  vrun: Float32Array
  /** Seconds from the start of the route to each sample, driven at `vrun`. */
  tcum: Float32Array
  /** How far either side of the centreline the line may go. */
  room: number
}

function sample(a: Float32Array, s: number): number {
  const f = clamp(s / STEP, 0, a.length - 1.0001)
  const i = Math.floor(f)
  return lerp(a[i], a[i + 1], f - i)
}

export const lineOffset = (l: RaceLine, s: number): number => sample(l.off, s)
export const lineSpeed = (l: RaceLine, s: number): number => sample(l.vmax, s)
/** Seconds the line takes from `s0` to `s1` at full pace. */
export const lineTime = (l: RaceLine, s0: number, s1: number): number => sample(l.tcum, s1) - sample(l.tcum, s0)

/**
 * Builds the line by relaxation: each point moves toward the midpoint of its
 * neighbours (a string pulled tight round the corners), clamped to the road,
 * first over long spans to find the shape of each corner, then short ones to
 * smooth it.
 */
export function raceLine(route: Route, surface: string, wet: boolean, p: CarPhys): RaceLine {
  const n = route.n
  const room = Math.max(0.5, route.half - EDGE)
  const nx = new Float32Array(n), nz = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    nx[i] = Math.cos(route.heading[i])
    nz[i] = -Math.sin(route.heading[i])
  }
  const off = new Float32Array(n)
  for (const [k, iters] of [[14, 40], [7, 40], [3, 30]] as const) {
    for (let it = 0; it < iters; it++) {
      for (let i = k; i < n - k; i++) {
        const a = i - k, b = i + k
        const mx = (route.x[a] + nx[a] * off[a] + route.x[b] + nx[b] * off[b]) / 2
        const mz = (route.z[a] + nz[a] * off[a] + route.z[b] + nz[b] * off[b]) / 2
        const want = (mx - route.x[i]) * nx[i] + (mz - route.z[i]) * nz[i]
        off[i] = clamp(off[i] + (want - off[i]) * 0.6, -room, room)
      }
    }
  }
  // Curvature of the line itself, from the heading change across a few samples.
  const px = new Float32Array(n), pz = new Float32Array(n), hd = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    px[i] = route.x[i] + nx[i] * off[i]
    pz[i] = route.z[i] + nz[i] * off[i]
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    hd[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a])
  }
  const curv = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2)
    let len = 0
    for (let j = a; j < b; j++) len += Math.hypot(px[j + 1] - px[j], pz[j + 1] - pz[j])
    curv[i] = wrapAngle(hd[b] - hd[a]) / Math.max(STEP, len)
  }
  // Grip along the road: patches and splashes override the rally's surface.
  const base = surface === 'asphalt' && wet ? 'wet' : surface
  const mu = new Float32Array(n).fill((MU[base] ?? 0.8) * p.grip)
  for (const f of route.features) {
    const sf = f.kind === 'patch' ? f.surface : f.kind === 'splash' ? 'water' : undefined
    if (!sf) continue
    for (let i = Math.max(0, Math.floor(f.s0 / STEP) - 2); i <= Math.min(n - 1, Math.ceil(f.s1 / STEP) + 2); i++) mu[i] = Math.min(mu[i], (MU[sf] ?? 0.8) * p.grip)
  }
  const vmax = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // The tightest point within a car's length: the line's curvature is noisy at sample scale.
    let k = 0
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) k = Math.max(k, Math.abs(curv[j]))
    vmax[i] = Math.min(70, Math.sqrt((mu[i] * G * CORNER) / Math.max(k, 1e-4)))
  }
  // Bumps: a car skipping from crest to crest of a broken road is in the air
  // half the time and corners on what's left. Corner as if the grip were less.
  for (let i = 2; i < n - 2; i++) {
    let kv = 0
    for (let j = i - 1; j <= i + 1; j++) kv = Math.max(kv, -(route.y[j + 1] - 2 * route.y[j] + route.y[j - 1]) / (STEP * STEP))
    const hop = Math.sqrt((G * 2.5) / Math.max(kv, 1e-4))
    if (hop < vmax[i]) vmax[i] = lerp(vmax[i], Math.max(hop, vmax[i] * 0.85), Math.min(1, Math.abs(curv[i]) * 40))
  }
  // Crests: over the brow the road falls away, and a car going fast enough
  // flies. A short hop on a straight is fine; flying into a corner, or far
  // enough to land out of shape, is how stages are lost. Ease off for any crest
  // that would throw the car, more so if the road bends near the landing.
  for (let i = 3; i < n - 3; i++) {
    const kv = -(route.y[i + 3] - 2 * route.y[i] + route.y[i - 3]) / (3 * STEP) ** 2
    if (kv <= 0.002) continue
    let bend = 0
    for (let j = i; j < Math.min(n, i + 25); j++) bend = Math.max(bend, Math.abs(curv[j]))
    const fly = bend > 0.012 ? 1.1 : 1.9
    const cap = Math.sqrt((G * fly) / kv)
    for (let j = Math.max(0, i - 2); j <= i + 2; j++) vmax[j] = Math.min(vmax[j], cap)
  }
  for (let i = n - 2; i >= 0; i--) vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * mu[i] * G * BRAKE * STEP))
  // Forward pass with the car's real gearbox, limited by the grip of its driven wheels.
  const driven = p.frontDrive > 0.01 && p.frontDrive < 0.99 ? 1 : p.frontDrive >= 0.99 ? p.b / (p.a + p.b) : p.a / (p.a + p.b)
  const vrun = new Float32Array(n)
  const tcum = new Float32Array(n)
  vrun[0] = Math.min(vmax[0], 1)
  for (let i = 1; i < n; i++) {
    const v = Math.max(vrun[i - 1], 1)
    const f = Math.min(wheelForce(p, v), mu[i] * driven * p.mass * G)
    const a = (f - p.dragCd * 2.2 * v * v) / p.mass - 0.02 * G
    vrun[i] = Math.min(vmax[i], Math.sqrt(v * v + 2 * Math.max(0, a) * STEP))
    tcum[i] = tcum[i - 1] + STEP / Math.max(1, (vrun[i] + vrun[i - 1]) / 2)
  }
  return { route, off, curv, vmax, vrun, tcum, room }
}

/** Another car as an AI driver sees it. */
export interface Traffic {
  s: number
  d: number
  speed: number
}

/**
 * Drives a car round a race line. Steering is pure pursuit of a point on the
 * line a speed-dependent distance ahead, aimed with the direction of travel
 * rather than the nose so a slide doesn't throw it wide; pedals chase the
 * line's speed scaled by skill; the handbrake swings it round hairpins. Cars
 * in the way are passed on whichever side has room, or followed if neither has.
 */
export class AiDriver {
  /** Multiplies the line's speed: 1 is the limit the line was planned at. */
  skill: number
  /** Sideways shift from the racing line, metres, + left: how it gets round other cars. */
  shift = 0
  private hbT = 0
  private hbCorner = -1

  constructor(readonly car: Car, readonly line: RaceLine, skill: number, readonly aggression: number) {
    this.skill = skill
  }

  drive(traffic: readonly Traffic[]): Input {
    const car = this.car
    const line = this.line
    const route = line.route
    const room = line.room
    const s = car.s, v = car.speed
    // --- traffic --------------------------------------------------------------
    let want = 0, cap = Infinity, busy = false
    for (const o of traffic) {
      const ds = o.s - s
      if (ds < -7 || ds > 40) continue
      const mine = clamp(lineOffset(line, o.s) + this.shift, -room, room)
      const lat = o.d - mine
      if (Math.abs(lat) > 2.3) continue
      busy = true
      if (ds > 3.5) {
        if (v < o.speed - 0.5) continue
        // Room either side of the car ahead, measured to the edge of what the line may use.
        const left = room - o.d, right = o.d + room
        // Stay committed to a side already chosen unless the other is clearly better.
        const side = Math.abs(left - right) < 0.6 && this.shift !== 0 ? Math.sign(this.shift) : left > right ? 1 : -1
        const gap = side > 0 ? left : right
        const bold = 1.9 + (1 - this.aggression) * 0.5
        if (gap > bold) want = clamp(o.d + side * 2.3, -room, room) - lineOffset(line, s)
        else cap = Math.min(cap, o.speed + Math.max(0, ds - 6) * 0.5)
      } else {
        // Alongside: keep a car's width between the two, and don't turn in on it.
        const away = lat <= 0 ? 1 : -1
        want = clamp(o.d + away * 2.2, -room, room) - lineOffset(line, s)
      }
    }
    const rate = (busy ? 2.4 : 0.9) * DT
    this.shift += clamp((busy ? want : 0) - this.shift, -rate, rate)

    // --- steering -----------------------------------------------------------
    const look = 5 + v * 0.65
    const sa = s + look
    const a = route.at(sa)
    const oa = clamp(lineOffset(line, sa) + this.shift, -room, room)
    const tx = a.x + Math.cos(a.heading) * oa, tz = a.z - Math.sin(a.heading) * oa
    const beta = Math.atan2(car.vy, Math.max(2, Math.abs(car.vx)))
    const err = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - (car.heading + beta))
    const here = clamp(lineOffset(line, s) + this.shift, -room, room)
    const gain = 1 / (1 + v / 30)
    // Catch a slide past a few degrees; a held angle in a hairpin is fine.
    const catchSlide = -Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.1) * 2.6
    // How fast it's moving across the road: damps the weave a pure pursuit sets up at speed.
    const road = route.at(s)
    const dDot = v * Math.sin(wrapAngle(car.heading + beta - road.heading)) - (lineOffset(line, s + v * 0.1) - lineOffset(line, s)) * 10
    const steer = clamp((-err * 3.2 + car.r * 0.35 + (car.d - here) * 0.14 + dDot * 0.2) * gain + catchSlide, -1, 1)
    if (car.airborne) return { steer, throttle: 0.3, brake: 0, handbrake: false }

    // --- pedals ---------------------------------------------------------------
    // Off the line the corner is tighter than planned; slow for it a little.
    // Running wide of where it means to be, too: back off until it's on line again.
    const offLine = Math.abs(this.shift) / Math.max(1, room) + Math.max(0, Math.abs(car.d - here) - 0.8) * 0.5
    // Read the speed a moment ahead: pedals and tyres take time to act.
    const ahead = Math.min(lineSpeed(line, s + 2), lineSpeed(line, s + 2 + v * 0.25))
    const target = Math.min(ahead * this.skill * (1 - 0.06 * Math.min(2, offLine)), cap)
    const over = v - target
    let throttle = over < 0 ? clamp(-over / 1.5, 0.3, 1) : 0
    const brake = over > 0.2 ? clamp(over / 0.8, 0, 1) : 0

    // --- handbrake for hairpins ----------------------------------------------
    let handbrake = false
    if (this.hbT > 0) {
      this.hbT -= DT
      handbrake = true
      throttle = Math.max(throttle, 0.4)
    } else if (v > 7 && v < 21) {
      const i0 = Math.floor((s + 3) / STEP), i1 = Math.min(line.curv.length - 1, Math.floor((s + 8 + v * 0.35) / STEP))
      for (let i = i0; i <= i1; i++) {
        if (Math.abs(line.curv[i]) > 1 / 11 && Math.abs(i - this.hbCorner) > 20) {
          this.hbCorner = i
          this.hbT = 0.22 + 0.12 * this.aggression
          break
        }
      }
    }
    return { steer, throttle, brake, handbrake }
  }
}

import { clamp, damp, lerp, rng, smoothstep, wrapAngle } from '../core/math'
import type { CarPhys } from '../data'
import { DT, MU, wheelForce, type Car, type Input } from './car'
import type { Rung } from './levels'
import type { Personality } from './personality'
import { STEP, type Route } from './route'

const G = 9.81

/**
 * How a driver plans a line: what share of the friction circle it means to
 * use in corners and under braking, how close to the edge it dares go, how
 * much of the road it uses, and where it puts the apex.
 */
export interface LineStyle {
  grip: number
  brake: number
  edge: number
  /** 0..1: 1 is the full racing line, 0 the centreline. */
  lineUse: number
  /** -1 early … +1 late apex. */
  apex: number
}

/** The old Pro's line: the default for anything that needs a line without a driver. */
export const DEFAULT_STYLE: LineStyle = { grip: 0.92, brake: 0.76, edge: 1.15, lineUse: 1, apex: 0 }

/**
 * A racing line round one stage for one car and one driver's style, and the
 * speed it can be driven at. The line cuts every corner as far as the style
 * allows; the speed comes from the line's own curvature, the grip of whatever
 * is under the wheels there (ice patches, water splashes), crests and bumps,
 * and braking back from every corner ahead.
 */
export interface RaceLine {
  route: Route
  /** Lateral offset of the line from the centreline at each route sample, + left. */
  off: Float32Array
  /** Signed curvature of the line at each sample, 1/m, + turning left. */
  curv: Float32Array
  /** Friction coefficient under the wheels at each sample, this car's tyres included. */
  mu: Float32Array
  /** The fastest the car can be at each sample on its own: cornering, crests and bumps, before braking. */
  vcorner: Float32Array
  /** Fastest speed at each sample: the cornering limit, braked back from everything ahead. */
  vmax: Float32Array
  /** The same, also limited by how fast the car can accelerate out of each corner. */
  vrun: Float32Array
  /** Seconds from the start of the route to each sample, driven at `vrun`. */
  tcum: Float32Array
  /** How far either side of the centreline the line may go. */
  room: number
  style: LineStyle
}

function sample(a: Float32Array, s: number): number {
  const f = clamp(s / STEP, 0, a.length - 1.0001)
  const i = Math.floor(f)
  return lerp(a[i], a[i + 1], f - i)
}

export const lineOffset = (l: RaceLine, s: number): number => sample(l.off, s)
export const lineSpeed = (l: RaceLine, s: number): number => sample(l.vmax, s)
export const lineRun = (l: RaceLine, s: number): number => sample(l.vrun, s)
/** Seconds the line takes from `s0` to `s1` at full pace. */
export const lineTime = (l: RaceLine, s0: number, s1: number): number => sample(l.tcum, s1) - sample(l.tcum, s0)

/**
 * Builds the line by relaxation: each point moves toward the midpoint of its
 * neighbours (a string pulled tight round the corners), clamped to the road,
 * first over long spans to find the shape of each corner, then short ones to
 * smooth it. The style then moves the apex and narrows the line.
 */
export function raceLine(route: Route, surface: string, wet: boolean, p: CarPhys, style: LineStyle = DEFAULT_STYLE): RaceLine {
  const n = route.n
  const room = Math.max(0.5, route.half - style.edge)
  const nx = new Float32Array(n), nz = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    nx[i] = Math.cos(route.heading[i])
    nz[i] = -Math.sin(route.heading[i])
  }
  const tight = new Float32Array(n)
  for (const [k, iters] of [[14, 40], [7, 40], [3, 30]] as const) {
    for (let it = 0; it < iters; it++) {
      for (let i = k; i < n - k; i++) {
        const a = i - k, b = i + k
        const mx = (route.x[a] + nx[a] * tight[a] + route.x[b] + nx[b] * tight[b]) / 2
        const mz = (route.z[a] + nz[a] * tight[a] + route.z[b] + nz[b] * tight[b]) / 2
        const want = (mx - route.x[i]) * nx[i] + (mz - route.z[i]) * nz[i]
        tight[i] = clamp(tight[i] + (want - tight[i]) * 0.6, -room, room)
      }
    }
  }
  // A late apex is the same shape reached later: the car stays wide longer,
  // turns in tighter and straightens the exit. An early one the reverse.
  const shift = Math.round(style.apex * 3)
  const off = new Float32Array(n)
  for (let i = 0; i < n; i++) off[i] = clamp(tight[clamp(i - shift, 0, n - 1)] * style.lineUse, -room, room)
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
  const vcorner = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // The tightest point within a car's length: the line's curvature is noisy at sample scale.
    let k = 0
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) k = Math.max(k, Math.abs(curv[j]))
    // In a hairpin the car is at full lock and rotating hard, and can't use the
    // last few percent of the tyres the way it can in an open bend.
    const g = style.grip - Math.max(0, style.grip - 0.92) * smoothstep(1 / 25, 1 / 11, k)
    vcorner[i] = Math.min(70, Math.sqrt((mu[i] * G * g) / Math.max(k, 1e-4)))
  }
  // Bumps: a car skipping from crest to crest of a broken road is in the air
  // half the time and corners on what's left. Corner as if the grip were less.
  for (let i = 2; i < n - 2; i++) {
    let kv = 0
    for (let j = i - 1; j <= i + 1; j++) kv = Math.max(kv, -(route.y[j + 1] - 2 * route.y[j] + route.y[j - 1]) / (STEP * STEP))
    const hop = Math.sqrt((G * 2.5) / Math.max(kv, 1e-4))
    if (hop < vcorner[i]) vcorner[i] = lerp(vcorner[i], Math.max(hop, vcorner[i] * 0.85), Math.min(1, Math.abs(curv[i]) * 40))
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
    for (let j = Math.max(0, i - 2); j <= i + 2; j++) vcorner[j] = Math.min(vcorner[j], cap)
  }
  const vmax = vcorner.slice()
  // Braking in a bend gets only the grip the bend leaves over.
  for (let i = n - 2; i >= 0; i--) {
    const lat = (vmax[i + 1] ** 2 * Math.abs(curv[i])) / (mu[i] * G)
    const aLong = mu[i] * G * style.brake * Math.max(0.15, 1 - lat)
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * aLong * STEP))
  }
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
  return { route, off, curv, mu, vcorner, vmax, vrun, tcum, room, style }
}

/** The line a driver of this rung and personality plans. */
export function styleFor(rung: Rung, persona: Personality): LineStyle {
  return {
    // Aggressive drivers lean on the tyres a little harder; late brakers brake later and harder.
    grip: rung.grip * (1 + 0.012 * (persona.aggression - 0.5)),
    brake: Math.min(0.95, rung.brake * (1 + 0.08 * (persona.lateBrake - 0.5))),
    edge: rung.edge + (1 - persona.line) * 1.2,
    lineUse: rung.lineUse,
    apex: persona.apex,
  }
}

/** Another car as an AI driver sees it. */
export interface Traffic {
  s: number
  d: number
  speed: number
}

export type MistakeKind = 'late' | 'wide' | 'twitch' | 'spin'

interface Mistake {
  kind: MistakeKind
  /** Seconds left, or for 'late' until the corner it was made for is behind. */
  t: number
  amount: number
  /** Its duration when it began. */
  t0: number
  /** For 'late': where the corner's apex is. For 'wide' and 'spin': which way (+ left). */
  at: number
}

/** A corner ahead on the line: where it tightens past `k`, its apex, and which way it turns. */
interface Corner {
  entry: number
  apex: number
  k: number
  dir: number
}

/**
 * A rival driver with a mind of its own. Every step it looks at the road
 * ahead and the cars around it and decides:
 *
 * - how fast it can go: its own planned line's cornering speeds, braked back
 *   over the distance to each corner with the grip actually under it, scaled
 *   by how much risk it is willing to take right now;
 * - where on the road to be: its racing line, or the other side of a slower
 *   car on a straight to pass it, or covering the inside when someone is
 *   close behind, or a car's width clear of a car alongside;
 * - whether to throw the car sideways into the next corner (drifters flick
 *   it, everyone pulls the handbrake in a true hairpin);
 * - whether it is about to hit someone who has braked hard, and back off.
 *
 * Its mood moves with the race: it pushes harder when trailing and settles
 * down when leading comfortably, a car in its mirrors rattles some and fires
 * up others, and concentration fades over a long stage. Lower rungs wander on
 * the wheel, react late and make mistakes — braking too late, running wide,
 * spinning — and every driver recovers afterwards before pushing again.
 *
 * Seeded: the same stage with the same field drives the same way every time.
 */
export class AiDriver {
  /** Multiplies the planned speed: rubber band and confidence, set by the race each step. */
  skill: number
  /** Sideways shift from the racing line, metres, + left: how it gets round other cars. */
  shift = 0
  /** Drifts it has started (flicks and handbrake entries). */
  drifts = 0
  /** Mistakes it has made, and of which kind. */
  mistakes = 0
  readonly kinds: Record<MistakeKind, number> = { late: 0, wide: 0, twitch: 0, spin: 0 }
  /** Cars it has overtaken, attacks it has committed to (picked a side), and defensive moves. */
  passes = 0
  attacks = 0
  defends = 0
  private prevGaps: number[] = []
  /** The speed it is aiming for right now, m/s. */
  target = 0
  /** -1 cautious … +1 all in. Rises when trailing, falls when leading comfortably. */
  risk = 0
  /** 0..1: how hard someone close behind is leaning on it. */
  pressure = 0
  private readonly rnd: () => number
  private readonly phase1: number
  private readonly phase2: number
  private mistake: Mistake | null = null
  private steerOut = 0
  private travelled = 0
  private lastS = 0
  private recover = 0
  /** Drift entry in progress: flick away, then the lever and turn in. */
  private flick: { t: number; dir: number; flick: number; pull: number } | null = null
  /** Index of the last corner a drift was decided for, so each corner is decided once. */
  private decided = -1
  /** Which side it committed to for a pass, so it doesn't swap mid-move. */
  private passSide = 0
  private defending = false
  /** 0.93..1: trust in the tyres, lost in a slide and won back over clean corners. */
  private feel = 1

  constructor(readonly car: Car, readonly line: RaceLine, readonly rung: Rung, readonly persona: Personality, seed: number, skill = 1) {
    this.skill = skill
    this.rnd = rng(seed)
    this.phase1 = this.rnd() * 10
    this.phase2 = this.rnd() * 10
    this.lastS = car.s
  }

  /** The next corner tighter than `kMin` within `look` metres. */
  private corner(s: number, look: number, kMin: number): Corner | null {
    const c = this.line.curv
    const i0 = Math.max(0, Math.floor(s / STEP)), i1 = Math.min(c.length - 1, Math.floor((s + look) / STEP))
    for (let i = i0; i <= i1; i++) {
      if (Math.abs(c[i]) < kMin) continue
      let a = i, k = Math.abs(c[i])
      for (let j = i; j < Math.min(c.length, i + 40) && Math.abs(c[j]) >= kMin * 0.7; j++) if (Math.abs(c[j]) > k) {
        k = Math.abs(c[j])
        a = j
      }
      return { entry: i * STEP, apex: a * STEP, k, dir: Math.sign(c[a]) }
    }
    return null
  }

  drive(traffic: readonly Traffic[], clock = 0): Input {
    const car = this.car
    const line = this.line
    const route = line.route
    const room = line.room
    const P = this.persona
    const R = this.rung
    const s = car.s, v = car.speed
    const ds = s - this.lastS
    if (ds > 0 && ds < 10) this.travelled += ds
    this.lastS = s

    // --- perception: who is where -------------------------------------------
    let ahead: Traffic | null = null, behind: Traffic | null = null, inFront = 0
    for (let k = 0; k < traffic.length; k++) {
      const o = traffic[k]
      const gap = o.s - s
      const was = this.prevGaps[k]
      if (was !== undefined && was > 0 && was < 30 && gap < -1) this.passes++
      if (was === undefined || gap < -1 || gap > 0) this.prevGaps[k] = gap
      if (gap > 0) inFront++
      if (gap > 3.5 && gap < 70 && (!ahead || gap < ahead.s - s)) ahead = o
      if (gap < -3.5 && gap > -30 && (!behind || gap > behind.s - s)) behind = o
    }

    // --- mood ----------------------------------------------------------------
    const leadingComfortably = inFront === 0 && (!behind || s - behind.s > 25)
    const want = inFront > 0
      ? clamp(0.25 + 0.5 * P.pressure + 0.3 * P.aggression, -1, 1) * (ahead && ahead.s - s < 40 ? 1 : 0.7)
      : leadingComfortably ? -0.35 * (0.4 + P.consistency) : 0.1 * P.aggression
    this.risk = damp(this.risk, want, 0.4, DT)
    const leaned = behind && behind.speed >= v - 1.5 ? clamp(1 - (s - behind.s - 3.5) / 15, 0, 1) : 0
    this.pressure = damp(this.pressure, leaned, 1.5, DT)
    // Concentration fades over a long stage; the consistent barely notice.
    const fatigue = Math.min(1, clock / 600) * (1 - P.consistency)

    // --- mistakes --------------------------------------------------------------
    const wilts = P.pressure < 0 ? -P.pressure : 0
    const hazard = (R.mistakes / 1000) * (1.6 - P.consistency) * (1 + 1.5 * fatigue + this.pressure * (0.4 + 2 * wilts) + Math.max(0, this.risk) * 0.8)
    // Mistakes happen where there's something to get wrong: on the way into a corner.
    const next = this.corner(s + 3, 40 + v * 2.2, 1 / 150)
    if (next && !this.mistake && this.recover <= 0 && !car.airborne && v > 8 && this.rnd() < hazard * 2.5 * Math.max(0, ds)) this.makeMistake(next, v)
    const m = this.mistake
    if (m) {
      m.t -= DT
      if (m.kind === 'late' ? s > m.at + 10 || m.t < -6 : m.t <= 0) this.mistake = null
    }

    // --- recovery after a moment ------------------------------------------------
    const roadHd = route.at(s).heading
    const facing = Math.abs(wrapAngle(car.heading - roadHd))
    if (facing > 1.0 || (car.offRoad && Math.abs(car.d) > route.half + 1)) this.recover = 1.6
    else if (this.recover > 0) this.recover -= DT

    // --- traffic: pass, defend, follow, avoid -----------------------------------
    let wantShift = 0, cap = Infinity, busy = false
    const a = Math.max(3, line.mu[Math.min(line.mu.length - 1, Math.max(0, Math.floor(s / STEP)))] * G * 0.7)
    for (const o of traffic) {
      const gap = o.s - s
      if (gap < -30 || gap > 70) continue
      const mine = clamp(lineOffset(line, o.s) + this.shift, -room, room)
      const lat = o.d - mine
      if (gap > 3.5) {
        if (Math.abs(lat) > 2.4) continue
        busy = true
        const closing = v - o.speed
        // Never ram: hold a speed it could still stop from before reaching the car ahead.
        const keep = 4.5 + (1 - P.aggression) * 4 + v * 0.12 * (1 - P.aggression)
        const follow = Math.sqrt(Math.max(0, o.speed * o.speed + 2 * a * Math.max(0, gap - keep)))
        // Brake-checked or a car stopped in the road: time to contact under a second.
        const ttc = closing > 0.5 ? (gap - 4) / closing : Infinity
        const faster = lineSpeed(line, s + 10) * this.skill > o.speed + 0.5 || closing > 1
        if (gap > 40 || !faster) {
          cap = Math.min(cap, follow)
          continue
        }
        // Pick a side: on a straight the other side from where it sits; into a
        // corner the bold go for the inside.
        const leftRoom = room - o.d, rightRoom = o.d + room
        let pick = this.passSide
        if (!pick) {
          if (next && next.entry - s < 30 + v && P.aggression > 0.55) pick = next.dir
          else pick = o.d > lineOffset(line, o.s) ? -1 : 1
          if ((pick > 0 ? leftRoom : rightRoom) < 2 && (pick > 0 ? rightRoom : leftRoom) > 2) pick = -pick
        }
        const space = pick > 0 ? leftRoom : rightRoom
        const need = 1.9 + (1 - P.aggression) * 0.6
        if (space > need) {
          if (!this.passSide) this.attacks++
          this.passSide = pick
          wantShift = clamp(o.d + pick * 2.3, -room, room) - lineOffset(line, s)
          // Alongside into a corner on the outside is a crash; only the brave stay there.
          if (next && next.dir === -pick && next.entry - s < 25 && P.aggression < 0.7) cap = Math.min(cap, follow)
        } else cap = Math.min(cap, follow)
        if (ttc < 1.1) cap = Math.min(cap, Math.max(0, o.speed - 2))
      } else if (gap >= -3.5) {
        if (Math.abs(lat) > 2.6) continue
        busy = true
        // Alongside: keep a car's width (a little less for the aggressive) and never turn in on it.
        const away = lat <= 0 ? 1 : -1
        wantShift = clamp(o.d + away * (2.4 - 0.3 * P.aggression), -room, room) - lineOffset(line, s)
      } else if (!busy && P.defence > 0.15 && o.speed >= v - 2 && gap > -15) {
        // Someone close behind: cover their side, a move at most, more for a defensive driver.
        const theirs = o.d - lineOffset(line, s)
        const cover = clamp(theirs, -1.8 * P.defence, 1.8 * P.defence)
        if (Math.abs(cover) > 0.4) {
          if (!this.defending) this.defends++
          this.defending = true
          wantShift = cover
        }
      }
    }
    if (!busy) this.passSide = 0
    if (!behind) this.defending = false
    const moving = busy || this.defending
    const rate = (busy ? 2.4 : this.defending ? 1.2 : 0.9) * DT
    this.shift += clamp((moving ? wantShift : 0) - this.shift, -rate, rate)

    // --- steering -----------------------------------------------------------
    const look = (this.recover > 0 ? 4 : 5) + v * 0.65
    const sa = s + look
    const ra = route.at(sa)
    // Running wide: the line it actually holds drifts out toward, and past, the edge.
    const wideK = m?.kind === 'wide' ? m.amount * Math.min(1, (m.t0 - m.t) * 1.5) : 0
    const edgeOut = m ? m.at * (route.half + 0.8) : 0
    const oa = lerp(clamp(lineOffset(line, sa) + this.shift, -room, room), edgeOut, wideK)
    const tx = ra.x + Math.cos(ra.heading) * oa, tz = ra.z - Math.sin(ra.heading) * oa
    const beta = Math.atan2(car.vy, Math.max(2, Math.abs(car.vx)))
    const err = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - (car.heading + beta))
    const here = lerp(clamp(lineOffset(line, s) + this.shift, -room, room), edgeOut, wideK)
    const gain = 1 / (1 + v / 30)
    // Catch a slide past a few degrees; a held angle in a hairpin or a drift is fine.
    // Drifters let it hang out further before catching it; past 0.45 rad everyone catches it hard.
    const holdAngle = this.flick || car.drift > 0.5 ? 0.1 + 0.2 * P.drift : 0.1
    const ab = Math.abs(beta)
    const catchSlide = -Math.sign(beta) * (Math.max(0, ab - holdAngle) * 2.6 + Math.max(0, ab - 0.45) * 4)
    // How fast it's moving across the road: damps the weave a pure pursuit sets up at speed.
    const dDot = v * Math.sin(wrapAngle(car.heading + beta - roadHd)) - (lineOffset(line, s + v * 0.1) - lineOffset(line, s)) * 10
    let steer = (-err * 3.2 + car.r * 0.35 + (car.d - here) * 0.14 + dDot * 0.2) * gain + catchSlide
    // Hands: a wander that grows when tired or rattled, and a little lag.
    const wob = R.wobble * (1 + fatigue + this.pressure * wilts) * (Math.sin(clock * 1.7 + this.phase1) * 0.6 + Math.sin(clock * 4.3 + this.phase2) * 0.4)
    steer += wob
    if (m?.kind === 'twitch') steer += m.at * m.amount * Math.sin(m.t * 18)
    this.steerOut = R.lag > 0 ? damp(this.steerOut, steer, 1 / R.lag, DT) : steer
    steer = clamp(this.steerOut, -1, 1)
    if (car.airborne) return { steer, throttle: 0.3, brake: 0, handbrake: false }

    // --- speed: braking for what's ahead with the grip that's there -------------
    const shiftCost = 1 - 0.05 * Math.min(2, Math.abs(this.shift) / Math.max(1, room) + Math.max(0, Math.abs(car.d - here) - 0.8) * 0.5)
    // Risk: a few percent either way, more for those who live on it.
    // Feeling for the limit: a slide it didn't ask for, or a wheel off the
    // road, and it trusts the tyres a little less; clean corners win it back.
    const unasked = !this.flick && car.drift < 0.5 && !m
    if ((unasked && ab > 0.28) || car.offRoad) this.feel = Math.max(0.93, this.feel - 0.6 * DT)
    else this.feel = Math.min(1, this.feel + 0.004 * DT)
    const commit = R.pace * this.skill * this.feel * (1 + this.risk * 0.012 * (0.5 + P.aggression)) * shiftCost
    let target = this.brakeTarget(s, v, commit, m)
    // Sliding when it didn't mean to: lift until the tyres bite again.
    if (unasked && ab > 0.18) target = Math.min(target, v * (1 - clamp((ab - 0.18) * 0.6, 0, 0.12)))
    target = Math.min(target, cap)
    if (this.recover > 0) target = Math.min(target, 9 + (1.6 - this.recover) * 6)
    this.target = target
    const over = v - target
    let throttle = over < 0 ? clamp(-over / 1.2, 0.3, 1) : 0
    let brake = over > 0.15 ? clamp(over / 0.7, 0, 1) : 0

    // --- drifting into corners ---------------------------------------------------
    let handbrake = false
    const f = this.flick
    if (f) {
      f.t += DT
      if (f.t < f.flick) {
        // The flick: a stab of steering away from the corner loads the outside and swings the tail.
        steer = f.dir * 0.55
      } else if (f.t < f.flick + f.pull) {
        steer = -f.dir
        handbrake = true
        // Still too fast: the lever doesn't replace the brake pedal.
        if (over < 0.5) throttle = Math.max(throttle, 0.45)
      } else this.flick = null
    } else if (this.recover <= 0 && v > 7 && !this.mistake) {
      const c = this.corner(s + 2, 10 + v * 0.6, 1 / 60)
      const ci = c ? Math.floor(c.apex / STEP) : -1
      if (c && Math.abs(ci - this.decided) > 15) {
        const hairpin = c.k > 1 / 11
        // Drifters go in sideways into anything tighter than about 50 m; on gravel everyone uses the lever in a true hairpin.
        const drifty = c.k > 1 / (12 + 40 * P.drift) && v < 15 + 14 * P.drift
        const toEntry = c.entry - s
        // Only once the braking is done: the lever carries speed into a slide, it doesn't shed it.
        if (((hairpin && v < 21) || drifty) && over < 1 && v < line.vcorner[ci] * commit + 2.5 && toEntry > -3) {
          if (toEntry < 4 + v * (0.18 + 0.12 * P.drift)) {
            this.decided = ci
            // On tarmac a slide costs more than it gains, even in a hairpin: drifters still try now and then.
            const loose = car.surface !== 'asphalt' && car.surface !== 'wet'
            const roll = this.rnd()
            if (loose ? hairpin || roll < P.drift : roll < P.drift * 0.35) {
              this.drifts++
              // A drifter flicks; a tidy driver just tugs the lever.
              const flick = P.drift > 0.45 && !hairpin ? 0.1 + 0.08 * P.drift : P.drift > 0.45 ? 0.08 : 0
              // Tarmac gives a tug, not a yank: the rear lets go far more suddenly there.
              this.flick = { t: 0, dir: c.dir, flick, pull: (loose ? 0.2 + 0.14 * Math.max(P.drift, P.aggression) : 0.08 + 0.05 * P.drift) }
              if (flick > 0) steer = c.dir * 0.55
            }
          }
        }
      }
    }
    if (m?.kind === 'spin') {
      // Overcooked it: lever, lock and a boot-full of throttle.
      steer = -m.at
      handbrake = true
      throttle = 1
      brake = 0
    }
    return { steer, throttle, brake, handbrake }
  }

  /**
   * The speed it wants now: for every point within braking distance, the
   * fastest it could arrive there and still take it, with the grip under the
   * car now if that is worse than planned (a verge, a slide), braking at the
   * style's share of that grip, a reaction distance out.
   */
  private brakeTarget(s: number, v: number, commit: number, m: Mistake | null): number {
    const line = this.line
    const n = line.vcorner.length
    const late = m?.kind === 'late' ? 1 + m.amount : 1
    const muCar = (MU[this.car.surface] ?? 0.8) * this.car.p.grip
    const share = line.style.brake
    // Pedals and tyres take a moment to bite: plan the braking point that far early.
    const react = v * (0.2 + this.rung.lag * 0.5)
    // A late braker's misjudged corner: it gets on the brakes this much later.
    const lateBy = late > 1 ? v * (late - 1) * 2 : 0
    const look = 16 + react + (v * v) / (2 * 0.3 * G)
    const i0 = Math.max(0, Math.floor(s / STEP))
    const i1 = Math.min(n - 1, i0 + Math.ceil(look / STEP))
    // Backward from the end of the window: the speed allowed at each point is
    // what the corner there takes, or what it can still brake from to the next
    // point. Braking in a bend only gets the grip the bend leaves over, so a
    // corner that tightens is braked for earlier than a straight run into it.
    const at = Math.min(i1, i0 + Math.max(1, Math.round((s - i0 * STEP + react - lateBy) / STEP)))
    let vNext = line.vmax[i1] * commit
    let best = Infinity
    for (let i = i1 - 1; i >= i0; i--) {
      const mu = i - i0 < 6 ? Math.min(line.mu[i], muCar) : line.mu[i]
      const vc = line.vcorner[i] * commit * (m?.kind === 'late' && Math.abs(i * STEP - m.at) < 30 ? late : 1)
      const lat = (vNext * vNext * Math.abs(line.curv[i])) / (mu * G)
      const aLong = mu * G * share * Math.max(0.15, 1 - lat)
      vNext = Math.min(vc, Math.sqrt(vNext * vNext + 2 * aLong * STEP))
      // From here to the point a reaction ahead, the slowest it must be.
      if (i <= at) best = Math.min(best, vNext)
    }
    return Number.isFinite(best) ? best : line.vmax[Math.min(n - 1, i0)] * commit
  }


  private makeMistake(c: Corner, v: number): void {
    const R = this.rung
    const sev = R.severity * (0.6 + 0.8 * this.rnd())
    const r = this.rnd()
    this.mistakes++
    // The worse the driver, the more of its mistakes are big ones.
    const big = R.severity * 0.35
    let kind: MistakeKind = 'twitch', t = 0.5 + 0.4 * sev, amount = 0.15 + 0.35 * sev, at = this.rnd() < 0.5 ? -1 : 1
    if (r < big && v > 8) {
      kind = 'spin'
      at = c.dir
    } else if (r < big + 0.4) {
      kind = 'late'
      t = 8
      amount = 0.08 + 0.25 * sev
      at = c.apex
    } else if (r < big + 0.7) {
      kind = 'wide'
      t = 1.8 + 2 * sev
      amount = 0.4 + 0.6 * sev
      at = -c.dir
    }
    this.mistake = { kind, t, t0: t, amount, at }
    this.kinds[kind]++
  }

  /** What it's up to, for the HUD and tests. */
  get thinking(): 'recovering' | 'mistake' | 'passing' | 'defending' | 'drifting' | 'racing' {
    return this.recover > 0 ? 'recovering' : this.mistake ? 'mistake' : this.passSide ? 'passing' : this.defending ? 'defending' : this.flick ? 'drifting' : 'racing'
  }
}

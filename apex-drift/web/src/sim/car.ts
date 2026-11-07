import { clamp, damp, lerp, smoothstep } from '../core/math'
import type { CarPhys } from '../data'
import type { Ground } from './terrain'

export const DT = 1 / 60
const G = 9.81
const TAU = Math.PI * 2
/** Gearbox, diff and driveshaft losses between crank and contact patch. */
const ETA = 0.88
const REVERSE = 3.4
/** Two wheels, tyres, hubs and brake discs on one axle, kg·m². */
const WHEEL_INERTIA = 2.2
/** Grip lost per unit of extra load on a tyre: the reason weight transfer changes the balance at all. */
const LOAD_SENS = 0.18
/**
 * Share of the lever's force that actually brakes the rears. A full lock
 * turns all their grip into braking and scrubs off half the car's speed in a
 * second; a tug that only unloads them lets the tail swing out while the car
 * carries its speed into the slide, which is how a handbrake is used on a
 * stage. `handbrakeMu` is how much rear grip is left while it's held.
 */
const HANDBRAKE_DRAG = 0.3
/** How quickly the rear lets go when the lever is pulled, and comes back after (1/s). */
const HB_IN = 14, HB_OUT = 3.5
/**
 * Share of the sliding tyres' drag along the direction of travel that a drift
 * doesn't cost. A tyre sliding at 30° turns most of its force into drag and a
 * held drift would bleed to walking pace in a few seconds; real cars keep
 * their momentum far better than a friction circle at the rear alone says,
 * because the driven rears push forward through the slide.
 */
const DRIFT_KEEP = 0.72
/** Rear grip a drift on full throttle gives up. */
const DRIFT_LOOSE = 0.35
/**
 * Front tyres reach their peak at a larger slip angle than the rears (rally
 * set-ups run stiff rear tyres): stable in a straight line and mild
 * understeer in the linear range, with both ends still able to slide at the
 * limit. Without it, tyre stiffness scales with load and the car is exactly
 * neutral, which weaves at speed.
 */
const FRONT_SLIP = 1.15, REAR_SLIP = 0.88
/** ABS holds the rears short of their peak, leaving them cornering grip: a braking car stays straight. */
const REAR_ABS = 0.7

export interface Input {
  /** -1 full left … +1 full right. */
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
}

export interface Assists {
  /** 0..1: pulls the steering toward the road direction when the player isn't steering hard. */
  steer: number
  /** Traction control and ABS: keeps the driven wheels from spinning and the braked ones from locking. */
  traction: boolean
  /** 0..1: helps the car turn in and stops a slide from growing into a spin. */
  stability: number
  /** Brakes for corners the car is arriving at too fast. */
  autoBrake: boolean
}

export const ASSISTS: Record<'rookie' | 'driver' | 'pro', Assists> = {
  rookie: { steer: 0.55, traction: true, stability: 0.85, autoBrake: true },
  driver: { steer: 0.15, traction: true, stability: 0.45, autoBrake: false },
  pro: { steer: 0, traction: false, stability: 0.12, autoBrake: false },
}

/** Peak friction coefficients. Off-road is drivable but slow. */
export const MU: Record<string, number> = {
  asphalt: 1.08, gravel: 0.82, wetgravel: 0.74, snow: 0.63, rough: 0.78,
  ice: 0.33, mud: 0.56, sand: 0.6, verge: 0.68, grass: 0.55, water: 0.6, wet: 0.84,
}

/**
 * How each surface lets go. Loose surfaces peak at larger slip and keep most
 * of their grip past the peak (the tyre ploughs a bank of gravel), which is
 * why a car on gravel can be held in a slide; tarmac peaks early and drops
 * off; ice peaks early and drops off hard.
 */
interface Tyre {
  /** Slip angle (rad) and slip ratio at peak force. */
  pkA: number; pkK: number
  /** Fraction of peak force left when fully sliding. */
  slide: number
  /** How quickly force falls from the peak toward `slide`. */
  fall: number
  /** Rolling resistance coefficient. */
  roll: number
}
const TYRE: Record<string, Tyre> = {
  asphalt: { pkA: 0.1, pkK: 0.1, slide: 0.74, fall: 0.9, roll: 0.015 },
  wet: { pkA: 0.09, pkK: 0.09, slide: 0.68, fall: 0.9, roll: 0.016 },
  gravel: { pkA: 0.15, pkK: 0.17, slide: 0.88, fall: 0.45, roll: 0.024 },
  wetgravel: { pkA: 0.15, pkK: 0.17, slide: 0.86, fall: 0.5, roll: 0.028 },
  rough: { pkA: 0.15, pkK: 0.17, slide: 0.86, fall: 0.5, roll: 0.034 },
  snow: { pkA: 0.17, pkK: 0.2, slide: 0.88, fall: 0.4, roll: 0.03 },
  ice: { pkA: 0.07, pkK: 0.07, slide: 0.55, fall: 1.2, roll: 0.012 },
  mud: { pkA: 0.18, pkK: 0.22, slide: 0.84, fall: 0.45, roll: 0.07 },
  sand: { pkA: 0.18, pkK: 0.22, slide: 0.88, fall: 0.4, roll: 0.085 },
  verge: { pkA: 0.16, pkK: 0.19, slide: 0.85, fall: 0.5, roll: 0.05 },
  grass: { pkA: 0.17, pkK: 0.2, slide: 0.78, fall: 0.6, roll: 0.09 },
  water: { pkA: 0.12, pkK: 0.12, slide: 0.7, fall: 0.8, roll: 0.12 },
}

export interface Pose {
  x: number; y: number; z: number
  heading: number; pitch: number; roll: number
  steer: number; spin: number
}

export interface CarEvents {
  /** Barrier or wall contact this step, m/s into it. */
  impact: number
  landed: number
}

function curveAt(p: CarPhys, rpm: number): number {
  const c = p.torqueCurve
  const u = clamp((rpm - p.idle) / (p.redline - p.idle), 0, 1) * (c.length - 1)
  const i = Math.min(c.length - 2, Math.floor(u))
  return lerp(c[i], c[i + 1], u - i)
}

const peakCache = new WeakMap<CarPhys, number>()
/** N·m at curve value 1, chosen so torque × rpm peaks exactly at `p.power`. */
export function peakTorque(p: CarPhys): number {
  let t = peakCache.get(p)
  if (t === undefined) {
    let best = 0
    for (let rpm = p.idle; rpm <= p.redline; rpm += 25) best = Math.max(best, curveAt(p, rpm) * rpm)
    t = p.power / ((best * TAU) / 60)
    peakCache.set(p, t)
  }
  return t
}

/** Full-throttle crank torque at an rpm and boost level (boost is ignored for a naturally aspirated engine). */
export function engineTorque(p: CarPhys, rpm: number, boost: number): number {
  const t = peakTorque(p) * curveAt(p, rpm)
  return p.turbo ? t * (p.offBoost + (1 - p.offBoost) * boost) : t
}

/** The clutch is slipped up to here when pulling away; turbo engines launch higher to light the boost. */
function launchRpm(p: CarPhys): number {
  return p.redline * (p.turbo ? 0.55 : 0.46)
}

/** Best full-throttle tractive force at a road speed in any gear, before tyre limits. */
export function wheelForce(p: CarPhys, v: number): number {
  let best = 0
  for (const g of p.gears) {
    const ratio = g * p.finalDrive
    const rpm = Math.max(launchRpm(p), (v / p.wheelRadius) * ratio * 60 / TAU)
    if (rpm > p.redline) continue
    best = Math.max(best, (engineTorque(p, rpm, 1) * ratio * ETA) / p.wheelRadius)
  }
  return best
}

export class Car {
  // Planar state in the car frame: vx forward, vy to the left, r yaw rate (+ = turning left).
  x = 0; z = 0; y = 0; heading = 0
  vx = 0; vy = 0; r = 0
  vyUp = 0
  airborne = false
  steerAngle = 0
  spin = 0
  pitch = 0; roll = 0; pitchV = 0; rollV = 0
  ax = 0; ay = 0
  surface = 'gravel'
  offRoad = false
  /** Combined slip of each axle, for tyre noise and dust. */
  slipF = 0; slipR = 0
  /** 0..1: how committed the car is to a slide (handbrake, or power held through it). Widens the angle the assists allow. */
  drift = 0
  /** 0..1: how far the rear has let go from the handbrake. */
  hbLoose = 0
  /** Distance along the route and lateral offset, updated every step. */
  s = 0; d = 0
  readonly prev: Pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0 }
  readonly events: CarEvents = { impact: 0, landed: 0 }

  // --- engine and drivetrain, for the HUD and the engine note --------------
  rpm: number
  /** 1..n forward, -1 reverse. Changes at the start of a shift; `shifting` covers the torque cut. */
  gear = 1
  shifting = false
  /** 0..1, always 0 without a turbo. */
  boost = 0
  /** Throttle actually reaching the engine after the limiter, shift cut and traction control. */
  throttleOut = 0
  /** -1..1: negative on the overrun (engine braking), positive when pulling. */
  engineLoad = 0
  /** 0..1: how hard the driven wheels are spinning. */
  wheelSpin = 0
  readonly redline: number
  readonly idle: number
  readonly turbo: boolean
  readonly cylinders: 4 | 5 | 6
  readonly layout: 'inline' | 'flat' | 'v'

  /** Wheel surface speed per axle, m/s. Differs from the ground speed when spinning or locked. */
  private wf = 0; private wr = 0
  private shiftT = 0
  private sinceShift = 0
  private limiter = false
  private reverseHold = 0
  /** Body accelerations seen through the suspension: what actually moves load between the tyres. */
  private loadAx = 0; private loadAy = 0
  /** Set by `axle` when traction control had to hold a driven wheel back. */
  private tcHit = false

  constructor(readonly p: CarPhys, private readonly ground: Ground, private readonly baseSurface: string, private readonly wet: boolean) {
    this.rpm = p.idle
    this.redline = p.redline
    this.idle = p.idle
    this.turbo = p.turbo
    this.cylinders = p.cylinders
    this.layout = p.layout
  }

  /** On the road at distance `s`, `d` metres left of the centreline, at rest. */
  place(s: number, d = 0): void {
    const a = this.ground.route.at(s)
    this.x = a.x + Math.cos(a.heading) * d; this.z = a.z - Math.sin(a.heading) * d; this.heading = a.heading
    this.y = this.ground.height(this.x, this.z)
    this.vx = this.vy = this.r = this.vyUp = 0
    this.drift = this.hbLoose = 0
    this.wf = this.wr = 0
    this.airborne = false
    this.steerAngle = 0
    this.pitch = this.roll = this.pitchV = this.rollV = 0
    this.loadAx = this.loadAy = 0
    this.gear = 1
    this.shiftT = 0
    this.shifting = false
    this.rpm = this.p.idle
    this.boost = 0
    this.s = s
    this.d = d
    this.snapshot()
  }

  /**
   * Moves the car along the road without simulating it, rolling straight at
   * `speed`: for a rival far out of sight, where only its progress matters.
   * Leaves a state the full simulation can carry on from at any step.
   */
  glide(s: number, d: number, heading: number, speed: number): void {
    this.snapshot()
    this.events.impact = 0
    this.events.landed = 0
    const a = this.ground.route.at(s)
    this.x = a.x + Math.cos(a.heading) * d
    this.z = a.z - Math.sin(a.heading) * d
    this.y = this.ground.height(this.x, this.z)
    this.heading = heading
    this.vx = speed
    this.vy = this.r = this.vyUp = 0
    this.wf = this.wr = speed
    this.airborne = false
    this.steerAngle = 0
    this.drift = this.hbLoose = 0
    this.pitch = this.roll = this.pitchV = this.rollV = 0
    this.loadAx = this.loadAy = 0
    this.s = s
    this.d = d
    this.offRoad = false
    const p = this.p
    const toRpm = (g: number) => (speed / p.wheelRadius) * g * p.finalDrive * 60 / TAU
    let g = 1
    while (g < p.gears.length && toRpm(p.gears[g]) > p.redline * 0.55) g++
    this.gear = g
    this.shiftT = 0
    this.shifting = false
    this.rpm = clamp(toRpm(p.gears[g - 1]), p.idle, p.redline)
    this.spin += (speed * DT) / p.wheelRadius
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy)
  }

  snapshot(): void {
    const q = this.prev
    q.x = this.x; q.y = this.y; q.z = this.z; q.heading = this.heading
    q.pitch = this.pitch; q.roll = this.roll; q.steer = this.steerAngle; q.spin = this.spin
  }

  /** Render pose blended between the last two physics steps. Without this the car judders at any frame rate that isn't exactly 60. */
  pose(alpha: number, out: Pose): Pose {
    const q = this.prev
    out.x = lerp(q.x, this.x, alpha)
    out.y = lerp(q.y, this.y, alpha)
    out.z = lerp(q.z, this.z, alpha)
    let dh = this.heading - q.heading
    while (dh > Math.PI) dh -= 2 * Math.PI
    while (dh < -Math.PI) dh += 2 * Math.PI
    out.heading = q.heading + dh * alpha
    out.pitch = lerp(q.pitch, this.pitch, alpha)
    out.roll = lerp(q.roll, this.roll, alpha)
    out.steer = lerp(q.steer, this.steerAngle, alpha)
    out.spin = lerp(q.spin, this.spin, alpha)
    return out
  }

  step(inp: Input, assists: Assists): void {
    this.snapshot()
    this.events.impact = 0
    this.events.landed = 0
    const p = this.p
    const L = p.a + p.b
    const R = p.wheelRadius
    const speed = this.speed
    const route = this.ground.route

    // --- where are we -------------------------------------------------------
    const c = route.closest(this.x, this.z, 200)
    if (c) {
      this.s = c.s
      this.d = c.d
    }
    const dist = c ? c.dist : 99
    const patch = c ? route.featureAt(c.s, 'patch') : undefined
    const splash = c ? route.featureAt(c.s, 'splash') : undefined
    this.offRoad = dist > this.ground.edge
    this.surface = splash && dist < route.half ? 'water'
      : dist <= route.half ? (patch?.surface ?? (this.baseSurface === 'asphalt' && this.wet ? 'wet' : this.baseSurface))
      : dist <= this.ground.edge ? 'verge' : 'grass'
    const tp = TYRE[this.surface] ?? TYRE.gravel
    const mu = (MU[this.surface] ?? 0.8) * p.grip

    // --- steering -----------------------------------------------------------
    let steerIn = clamp(inp.steer, -1, 1)
    if (assists.steer > 0 && c && !this.airborne) {
      // Aim a little down the road; blend that in only as much as the player isn't steering.
      const ahead = route.at(c.s + 8 + speed * 0.5)
      const want = Math.atan2(ahead.x - this.x, ahead.z - this.z)
      let err = want - this.heading
      while (err > Math.PI) err -= 2 * Math.PI
      while (err < -Math.PI) err += 2 * Math.PI
      const auto = clamp(-err * 2.2, -1, 1)
      const free = 1 - Math.min(1, Math.abs(steerIn) * 1.4)
      steerIn = clamp(steerIn + auto * assists.steer * free, -1, 1)
    }
    // Full lock shrinks quickly with speed. Touch buttons are on/off, so every
    // press is a full press: at speed it must ask for roughly the most the
    // front tyres can use (geometric angle plus peak slip), not more. Loose
    // surfaces peak at a bigger slip angle and so get a little more lock.
    const v2 = Math.max(speed * speed, 1)
    const maxAngle = Math.min(p.steerMax, Math.max(p.steerMax / (1 + v2 / 260), (L * mu * G) / v2 + tp.pkA))
    // Drift assist: in a committed slide the front wheels are let follow the
    // direction of travel, as caster does on a real car, so holding a slide
    // takes a small correction rather than a perfectly timed full opposite lock.
    const slideAngle = Math.atan2(this.vy, Math.max(2, Math.abs(this.vx)))
    const align = this.airborne ? 0 : this.drift * clamp(slideAngle, -0.6, 0.6) * (0.45 + 0.4 * assists.stability)
    const target = clamp(-steerIn * maxAngle + align, -p.steerMax, p.steerMax)
    const rate = p.steerSpeed * 0.55 * DT
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate)
    const delta = this.steerAngle

    // --- pedals and gear selection -----------------------------------------
    let throttle = clamp(inp.throttle, 0, 1)
    let brake = clamp(inp.brake, 0, 1)
    if (assists.autoBrake && c && !this.airborne) {
      const safe = cornerSpeed(route, c.s, speed, mu)
      if (speed > safe + 1.5) {
        throttle = Math.min(throttle, 0.15)
        brake = Math.max(brake, clamp((speed - safe) / 8, 0, 0.75))
      }
    }
    // Holding brake at a standstill selects reverse; throttle selects first again.
    if (this.gear > 0) {
      this.reverseHold = this.vx < 0.5 && brake > 0.1 && throttle < 0.1 && !inp.handbrake ? this.reverseHold + DT : 0
      if (this.reverseHold > 0.2) {
        this.gear = -1
        this.reverseHold = 0
      }
    } else if (throttle > 0.1 && this.vx > -0.5) {
      this.gear = 1
    }
    let pedal = throttle, brk = brake
    if (this.gear < 0) {
      pedal = this.vx > -9 ? brake : 0
      brk = throttle
    }

    // A pulled lever opens the centre clutch of a four-wheel-drive car and the
    // driver dips the clutch in a rear-driven one: no drive to locked wheels.
    let fShare = p.frontDrive
    let declutch = false
    if (inp.handbrake) {
      if (fShare < 0.01) declutch = true
      else fShare = 1
    }
    const ratio = this.gear < 0 ? -REVERSE * p.finalDrive : p.gears[this.gear - 1] * p.finalDrive
    const toRpm = (Math.abs(ratio) * 60) / (TAU * R)
    const wDriven = fShare * this.wf + (1 - fShare) * this.wr
    const rpmGround = Math.max(0, Math.sign(ratio) * this.vx) * toRpm

    this.sinceShift += DT
    if (this.shiftT > 0) this.shiftT -= DT
    if (this.gear > 0 && this.shiftT <= 0 && !this.airborne) {
      const n = p.gears.length
      const rl = p.redline
      // Lifting does not upshift, so the engine keeps braking into the corner.
      const up = pedal > 0.05 ? lerp(0.62, 0.97, pedal) * rl : 0.97 * rl
      // Under braking judge by road speed (a locking wheel reads zero); otherwise by
      // the faster of road and wheels, so a power slide doesn't kick down mid-drift.
      const shaft = brk > 0.1 ? rpmGround : Math.max(rpmGround, Math.max(0, Math.sign(ratio) * wDriven) * toRpm)
      const lowerRpm = this.gear > 1 ? (shaft * p.gears[this.gear - 2]) / p.gears[this.gear - 1] : Infinity
      // Each case leaves the lower gear well short of the upshift point, so the box never hunts.
      const down = brk > 0.1 ? lowerRpm < 0.8 * rl
        : pedal > 0.5 ? shaft < 0.5 * rl && lowerRpm < 0.85 * rl
        : shaft < Math.max(1.5 * p.idle, 0.3 * rl)
      // Revs from wheelspin alone don't upshift: a slide stays in gear on the limiter.
      if (this.gear < n && this.rpm > up && rpmGround > up * 0.8 && this.sinceShift > 0.3) {
        this.gear++
        this.shiftT = p.shiftTime
        this.sinceShift = 0
      } else if (this.gear > 1 && down && this.sinceShift > (brk > 0.1 ? 0.15 : 0.4)) {
        this.gear--
        this.shiftT = p.shiftTime
        this.sinceShift = 0
      }
    }
    this.shifting = this.shiftT > 0
    // Ratio may have changed with the gear.
    const ratioNow = this.gear < 0 ? -REVERSE * p.finalDrive : p.gears[this.gear - 1] * p.finalDrive
    const toRpmNow = (Math.abs(ratioNow) * 60) / (TAU * R)
    const rpmW = Math.max(0, Math.sign(ratioNow) * wDriven) * toRpmNow

    // --- engine ---------------------------------------------------------------
    const launch = p.idle + pedal * (launchRpm(p) - p.idle)
    // A car that straightens out of a big slide can find its wheels turning
    // faster than the engine may: the clutch slips rather than over-revving it.
    const overrev = rpmW > p.redline * 1.03
    const slipping = declutch || overrev || (Math.abs(this.gear) === 1 ? rpmW < launch : rpmW < p.idle)
    if (this.shifting) this.rpm = damp(this.rpm, Math.max(p.idle, rpmW), 3 / p.shiftTime, DT)
    else if (slipping) this.rpm = damp(this.rpm, overrev ? p.redline : declutch ? p.idle + pedal * (p.redline - p.idle) * 0.7 : Math.max(launch, rpmW), 12, DT)
    else this.rpm = Math.max(p.idle, rpmW)
    if (this.rpm >= p.redline) this.limiter = true
    else if (this.rpm < p.redline - 250) this.limiter = false

    let out = this.shifting || this.limiter ? 0 : pedal
    if (p.turbo) {
      const want = pedal * smoothstep(p.boostRpm * 0.75, p.boostRpm + 1200, this.rpm)
      // Boost survives a shift (the wastegate stays shut for the cut): only a lift dumps it.
      if (want > this.boost) this.boost = Math.min(want, this.boost + DT / p.boostLag)
      else if (!this.shifting) this.boost = Math.max(want, this.boost - DT * 2.5)
    }
    const tq = engineTorque(p, this.rpm, this.boost)
    const tBrake = -peakTorque(p) * (0.05 + 0.17 * (this.rpm / p.redline))
    let crank: number
    if (this.shifting || declutch || overrev) crank = 0
    else if (slipping) crank = out * tq
    else crank = out * tq + (1 - out) * tBrake
    if (rpmGround > p.redline * 1.02 && crank > 0) crank = tBrake
    const fDrive = (crank * ratioNow * ETA) / R
    const engaged = !this.shifting && !slipping
    const mEng = engaged ? (p.engineInertia * ratioNow * ratioNow) / (R * R) : 0
    const mWheel = WHEEL_INERTIA / (R * R)

    // --- tyre loads -----------------------------------------------------------
    const m = p.mass
    const Nf0 = (m * G * p.b) / L, Nr0 = (m * G * p.a) / L
    const dLong = (m * this.loadAx * p.h) / L
    const Nf = Math.max(0.08 * Nf0, Nf0 - dLong), Nr = Math.max(0.08 * Nr0, Nr0 + dLong)
    const dLat = (m * Math.abs(this.loadAy) * p.h) / (2 * p.halfW * 0.84)
    const capF = mu * axleGrip(Nf, dLat * p.rollFront, Nf0 / 2)
    this.hbLoose = damp(this.hbLoose, inp.handbrake ? 1 : 0, inp.handbrake ? HB_IN : HB_OUT, DT)
    // Power held through a drift keeps the rear light, so a slide can be
    // carried from one corner into the next instead of gripping up halfway.
    // Not at fast-road speeds, where a loose rear is a spin, not a drift.
    const loose = Math.min(lerp(1, p.handbrakeMu, this.hbLoose), 1 - DRIFT_LOOSE * this.drift * clamp(inp.throttle, 0, 1) * smoothstep(0.1, 0.25, Math.abs(slideAngle)) * (1 - smoothstep(25, 35, speed)))
    const capR = mu * axleGrip(Nr, dLat * (1 - p.rollFront), Nr0 / 2) * loose

    // --- tyre forces ----------------------------------------------------------
    const cs = Math.cos(delta), sn = Math.sin(delta)
    const vyF = this.vy + p.a * this.r
    const vxwF = this.vx * cs + vyF * sn
    const vywF = -this.vx * sn + vyF * cs
    const vyR = this.vy - p.b * this.r
    const af = Math.atan2(vywF, Math.max(Math.abs(vxwF), 4))
    const ar = Math.atan2(vyR, Math.max(Math.abs(this.vx), 4))
    const fb = brk * p.brakeForce
    const absOn = assists.traction || p.abs
    const tc = assists.traction ? 1 : 0
    // Rookie's traction control is strict; Driver's lets a held drift keep its drive.
    const tcFloor = lerp(0.75, 0.2, assists.stability)
    let Fxf = 0, Fyf = 0, Fxr = 0, Fyr = 0, kf = 0, kr = 0
    this.tcHit = false
    if (this.airborne) {
      // Wheels in the air run up to the throttle; capped so a landing doesn't spin the car.
      this.wf = damp(this.wf, vxwF * (1 + 0.06 * fShare * out), 6, DT)
      this.wr = damp(this.wr, this.vx * (1 + 0.06 * (1 - fShare) * out) * (inp.handbrake ? 0 : 1), 6, DT)
    } else {
      this.wf = this.axle(capF, vxwF, af / (tp.pkA * FRONT_SLIP), this.wf, fDrive * fShare, fb * p.brakeFront, mWheel + mEng * fShare, absOn, 0.95, tc, tcFloor, tp)
      Fxf = tyre.fx; Fyf = tyre.fy
      kf = (this.wf - vxwF) / Math.max(Math.abs(vxwF), 4)
      const hb = inp.handbrake ? p.handbrakeForce * HANDBRAKE_DRAG : 0
      this.wr = this.axle(capR, this.vx, ar / (tp.pkA * REAR_SLIP), this.wr, fDrive * (1 - fShare), fb * (1 - p.brakeFront) + hb, mWheel + mEng * (1 - fShare), absOn && !inp.handbrake, REAR_ABS, tc, tcFloor, tp)
      Fxr = tyre.fx; Fyr = tyre.fy
      kr = (this.wr - this.vx) / Math.max(Math.abs(this.vx), 4)
    }
    this.slipF = Math.hypot(af, kf * 0.5)
    this.slipR = Math.hypot(ar, kr * 0.5)
    const spinF = fShare > 0 ? kf : 0, spinR = fShare < 1 ? kr : 0
    this.wheelSpin = this.airborne ? 0 : clamp((Math.max(spinF, spinR) * Math.sign(ratioNow) - tp.pkK) / 0.4, 0, 1)
    // Traction control shows up as throttle the engine never got.
    if (this.tcHit && fDrive > 1) out *= clamp((Math.max(0, Fxf) + Math.max(0, Fxr)) / fDrive, 0.2, 1)
    this.throttleOut = out
    this.engineLoad = crank >= 0 ? clamp(crank / Math.max(1, peakTorque(p)), 0, 1) : -clamp(-crank / (peakTorque(p) * 0.22), 0, 1)

    const drag = p.dragCd * 2.2 * this.vx * Math.abs(this.vx)
    const rolling = tp.roll * m * G * Math.tanh(this.vx)
    const pitchSlope = this.groundPitch()
    const grav = m * G * Math.sin(pitchSlope)

    let tx = Fxf * cs - Fyf * sn + Fxr
    let ty = Fxf * sn + Fyf * cs + Fyr
    // A drift is committed by the lever or by holding power through a slide;
    // a slide on the brakes or off the throttle is just a slide. Rookie's
    // assists only half-commit to an unplanned power slide.
    const absSlide = Math.abs(slideAngle)
    const powered = smoothstep(0.14, 0.3, absSlide) * (pedal > 0.2 && brk < 0.2 ? 1 : 0) * (1 - assists.stability * 0.6) * (1 - smoothstep(22, 34, speed))
    const want = inp.handbrake ? 1 : absSlide > 0.07 ? Math.max(powered, Math.min(this.drift, smoothstep(0.07, 0.2, absSlide))) : 0
    this.drift = damp(this.drift, want, want > this.drift ? (inp.handbrake ? 10 : 4) : 2.5, DT)
    // Take back part of the drag the tyres put along the direction of travel
    // while the car is properly sideways. The yaw they cause, and the force
    // across the path that bends it round the corner, stay as they were.
    if (!this.airborne && speed > 4) {
      const ux = this.vx / speed, uy = this.vy / speed
      const along = tx * ux + ty * uy
      const keep = DRIFT_KEEP * smoothstep(0.08, 0.3, absSlide) * Math.max(this.drift, 0.4) * (1 - clamp(brk * 2, 0, 1))
      if (along < 0 && keep > 0) {
        tx -= along * keep * ux
        ty -= along * keep * uy
      }
    }
    let ax = (tx - drag - rolling - grav) / m
    let ay = ty / m
    let rdot = (p.a * (Fyf * cs + Fxf * sn) - p.b * Fyr) / p.iz
    if (this.airborne) {
      ax = -drag / m
      ay = 0
      // A flying car keeps its heading; without this it lands sideways.
      rdot = -this.r * 4
    }

    // --- integrate ----------------------------------------------------------
    this.vx += (ax + this.vy * this.r) * DT
    this.vy += (ay - this.vx * this.r) * DT
    this.r += rdot * DT

    // Below walking pace the slip model is meaningless; blend to a kinematic car.
    const k = smoothstep(1.5, 6, speed)
    const rKin = (this.vx * Math.tan(delta)) / L
    this.r = lerp(rKin, this.r, k)
    this.vy = lerp(this.vy * 0.8, this.vy, k)

    if (!this.airborne) {
      // What the tyres would give in a steady turn, understeer included: the
      // kinematic rate is far more than any tyre can deliver at speed.
      const kUs = ((FRONT_SLIP - REAR_SLIP) * tp.pkA) / (2 * mu * G)
      const rSteady = (this.vx * Math.tan(delta)) / (L + kUs * this.vx * this.vx)
      this.assist(inp, assists, rSteady, ay, mu, speed)
    }
    this.ax = ax
    this.ay = ay
    // Springs and dampers take about a tenth of a second to move the load.
    this.loadAx = damp(this.loadAx, this.airborne ? 0 : ax, 10, DT)
    this.loadAy = damp(this.loadAy, this.airborne ? 0 : ay, 10, DT)

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading)
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading)
    let wx = fx * this.vx + lx * this.vy
    let wz = fz * this.vx + lz * this.vy
    this.x += wx * DT
    this.z += wz * DT
    this.heading += this.r * DT
    this.spin += (this.wr * DT) / R

    // --- keep it on the stage ---------------------------------------------
    const c2 = route.closest(this.x, this.z, 200)
    if (c2) {
      const lim = this.ground.limitAt(c2.s)
      if (c2.dist > lim) {
        const a = route.at(c2.s)
        const nx = Math.cos(a.heading) * Math.sign(c2.d), nz = -Math.sin(a.heading) * Math.sign(c2.d)
        const over = c2.dist - lim
        this.x -= nx * over
        this.z -= nz * over
        const vn = wx * nx + wz * nz
        if (vn > 0) {
          // Redirect along the barrier instead of stopping dead: remove the
          // velocity into it, keep most of the rest.
          wx -= nx * vn * 1.15
          wz -= nz * vn * 1.15
          const keep = 1 - 0.18 * Math.min(1, vn / 12)
          wx *= keep
          wz *= keep
          this.vx = wx * fx + wz * fz
          this.vy = wx * lx + wz * lz
          this.r *= 0.6
          this.events.impact = vn
        }
      }
    }

    // --- vertical ------------------------------------------------------------
    const gh = this.ground.height(this.x, this.z)
    if (this.airborne) {
      this.vyUp -= G * DT
      this.y += this.vyUp * DT
      if (this.y <= gh) {
        this.events.landed = -this.vyUp
        this.y = gh
        this.airborne = false
        // Continue at the slope's own vertical speed; landing with zero
        // vertical speed on a downhill makes the car hop all the way down.
        this.vyUp = Math.tan(pitchSlope) * this.vx
        // The springs take the hit and the heavy front end dips (positive
        // pitch is nose down), further the harder the landing.
        this.pitchV += clamp(0.25 + this.events.landed * 0.07, 0.25, 0.9)
      }
    } else {
      const climb = (gh - this.y) / DT
      // Ground falling away faster than suspension plus gravity can follow
      // (about 2.5 g of drop): we're flying. Ordinary bumps stay planted,
      // including the small kinks where the road's height samples join, which
      // the suspension soaks up: without the margin a car on a bumpy road
      // skips into the air for a step at a time and loses grip mid-corner.
      if (climb < this.vyUp - G * DT * 2.5 - 0.6 && speed > 12) {
        this.airborne = true
        this.y += this.vyUp * DT
      } else {
        this.vyUp = climb
        this.y = gh
      }
    }

    // --- body motion (visual only) --------------------------------------------
    // Dive, squat and roll follow the same filtered accelerations that move
    // load between the tyres, scaled by how tall the car is.
    const tall = p.h / 0.48
    const pitchT = this.airborne ? this.pitch : -pitchSlope + clamp(-this.loadAx * 0.009 * tall, -0.08, 0.08)
    const rollT = this.airborne ? this.roll : this.groundRoll() + clamp(this.loadAy * 0.013 * tall, -0.11, 0.11)
    this.pitchV += ((pitchT - this.pitch) * 90 - this.pitchV * 12) * DT
    this.rollV += ((rollT - this.roll) * 90 - this.rollV * 12) * DT
    this.pitch += this.pitchV * DT
    this.roll += this.rollV * DT
  }

  /**
   * One axle's wheel speed and tyre forces. The wheel is stiff against the
   * ground (a few milliseconds), far quicker than the 60 Hz step, so its speed
   * is advanced implicitly with the tyre force linearised about the current
   * slip; the forces are then taken at the new wheel speed. Leaves the
   * longitudinal and lateral forces in `tyre` and returns the wheel speed.
   */
  private axle(cap: number, vxw: number, sA: number, w0: number, drive: number, brake: number, mass: number, abs: boolean, absRoom: number, tc: number, tcFloor: number, tp: Tyre): number {
    const vden = Math.max(Math.abs(vxw), 4)
    const toK = 1 / (tp.pkK * vden)
    combined(cap, sA, (w0 - vxw) * toK, tp)
    const me = mass + DT * Math.max(0, tyre.dfx) * toK
    let w = w0 + (DT * (drive - tyre.fx)) / me
    const dB = (DT * brake) / me
    w = Math.abs(w) <= dB ? 0 : w - Math.sign(w) * dB
    // Hold the slip at the peak of what's left after cornering takes its share.
    const room = tp.pkK * vden * Math.sqrt(Math.max(0.04, 1 - Math.min(1, sA * sA)))
    if (abs && brake > 0 && vxw > 2) w = Math.max(w, vxw - room * absRoom)
    // In a slide there's no cornering grip left to protect; a strict system would
    // cut all drive and bog the car down, so it always lets some wheelspin through.
    // Sideways, the slip angle already takes most of the friction circle; the
    // driven wheels need matching wheelspin for drive to push the car through a drift.
    const tcRoom = Math.max(room * 1.15, tp.pkK * vden * Math.max(tcFloor, (Math.abs(sA) - 1) * 0.8))
    if (tc > 0 && drive > 0 && vxw > -1 && w > vxw + tcRoom) {
      w = vxw + tcRoom
      this.tcHit = true
    }
    combined(cap, sA, (w - vxw) * toK, tp)
    return w
  }

  /**
   * Driver aids that act on the body rather than the tyres. Turn-in help fades
   * out once the car is sliding (fully only on Pro), so it doesn't fight a
   * drift the player is holding. The catch stops a growing slide and pulls
   * back one past a comfortable angle; that angle is wide on Pro and narrow on
   * Rookie, so the same slide is a drift on one and a non-event on the other.
   */
  private assist(inp: Input, assists: Assists, rSteer: number, ay: number, mu: number, speed: number): void {
    const p = this.p
    const stab = assists.stability
    const vxa = Math.max(3, Math.abs(this.vx))
    const hb = inp.handbrake
    const dr = this.drift
    const beta = Math.atan2(this.vy, Math.max(2, Math.abs(this.vx)))
    const ab = Math.abs(beta)
    const sliding = smoothstep(0.12, 0.3, ab)
    const rMax = ((mu * G) / vxa) * (hb ? 1.8 : lerp(1.05, 1.5, dr))
    // Turn-in help steps back in a committed drift: there the steering is
    // countersteer, and following it would straighten the car out of the slide.
    const follow = (stab * 5 + 0.3) * (1 - sliding * (1 - stab)) * (hb ? 0.3 : 1) * (1 - 0.85 * dr)
    this.r = damp(this.r, clamp(rSteer, -rMax, rMax), follow, DT)
    // The angle a slide may settle at: narrow in grip driving (a slide is an
    // accident to tidy up), wide in a drift, and smaller the faster you go.
    const comfyGrip = p.driftMax * clamp(10 / Math.max(1, speed), 0.25, 1) * (1 - stab * 0.7)
    const comfyDrift = p.driftMax * clamp(24 / Math.max(1, speed), 0.6, 1) * lerp(1.1, 0.72, stab)
    const comfy = lerp(comfyGrip, comfyDrift, dr)
    if (!hb) {
      const rHold = ay / vxa
      const over = Math.max(0, ab - comfy)
      const growing = beta * (rHold - this.r) > 0
      // dβ/dt = rHold − r, so r = rHold freezes the angle and anything past it
      // unwinds it. In a drift the same pull acts as yaw damping: the angle
      // can still grow, but slowly enough to be caught with the keys.
      const rate = lerp(stab * 10 * smoothstep(0.05, 0.18, ab), (1.2 + stab * 5) * (over > 0 ? 1 : 0.35), dr)
      if (over > 0 || growing) this.r = damp(this.r, rHold + Math.sign(beta) * over * 3, rate, DT)
    }
    // Hold the slide angle inside what this car can recover from. Big angles
    // are fun at hairpin speed and a crash at 140 km/h. Past it the car is
    // turned back toward its direction of travel without losing speed, rather
    // than having its sideways speed taken away.
    const limGrip = (hb ? p.driftMax * 1.35 : p.driftMax * clamp(14 / Math.max(1, speed), 0.3, 1)) * lerp(1, 0.45, stab)
    const lim = Math.max(limGrip, comfyDrift * 1.25 * dr)
    if (ab > lim && this.vx > 2) {
      const v = Math.hypot(this.vx, this.vy)
      const nb = Math.sign(beta) * (lim + (ab - lim) * 0.85)
      this.vx = v * Math.cos(nb)
      this.vy = v * Math.sin(nb)
      if (Math.sign(this.r) === -Math.sign(beta)) this.r *= lerp(0.9, 0.95, dr)
    }
  }

  private groundPitch(): number {
    const f = 1.4, fx = Math.sin(this.heading) * f, fz = Math.cos(this.heading) * f
    const hf = this.ground.height(this.x + fx, this.z + fz), hb = this.ground.height(this.x - fx, this.z - fz)
    return Math.atan2(hf - hb, 2 * f)
  }

  private groundRoll(): number {
    const w = 0.8, lx = Math.cos(this.heading) * w, lz = -Math.sin(this.heading) * w
    const hl = this.ground.height(this.x + lx, this.z + lz), hr = this.ground.height(this.x - lx, this.z - lz)
    return Math.atan2(hl - hr, 2 * w)
  }
}

/**
 * Grip of an axle (as a multiple of the friction coefficient) with `shift`
 * newtons moved from the inside wheel to the outside one. Grip grows less
 * than linearly with load, so the pair grips less the more load moves across.
 */
function axleGrip(N: number, shift: number, nominal: number): number {
  const inner = Math.max(0, N / 2 - shift), outer = N - inner
  return inner * clamp(1 - LOAD_SENS * (inner / nominal - 1), 0.5, 1.2) + outer * clamp(1 - LOAD_SENS * (outer / nominal - 1), 0.5, 1.2)
}

/**
 * Friction-circle tyre: slip angle and slip ratio, each normalised by its
 * peak, combine into one slip magnitude whose force is split between the two
 * directions. Spinning or locking a wheel therefore takes away its cornering
 * grip, which is what makes power oversteer and handbrake turns work.
 */
/** Scratch output of `combined`; one car steps at a time, so one is enough. */
const tyre = { fx: 0, fy: 0, dfx: 0 }

function combined(cap: number, sA: number, sK: number, tp: Tyre): void {
  const out = tyre
  const s = Math.hypot(sA, sK)
  let F: number, dF: number
  if (s < 1) {
    F = cap * s * (2 - s)
    dF = cap * 2 * (1 - s)
  } else {
    const u = tp.fall * (s - 1), q = 1 / (1 + u * u)
    F = cap * (tp.slide + (1 - tp.slide) * q)
    dF = -cap * (1 - tp.slide) * 2 * u * tp.fall * q * q
  }
  if (s < 1e-6) {
    out.fx = out.fy = 0
    out.dfx = 2 * cap
    return
  }
  const cx = sK / s, cy = sA / s
  out.fx = F * cx
  out.fy = -F * cy
  out.dfx = (F / s) * (1 - cx * cx) + dF * cx * cx
}

/**
 * The fastest speed at which the next stretch of road can be taken, allowing
 * for braking distance to each corner. Shared by auto-brake, the autopilot and
 * the target-time calculation, so all three agree on how fast a corner is.
 */
export function cornerSpeed(route: { at(s: number): { curv: number }; length: number }, s: number, speed: number, mu: number): number {
  let best = 80
  const decel = mu * G * 0.8
  const look = 20 + speed * speed / (2 * decel) + 10
  for (let d = 4; d < look; d += 4) {
    const k = Math.abs(route.at(Math.min(route.length, s + d)).curv)
    const v = Math.sqrt((mu * G * 0.92) / Math.max(k, 1e-4))
    // v at distance d must allow braking down to v by then.
    best = Math.min(best, Math.sqrt(v * v + 2 * decel * Math.max(0, d - 6)))
  }
  return best
}

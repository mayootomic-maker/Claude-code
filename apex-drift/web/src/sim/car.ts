import { clamp, damp, lerp, smoothstep } from '../core/math'
import type { CarPhys } from '../data'
import type { Ground } from './terrain'

export const DT = 1 / 60
const G = 9.81

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
  /** Cuts drive force before the driven wheels spin. */
  traction: boolean
  /** 0..1: damps yaw toward what the steering asks for, so the car doesn't spin. */
  stability: number
  /** Brakes for corners the car is arriving at too fast. */
  autoBrake: boolean
}

export const ASSISTS: Record<'rookie' | 'driver' | 'pro', Assists> = {
  rookie: { steer: 0.55, traction: true, stability: 0.85, autoBrake: true },
  driver: { steer: 0.15, traction: true, stability: 0.45, autoBrake: false },
  pro: { steer: 0, traction: false, stability: 0.15, autoBrake: false },
}

/** Friction coefficients. Off-road is drivable but slow. */
export const MU: Record<string, number> = {
  asphalt: 1.05, gravel: 0.8, wetgravel: 0.72, snow: 0.62, rough: 0.76,
  ice: 0.34, mud: 0.55, sand: 0.6, verge: 0.68, grass: 0.55, water: 0.6, wet: 0.82,
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
  /** Lateral slip of each axle, for tyre noise and dust. */
  slipF = 0; slipR = 0
  /** Distance along the route and lateral offset, updated every step. */
  s = 0; d = 0
  readonly prev: Pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0 }
  readonly events: CarEvents = { impact: 0, landed: 0 }

  constructor(readonly p: CarPhys, private readonly ground: Ground, private readonly baseSurface: string, private readonly wet: boolean) {}

  place(s: number): void {
    const a = this.ground.route.at(s)
    this.x = a.x; this.z = a.z; this.heading = a.heading
    this.y = this.ground.height(a.x, a.z)
    this.vx = this.vy = this.r = this.vyUp = 0
    this.airborne = false
    this.steerAngle = 0
    this.pitch = this.roll = this.pitchV = this.rollV = 0
    this.s = s
    this.d = 0
    this.snapshot()
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
    const mu = (MU[this.surface] ?? 0.8) * p.grip * (this.airborne ? 0 : 1)

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
    // front tyres can use (geometric angle plus peak slip), not more.
    const maxAngle = p.steerMax / (1 + (speed * speed) / 260)
    const target = -steerIn * maxAngle
    const rate = p.steerSpeed * 0.55 * DT
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate)

    // --- forces -------------------------------------------------------------
    const pitchSlope = this.groundPitch()
    const Nf0 = (p.mass * G * p.b) / L, Nr0 = (p.mass * G * p.a) / L
    // Half the real weight transfer: enough to feel the nose dip and the rear
    // lighten, without lift-off spins at every braking point.
    const transfer = (0.5 * p.mass * this.ax * p.h) / L
    const Nf = Math.max(0.15 * Nf0, Nf0 - transfer), Nr = Math.max(0.15 * Nr0, Nr0 + transfer)
    const fwd = this.vx

    let throttle = clamp(inp.throttle, 0, 1)
    let brake = clamp(inp.brake, 0, 1)
    if (assists.autoBrake && c && !this.airborne) {
      const safe = cornerSpeed(route, c.s, speed, mu)
      if (speed > safe + 1.5) {
        throttle = Math.min(throttle, 0.15)
        brake = Math.max(brake, clamp((speed - safe) / 8, 0, 0.75))
      }
    }

    let drive = 0
    if (fwd < 0.5 && brake > 0.1 && throttle < 0.1) {
      // Holding brake at a standstill means reverse.
      drive = fwd > -10 ? -brake * p.maxDriveForce * 0.45 : 0
      brake = 0
    } else {
      drive = throttle * Math.min(p.maxDriveForce, p.power / Math.max(Math.abs(fwd), 1))
    }
    let Fxf = drive * p.frontDrive
    let Fxr = drive * (1 - p.frontDrive)
    const sgn = fwd >= 0 ? 1 : -1
    const fb = brake * p.brakeForce
    Fxf -= sgn * fb * p.brakeFront * smoothstep(0, 0.5, Math.abs(fwd))
    Fxr -= sgn * fb * (1 - p.brakeFront) * smoothstep(0, 0.5, Math.abs(fwd))
    let muR = mu
    if (inp.handbrake) {
      Fxr -= sgn * p.handbrakeForce * smoothstep(0, 1, Math.abs(fwd))
      muR *= p.handbrakeMu
    }
    if (assists.traction) {
      // Also back off when the rear is already sliding: drive force eats the
      // grip the rear needs to stay in line.
      const rearSlide = Math.abs(Math.atan2(this.vy - p.b * this.r, Math.max(Math.abs(fwd), 5)))
      const cut = 1 - 0.8 * smoothstep(0.04, 0.12, rearSlide)
      if (Fxr > 0) Fxr *= cut
      if (Fxf > 0) Fxf *= cut
      Fxr = clamp(Fxr, -muR * Nr, 0.85 * muR * Nr)
      Fxf = clamp(Fxf, -mu * Nf, 0.85 * mu * Nf)
    }
    Fxf = clamp(Fxf, -mu * Nf, mu * Nf)
    Fxr = clamp(Fxr, -muR * Nr, muR * Nr)

    const denom = Math.max(Math.abs(fwd), 5)
    const af = Math.atan2(this.vy + p.a * this.r, denom) - this.steerAngle * sgn
    const ar = Math.atan2(this.vy - p.b * this.r, denom)
    // Friction ellipse, weighted so cornering keeps a little priority over drive.
    const capF = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - (0.75 * Fxf) ** 2))
    const capR = Math.sqrt(Math.max(0, (muR * Nr) ** 2 - (0.75 * Fxr) ** 2))
    // Peak lateral grip at ~8° of slip. The rear holds a touch more than the
    // front so the car is stable by default and slides only when asked to.
    const Fyf = -capF * Math.sin(1.3 * Math.atan(18 * af))
    const Fyr = -capR * 1.1 * Math.sin(1.3 * Math.atan(18 * ar))
    this.slipF = Math.abs(af)
    this.slipR = Math.abs(ar) + (inp.handbrake ? 0.15 : 0)

    const drag = p.dragCd * 2.2 * fwd * Math.abs(fwd)
    const rolling = (this.offRoad ? 0.09 : this.surface === 'water' ? 0.12 : 0.015) * p.mass * G * Math.tanh(fwd)
    const grav = p.mass * G * Math.sin(pitchSlope)

    const cs = Math.cos(this.steerAngle), sn = Math.sin(this.steerAngle)
    let ax = (Fxf * cs - Fyf * sn + Fxr - drag - rolling - grav) / p.mass
    let ay = (Fxf * sn + Fyf * cs + Fyr) / p.mass
    let rdot = (p.a * (Fyf * cs + Fxf * sn) - p.b * Fyr) / p.iz
    if (this.airborne) {
      ax = -drag / p.mass
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
    const rKin = (this.vx * Math.tan(this.steerAngle)) / L
    this.r = lerp(rKin, this.r, k)
    this.vy = lerp(this.vy * 0.8, this.vy, k)

    if (!this.airborne) {
      const rWant = clamp(rKin, -(mu * G) / Math.max(3, Math.abs(this.vx)), (mu * G) / Math.max(3, Math.abs(this.vx)))
      this.r = damp(this.r, rWant, assists.stability * 6 + 0.6, DT)
      // Hold the slide angle inside what this car can recover from.
      const beta = Math.atan2(this.vy, Math.max(2, Math.abs(this.vx)))
      // Stability assist narrows how far the car may slide before it's caught.
      // Big angles are fun at hairpin speed and a crash at 140 km/h.
      const lim = (inp.handbrake ? p.driftMax * 1.35 : p.driftMax * clamp(14 / Math.max(1, speed), 0.3, 1)) * lerp(1, 0.45, assists.stability)
      if (Math.abs(beta) > lim) {
        this.vy *= 0.92
        if (Math.sign(this.r) === -Math.sign(beta)) this.r *= 0.9
      }
    }
    this.ax = ax
    this.ay = ay

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading)
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading)
    let wx = fx * this.vx + lx * this.vy
    let wz = fz * this.vx + lz * this.vy
    this.x += wx * DT
    this.z += wz * DT
    this.heading += this.r * DT
    this.spin += (this.vx * DT) / 0.32

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
        this.pitchV -= 0.6
      }
    } else {
      const climb = (gh - this.y) / DT
      // Ground falling away faster than suspension plus gravity can follow
      // (about 2.5 g of drop): we're flying. Ordinary bumps stay planted.
      if (climb < this.vyUp - G * DT * 2.5 && speed > 12) {
        this.airborne = true
        this.y += this.vyUp * DT
      } else {
        this.vyUp = climb
        this.y = gh
      }
    }

    // --- body motion (visual only) --------------------------------------------
    const pitchT = this.airborne ? this.pitch : -pitchSlope + clamp(-ax * 0.008, -0.06, 0.06)
    const rollT = this.airborne ? this.roll : this.groundRoll() + clamp(ay * 0.012, -0.09, 0.09)
    this.pitchV += ((pitchT - this.pitch) * 90 - this.pitchV * 12) * DT
    this.rollV += ((rollT - this.roll) * 90 - this.rollV * 12) * DT
    this.pitch += this.pitchV * DT
    this.roll += this.rollV * DT
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

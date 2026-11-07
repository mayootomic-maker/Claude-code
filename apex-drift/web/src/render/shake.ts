import { noise2 } from '../core/math'

/**
 * Camera shake built the way onboard footage moves, in layers with their own
 * frequency bands rather than white noise:
 *  - road texture: a fast, small buzz whose pitch rises with speed and whose
 *    size depends on the surface (glassy on tarmac, chattering on rough gravel);
 *  - suspension: slow heave and pitch as the body rides the bumps;
 *  - engine: an idle rumble at a standstill, a fine buzz near the limiter;
 *  - kicks: damped springs struck by landings, gear changes and hits, which
 *    ring and decay instead of snapping back.
 * All noise is smooth and deterministic, so frame-rate changes never turn it
 * into flicker. Output is in camera space: metres and radians.
 */

export interface ShakeInput {
  dt: number
  speed: number
  surface: string
  offRoad: boolean
  airborne: boolean
  /** Vertical speed, m/s (+ up). */
  vyUp: number
  rpm: number
  idle: number
  redline: number
  throttle: number
  gear: number
  /** Barrier impact this step, m/s, and landing speed, m/s. */
  impact: number
  landed: number
  /** Longitudinal and lateral acceleration, m/s². */
  ax: number
  ay: number
}

export interface ShakeOut { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }

const ROUGH: Record<string, number> = {
  asphalt: 0.06, wet: 0.06, ice: 0.04, gravel: 0.38, wetgravel: 0.42, rough: 0.85, snow: 0.28,
  mud: 0.5, sand: 0.42, verge: 0.65, grass: 0.55, water: 0.55,
}

/** A damped spring: struck with a velocity, rings at `hz` and dies away. */
class Kick {
  x = 0
  v = 0
  constructor(private readonly hz: number, private readonly zeta: number) {}
  hit(v: number): void {
    this.v += v
  }
  step(dt: number): number {
    const w = this.hz * Math.PI * 2
    // Sub-stepped so a long frame can't make the spring blow up.
    const n = Math.max(1, Math.ceil(dt / 0.008))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      this.v += (-w * w * this.x - 2 * this.zeta * w * this.v) * h
      this.x += this.v * h
    }
    return this.x
  }
}

export class CameraShake {
  private readonly n = noise2(41)
  private road = 0
  private bump = 0
  private eng = 0
  private t = 0
  private lastGear = 1
  private fall = 0
  private wasAir = false
  private surge = 0
  private readonly kY = new Kick(4.2, 0.32)
  private readonly kPitch = new Kick(3.4, 0.3)
  private readonly kZ = new Kick(2.6, 0.45)
  private readonly kX = new Kick(5.5, 0.28)
  private readonly kRoll = new Kick(4.8, 0.3)
  readonly out: ShakeOut = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }

  /** Smooth noise in -1..1, one channel per id. */
  private nz(phase: number, id: number): number {
    return this.n(phase, id * 17.3) + 0.5 * this.n(phase * 2.07 + 31, id * 17.3 + 5)
  }

  reset(): void {
    for (const k of [this.kY, this.kPitch, this.kZ, this.kX, this.kRoll]) k.x = k.v = 0
    this.surge = 0
    this.fall = 0
  }

  update(i: ShakeInput, gain: number): ShakeOut {
    const dt = Math.min(0.1, Math.max(0, i.dt))
    this.t += dt
    const o = this.out
    if (gain <= 0 || dt === 0) {
      o.x = o.y = o.z = o.pitch = o.yaw = o.roll = 0
      return o
    }
    const sp = Math.max(0, i.speed)
    const rough = i.airborne ? 0 : Math.max(ROUGH[i.surface] ?? 0.3, i.offRoad ? 0.7 : 0)
    const v01 = Math.min(1, sp / 28)

    // Road texture: 9 Hz at a crawl rising to ~24 Hz flat out.
    this.road += dt * Math.min(24, 9 + sp * 0.4)
    const ar = rough * v01 * (0.55 + 0.45 * Math.min(1, sp / 40))
    // Suspension: 1.2–3.5 Hz heave and pitch over the bumps.
    this.bump += dt * (1.2 + Math.min(2.3, sp * 0.06))
    const ab = rough * Math.min(1, sp / 18)
    // Engine: idle rumble when slow, a buzz under load near the limiter.
    this.eng += dt * Math.min(27, (i.rpm / 60) * 0.5)
    const idle = (1 - Math.min(1, sp / 10)) * (0.35 + 0.65 * i.throttle)
    const rev = i.throttle * Math.max(0, (i.rpm - i.idle) / Math.max(1, i.redline - i.idle)) ** 2
    const ae = idle * 0.6 + rev * 0.35

    // Landings: from the event, or from the fall speed when touching down.
    if (i.airborne) this.fall = Math.max(this.fall, -i.vyUp)
    let land = i.landed
    if (this.wasAir && !i.airborne) land = Math.max(land, this.fall)
    if (!i.airborne) this.fall = 0
    this.wasAir = i.airborne
    if (land > 0.8) {
      const l = Math.min(12, land)
      this.kY.hit(-l * 0.12)
      this.kPitch.hit(l * 0.012)
      this.kRoll.hit(this.nz(this.t * 3, 9) * l * 0.006)
    }
    // Gear changes: the cut and re-engagement nod the head.
    if (i.gear !== this.lastGear) {
      if (sp > 2 && !i.airborne && i.gear > 0 && this.lastGear > 0) {
        const up = i.gear > this.lastGear ? 1 : -1
        this.kZ.hit(-up * 0.12 * (0.4 + i.throttle))
        this.kPitch.hit(-up * 0.035 * (0.4 + i.throttle))
      }
      this.lastGear = i.gear
    }
    if (i.impact > 0.5) {
      const h = Math.min(20, i.impact)
      const dir = this.nz(this.t * 5, 11) > 0 ? 1 : -1
      this.kX.hit(dir * h * 0.05)
      this.kRoll.hit(-dir * h * 0.02)
      this.kY.hit(h * 0.015)
    }
    // Surge: the camera sinks back under acceleration and leans in under braking.
    const k = 1 - Math.exp(-dt * 6)
    this.surge += (i.ax - this.surge) * k

    const ky = this.kY.step(dt), kp = this.kPitch.step(dt), kz = this.kZ.step(dt), kx = this.kX.step(dt), kr = this.kRoll.step(dt)
    o.y = (this.nz(this.road, 1) * ar * 0.006 + this.nz(this.bump, 2) * ab * 0.022 + this.nz(this.eng, 3) * ae * 0.0012 + ky) * gain
    o.x = (this.nz(this.road, 4) * ar * 0.003 + this.nz(this.bump, 5) * ab * 0.008 + this.nz(this.eng, 6) * ae * 0.0006 + kx - i.ay * 0.0015) * gain
    o.z = (this.nz(this.bump, 7) * ab * 0.006 + kz - this.surge * 0.004) * gain
    o.pitch = (this.nz(this.road, 8) * ar * 0.0022 + this.nz(this.bump, 9) * ab * 0.009 + this.nz(this.eng, 10) * ae * 0.0007 + kp + this.surge * 0.0012) * gain
    o.yaw = (this.nz(this.road, 12) * ar * 0.0012 + this.nz(this.bump, 13) * ab * 0.004) * gain
    o.roll = (this.nz(this.road, 14) * ar * 0.002 + this.nz(this.bump, 15) * ab * 0.008 + this.nz(this.eng, 16) * ae * 0.0006 + kr) * gain
    return o
  }
}

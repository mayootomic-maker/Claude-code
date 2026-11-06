import type { Pose } from '../sim/car'

/**
 * The full-detail recording of the run just driven, for the replay after the
 * finish. Unlike the ghost (10 Hz, position only, saved), this keeps body
 * pitch and roll, steering, wheel spin and the engine, 30 times a second, and
 * lives only in memory: a five-minute stage is about half a megabyte.
 */
export const REPLAY_HZ = 30
const F = 14

export interface ReplayFrame extends Pose {
  /** Distance along the route, for placing trackside cameras. */
  s: number
  speed: number
  rpm: number
  throttle: number
  gear: number
  slip: number
}

export class ReplayRecorder {
  private data: number[] = []
  private next = 0

  record(t: number, s: number, p: Pose, speed: number, rpm: number, throttle: number, gear: number, slip: number): void {
    // Advance the sample clock by whole intervals: restarting it from t lets
    // rounding skip a physics step now and then, and the playback runs fast.
    if (t < this.next - 1e-6) return
    this.next = Math.max(this.next + 1 / REPLAY_HZ, t)
    this.data.push(s, p.x, p.y, p.z, p.heading, p.pitch, p.roll, p.steer, p.spin, speed, rpm, throttle, gear, slip)
  }

  done(): Replay {
    return new Replay(new Float32Array(this.data))
  }
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

export class Replay {
  readonly duration: number
  constructor(private readonly f: Float32Array) {
    this.duration = Math.max(0, f.length / F - 1) / REPLAY_HZ
  }

  get frames(): number {
    return this.f.length / F
  }

  /** Interpolated state at time t, clamped to the recording. */
  at(t: number, out: ReplayFrame): ReplayFrame {
    const n = this.frames
    const f = Math.min(Math.max(0, t * REPLAY_HZ), Math.max(0, n - 1))
    const i = Math.min(Math.floor(f), Math.max(0, n - 2))
    const u = n > 1 ? f - i : 0
    const a = i * F, b = n > 1 ? a + F : a
    const d = this.f
    const L = (k: number) => d[a + k] + (d[b + k] - d[a + k]) * u
    out.s = L(0); out.x = L(1); out.y = L(2); out.z = L(3)
    out.heading = d[a + 4] + wrap(d[b + 4] - d[a + 4]) * u
    out.pitch = L(5); out.roll = L(6); out.steer = L(7)
    out.spin = d[a + 8] + wrap(d[b + 8] - d[a + 8]) * u
    out.speed = L(9); out.rpm = L(10); out.throttle = L(11)
    out.gear = Math.round(u < 0.5 ? d[a + 12] : d[b + 12])
    out.slip = L(13)
    return out
  }
}

export const emptyFrame = (): ReplayFrame => ({ s: 0, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0, speed: 0, rpm: 0, throttle: 0, gear: 1, slip: 0 })

export type ShotKind = 'trackside' | 'heli' | 'wheel' | 'chase' | 'front'

export interface Shot {
  kind: ShotKind
  pos: { x: number; y: number; z: number }
  look: { x: number; y: number; z: number }
  fov: number
}

interface RoutePoint {
  x: number; y: number; z: number; heading: number
}

/**
 * The TV director: cuts between trackside cameras the car drives past, a
 * helicopter, a wheel-arch camera and a low front tracking shot, the way rally
 * coverage does. Trackside cameras stand just inside the strip that scenery
 * placement keeps clear of solids, so a tree trunk never fills the frame.
 */
export class Director {
  private kind: ShotKind = 'trackside'
  private started = -1
  private index = 0
  /** Where the current trackside camera stands, chosen when the shot begins. */
  private post: { x: number; y: number; z: number; s: number } | null = null
  private static readonly ORDER: ShotKind[] = ['trackside', 'heli', 'trackside', 'wheel', 'trackside', 'front', 'chase']

  constructor(
    private readonly route: { at(s: number): RoutePoint },
    private readonly ground: (x: number, z: number) => number,
    /** Distance from the centre line that is guaranteed free of trees, rocks and buildings. */
    private readonly clear: (s: number) => number,
    private readonly finish: number,
  ) {}

  reset(): void {
    this.started = -1
    this.index = 0
    this.post = null
  }

  get current(): ShotKind {
    return this.kind
  }

  shot(t: number, c: ReplayFrame): Shot {
    if (this.started < 0 || this.due(t, c)) this.cut(t, c)
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
    const lx = Math.cos(c.heading), lz = -Math.sin(c.heading)
    const car = { x: c.x, y: c.y + 0.7, z: c.z }
    const lift = (p: { x: number; y: number; z: number }, min: number) => {
      p.y = Math.max(p.y, this.ground(p.x, p.z) + min)
      return p
    }
    const age = t - this.started
    switch (this.kind) {
      case 'trackside': {
        const p = this.post!
        // A long lens far away, opening up as the car arrives: the classic rally shot.
        const d = Math.hypot(car.x - p.x, car.z - p.z)
        const fov = Math.min(55, Math.max(14, 900 / Math.max(8, d) + 8))
        return { kind: this.kind, pos: p, look: car, fov }
      }
      case 'heli': {
        const swing = Math.sin(age * 0.25) * 0.6
        const ang = c.heading + Math.PI + swing
        return { kind: this.kind, pos: lift({ x: c.x + Math.sin(ang) * 22, y: c.y + 14, z: c.z + Math.cos(ang) * 22 }, 6), look: { x: c.x + fx * 8, y: c.y, z: c.z + fz * 8 }, fov: 42 }
      }
      case 'wheel':
        return { kind: this.kind, pos: lift({ x: c.x + lx * 1.25 - fx * 0.6, y: c.y + 0.45, z: c.z + lz * 1.25 - fz * 0.6 }, 0.25), look: { x: c.x + fx * 8, y: c.y + 0.3, z: c.z + fz * 8 }, fov: 66 }
      case 'front':
        return { kind: this.kind, pos: lift({ x: c.x + fx * 7 + lx * 1.5, y: c.y + 0.8, z: c.z + fz * 7 + lz * 1.5 }, 0.5), look: car, fov: 48 }
      default:
        return { kind: this.kind, pos: lift({ x: c.x - fx * 7, y: c.y + 2.6, z: c.z - fz * 7 }, 1), look: { x: c.x + fx * 5, y: c.y + 1, z: c.z + fz * 5 }, fov: 58 }
    }
  }

  private due(t: number, c: ReplayFrame): boolean {
    const age = t - this.started
    if (this.kind === 'trackside') {
      // Cut once the car is well past the camera, or if it never shows up.
      return c.s > (this.post?.s ?? 0) + 25 || age > 9
    }
    return age > (this.kind === 'heli' ? 6 : 4.5)
  }

  private cut(t: number, c: ReplayFrame): void {
    this.kind = Director.ORDER[this.index % Director.ORDER.length]
    this.index++
    this.started = t
    if (this.kind === 'trackside') {
      // Stand ahead of the car, off to the outside, on the bank.
      const ahead = Math.min(this.finish, c.s + 45 + Math.min(60, c.speed * 1.6))
      const a = this.route.at(ahead)
      const side = this.index % 2 ? 1 : -1
      const off = this.clear(ahead)
      const x = a.x + Math.cos(a.heading) * off * side
      const z = a.z - Math.sin(a.heading) * off * side
      this.post = { x, y: this.ground(x, z) + 1.6 + (this.index % 3), z, s: ahead }
    }
  }
}

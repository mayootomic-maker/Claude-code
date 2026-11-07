import { clamp, rng, wrapAngle } from '../core/math'
import { CARS, LIVERIES, RIVALS, carPhys, type CarPhys, type RallyDef } from '../data'
import { AiDriver, lineOffset, lineSpeed, lineTime, raceLine, type RaceLine, type Traffic } from './ai'
import { Car, DT, wheelForce, type Assists, type Input } from './car'
import type { Ground } from './terrain'

type Difficulty = 'rookie' | 'driver' | 'pro'

/** Cars on the grid, the player included. */
export const FIELD = 4
/**
 * Share of the race line's limit each difficulty's rivals drive at. Pro is
 * the line itself: on equal cars, beating it takes a cleaner run than the
 * AI's, which never misses a braking point.
 */
export const RACE_SKILL: Record<Difficulty, number> = { rookie: 0.85, driver: 0.93, pro: 1.0 }
/**
 * No steering or braking help. ABS and traction control, and the stability
 * aid, stand in for the feel a driver has for the pedals and for a rear
 * stepping out, which the AI's steering alone reacts to a step late.
 */
const AI_ASSISTS: Assists = { steer: 0, traction: true, stability: 0.4, autoBrake: false }
/** Rivals further than this from the player along the road are moved without the full physics. */
export const LOD_DIST = 260
/**
 * What a simulated driver gets out of the line compared with its ideal
 * speed profile; a gliding car runs at this share so it neither gains nor
 * loses on the ones that are being simulated.
 */
const GLIDE_PACE = 0.93
const STUCK_PENALTY = 5

export interface GridSlot {
  /** Index into RIVALS. */
  rival: number
  name: string
  nat: string
  car: string
  livery: string
  skill: number
  /** 0..1: how readily it dives for a gap, and how hard it uses the handbrake. */
  aggression: number
}

/**
 * Three rivals for a race. Harder difficulties draw from the front of the
 * field; each drives a car of the same era as the player's, tuned to the same
 * power-to-weight so the race is decided by driving, not by the garage.
 */
export function raceGrid(rally: RallyDef, stageIdx: number, difficulty: Difficulty, playerCar: string, playerLivery: string): GridSlot[] {
  const seed = rally.stages[stageIdx]?.seed ?? 1
  const r = rng(seed * 7 + 13)
  const pool = difficulty === 'pro' ? [0, 1, 2, 3, 4] : difficulty === 'driver' ? [2, 3, 4, 5, 6, 7, 8] : [5, 6, 7, 8, 9, 10, 11]
  const picked: number[] = []
  while (picked.length < FIELD - 1 && pool.length) picked.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
  const ci = Math.max(0, CARS.findIndex((c) => c.id === playerCar))
  const nearby = [ci, ci - 1, ci + 1, ci - 2, ci + 2].filter((i) => i >= 0 && i < CARS.length)
  // Rivals wear the regular team liveries, never the joke ones you unlock with secrets.
  const liveries = LIVERIES.filter((l) => l.id !== playerLivery && l.unlock.type !== 'secret' && l.unlock.type !== 'code')
  return picked.map((ri, k) => {
    const rv = RIVALS[ri]
    const likes = rv.likes.includes(rally.surface) ? 1.006 : 1
    return {
      rival: ri,
      name: rv.name,
      nat: rv.nat,
      car: CARS[nearby[(k + 1) % nearby.length]].id,
      livery: liveries[(ri * 5 + seed) % liveries.length].id,
      // RIVALS pace is a time multiple: 0.99 is a percent quicker than the field.
      skill: RACE_SKILL[difficulty] * likes * (1 + (1.02 - rv.pace) * 0.6),
      aggression: rng(ri * 101 + 7)() * 0.7 + 0.3,
    }
  })
}

/** A rival car's physics, matched to the player's car's power-to-weight. */
export function rivalPhys(car: string, playerCar: string): CarPhys {
  const p = carPhys(car), me = carPhys(playerCar)
  const k = clamp((me.power / me.mass) / (p.power / p.mass), 0.7, 1.4)
  return { ...p, power: p.power * k, maxDriveForce: p.maxDriveForce * k }
}

/**
 * Starting slots, staggered left and right a few metres apart, before the
 * start line. The player starts at the back: the field has to be beaten, not led.
 */
export function gridSlot(i: number, start: number, half: number): { s: number; d: number } {
  const side = Math.min(1.25, Math.max(0.6, half - 1.3))
  return { s: start - 6 - i * 4.5, d: i % 2 === 0 ? side : -side }
}

export class Opponent {
  readonly car: Car
  readonly driver: AiDriver
  readonly line: RaceLine
  /** Race time when it crossed the line, or null while still running. */
  finishTime: number | null = null
  penalty = 0
  resets = 0
  /** True while it's being moved along the line instead of simulated. */
  gliding = false
  /** Off only in tests, to time the full simulation over a whole stage. */
  lod = true
  private stuckFor = 0
  private lastGood: number
  private confidence = 1
  private wasOff = false
  private glideV = 0

  constructor(readonly slot: GridSlot, ground: Ground, surface: string, wet: boolean, playerCar: string, at: { s: number; d: number }, private readonly start: number, private readonly finish: number) {
    const phys = rivalPhys(slot.car, playerCar)
    this.car = new Car(phys, ground, surface, wet)
    this.line = raceLine(ground.route, surface, wet, phys)
    this.driver = new AiDriver(this.car, this.line, slot.skill, slot.aggression)
    this.car.place(at.s, at.d)
    this.lastGood = at.s
  }

  /** Total race time including penalties, or an estimate from the line if it hasn't finished. */
  total(clock: number): number {
    if (this.finishTime !== null) return this.finishTime + this.penalty
    const s = Math.min(this.car.s, this.finish)
    return clock + this.penalty + lineTime(this.line, s, this.finish) / (this.driver.skill * GLIDE_PACE)
  }

  hold(): void {
    this.car.step({ steer: 0, throttle: 0, brake: 1, handbrake: true }, AI_ASSISTS)
  }

  /**
   * One step of racing. `ref` is where the player is; far from it the car
   * glides along its line at its calibrated pace instead of running the full
   * physics, which keeps three rivals cheap on a phone.
   */
  step(clock: number, traffic: readonly Traffic[], ref: number): void {
    const car = this.car
    const done = this.finishTime !== null
    // A light rubber band: a few percent at most, and only once well clear.
    const gap = car.s - ref
    const band = gap < -90 ? 1 + Math.min(0.025, (-gap - 90) / 6000) : gap > 160 ? 1 - Math.min(0.02, (gap - 160) / 6000) : 1
    // Off the road it backs off a little, as a driver would after a fright,
    // and builds back up over the next half minute.
    if (car.offRoad && !this.wasOff) this.confidence = Math.max(0.9, this.confidence - 0.035)
    this.wasOff = car.offRoad
    this.confidence = Math.min(1, this.confidence + DT / 900)
    this.driver.skill = this.slot.skill * band * this.confidence
    const far = this.lod && Math.abs(gap) > LOD_DIST && !done && car.s > this.start + 20
    if (far) this.glide()
    else {
      if (this.gliding) this.gliding = false
      const input: Input = done ? { steer: this.driver.drive(traffic).steer, throttle: 0, brake: 0.5, handbrake: false } : this.driver.drive(traffic)
      car.step(input, AI_ASSISTS)
    }
    if (done) return
    if (!car.offRoad && !car.airborne && Math.abs(car.d) < car.p.halfW + this.line.room) this.lastGood = car.s
    // Stuck against a wall or facing the wrong way: back on the road, as the player would be.
    const a = this.line.route.at(car.s)
    const wrong = Math.abs(wrapAngle(car.heading - a.heading)) > 2
    this.stuckFor = car.speed < 1.5 || wrong || Math.abs(car.d) > this.line.room + 6 ? this.stuckFor + DT : Math.max(0, this.stuckFor - DT * 2)
    if (this.stuckFor > 2.5) {
      this.stuckFor = 0
      this.resets++
      this.penalty += STUCK_PENALTY
      // Held up by a car stopped across the road: the marshals wave it past.
      const blocker = traffic.find((o) => o.s - car.s > -2 && o.s - car.s < 15 && o.speed < 2)
      const s = clamp(blocker ? blocker.s + 12 : this.lastGood - 10, this.start, this.finish)
      this.car.place(s, lineOffset(this.line, s))
    }
    if (car.s >= this.finish) this.finishTime = clock
  }

  private glide(): void {
    const car = this.car
    const line = this.line
    if (!this.gliding) {
      this.gliding = true
      this.glideV = car.speed
    }
    const p = car.p
    const v = Math.max(1, this.glideV)
    const accel = (Math.min(wheelForce(p, v), p.maxDriveForce * 1.4) - p.dragCd * 2.2 * v * v) / p.mass
    const target = lineSpeed(line, car.s + 2) * this.driver.skill * GLIDE_PACE
    this.glideV = Math.min(target, v + Math.max(0, accel) * DT)
    const s = car.s + this.glideV * DT
    const d = lineOffset(line, s)
    const a = line.route.at(s)
    const slope = (lineOffset(line, s + 2) - lineOffset(line, s - 2)) / 4
    car.glide(s, d, a.heading + Math.atan(slope), this.glideV)
  }
}

/**
 * Car-to-car contact. Each body is two discs along its length; the deepest
 * overlap is pushed apart (heavier car moves less) and the closing speed at
 * the contact point is reversed with a little bounce, which spins both cars
 * about their centres of mass according to where they were hit. Returns the
 * closing speed, 0 if they weren't touching.
 */
export function collide(a: Car, b: Car): number {
  const dx0 = b.x - a.x, dz0 = b.z - a.z
  const reach = a.p.halfL + b.p.halfL
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return 0
  if (Math.abs(a.y - b.y) > 2) return 0
  let best = 0, nx = 0, nz = 0, cax = 0, caz = 0, cbx = 0, cbz = 0
  const ra = a.p.halfW + 0.05, rb = b.p.halfW + 0.05
  const la = Math.max(0, a.p.halfL - ra), lb = Math.max(0, b.p.halfL - rb)
  const fax = Math.sin(a.heading), faz = Math.cos(a.heading)
  const fbx = Math.sin(b.heading), fbz = Math.cos(b.heading)
  for (const ua of [-la, la])
    for (const ub of [-lb, lb]) {
      const ax = a.x + fax * ua, az = a.z + faz * ua
      const bx = b.x + fbx * ub, bz = b.z + fbz * ub
      const dx = bx - ax, dz = bz - az
      const dist = Math.hypot(dx, dz)
      const pen = ra + rb - dist
      if (pen > best) {
        best = pen
        nx = dist > 1e-4 ? dx / dist : 1
        nz = dist > 1e-4 ? dz / dist : 0
        // Contact point halfway between the surfaces, relative to each centre.
        const px = ax + nx * (ra - pen / 2), pz = az + nz * (ra - pen / 2)
        cax = px - a.x; caz = pz - a.z
        cbx = px - b.x; cbz = pz - b.z
      }
    }
  if (best <= 0) return 0
  const ma = a.p.mass, mb = b.p.mass
  // Separate.
  const wa = mb / (ma + mb), wb = ma / (ma + mb)
  a.x -= nx * best * wa; a.z -= nz * best * wa
  b.x += nx * best * wb; b.z += nz * best * wb
  // Velocities in the world, and of the contact point on each body.
  const va = toWorld(a), vb = toWorld(b)
  // d(offset)/d(heading) for a body-fixed point is (oz, -ox).
  const ta = caz * nx - cax * nz, tb = cbz * nx - cbx * nz
  const vax = va.x + a.r * caz, vaz = va.z - a.r * cax
  const vbx = vb.x + b.r * cbz, vbz = vb.z - b.r * cbx
  const vn = (vbx - vax) * nx + (vbz - vaz) * nz
  if (vn >= 0) return 0
  const e = 0.25
  const j = (-(1 + e) * vn) / (1 / ma + 1 / mb + (ta * ta) / a.p.iz + (tb * tb) / b.p.iz)
  // A little friction along the contact, so cars rubbing door to door slow each other.
  const tx = -nz, tz = nx
  const vt = (vbx - vax) * tx + (vbz - vaz) * tz
  const jt = clamp(-vt / (1 / ma + 1 / mb), -0.3 * j, 0.3 * j)
  va.x -= (j * nx + jt * tx) / ma; va.z -= (j * nz + jt * tz) / ma
  vb.x += (j * nx + jt * tx) / mb; vb.z += (j * nz + jt * tz) / mb
  a.r -= (j * ta) / a.p.iz
  b.r += (j * tb) / b.p.iz
  fromWorld(a, va)
  fromWorld(b, vb)
  const hit = -vn
  a.events.impact = Math.max(a.events.impact, hit)
  b.events.impact = Math.max(b.events.impact, hit)
  return hit
}

function toWorld(c: Car): { x: number; z: number } {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
  const lx = Math.cos(c.heading), lz = -Math.sin(c.heading)
  return { x: fx * c.vx + lx * c.vy, z: fz * c.vx + lz * c.vy }
}

function fromWorld(c: Car, v: { x: number; z: number }): void {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
  const lx = Math.cos(c.heading), lz = -Math.sin(c.heading)
  c.vx = v.x * fx + v.z * fz
  c.vy = v.x * lx + v.z * lz
}

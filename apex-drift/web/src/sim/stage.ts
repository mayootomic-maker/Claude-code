import { clamp } from '../core/math'
import { carPhys, type RallyDef, type StageDef } from '../data'
import { ASSISTS, Car, cornerSpeed, DT, MU, wheelForce, type Assists, type Input } from './car'
import { collide, FIELD, gridSlot, Opponent, type GridSlot } from './race'
import { buildRoute, type Route } from './route'
import { makeGround, type Ground } from './terrain'

export type Difficulty = 'rookie' | 'driver' | 'pro'

/** How much slower than the ideal time each difficulty's targets are. */
export const DIFFICULTY_SCALE: Record<Difficulty, number> = { rookie: 1.42, driver: 1.19, pro: 1.07 }

/** Metres before the start line where the car waits, and after the finish where it stops. */
export const RUN_IN = 30
export const RUN_OUT = 120
export const STUCK_PENALTY = 5

export type Phase = 'countdown' | 'running' | 'finished'

export interface StageSetup {
  rally: RallyDef
  stage: StageDef
  car: string
  difficulty: Difficulty
  /** Engine power multiplier; only the owner build's TURBO cheat sets it. */
  power?: number
  /** Head-to-head: these rivals start alongside on the road (see `raceGrid`). Absent for a time trial. */
  race?: GridSlot[]
}

/** One car's place in a race. */
export interface RaceEntry {
  name: string
  car: string
  you: boolean
  /** Distance along the stage, metres past the start line. */
  progress: number
  finished: boolean
  /** Finishing time with penalties; for a car still running, an estimate from its pace. */
  total: number
  /** Index into `field`, or -1 for the player. */
  idx: number
}

export class StageSim {
  readonly route: Route
  readonly ground: Ground
  readonly car: Car
  readonly assists: Assists
  readonly start: number
  readonly finish: number
  phase: Phase = 'countdown'
  countdown = 3
  time = 0
  penalty = 0
  resets = 0
  /** Furthest progress along the stage, metres past the start line. */
  progress = 0
  /** Rivals on the road in a race; empty in a time trial. */
  readonly field: Opponent[] = []
  /** Race clock: runs on after the player finishes, until the rivals are home. */
  clock = 0
  private stuckFor = 0
  private wrongWay = 0
  private lastGood: number
  /** Race time each car first reached every 10 m of the stage, for gaps. */
  private readonly splits: Float32Array[] = []

  constructor(readonly setup: StageSetup) {
    const { rally, stage } = setup
    this.route = buildRoute({ ...rally, seed: stage.seed, km: stage.km + (RUN_IN + RUN_OUT) / 1000 })
    this.ground = makeGround(this.route, rally, stage.seed)
    const wet = stage.weather === 'rain'
    const phys = carPhys(setup.car)
    const k = setup.power ?? 1
    this.car = new Car(k === 1 ? phys : { ...phys, power: phys.power * k, maxDriveForce: phys.maxDriveForce * k }, this.ground, rally.surface, wet)
    this.assists = ASSISTS[setup.difficulty]
    this.start = RUN_IN
    this.finish = this.route.length - RUN_OUT
    const race = setup.race ?? []
    if (race.length) {
      const me = gridSlot(Math.min(FIELD, race.length + 1) - 1, this.start, this.route.half)
      this.car.place(me.s, me.d)
      this.lastGood = me.s
      race.forEach((slot, i) => this.field.push(new Opponent(slot, this.ground, rally.surface, wet, setup.car, gridSlot(i, this.start, this.route.half), this.start, this.finish)))
      for (let i = 0; i <= this.field.length; i++) this.splits.push(new Float32Array(Math.ceil(this.length / 10) + 2).fill(-1))
    } else {
      this.car.place(this.start - 6)
      this.lastGood = this.start - 6
    }
  }

  get racing(): boolean {
    return this.field.length > 0
  }

  get length(): number {
    return this.finish - this.start
  }

  /** Total stage time including penalties. */
  get total(): number {
    return this.time + this.penalty
  }

  step(input: Input): void {
    if (this.phase === 'countdown') {
      this.countdown -= DT
      // The car is held on the line; the engine can still be revved.
      this.car.step({ steer: 0, throttle: 0, brake: 1, handbrake: true }, this.assists)
      for (const o of this.field) o.hold()
      if (this.countdown <= 0) this.phase = 'running'
      return
    }
    const finished = this.phase === 'finished'
    this.car.step(finished ? { steer: input.steer * 0.3, throttle: 0, brake: 0.6, handbrake: false } : input, this.assists)
    if (this.racing) this.stepField()
    if (finished) return

    this.time += DT
    const s = this.car.s
    if (s - this.start > this.progress && Math.abs(s - this.start - this.progress) < 40) this.progress = s - this.start
    if (!this.car.offRoad && !this.car.airborne && Math.abs(this.car.d) < this.route.half) this.lastGood = s

    // Stuck: wanting to go but not moving, or pointing the wrong way.
    const moving = this.car.speed > 1.2
    const trying = input.throttle > 0.3 || input.brake > 0.3
    this.stuckFor = !moving && trying ? this.stuckFor + DT : Math.max(0, this.stuckFor - DT * 2)
    const a = this.route.at(s)
    let err = this.car.heading - a.heading
    while (err > Math.PI) err -= 2 * Math.PI
    while (err < -Math.PI) err += 2 * Math.PI
    this.wrongWay = Math.abs(err) > 2.2 && this.car.speed > 3 ? this.wrongWay + DT : 0
    if (this.stuckFor > 3) this.reset()

    if (s >= this.finish) this.phase = 'finished'
  }

  /** Rivals drive, cars that touch bounce off each other, and everyone's gaps are logged. */
  private stepField(): void {
    this.clock += DT
    const all = [this.car, ...this.field.map((o) => o.car)]
    const traffic = all.map((c) => ({ s: c.s, d: c.d, speed: c.speed }))
    this.field.forEach((o, i) => {
      // Each rival sees every car but itself.
      const others = traffic.filter((_, k) => k !== i + 1)
      o.step(this.clock, others, this.car.s)
    })
    for (let i = 0; i < all.length; i++) {
      if (i > 0 && this.field[i - 1].gliding) continue
      for (let k = i + 1; k < all.length; k++) {
        if (this.field[k - 1].gliding) continue
        collide(all[i], all[k])
      }
    }
    for (let i = 0; i < all.length; i++) {
      const sp = this.splits[i]
      const b = Math.floor((all[i].s - this.start) / 10)
      if (b >= 0 && b < sp.length && sp[b] < 0) for (let j = b; j >= 0 && sp[j] < 0; j--) sp[j] = this.clock
    }
  }

  /** Race order, leader first: finishers by time, then everyone else by how far they've got. */
  order(): RaceEntry[] {
    const you: RaceEntry = {
      name: '', car: this.setup.car, you: true, idx: -1,
      progress: Math.min(this.length, this.car.s - this.start), finished: this.phase === 'finished',
      total: this.phase === 'finished' ? this.total : Infinity,
    }
    const rows = [you, ...this.field.map((o, idx): RaceEntry => ({
      name: o.slot.name, car: o.slot.car, you: false, idx,
      progress: Math.min(this.length, o.car.s - this.start), finished: o.finishTime !== null, total: o.total(this.clock),
    }))]
    return rows.sort((a, b) => (a.finished && b.finished ? a.total - b.total : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress))
  }

  /** Final order once the player is home: rivals still running are placed by their projected time. */
  result(): RaceEntry[] {
    return this.order().sort((a, b) => a.total - b.total)
  }

  /**
   * Seconds between the player and the cars either side on the road: how
   * long ago the car ahead passed the point the player is at now, and how
   * long the car behind will take to reach it.
   */
  gaps(): { ahead: number | null; behind: number | null } {
    const order = this.order()
    const at = order.findIndex((e) => e.you)
    const mine = this.splits[0]
    const gapTo = (e: RaceEntry | undefined, ahead: boolean): number | null => {
      if (!e) return null
      const lead = ahead ? this.splits[e.idx + 1] : mine
      const trail = ahead ? mine : this.splits[e.idx + 1]
      const b = Math.floor(Math.min(ahead ? this.car.s : this.field[e.idx].car.s, this.finish) - this.start) / 10
      const i = Math.floor(b)
      if (i < 0 || i >= lead.length || lead[i] < 0) return null
      const t = trail[i] >= 0 ? trail[i] : this.clock
      return Math.max(0, t - lead[i])
    }
    return { ahead: gapTo(order[at - 1], true), behind: gapTo(order[at + 1], false) }
  }

  get isWrongWay(): boolean {
    return this.wrongWay > 1.5
  }

  /** Back on the road, facing forward, a little behind where you left it. */
  reset(): void {
    this.resets++
    this.penalty += STUCK_PENALTY
    this.stuckFor = 0
    this.wrongWay = 0
    this.car.place(clamp(this.lastGood - 10, this.start - 6, this.finish))
  }
}

/** Simple line-following driver used by tests, attract mode and the tutorial demo. */
export function autopilot(sim: StageSim, skill = 1): Input {
  const car = sim.car
  const route = sim.route
  const ahead = route.at(car.s + 5 + car.speed * 0.7)
  const want = Math.atan2(ahead.x - car.x, ahead.z - car.z)
  // Steer the direction of travel, not the nose: in a slide they differ by
  // the slip angle, and aiming the nose drives wide of every corner.
  const travel = car.heading + Math.atan2(car.vy, Math.max(2, Math.abs(car.vx)))
  let err = want - travel
  while (err > Math.PI) err -= 2 * Math.PI
  while (err < -Math.PI) err += 2 * Math.PI
  // Lateral term: at speed the look-ahead point is nearly straight ahead, so
  // drift toward the verge would otherwise go uncorrected for too long.
  const gain = 1 / (1 + car.speed / 30)
  // Aiming the travel direction steers into a slide; past a few degrees of
  // slip, countersteer like a driver would to catch the rear first.
  const beta = Math.atan2(car.vy, Math.max(2, Math.abs(car.vx)))
  const catchSlide = -Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05) * 3
  const steer = clamp((-err * 3.2 + car.r * 0.35 + car.d * 0.12) * gain + catchSlide, -1, 1)
  const mu = Math.min(MU[car.surface] ?? 0.8, muAhead(sim, car.s, car.speed))
  const safe = cornerSpeed(route, car.s, car.speed, mu) * skill
  const over = car.speed - safe
  // Pedals do nothing in the air, and landing on them unsettles the car.
  if (car.airborne) return { steer, throttle: 0.3, brake: 0, handbrake: false }
  return {
    steer,
    // Proportional rather than on/off: every throttle step moves load
    // between the axles, and a train of them sets up a weave at speed.
    throttle: over < 0 ? clamp(-over / 2.5, 0.25, 1) : 0,
    brake: over > 0.5 ? clamp(over / 3, 0, 1) : 0,
    handbrake: false,
  }
}

/**
 * The slipperiest road surface within braking distance: an ice or mud patch
 * ahead has to be braked for before the car is on it, not once it is.
 */
export function muAhead(sim: StageSim, s: number, speed: number): number {
  const base = sim.setup.rally.surface === 'asphalt' && sim.setup.stage.weather === 'rain' ? 'wet' : sim.setup.rally.surface
  let mu = MU[base] ?? 0.8
  const look = 30 + (speed * speed) / (2 * 0.6 * 9.81)
  for (const f of sim.route.features) {
    if (f.kind === 'patch' && f.surface && f.s1 >= s && f.s0 <= s + look) mu = Math.min(mu, MU[f.surface] ?? mu)
  }
  return mu
}

/**
 * Ideal time for a stage: a speed profile limited by cornering grip, power,
 * drag and braking, integrated along the road. Targets and rival times derive
 * from this, so every stage is calibrated the same way regardless of length.
 */
export function idealTime(sim: StageSim): number {
  const p = carPhys('kestrel')
  const route = sim.route
  const mu = MU[sim.setup.rally.surface] ?? 0.8
  const step = 4
  const n = Math.ceil(sim.length / step) + 1
  const vmax = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const k = Math.abs(route.at(sim.start + i * step).curv)
    vmax[i] = Math.sqrt((mu * 9.81 * 0.95) / Math.max(k, 1e-4))
  }
  // Tractive force by speed through the real gearbox, limited by the grip of four driven wheels.
  const force = new Float32Array(81)
  for (let j = 0; j <= 80; j++) force[j] = Math.min(wheelForce(p, j), mu * p.mass * 9.81)
  const v = new Float32Array(n)
  v[0] = 0
  for (let i = 1; i < n; i++) {
    const vp = Math.max(v[i - 1], 1)
    const a = (force[Math.min(80, Math.round(vp))] - p.dragCd * 2.2 * vp * vp) / p.mass - 0.02 * 9.81
    v[i] = Math.min(vmax[i], Math.sqrt(vp * vp + 2 * Math.max(0, a) * step))
  }
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * mu * 9.81 * 0.85 * step))
  let t = 0
  for (let i = 1; i < n; i++) t += step / Math.max(1, (v[i] + v[i - 1]) / 2)
  return t
}

export interface Medals {
  gold: number
  silver: number
  bronze: number
}

export function medals(ideal: number, difficulty: Difficulty): Medals {
  const g = ideal * DIFFICULTY_SCALE[difficulty]
  return { gold: g, silver: g * 1.08, bronze: g * 1.18 }
}

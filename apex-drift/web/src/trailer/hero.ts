import { clamp, wrapAngle } from '../core/math'
import { carPhys, type RallyDef } from '../data'
import { AiDriver, raceLine, type Traffic } from '../sim/ai'
import { RUNGS } from '../sim/levels'
import { NEUTRAL, type Personality } from '../sim/personality'
import { DT, type Assists, type Car, type Input } from '../sim/car'
import { raceGrid } from '../sim/race'
import { idealTime, StageSim } from '../sim/stage'
import { STEP } from '../sim/route'

/**
 * The trailer's hero driver and its recorded runs. Everything here is plain
 * simulation, no rendering: a run is simulated once, every step of every car
 * is taped, and the renderer then poses the cars straight from the tape. That
 * keeps the footage and the telemetry the sound is built from in exact sync,
 * and lets a shot start anywhere in a run without re-simulating up to it.
 */

export const HERO_CAR = 'apex'
export const HERO_LIVERY = 'works'
/** Same help the AI rivals get: traction control and a light stability aid, no steering help. */
const HERO_ASSISTS: Assists = { steer: 0, traction: true, abs: true, stability: 0.4, autoBrake: false, forgive: 0 }
/** For drift footage the stability aid is mostly off, so the rear can be held out. */
const DRIFT_ASSISTS: Assists = { steer: 0, traction: false, abs: true, stability: 0.15, autoBrake: false, forgive: 0 }
/** Pace profile resolution along the stage, metres. */
const BIN = 10

export type Style = 'fast' | 'drift'

export interface RunSpec {
  rally: RallyDef
  stageIdx: number
  /** Start from the back of a four-car grid against Pro rivals. */
  race: boolean
  style: Style
  /** Stop once the hero is this far past the start line (metres); the whole stage if absent. */
  until?: number
}

// ------------------------------------------------------------------ tape

type Scalar = number | boolean | string
const POSE_KEYS = ['x', 'y', 'z', 'heading', 'pitch', 'roll', 'steer', 'spin'] as const

/**
 * Every scalar field of a car, every step. Restoring a step puts the car back
 * exactly as the simulation left it, private drivetrain state included, so
 * anything the view reads (pose, slip, surface, rpm, events) is the real thing.
 */
export class Tape {
  private readonly keys: string[]
  private readonly bools: boolean[]
  private readonly width: number
  private readonly data: number[][]
  private readonly surf: number[][]
  private readonly surfaces: string[] = []
  steps = 0

  constructor(cars: readonly Car[]) {
    const rec = cars[0] as unknown as Record<string, Scalar>
    this.keys = Object.keys(rec).filter((k) => typeof rec[k] === 'number' || typeof rec[k] === 'boolean')
    this.bools = this.keys.map((k) => typeof rec[k] === 'boolean')
    this.width = this.keys.length + POSE_KEYS.length + 2
    this.data = cars.map(() => [])
    this.surf = cars.map(() => [])
  }

  record(cars: readonly Car[]): void {
    cars.forEach((car, ci) => {
      const rec = car as unknown as Record<string, Scalar>
      const d = this.data[ci]
      for (const k of this.keys) d.push(Number(rec[k]))
      for (const k of POSE_KEYS) d.push(car.prev[k])
      d.push(car.events.impact, car.events.landed)
      let si = this.surfaces.indexOf(car.surface)
      if (si < 0) si = this.surfaces.push(car.surface) - 1
      this.surf[ci].push(si)
    })
    this.steps++
  }

  /** Puts every car back to the state after step `k`; events are the strongest since step `since`. */
  restore(cars: readonly Car[], k: number, since = k): void {
    k = clamp(Math.round(k), 0, this.steps - 1)
    since = clamp(Math.round(since), 0, k)
    cars.forEach((car, ci) => {
      const rec = car as unknown as Record<string, Scalar>
      const d = this.data[ci]
      const o = k * this.width
      this.keys.forEach((key, i) => (rec[key] = this.bools[i] ? d[o + i] !== 0 : d[o + i]))
      const n = this.keys.length
      POSE_KEYS.forEach((key, i) => (car.prev[key] = d[o + n + i]))
      let impact = 0, landed = 0
      for (let j = since; j <= k; j++) {
        impact = Math.max(impact, d[j * this.width + n + 8])
        landed = Math.max(landed, d[j * this.width + n + 9])
      }
      car.events.impact = impact
      car.events.landed = landed
      car.surface = this.surfaces[this.surf[ci][k]]
    })
  }

  /** One field of one car at step k, by name ('x', 'speed' is not a field: use vx/vy). */
  get(ci: number, key: string, k: number): number {
    const i = this.keys.indexOf(key)
    return this.data[ci][clamp(Math.round(k), 0, this.steps - 1) * this.width + i]
  }

  surface(ci: number, k: number): string {
    return this.surfaces[this.surf[ci][clamp(Math.round(k), 0, this.steps - 1)]]
  }
}

// ------------------------------------------------------------------ driver

/**
 * The race AI at the limit, with a pace multiplier that varies along the
 * stage: high everywhere, trimmed only where a run left the road. In drift
 * style it adds a Scandinavian flick into tight corners: a dab of opposite
 * lock to load the outside, then the lever and full lock into the turn.
 */
class HeroDriver {
  readonly ai: AiDriver
  private flick = 0
  private flickDir = 0
  private lastFlick = -1e9

  private readonly straightJumps: { s0: number; s1: number }[]

  constructor(private readonly sim: StageSim, private readonly pace: Float32Array, readonly style: Style) {
    const route = sim.route
    // A jump with a straight landing can be taken flat out; one into a bend is braked for, as the line plans.
    this.straightJumps = route.features.filter((f) => {
      if (f.kind !== 'jump') return false
      for (let x = f.s0 - 20; x < f.s1 + 100; x += 4) if (Math.abs(route.at(x).curv) > 1 / 130) return false
      return true
    })
    const { rally, stage } = sim.setup
    const line = raceLine(sim.route, rally.surface, stage.weather === 'rain', carPhys(sim.setup.car))
    // The top rung's hands (no wobble, no lag, no mistakes) on the hero's own car: no works engine.
    const persona: Personality = { ...NEUTRAL, consistency: 1, aggression: 0.8, lateBrake: 0.8, drift: style === 'drift' ? 1 : 0.3 }
    this.ai = new AiDriver(sim.car, line, RUNGS.unbeatable, persona, 1)
  }

  /**
   * Flat out over a straight jump, unless an earlier run was thrown off the
   * road by it: the pace trim then reaches back over the jump and this stops.
   */
  private flatOut(s: number, v: number): boolean {
    for (const j of this.straightJumps) {
      if (s > j.s0 - 25 - v * 1.2 && s < j.s1) return this.pace[clamp(Math.floor(j.s0 / BIN), 0, this.pace.length - 1)] >= 1.02
    }
    return false
  }

  drive(traffic: readonly Traffic[]): Input {
    const car = this.sim.car
    const bin = clamp(Math.floor(car.s / BIN), 0, this.pace.length - 1)
    this.ai.skill = this.pace[bin]
    const inp = this.ai.drive(traffic)
    if (this.style === 'fast' && !car.airborne && this.flatOut(car.s, car.speed)) return { ...inp, throttle: 1, brake: 0 }
    if (this.style !== 'drift' || car.airborne) return inp
    if (this.flick > 0) {
      // 0.0-0.22 s: opposite lock; then lever and full lock into the corner, on the power.
      const t = 0.62 - this.flick
      this.flick -= DT
      if (t < 0.22) return { steer: -this.flickDir * 0.75, throttle: 0.5, brake: 0.2, handbrake: false }
      if (t < 0.5) return { steer: this.flickDir, throttle: 0.6, brake: 0, handbrake: true }
      return { ...inp, steer: clamp(inp.steer + this.flickDir * 0.3, -1, 1), throttle: Math.max(inp.throttle, 0.7) }
    }
    const v = car.speed
    if (v > 12 && v < 30 && car.s - this.lastFlick > 120) {
      const line = this.ai.line
      const i0 = Math.floor((car.s + v * 0.55) / STEP), i1 = Math.floor((car.s + v * 0.95) / STEP)
      for (let i = i0; i <= i1 && i < line.curv.length; i++) {
        const k = line.curv[i]
        if (Math.abs(k) > 1 / 30) {
          // Positive curvature turns left, and positive steer input is right.
          this.flickDir = -Math.sign(k)
          this.flick = 0.62
          this.lastFlick = car.s
          break
        }
      }
    }
    return inp
  }
}

// ------------------------------------------------------------------ runs


export interface Run {
  spec: RunSpec
  sim: StageSim
  tape: Tape
  /** Cars in tape order: the hero first, then the rivals. */
  cars: Car[]
  names: string[]
  carIds: string[]
  liveries: string[]
  /** Step at which the countdown ended. */
  go: number
  /** Step at which the hero crossed the finish (or reached `until`). */
  end: number
  /** Hero stage time to `end`, seconds. */
  time: number
  offSteps: number
  resets: number
  /** Finishing place in a race, 1 = won; 0 in a time trial. */
  place: number
  /** Seconds the hero spent sliding at more than ~11 degrees. */
  slide: number
}

function simulate(spec: RunSpec, pace: Float32Array, rivalsToo = true): Run {
  const { rally, stageIdx } = spec
  const stage = rally.stages[stageIdx]
  const race = spec.race ? raceGrid(rally, stageIdx, 'pro', HERO_CAR, HERO_LIVERY) : undefined
  const sim = new StageSim({ rally, stage, car: HERO_CAR, difficulty: 'pro', race: rivalsToo ? race : undefined })
  ;(sim as unknown as { assists: Assists }).assists = spec.style === 'drift' ? DRIFT_ASSISTS : HERO_ASSISTS
  // Rivals run their full physics wherever they are: the tape must hold real driving.
  for (const o of sim.field) o.lod = false
  // A longer wait on the grid than the game's three seconds, so the trailer can open on it.
  if (spec.race) sim.countdown = 5.5
  const driver = new HeroDriver(sim, pace, spec.style)
  const cars = [sim.car, ...sim.field.map((o) => o.car)]
  const tape = new Tape(cars)
  const until = Math.min(sim.finish, sim.start + (spec.until ?? Infinity))
  let go = -1, end = -1, off = 0, slide = 0
  const maxSteps = Math.ceil((sim.length / 6 + 60) / DT)
  // Run on after the hero is done so the finish can be filmed with the cars braking.
  let after = -1
  for (let k = 0; k < maxSteps; k++) {
    let inp: Input = { steer: 0, throttle: 0, brake: 1, handbrake: false }
    if (sim.phase === 'running') {
      const traffic = sim.field.map((o) => ({ s: o.car.s, d: o.car.d, speed: o.car.speed }))
      inp = driver.drive(traffic)
    } else if (sim.phase === 'countdown' && sim.countdown < 0.6) {
      // Revs up on the line for the launch.
      inp = { steer: 0, throttle: 0.75, brake: 1, handbrake: false }
    }
    sim.step(inp)
    tape.record(cars)
    if (go < 0 && sim.phase !== 'countdown') go = k
    if (end < 0 && sim.phase !== 'countdown') {
      if (sim.car.offRoad && sim.car.s > sim.start) off++
      const b = Math.abs(Math.atan2(sim.car.vy, Math.max(2, Math.abs(sim.car.vx))))
      if (b > 0.2 && sim.car.speed > 8) slide += DT
      if (sim.car.s >= until || sim.phase === 'finished') {
        end = k
        after = k + Math.round(6 / DT)
      }
    }
    if (after > 0 && k >= after) break
    // Hopeless: stop early rather than simulate minutes of resets.
    if (end < 0 && sim.resets > 3) break
  }
  if (end < 0) end = tape.steps - 1
  const time = (end - go) * DT
  let place = 0
  if (spec.race) {
    const mine = sim.time
    place = 1 + sim.field.filter((o) => o.finishTime !== null ? o.finishTime + o.penalty < mine : o.car.s > sim.car.s).length
  }
  return {
    spec, sim, tape, cars,
    names: ['Hero', ...sim.field.map((o) => o.slot.name)],
    carIds: [HERO_CAR, ...sim.field.map((o) => o.slot.car)],
    liveries: [HERO_LIVERY, ...sim.field.map((o) => o.slot.livery)],
    go, end, time, offSteps: off, resets: sim.resets, place, slide,
  }
}

/** First place along the stage (metres from the route start) where the hero left the road or was reset. */
function firstFault(run: Run): number | null {
  const t = run.tape
  for (let k = run.go; k <= run.end; k++) {
    if (t.get(0, 'offRoad', k) && t.get(0, 's', k) > run.sim.start) return t.get(0, 's', k)
    if (k > run.go && t.get(0, 's', k) < t.get(0, 's', k - 1) - 5) return t.get(0, 's', k - 1)
  }
  return null
}

export interface HeroReport {
  stage: string
  style: Style
  race: boolean
  metres: number
  heroTime: number
  proTime: number
  proFaults: string
  idealTime: number | null
  place: number
  iterations: number
  clean: boolean
  slide: number
}

/**
 * The fastest clean run: start well above the AI's own limit everywhere and,
 * each time the run leaves the road, trim the pace over the stretch leading up
 * to where it happened, then run again. What is left is the limit corner by
 * corner, no more cautious anywhere than it had to be. A few starting levels
 * are tried and the quickest clean result is kept.
 */
export function bestRun(spec: RunSpec, log: (s: string) => void = () => {}): { run: Run; report: HeroReport } {
  const probe = new StageSim({ rally: spec.rally, stage: spec.rally.stages[spec.stageIdx], car: HERO_CAR, difficulty: 'pro' })
  const bins = Math.ceil(probe.route.length / BIN) + 2
  let best: Run | null = null
  let iterations = 0
  const levels = spec.style === 'drift' ? [1.08, 1.02] : [1.2, 1.14, 1.08]
  for (const level of levels) {
    const pace = new Float32Array(bins).fill(level)
    let run: Run | null = null
    for (let it = 0; it < 40; it++) {
      iterations++
      run = simulate(spec, pace)
      const fault = firstFault(run)
      const won = !spec.race || run.place === 1
      if (fault === null && run.resets === 0 && won) break
      if (fault === null) {
        // Clean but beaten: nothing to trim, this level cannot win.
        break
      }
      for (let s = fault - 170; s <= fault + 20; s += BIN) {
        const b = clamp(Math.floor(s / BIN), 0, bins - 1)
        // Hardest trim right before the fault, where the corner was entered too fast.
        const w = s > fault - 70 ? 0.965 : 0.985
        pace[b] = Math.max(0.85, pace[b] * w)
      }
      run = null
    }
    if (run && run.offSteps === 0 && run.resets === 0 && (!spec.race || run.place === 1)) {
      log(`  level ${level}: clean ${run.time.toFixed(2)} s`)
      if (!best || run.time < best.time) best = run
    } else log(`  level ${level}: no clean run`)
  }
  const clean = !!best
  if (!best) {
    // Every level failed: fall back to the AI's own pace, which is what the game ships.
    best = simulate(spec, new Float32Array(bins).fill(1))
  }
  // The Pro AI on its own over the same distance, for comparison.
  const pro = simulate({ ...spec, race: false, style: 'fast' }, new Float32Array(1).fill(1), false)
  const proDist = best.tape.get(0, 's', best.end) - best.sim.start
  let proEnd = pro.go
  while (proEnd < pro.tape.steps - 1 && pro.tape.get(0, 's', proEnd) - pro.sim.start < proDist) proEnd++
  const report: HeroReport = {
    stage: `${spec.rally.name} / ${spec.rally.stages[spec.stageIdx].name}`,
    style: spec.style,
    race: spec.race,
    metres: Math.round(proDist),
    heroTime: best.time,
    proTime: (proEnd - pro.go) * DT,
    proFaults: `${(pro.offSteps * DT).toFixed(1)} s off-road, ${pro.resets} resets`,
    idealTime: spec.until === undefined ? idealTime(best.sim) : null,
    place: best.place,
    iterations,
    clean,
    slide: best.slide,
  }
  return { run: best, report }
}

/** Body slip angle of car `ci` at step k, radians. */
export function slipAngle(run: Run, ci: number, k: number): number {
  const vx = run.tape.get(ci, 'vx', k), vy = run.tape.get(ci, 'vy', k)
  return Math.atan2(vy, Math.max(2, Math.abs(vx)))
}

export function speedAt(run: Run, ci: number, k: number): number {
  return Math.hypot(run.tape.get(ci, 'vx', k), run.tape.get(ci, 'vy', k))
}

/** World-space velocity of car `ci` at step k. */
export function worldVel(run: Run, ci: number, k: number): { x: number; z: number } {
  const t = run.tape
  const h = t.get(ci, 'heading', k), vx = t.get(ci, 'vx', k), vy = t.get(ci, 'vy', k)
  return { x: Math.sin(h) * vx + Math.cos(h) * vy, z: Math.cos(h) * vx - Math.sin(h) * vy }
}

export const headingErr = (a: number, b: number): number => Math.abs(wrapAngle(a - b))

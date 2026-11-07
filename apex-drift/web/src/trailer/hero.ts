import { clamp, wrapAngle } from '../core/math'
import { carPhys, type RallyDef } from '../data'
import { AiDriver, raceLine, styleFor, type Traffic } from '../sim/ai'
import { RUNGS, type Difficulty } from '../sim/levels'
import { NEUTRAL, type Personality } from '../sim/personality'
import { DT, type Assists, type Car, type Input } from '../sim/car'
import { raceGrid } from '../sim/race'
import { idealTime, StageSim } from '../sim/stage'

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
/**
 * For the snow footage traction control is off and the stability aid low, so
 * the power can hold the rear out through the fast sweepers.
 */
const DRIFT_ASSISTS: Assists = { steer: 0, traction: false, abs: true, stability: 0.3, autoBrake: false, forgive: 0 }
/** Pace profile resolution along the stage, metres. */
const BIN = 10
/**
 * Seconds of the drift run spent visibly sideways (past ~11 degrees) that the
 * search must keep: enough for three shots of it. Without a floor it would
 * straighten the car out wherever that is a hundredth quicker.
 */
const MIN_SLIDE = 10
/**
 * The pace search: first push every stretch of this length by this share,
 * then shorter stretches by less. Each step keeps a change only if the whole
 * run is still clean and quicker.
 */
const PASSES: [number, number][] = [[160, 0.05], [80, 0.03], [160, 0.03], [40, 0.02]]
/** Where the search starts: a shade under the top rung's own commitment, so the first run is nearly clean. */
const START = 0.97
/** Then, in a race, a lighter retune of that pace for the traffic. */
const RACE_PASSES: [number, number][] = [[160, 0.04], [80, 0.03], [40, 0.02]]

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
 * The top rung of the race AI on the player's own car (no works engine):
 * the top rung's line and hands, with a pace multiplier that varies along the
 * stage, set by the search in `bestRun`. In drift style every slide is one it
 * chose, so it holds the angle on the power instead of lifting.
 */
class HeroDriver {
  readonly ai: AiDriver
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
    // No lever on tarmac or in fast corners: on a clean run a slide only costs time unless it is the point.
    const persona: Personality = { ...NEUTRAL, consistency: 1, aggression: 0.8, lateBrake: 0.8, drift: style === 'drift' ? 0.5 : 0 }
    // The line is planned the way the top rung plans it: more of the tyres, later braking, closer to the edge.
    const line = raceLine(sim.route, rally.surface, stage.weather === 'rain', carPhys(sim.setup.car), styleFor(RUNGS.unbeatable, persona))
    this.ai = new AiDriver(sim.car, line, RUNGS.unbeatable, persona, 1)
    this.ai.meantSlides = style === 'drift'
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
    const inp = this.ai.drive(focus(traffic, car.s))
    if (this.style === 'fast' && !car.airborne && this.flatOut(car.s, car.speed)) return { ...inp, throttle: 1, brake: 0 }
    return inp
  }
}

/**
 * What the hero races against: the nearest car ahead, and anything alongside
 * or behind. The race AI weighs every car within 70 m, so behind a train of
 * three it lines up a pass on each at once, the moves cancel out and it sits
 * in the queue; a driver takes the cars one at a time.
 */
function focus(traffic: readonly Traffic[], s: number): Traffic[] {
  let ahead: Traffic | null = null
  for (const o of traffic) if (o.s - s > 3.5 && (!ahead || o.s < ahead.s)) ahead = o
  return traffic.filter((o) => o === ahead || o.s - s <= 3.5)
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

function simulate(spec: RunSpec, pace: Float32Array): Run {
  const { rally, stageIdx } = spec
  const stage = rally.stages[stageIdx]
  const race = spec.race ? raceGrid(rally, stageIdx, 'pro', HERO_CAR, HERO_LIVERY) : undefined
  const sim = new StageSim({ rally, stage, car: HERO_CAR, difficulty: 'pro', race, assists: spec.style === 'drift' ? DRIFT_ASSISTS : HERO_ASSISTS })
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
  /** The hero over the same distance alone, in a race: the race time carries the traffic. */
  soloTime: number | null
  /** The Pro rung on its own over the same distance, same car and power. */
  proTime: number
  proFaults: string
  /** The top rung on the same car, without the works engine it gets in the game. */
  topTime: number
  topFaults: string
  idealTime: number | null
  place: number
  iterations: number
  clean: boolean
  slide: number
}

/**
 * The fastest clean run. First one at a shade under the top rung's pace,
 * trimmed wherever it leaves the road until it doesn't. Then, stretch by
 * stretch along the stage, push harder (or, where that is what pays, ease
 * off) and keep the change only if the whole run is still clean, places no
 * worse in a race, and is quicker; then again over shorter stretches. What is
 * left is the limit corner by corner, found by driving it.
 *
 * A race is searched with the road to itself first: traffic makes a run
 * chaotic (a hundredth here changes who is where at the next corner), so the
 * driving is found alone and then only tuned for the overtakes.
 */
function search(spec: RunSpec, start: Float32Array, passes: [number, number][], log: (s: string) => void): { best: Run | null; pace: Float32Array; iterations: number } {
  const bins = start.length
  const drift = spec.style === 'drift'
  let iterations = 0
  let pace = start.slice()
  let best: Run | null = null
  for (let it = 0; it < 40; it++) {
    iterations++
    const run = simulate(spec, pace)
    const fault = firstFault(run)
    if (fault === null && run.resets === 0) {
      best = run
      break
    }
    if (fault === null) break
    for (let s = fault - 170; s <= fault + 20; s += BIN) {
      const b = clamp(Math.floor(s / BIN), 0, bins - 1)
      // Hardest trim right before the fault, where the corner was entered too fast.
      pace[b] = Math.max(0.85, pace[b] * (s > fault - 70 ? 0.975 : 0.99))
    }
  }
  if (!best) return { best, pace, iterations }
  log(`  ${spec.race ? 'race' : 'alone'}: first clean run ${best.time.toFixed(2)} s${spec.race ? `, place ${best.place}` : ''}`)
  const s0 = best.sim.start - 20, s1 = best.tape.get(0, 's', best.end)
  for (const [seg, step] of passes) {
    const was = best.time
    for (let a = s0; a < s1; a += seg) {
      for (const dir of [1, -1]) {
        const cand = pace.slice()
        for (let x = a; x < a + seg; x += BIN) {
          const b = clamp(Math.floor(x / BIN), 0, bins - 1)
          cand[b] = clamp(cand[b] * (1 + dir * step), 0.85, 1.35)
        }
        iterations++
        const run: Run = simulate(spec, cand)
        const better = run.place < best.place || (run.place === best.place && run.time < best.time - 0.005)
        if (firstFault(run) === null && run.resets === 0 && better && (!drift || run.slide >= Math.min(MIN_SLIDE, best.slide))) {
          best = run
          pace = cand
          break
        }
      }
    }
    log(`  ${seg} m stretches x${step}: ${best.time.toFixed(2)} s (${(best.time - was).toFixed(2)})${spec.race ? `, place ${best.place}` : ''}`)
  }
  return { best, pace, iterations }
}

export function bestRun(spec: RunSpec, log: (s: string) => void = () => {}): { run: Run; report: HeroReport } {
  const probe = new StageSim({ rally: spec.rally, stage: spec.rally.stages[spec.stageIdx], car: HERO_CAR, difficulty: 'pro' })
  const bins = Math.ceil(probe.route.length / BIN) + 2
  const clean = (r: Run) => firstFault(r) === null && r.resets === 0 && (!spec.race || r.place === 1)
  const alone = search({ ...spec, race: false }, new Float32Array(bins).fill(START), PASSES, log)
  let { best, pace, iterations } = alone
  if (spec.race) {
    const raced = search(spec, alone.pace, RACE_PASSES, log)
    ;({ best, pace } = raced)
    iterations += raced.iterations
  }
  const found = !!best && clean(best)
  // Nothing clean: fall back to the AI's own pace, which is what the game ships.
  const run = best && found ? best : simulate(spec, new Float32Array(bins).fill(1))
  const dist = run.tape.get(0, 's', run.end) - run.sim.start
  const pro = rung(spec, 'pro', dist)
  const top = rung(spec, 'unbeatable', dist)
  const report: HeroReport = {
    stage: `${spec.rally.name} / ${spec.rally.stages[spec.stageIdx].name}`,
    style: spec.style,
    race: spec.race,
    metres: Math.round(dist),
    heroTime: run.time,
    soloTime: spec.race ? simulate({ ...spec, race: false }, pace).time : null,
    proTime: pro.time,
    proFaults: `${pro.off.toFixed(1)} s off-road, ${pro.resets} resets`,
    topTime: top.time,
    topFaults: `${top.off.toFixed(1)} s off-road, ${top.resets} resets`,
    idealTime: spec.until === undefined ? idealTime(run.sim) : null,
    place: run.place,
    iterations,
    clean: found,
    slide: run.slide,
  }
  return { run, report }
}

/**
 * One rung of the race AI alone over the first `dist` metres of the stage:
 * the hero's car at the player's power, the rivals' assists, a neutral
 * character. What the hero is measured against.
 */
function rung(spec: RunSpec, level: Difficulty, dist: number): { time: number; off: number; resets: number } {
  const { rally, stageIdx } = spec
  const stage = rally.stages[stageIdx]
  const sim = new StageSim({ rally, stage, car: HERO_CAR, difficulty: 'pro', assists: HERO_ASSISTS })
  const r = RUNGS[level]
  const line = raceLine(sim.route, rally.surface, stage.weather === 'rain', carPhys(HERO_CAR), styleFor(r, NEUTRAL))
  const ai = new AiDriver(sim.car, line, r, NEUTRAL, 1234, 1)
  const until = Math.min(sim.finish, sim.start + dist)
  let go = -1, off = 0
  const max = Math.ceil((sim.length / 4 + 60) / DT)
  for (let k = 0; k < max; k++) {
    const clock = go < 0 ? 0 : (k - go) * DT
    sim.step(sim.phase === 'running' ? ai.drive([], clock) : { steer: 0, throttle: 0, brake: 1, handbrake: false })
    if (sim.phase === 'countdown') continue
    if (go < 0) go = k
    if (sim.car.offRoad) off += DT
    if (sim.car.s >= until || sim.phase === 'finished') return { time: (k - go) * DT, off, resets: sim.resets }
  }
  return { time: Infinity, off, resets: sim.resets }
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

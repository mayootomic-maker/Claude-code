import { describe, expect, it } from 'vitest'
import { carPhys, RALLIES, SCHOOL } from '../data'
import { Car, DT, type Input } from './car'
import { collide, FIELD, RACE_SKILL, raceGrid } from './race'
import { autopilot, idealTime, StageSim, type Difficulty } from './stage'
import type { Route } from './route'
import type { Ground } from './terrain'

const IDLE: Input = { steer: 0, throttle: 0, brake: 0, handbrake: false }

/** One rival alone on a stage, the player parked on the grid, simulated in full all the way. */
function solo(rallyIdx: number, stageIdx: number, d: Difficulty, car = 'kestrel') {
  const rally = RALLIES[rallyIdx]
  const slot = { ...raceGrid(rally, stageIdx, d, car, 'works')[0], car, skill: RACE_SKILL[d] }
  const sim = new StageSim({ rally, stage: rally.stages[stageIdx], car, difficulty: d, race: [slot] })
  const o = sim.field[0]
  o.lod = false
  let off = 0, steps = 0
  while (o.finishTime === null && steps < 60 * 60 * 15) {
    sim.step(IDLE)
    steps++
    if (o.car.offRoad) off += DT
    if (!Number.isFinite(o.car.x + o.car.z + o.car.vx)) throw new Error(`NaN at step ${steps}`)
  }
  return { sim, o, off, ideal: idealTime(sim) }
}

describe('AI driver', () => {
  for (let r = 0; r < RALLIES.length; r++) {
    it(`${RALLIES[r].id}: drives the closing stage on its own, quickly and on the road`, () => {
      const { o, off, ideal } = solo(r, 3, 'pro')
      const label = RALLIES[r].id
      expect(o.finishTime, label).not.toBeNull()
      expect(o.resets, label).toBeLessThanOrEqual(1)
      expect(off, `${label} seconds off the road`).toBeLessThan(5)
      // Within reach of the stage's ideal time: it races, it doesn't tour.
      expect(o.finishTime! / ideal, label).toBeLessThan(1.45)
    }, 60000)
  }

  it('drives other cars round the stage too: a front-driven 60s car and a 90s four-wheel-drive', () => {
    for (const car of ['piccola', 'apex']) {
      const { o, off } = solo(7, 3, 'driver', car)
      expect(o.finishTime, car).not.toBeNull()
      expect(o.resets, car).toBeLessThanOrEqual(1)
      expect(off, car).toBeLessThan(5)
    }
  }, 60000)

  it('a gliding rival far out of sight keeps the pace it would have had in the full simulation', () => {
    const run = (lod: boolean) => {
      const rally = RALLIES[3]
      const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'pro', race: [{ ...raceGrid(rally, 3, 'pro', 'kestrel', 'works')[0], car: 'kestrel', skill: 1 }] })
      sim.field[0].lod = lod
      let glided = 0
      while (sim.field[0].finishTime === null) {
        sim.step(IDLE)
        if (sim.field[0].gliding) glided++
      }
      return { t: sim.field[0].finishTime!, glided }
    }
    const full = run(false), cheap = run(true)
    expect(cheap.glided * DT).toBeGreaterThan(full.t * 0.5)
    expect(Math.abs(cheap.t / full.t - 1)).toBeLessThan(0.06)
  }, 60000)
})

describe('race', () => {
  it('picks three different rivals, quicker ones on harder difficulties, in other cars and liveries', () => {
    const avg = (d: Difficulty) => {
      const g = raceGrid(RALLIES[0], 0, d, 'kestrel', 'works')
      expect(g).toHaveLength(FIELD - 1)
      expect(new Set(g.map((x) => x.rival)).size).toBe(FIELD - 1)
      expect(g.every((x) => x.livery !== 'works')).toBe(true)
      return g.reduce((a, x) => a + x.skill, 0) / g.length
    }
    expect(avg('pro')).toBeGreaterThan(avg('driver'))
    expect(avg('driver')).toBeGreaterThan(avg('rookie'))
  })

  it('starts four cars on a staggered grid, the player at the back, none overlapping', () => {
    const rally = RALLIES[0]
    const sim = new StageSim({ rally, stage: rally.stages[0], car: 'kestrel', difficulty: 'driver', race: raceGrid(rally, 0, 'driver', 'kestrel', 'works') })
    const cars = [sim.car, ...sim.field.map((o) => o.car)]
    expect(cars).toHaveLength(FIELD)
    for (let i = 0; i < cars.length; i++)
      for (let k = i + 1; k < cars.length; k++) expect(Math.hypot(cars[i].x - cars[k].x, cars[i].z - cars[k].z)).toBeGreaterThan(2)
    expect(Math.min(...sim.field.map((o) => o.car.s))).toBeGreaterThan(sim.car.s)
    expect(sim.order().findIndex((e) => e.you)).toBe(FIELD - 1)
  })

  it('orders the field by finishing time, then by distance run', () => {
    const rally = RALLIES[0]
    const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'driver', race: raceGrid(rally, 3, 'driver', 'kestrel', 'works') })
    const [a, b, c] = sim.field
    sim.phase = 'running'
    a.car.place(sim.start + 500)
    b.car.place(sim.start + 900)
    c.car.place(sim.start + 100)
    sim.car.place(sim.start + 700)
    sim.car.s = sim.start + 700
    let names = sim.order().map((e) => (e.you ? 'you' : e.name))
    expect(names).toEqual([b.slot.name, 'you', a.slot.name, c.slot.name])
    // A finisher leads anyone still running, and finishers rank by time.
    c.finishTime = 300
    a.finishTime = 290
    names = sim.order().map((e) => (e.you ? 'you' : e.name))
    expect(names.slice(0, 2)).toEqual([a.slot.name, c.slot.name])
    // Penalties count toward a finisher's time.
    a.penalty = 15
    expect(sim.order()[0].name).toBe(c.slot.name)
  })

  it('rivals get past a player parked across the road instead of queueing behind it', () => {
    const sim = new StageSim({ rally: SCHOOL, stage: SCHOOL.stages[0], car: 'kestrel', difficulty: 'driver', race: raceGrid(SCHOOL, 0, 'driver', 'kestrel', 'works') })
    sim.phase = 'running'
    sim.car.place(sim.start + 150)
    sim.car.heading += Math.PI / 2
    for (let i = 0; i < 60 * 40; i++) sim.step(IDLE)
    for (const o of sim.field) expect(o.car.s, o.slot.name).toBeGreaterThan(sim.start + 170)
  }, 30000)

  it('a full race on a short stage: everyone finishes, results are in time order, and Pro rivals beat a tidy driver', () => {
    const sim = new StageSim({ rally: SCHOOL, stage: SCHOOL.stages[0], car: 'kestrel', difficulty: 'pro', race: raceGrid(SCHOOL, 0, 'pro', 'kestrel', 'works') })
    let steps = 0, contact = 0
    while ((sim.phase !== 'finished' || sim.field.some((o) => o.finishTime === null)) && steps < 60 * 60 * 6) {
      sim.step(autopilot(sim, 0.85))
      steps++
      if (sim.car.events.impact > 0) contact++
    }
    expect(sim.phase).toBe('finished')
    for (const o of sim.field) expect(o.finishTime, o.slot.name).not.toBeNull()
    const res = sim.result()
    expect(res).toHaveLength(FIELD)
    for (let i = 1; i < res.length; i++) expect(res[i].total).toBeGreaterThanOrEqual(res[i - 1].total)
    // Starting from the back of the grid, the autopilot doesn't win against Pro rivals.
    expect(res.findIndex((e) => e.you)).toBeGreaterThan(0)
    expect(sim.gaps().ahead).not.toBeUndefined()
  }, 60000)
})

/** A flat test plane for the contact model. */
function plain(): Ground {
  const route = { closest: (x: number, z: number) => ({ s: z, d: x, dist: Math.abs(x) }), at: (s: number) => ({ x: 0, z: s, y: 0, heading: 0, curv: 0, i: 0 }), featureAt: () => undefined, half: 1e9, length: 1e9 }
  return { height: () => 0, natural: () => 0, water: () => null, edge: 1e9, limitAt: () => 1e9, route: route as unknown as Route }
}

describe('car-to-car contact', () => {
  it('pushes overlapping cars apart, stops them closing, and keeps the momentum between them', () => {
    const g = plain()
    const a = new Car(carPhys('kestrel'), g, 'gravel', false), b = new Car(carPhys('apex'), g, 'gravel', false)
    a.place(0, 0.8)
    b.place(0, -0.8)
    // A side-swipe: A moving right into B, both rolling forward.
    a.vx = 20; a.vy = -3
    b.vx = 20; b.vy = 0
    const p0 = a.p.mass * a.vy + b.p.mass * b.vy
    const hit = collide(a, b)
    expect(hit).toBeGreaterThan(2)
    expect(a.x - b.x).toBeGreaterThanOrEqual(a.p.halfW + b.p.halfW - 0.01)
    // The closing speed is mostly gone (some goes into spinning both cars).
    expect(a.vy - b.vy).toBeGreaterThan(-1.5)
    const p1 = a.p.mass * a.vy + b.p.mass * b.vy
    expect(Math.abs(p1 - p0)).toBeLessThan(Math.abs(p0) * 0.15 + 50)
    expect(a.events.impact).toBeGreaterThan(0)
  })

  it('leaves cars that are apart alone, and a nose-to-tail tap slows the one behind', () => {
    const g = plain()
    const a = new Car(carPhys('kestrel'), g, 'gravel', false), b = new Car(carPhys('kestrel'), g, 'gravel', false)
    a.place(0)
    b.place(10)
    expect(collide(a, b)).toBe(0)
    b.place(a.p.halfL * 2 - 0.3)
    a.vx = 25; b.vx = 20
    expect(collide(a, b)).toBeGreaterThan(0)
    expect(a.vx).toBeLessThan(25)
    expect(b.vx).toBeGreaterThan(20)
  })
})

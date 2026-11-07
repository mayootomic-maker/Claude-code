import { describe, expect, it } from 'vitest'
import { carPhys, RALLIES, RIVALS, SCHOOL } from '../data'
import { Car, DT, type Input } from './car'
import { raceLine, styleFor } from './ai'
import { LEVELS, RUNGS } from './levels'
import { CHARACTERS, character, NEUTRAL, styleDistance, type Personality } from './personality'
import { collide, FIELD, raceGrid } from './race'
import { autopilot, idealTime, StageSim, type Difficulty } from './stage'
import type { Route } from './route'
import type { Ground } from './terrain'

const IDLE: Input = { steer: 0, throttle: 0, brake: 0, handbrake: false }

/** One rival alone on a stage, the player parked on the grid, simulated in full all the way. */
function solo(rallyIdx: number, stageIdx: number, d: Difficulty, car = 'kestrel', persona: Personality = NEUTRAL, seed = 1234) {
  const rally = RALLIES[rallyIdx]
  const slot = { ...raceGrid(rally, stageIdx, d, car, 'works')[0], car, skill: 1, persona, seed }
  const sim = new StageSim({ rally, stage: rally.stages[stageIdx], car, difficulty: d, race: [slot] })
  const o = sim.field[0]
  o.lod = false
  let off = 0, steps = 0, verge = 0
  while (o.finishTime === null && steps < 60 * 60 * 20) {
    sim.step(IDLE)
    steps++
    if (o.car.offRoad) off += DT
    if (Math.abs(o.car.d) > sim.route.half) verge += DT
    if (!Number.isFinite(o.car.x + o.car.z + o.car.vx)) throw new Error(`NaN at step ${steps}`)
  }
  return { sim, o, off, verge, t: o.finishTime! + o.penalty, ideal: idealTime(sim) }
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

describe('AI skill ladder', () => {
  it('has thirteen rungs, each planning harder than the one below, the old three among them', () => {
    expect(LEVELS).toHaveLength(13)
    for (const d of ['rookie', 'driver', 'pro'] as const) expect(LEVELS).toContain(d)
    for (let i = 1; i < LEVELS.length; i++) {
      const a = RUNGS[LEVELS[i - 1]], b = RUNGS[LEVELS[i]]
      expect(b.grip * b.pace, LEVELS[i]).toBeGreaterThanOrEqual(a.grip * a.pace)
      expect(b.mistakes, LEVELS[i]).toBeLessThanOrEqual(a.mistakes)
      expect(b.target, LEVELS[i]).toBeLessThan(a.target)
    }
    expect(RUNGS.unbeatable.mistakes).toBe(0)
  })

  for (const [ri, si] of [[0, 3], [7, 3]] as const) {
    it(`${RALLIES[ri].id} stage ${si + 1}: every few rungs is quicker, and the top beats the old Pro clearly`, () => {
      const pick = ['bad', 'casual', 'rookie', 'driver', 'pro', 'champion', 'unbeatable'] as const
      const times = pick.map((d) => solo(ri, si, d).t)
      for (let i = 1; i < times.length; i++) expect(times[i], pick[i]).toBeLessThan(times[i - 1])
      // Bad is a long way off the pace; the top is a few seconds a stage quicker than Pro.
      expect(times[0] / times[4]).toBeGreaterThan(1.3)
      expect(times[6] / times[4]).toBeLessThan(0.975)
    }, 120000)
  }

  it('the bottom rungs make visible mistakes, the top makes none', () => {
    const bad = solo(7, 3, 'bad')
    const d = bad.o.driver
    expect(d.mistakes).toBeGreaterThanOrEqual(5)
    expect(d.kinds.spin + d.kinds.wide).toBeGreaterThan(0)
    expect(bad.verge).toBeGreaterThan(1)
    const top = solo(7, 3, 'unbeatable')
    expect(top.o.driver.mistakes).toBe(0)
    expect(top.off).toBe(0)
  }, 60000)
})

describe('AI personalities', () => {
  it('twelve fictional characters, every one with a distinct style, bio and catchphrase in both languages', () => {
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(CHARACTERS.map((c) => c.style.en)).size).toBe(CHARACTERS.length)
    for (const c of CHARACTERS) {
      expect(RIVALS.some((r) => r.id === c.id), c.id).toBe(true)
      for (const t of [c.style, c.bio, c.quote]) expect(t.en.length * t.de.length, c.id).toBeGreaterThan(0)
    }
    for (let i = 0; i < CHARACTERS.length; i++)
      for (let k = i + 1; k < CHARACTERS.length; k++) expect(styleDistance(CHARACTERS[i].p, CHARACTERS[k].p)).toBeGreaterThan(0.3)
  })

  it('a late-apex driver takes a different line from an early-apex one', () => {
    const rally = RALLIES[0]
    const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'pro' })
    const late = raceLine(sim.route, 'gravel', false, carPhys('kestrel'), styleFor(RUNGS.pro, character('r2')!.p))
    const early = raceLine(sim.route, 'gravel', false, carPhys('kestrel'), styleFor(RUNGS.pro, character('r6')!.p))
    let diff = 0
    for (let i = 0; i < late.off.length; i++) diff = Math.max(diff, Math.abs(late.off[i] - early.off[i]))
    expect(diff).toBeGreaterThan(0.8)
  })

  it('the drifter goes in sideways far more often than the surgeon, and they finish at different times', () => {
    const drifter = solo(10, 3, 'pro', 'kestrel', character('r3')!.p)
    const surgeon = solo(10, 3, 'pro', 'kestrel', character('r5')!.p)
    expect(drifter.o.driver.drifts).toBeGreaterThan(surgeon.o.driver.drifts + 2)
    expect(Math.abs(drifter.t - surgeon.t)).toBeGreaterThan(0.3)
  }, 60000)

  it('a nervous driver makes more mistakes with someone on its bumper than a steady one does', () => {
    const run = (id: string) => {
      const rally = RALLIES[7]
      const grid = raceGrid(rally, 3, 'rookie', 'kestrel', 'works')
      // A quick, aggressive chaser right behind a rookie-level driver of each character.
      const lead = { ...grid[0], car: 'kestrel', skill: 1, persona: character(id)!.p, seed: 9 }
      const chase = { ...grid[1], car: 'kestrel', skill: 1, level: 'elite' as const, persona: character('r7')!.p, seed: 5 }
      const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'rookie', race: [lead, chase] })
      for (const o of sim.field) o.lod = false
      let pressure = 0
      for (let i = 0; i < 60 * 90; i++) {
        sim.step(IDLE)
        pressure = Math.max(pressure, sim.field[0].driver.pressure)
      }
      return { mistakes: sim.field[0].driver.mistakes, pressure }
    }
    const nervous = run('r11'), steady = run('r1')
    expect(nervous.pressure).toBeGreaterThan(0.3)
    expect(nervous.mistakes).toBeGreaterThan(steady.mistakes)
  }, 60000)
})

describe('race', () => {
  it('picks three different characters at the chosen rung, in other cars and liveries, with styles that differ', () => {
    for (const d of LEVELS) for (let st = 0; st < 4; st++) {
      const g = raceGrid(RALLIES[st * 3], st, d, 'kestrel', 'works')
      expect(g).toHaveLength(FIELD - 1)
      expect(new Set(g.map((x) => x.rival)).size).toBe(FIELD - 1)
      expect(g.every((x) => x.livery !== 'works' && x.level === d)).toBe(true)
      for (let i = 0; i < g.length; i++) for (let k = i + 1; k < g.length; k++) expect(styleDistance(g[i].persona, g[k].persona)).toBeGreaterThan(0.3)
    }
  })

  it('is deterministic: the same race run twice finishes in exactly the same times', () => {
    const run = () => {
      const sim = new StageSim({ rally: SCHOOL, stage: SCHOOL.stages[0], car: 'kestrel', difficulty: 'club', race: raceGrid(SCHOOL, 0, 'club', 'kestrel', 'works') })
      for (let i = 0; i < 60 * 70; i++) sim.step(autopilot(sim, 0.8))
      return sim.field.map((o) => `${o.car.s.toFixed(4)}:${o.driver.mistakes}:${o.driver.drifts}`).join(',')
    }
    expect(run()).toBe(run())
  }, 60000)

  it('a fast rival behind a slow one picks a side on a straight and gets past without hitting it', () => {
    const rally = RALLIES[0]
    const grid = raceGrid(rally, 3, 'pro', 'kestrel', 'works')
    const slow = { ...grid[0], car: 'kestrel', skill: 1, level: 'bad' as const, persona: NEUTRAL, seed: 3 }
    const fast = { ...grid[1], car: 'kestrel', skill: 1, level: 'unbeatable' as const, persona: character('r7')!.p, seed: 4 }
    // The slow car starts in front.
    const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'pro', race: [slow, fast] })
    for (const o of sim.field) o.lod = false
    let hard = 0
    for (let i = 0; i < 60 * 80; i++) {
      sim.step(IDLE)
      if (sim.field[0].car.events.impact > 4) hard++
    }
    expect(sim.field[1].car.s).toBeGreaterThan(sim.field[0].car.s + 20)
    expect(sim.field[1].driver.passes).toBeGreaterThan(0)
    expect(hard).toBe(0)
  }, 60000)

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

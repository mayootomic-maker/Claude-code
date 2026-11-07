import { describe, expect, it } from 'vitest'
import { carPhys, RALLIES } from '../data'
import { ASSISTS, Car, type Assists } from '../sim/car'
import { LEVELS } from '../sim/levels'
import type { Route } from '../sim/route'
import { autopilot, StageSim } from '../sim/stage'
import type { Ground } from '../sim/terrain'
import { assistPreset, isCustom, sanitizeAssists, steerScale, toSim } from './assists'
import { sanitize } from './save'

/** A straight road 4 m either side, verge to 8 m, grass beyond. */
function road(): Ground {
  const route = { closest: (x: number, z: number) => ({ s: z, d: x, dist: Math.abs(x) }), at: (s: number) => ({ x: 0, z: s, y: 0, heading: 0, curv: 0, i: 0 }), featureAt: () => undefined, half: 4, length: 1e9 }
  return { height: () => 0, natural: () => 0, water: () => null, edge: 8, limitAt: () => 1e9, route: route as unknown as Route }
}

describe('driving assists', () => {
  it('each preset maps onto the physics it names, Full the old Rookie help and Off none', () => {
    expect(toSim(assistPreset('full'))).toEqual(ASSISTS.full)
    expect(toSim(assistPreset('medium'))).toEqual(ASSISTS.medium)
    expect(toSim(assistPreset('off'))).toEqual(ASSISTS.off)
    const a = assistPreset('off')
    a.abs = true
    expect(isCustom(a)).toBe(true)
    expect(toSim(a).abs).toBe(true)
    expect(toSim(a).traction).toBe(false)
  })

  it('speed-sensitive steering leaves town speeds alone and calms a fast road', () => {
    expect(steerScale(8, 1)).toBe(1)
    expect(steerScale(45, 1)).toBeCloseTo(0.5)
    expect(steerScale(45, 0)).toBe(1)
  })

  it('grip forgiveness: a car cornering with two wheels on the grass holds a tighter line', () => {
    const run = (assists: Assists) => {
      const c = new Car(carPhys('kestrel'), road(), 'gravel', false)
      c.place(0, 9)
      const w = c as unknown as { wf: number; wr: number }
      c.vx = w.wf = w.wr = 20
      c.gear = 3
      for (let i = 0; i < 90; i++) c.step({ steer: -0.7, throttle: 0.4, brake: 0, handbrake: false }, assists)
      return c.heading
    }
    expect(run({ ...ASSISTS.off, forgive: 1 })).toBeGreaterThan(run(ASSISTS.off) * 1.15)
  })

  it('auto-countersteer catches a slide the driver does nothing about', () => {
    const run = (steer: number) => {
      const c = new Car(carPhys('ruska'), road(), 'gravel', false)
      c.place(0)
      const w = c as unknown as { wf: number; wr: number }
      c.vx = w.wf = w.wr = 18
      c.vy = 7
      c.r = -0.8
      c.gear = 3
      let worst = 0
      for (let i = 0; i < 120; i++) {
        c.step({ steer: 0, throttle: 0.6, brake: 0, handbrake: false }, { ...ASSISTS.off, steer })
        worst = Math.max(worst, Math.abs(Math.atan2(c.vy, c.vx)))
      }
      return { worst, end: Math.abs(Math.atan2(c.vy, c.vx)) }
    }
    expect(run(0.55).worst).toBeLessThan(run(0).worst)
  })

  it('the full assists get a sloppy driver round a stage quicker than none', () => {
    const drive = (assists: Assists) => {
      const rally = RALLIES[0]
      const sim = new StageSim({ rally, stage: rally.stages[3], car: 'kestrel', difficulty: 'rookie', assists })
      let n = 0
      while (sim.phase !== 'finished' && n++ < 60 * 60 * 10) {
        const inp = autopilot(sim, 1.12)
        sim.step({ ...inp, steer: inp.steer * 0.8 })
      }
      return sim.total
    }
    expect(drive(ASSISTS.full)).toBeLessThan(drive(ASSISTS.off))
  }, 60000)
})

describe('save: AI level and assists', () => {
  it('keeps every rung, and maps an old difficulty to the assists it used to bring', () => {
    for (const d of LEVELS) expect(sanitize({ settings: { difficulty: d } }).settings.difficulty).toBe(d)
    expect(sanitize({ settings: { difficulty: 'pro' } }).settings.assists).toEqual(assistPreset('off'))
    expect(sanitize({ settings: { difficulty: 'driver' } }).settings.assists).toEqual(assistPreset('medium'))
    expect(sanitize({ settings: { difficulty: 'rookie' } }).settings.assists).toEqual(assistPreset('full'))
    expect(sanitize({ event: { rally: 'finland', times: [100], difficulty: 'legend' } }).event?.difficulty).toBe('legend')
  })

  it('validates the assist block field by field', () => {
    const a = sanitizeAssists({ preset: 'turbo', steer: 'yes', abs: false, speedSteer: 7 }, assistPreset('strong'))
    expect(a.preset).toBe('strong')
    expect(a.steer).toBe(true)
    expect(a.abs).toBe(false)
    expect(a.speedSteer).toBe(1)
  })
})

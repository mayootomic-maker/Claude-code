import { describe, expect, it } from 'vitest'
import { RALLIES } from '../data'
import { autopilot, StageSim } from '../sim/stage'
import { bestRun, Tape } from './hero'
import { ease, easeOut } from './cams'
import { timeline } from './plan'

describe('trailer tape', () => {
  it('puts a car back exactly as the simulation left it', () => {
    const sim = new StageSim({ rally: RALLIES[0], stage: RALLIES[0].stages[3], car: 'apex', difficulty: 'pro' })
    const tape = new Tape([sim.car])
    const snaps: string[] = []
    for (let k = 0; k < 900; k++) {
      sim.step(autopilot(sim, 0.9))
      tape.record([sim.car])
      if (k === 400) snaps.push(JSON.stringify(sim.car))
    }
    tape.restore([sim.car], 400)
    expect(JSON.stringify(sim.car)).toBe(snaps[0])
  })
})

describe('trailer hero', () => {
  it('drives a clean run faster than the Pro AI', () => {
    const { run, report } = bestRun({ rally: RALLIES[0], stageIdx: 3, race: false, style: 'fast', until: 900 })
    expect(report.clean).toBe(true)
    expect(run.offSteps).toBe(0)
    expect(report.heroTime).toBeLessThan(report.proTime)
  })
})

describe('trailer edit', () => {
  it('eases without a jump at either end and lays shots end to end less their transitions', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.001)).toBeLessThan(1e-7)
    expect(easeOut(1)).toBe(1)
    expect(timeline([{ dur: 3, out: { dur: 0.5 } }, { dur: 2, out: { dur: 0 } }, { dur: 1, out: { dur: 0 } }])).toEqual([0, 2.5, 4.5])
  })
})

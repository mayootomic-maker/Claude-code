import { describe, expect, it } from 'vitest'
import { RALLIES } from '../data'
import { DT } from './car'
import { autopilot, idealTime, medals, StageSim, type Difficulty } from './stage'

function drive(rallyIdx: number, stageIdx: number, difficulty: Difficulty, skill: number, car = 'kestrel') {
  const rally = RALLIES[rallyIdx]
  const sim = new StageSim({ rally, stage: rally.stages[stageIdx], car, difficulty })
  let steps = 0
  let maxOff = 0
  while (sim.phase !== 'finished' && steps < 60 * 60 * 20) {
    sim.step(autopilot(sim, skill))
    steps++
    const c = sim.car
    if (!Number.isFinite(c.x + c.z + c.y + c.vx + c.vy + c.r)) throw new Error(`NaN at step ${steps}`)
    const below = sim.ground.height(c.x, c.z) - c.y
    if (below > 0.05) throw new Error(`car ${below.toFixed(2)} m below ground at s=${c.s.toFixed(0)}`)
    if (sim.phase === 'running') maxOff = Math.max(maxOff, Math.abs(c.d))
  }
  return { sim, steps, maxOff, ideal: idealTime(sim) }
}

describe('stage simulation', () => {
  it('a mediocre driver on Rookie wins gold on the first stage of the career', () => {
    const { sim, ideal } = drive(0, 0, 'rookie', 0.8)
    expect(sim.phase).toBe('finished')
    const m = medals(ideal, 'rookie')
    expect(sim.total).toBeLessThan(m.gold)
  })

  for (let r = 0; r < RALLIES.length; r++) {
    it(`${RALLIES[r].id}: all four stages can be driven clean by a careful driver`, () => {
      for (let st = 0; st < 4; st++) {
        const { sim } = drive(r, st, 'driver', 0.82)
        const label = `${RALLIES[r].id} stage ${st + 1}`
        expect(sim.phase, label).toBe('finished')
        expect(sim.resets, label).toBe(0)
      }
    })
  }

  it('runs at a fixed 60 Hz', () => {
    expect(DT).toBeCloseTo(1 / 60)
  })
})

import { describe, expect, it } from 'vitest'
import { autopilot, StageSim } from '../sim/stage'
import { dailyChallenge, dayKey, streak } from './daily'

describe('daily stage', () => {
  it('is the same for a given date and different on the next day', () => {
    const a = dailyChallenge(new Date(2026, 10, 6)), b = dailyChallenge(new Date(2026, 10, 6)), c = dailyChallenge(new Date(2026, 10, 7))
    expect(a.rally.stages[0]).toEqual(b.rally.stages[0])
    expect(a.car).toBe(b.car)
    expect(c.rally.stages[0].seed).not.toBe(a.rally.stages[0].seed)
  })

  it('a week of daily stages can all be driven to the finish', () => {
    for (let i = 0; i < 7; i++) {
      const d = dailyChallenge(new Date(2026, 10, 1 + i))
      const sim = new StageSim({ rally: d.rally, stage: d.rally.stages[0], car: 'kestrel', difficulty: 'driver' })
      let n = 0
      while (sim.phase !== 'finished' && n++ < 60 * 600) sim.step(autopilot(sim, 0.82))
      expect(sim.phase, d.key).toBe('finished')
    }
  })

  it('counts consecutive days ending today or yesterday', () => {
    const today = new Date(2026, 10, 6)
    const day = (o: number) => dayKey(new Date(2026, 10, 6 - o))
    expect(streak([day(0), day(1), day(2)], today)).toBe(3)
    expect(streak([day(1), day(2)], today)).toBe(2)
    expect(streak([day(0), day(2)], today)).toBe(1)
    expect(streak([day(3)], today)).toBe(0)
  })
})

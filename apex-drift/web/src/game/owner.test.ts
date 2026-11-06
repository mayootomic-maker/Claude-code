import { describe, expect, it } from 'vitest'
import { CARS, LIVERIES, RALLIES } from '../data'
import { level } from './career'
import { CHEATS, findCheat, OWNER, unlockAll } from './owner'
import { defaults, SAVE_KEY } from './save'

describe('owner build', () => {
  it('is off in normal builds, which keep the normal save', () => {
    expect(OWNER).toBe(false)
    expect(SAVE_KEY).toBe('apexdrift.save.v4')
  })

  it('unlocks every rally, car and livery, and running it twice changes nothing', () => {
    const s = defaults()
    unlockAll(s)
    expect(s.finished.length).toBe(RALLIES.length)
    expect(s.owned.cars.length).toBe(CARS.length)
    expect(s.owned.liveries.length).toBe(LIVERIES.length)
    expect(level(s.xp).level).toBeGreaterThan(Math.max(...CARS.map((c) => c.level)))
    const once = JSON.stringify(s)
    unlockAll(s)
    expect(JSON.stringify(s)).toBe(once)
  })

  it('reads codes regardless of case and spacing, and every code works', () => {
    expect(findCheat(' money-bags ')?.code).toBe('MONEYBAGS')
    expect(findCheat('nope')).toBeUndefined()
    for (const c of CHEATS) {
      const s = defaults()
      expect(c.run(s, { turbo: false })).not.toMatch(/unknown/i)
    }
    const s = defaults()
    findCheat('levelup')!.run(s, { turbo: false })
    expect(level(s.xp).level).toBe(2)
    findCheat('quack')!.run(s, { turbo: false })
    expect(s.livery).toBe('duck')
  })
})

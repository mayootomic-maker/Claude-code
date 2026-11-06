import { describe, expect, it } from 'vitest'
import { RALLIES } from '../data'
import { StageSim } from '../sim/stage'
import { LAKE_BELOW_ROAD, lakeSurface } from './lakes'
import { TILE } from './placement'

describe('lakes', () => {
  it('never put water on or above the road, on any stage with lakes', () => {
    let sheets = 0
    for (const rally of RALLIES.filter((r) => r.water.lakes > 0))
      for (const stage of rally.stages) {
        const sim = new StageSim({ rally, stage, car: 'kestrel', difficulty: 'driver' })
        const g = sim.ground
        const done = new Set<string>()
        for (let s = 0; s < sim.finish; s += 16) {
          const a = sim.route.at(s)
          const cx = (Math.round(a.x / TILE)) * TILE, cz = Math.round(a.z / TILE) * TILE
          const key = `${cx},${cz}`
          if (done.has(key)) continue
          done.add(key)
          const sheet = lakeSurface(g, cx - TILE / 2, cz - TILE / 2, TILE / 4 + 1, 4)
          if (!sheet) continue
          sheets++
          for (let k = 0; k < sheet.pos.length; k += 3) {
            const c = sim.route.closest(sheet.pos[k], sheet.pos[k + 2], 600)!
            // Clear of the drivable strip, and below the road beside it.
            expect(c.dist).toBeGreaterThan(g.edge + 4)
            expect(sheet.pos[k + 1]).toBeLessThanOrEqual(c.y - LAKE_BELOW_ROAD + 1e-4)
          }
        }
      }
    expect(sheets).toBeGreaterThan(10)
  }, 300000)
})

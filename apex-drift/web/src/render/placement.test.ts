import { describe, expect, it } from 'vitest'
import { noise2 } from '../core/math'
import { RALLIES, SCHOOL } from '../data'
import { StageSim } from '../sim/stage'
import { BODY } from '../sim/terrain'
import { edgePoint, planSegment, planTile, TILE, type PlanCtx } from './placement'

/**
 * "Things on the road" was a 2.0 complaint. This walks every stage and checks
 * every solid object the world would place: its whole footprint must be
 * further from the nearest road leg than the car's centre can ever go, plus
 * the width of the car body.
 */
describe('scenery never intrudes on the drivable area', () => {
  for (const rally of [...RALLIES, SCHOOL]) {
    it(rally.id, () => {
      let checked = 0
      rally.stages.forEach((stage, si) => {
        const sim = new StageSim({ rally, stage, car: 'kestrel', difficulty: 'driver' })
        const ctx: PlanCtx = { route: sim.route, ground: sim.ground, rally, seed: stage.seed, noise: noise2(9), snowAll: rally.surface === 'snow' }
        const fail = (p: { kind: string; x: number; z: number; r: number }) => {
          const c = sim.route.closest(p.x, p.z, 800)
          if (!c) return
          const limit = sim.ground.limitAt(c.s)
          if (c.dist - p.r < limit + BODY) throw new Error(`${rally.id} stage ${si + 1}: ${p.kind} r=${p.r.toFixed(1)} at ${c.dist.toFixed(1)} m from road (limit ${limit.toFixed(1)}) s=${c.s.toFixed(0)}`)
          checked++
        }
        // Tiles along the road, every third one to keep the test quick.
        const seen = new Set<number>()
        for (let i = 0; i < sim.route.n; i += 12) {
          const gx = Math.floor(sim.route.x[i] / TILE), gz = Math.floor(sim.route.z[i] / TILE)
          const key = (gx + 32768) * 65536 + (gz + 32768)
          if (seen.has(key) || seen.size % 3 === 1) {
            seen.add(key)
            continue
          }
          seen.add(key)
          for (const p of planTile(ctx, (gx + 0.5) * TILE, (gz + 0.5) * TILE, key, 1)) if (p.r > 0) fail(p)
        }
        for (let s0 = 0, i = 0; s0 < sim.route.length; s0 += 120, i++)
          for (const p of planSegment(ctx, s0, s0 + 120, i, sim.start, sim.finish, 1)) fail(p)
      })
      expect(checked).toBeGreaterThan(100)
    })
  }
})

describe('rails, walls and marker posts stand clear of every leg of road', () => {
  for (const rally of RALLIES) {
    it(rally.id, () => {
      for (const stage of rally.stages) {
        const sim = new StageSim({ rally, stage, car: 'kestrel', difficulty: 'driver' })
        const ctx: PlanCtx = { route: sim.route, ground: sim.ground, rally, seed: stage.seed, noise: noise2(9), snowAll: false }
        let placed = 0, total = 0
        for (let s = 0; s < sim.route.length; s += 4) {
          for (const side of [1, -1] as const) {
            total++
            const p = edgePoint(ctx, s, side)
            if (!p) continue
            placed++
            const c = sim.route.closest(p.x, p.z, 400)!
            expect(c.dist).toBeGreaterThanOrEqual(sim.ground.limitAt(c.s) + BODY - 0.05)
          }
        }
        // Gaps only on the inside of the tightest bends, never most of the stage.
        expect(placed / total, stage.name).toBeGreaterThan(0.85)
      }
    })
  }
})

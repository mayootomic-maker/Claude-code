import { describe, expect, it } from 'vitest'
import { noise2, rng } from '../core/math'
import { RALLIES, SCHOOL } from '../data'
import { StageSim } from '../sim/stage'
import { asLand, BODY } from '../sim/terrain'
import { streamSurface } from './lakes'
import { baseFor, edgePoint, planSegment, planTile, type PlanCtx } from './placement'
import { FAR_RES, planTileRes, splitAD, Surface, TILE, triHeight } from './surface'

/** The terrain grid spacings of the tier with the coarsest corridor (Low); the finest is checked separately. */
const TIERS: [number, number, number][] = [[2, 4, 4], [1, 2, 4]]

function setup(rallyIdx: number, stageIdx: number, res: [number, number, number]) {
  const rally = rallyIdx < 0 ? SCHOOL : RALLIES[rallyIdx]
  const stage = rally.stages[stageIdx]
  const sim = new StageSim({ rally, stage, car: 'kestrel', difficulty: 'driver' })
  const land = asLand(sim.ground)
  const tiles = planTileRes(sim.route, land.edge, res)
  const surf = new Surface(land, (gx, gz) => tiles.get((gx + 32768) * 65536 + (gz + 32768)) ?? FAR_RES)
  const ctx: PlanCtx = { route: sim.route, ground: sim.ground, rally, seed: stage.seed, noise: noise2(9), snowAll: rally.surface === 'snow' }
  return { rally, sim, land, tiles, surf, ctx }
}

/**
 * "Things floating around" was the complaint: trees, rocks and posts placed
 * on the smooth ground function while the terrain is drawn as triangles,
 * which on slopes and banks sit tens of centimetres lower. Everything now
 * reads the drawn surface; these tests hold it to that, on every stage.
 */
describe('the surface read back is the terrain that is drawn', () => {
  it('matches the triangles of a tile built the way the world builds it, at every grid spacing', () => {
    for (const res of [1, 2, 4, FAR_RES]) {
      const { sim, land, surf } = setup(9, 0, [res, res, res])
      const r = rng(res)
      for (let k = 0; k < 6; k++) {
        const a = sim.route.at(500 + k * 1300)
        const gx = Math.floor(a.x / TILE), gz = Math.floor(a.z / TILE)
        const n = TILE / res + 1
        const x0 = gx * TILE, z0 = gz * TILE
        // The tile's own grid, sampled as World.buildTile samples it.
        const h = new Float32Array(n * n)
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = land.sample(x0 + i * res, z0 + j * res).mesh
        for (let q = 0; q < 300; q++) {
          const x = x0 + r() * TILE * 0.999, z = z0 + r() * TILE * 0.999
          const i = Math.floor((x - x0) / res), j = Math.floor((z - z0) / res), c = j * n + i
          const drawn = triHeight(h[c], h[c + 1], h[c + n], h[c + n + 1], (x - x0) / res - i, (z - z0) / res - j)
          expect(Math.abs(surf.height(x, z) - drawn)).toBeLessThan(1e-3)
        }
      }
    }
  })

  it('splits each quad along the diagonal that keeps it on the ground', () => {
    // A ridge along the a-d diagonal: split there, the ridge stays up.
    expect(splitAD(1, 0.2, 0, 1)).toBe(true)
    expect(triHeight(1, 0.2, 0, 1, 0.5, 0.5)).toBeCloseTo(1)
    expect(splitAD(0, 1, 1, 0.2)).toBe(false)
    expect(triHeight(0, 1, 1, 0.2, 0.5, 0.5)).toBeCloseTo(1)
  })
})

describe('everything stands on the drawn ground: no hovering on slopes, nothing buried', () => {
  const rallies = [...RALLIES.map((_, i) => i), -1]
  for (const ri of rallies) {
    const id = ri < 0 ? SCHOOL.id : RALLIES[ri].id
    it(id, () => {
      let checked = 0
      const stages = ri < 0 ? [0] : [0, 1, 2, 3]
      for (const si of stages) {
        const { sim, surf, ctx, land } = setup(ri, si, TIERS[si % 2])
        const check = (kind: string, x: number, z: number, y: number, bottom: number, foot: number) => {
          const lo = surf.low(x, z, foot), hi = surf.high(x, z, foot)
          // The lowest point of the model reaches the lowest ground under it...
          if (bottom > lo + 0.01) throw new Error(`${id} stage ${si + 1}: ${kind} at (${x.toFixed(1)}, ${z.toFixed(1)}) hovers ${(bottom - lo).toFixed(2)} m`)
          // ...and it stands on that ground, not sunk below it or lifted above its high side.
          if (y < lo - 0.01 || y > hi + 0.01) throw new Error(`${id} stage ${si + 1}: ${kind} base ${y.toFixed(2)} outside ${lo.toFixed(2)}..${hi.toFixed(2)}`)
          checked++
        }
        // Scenery in tiles along the road, every few tiles to keep the test quick.
        const seen = new Set<number>()
        for (let i = 0; i < sim.route.n; i += 40) {
          const gx = Math.floor(sim.route.x[i] / TILE), gz = Math.floor(sim.route.z[i] / TILE)
          const key = (gx + 32768) * 65536 + (gz + 32768)
          if (seen.has(key)) continue
          seen.add(key)
          for (const p of planTile(ctx, (gx + 0.5) * TILE, (gz + 0.5) * TILE, key, 1)) {
            const b = baseFor(p, surf)
            check(p.kind, p.x, p.z, b.y, b.bottom, b.foot)
          }
        }
        // Road furniture: crowds, chevrons, houses, fences, poles, landmarks.
        for (let s0 = 0, i = 0; s0 < sim.route.length; s0 += 360, i += 3)
          for (const p of planSegment(ctx, s0, s0 + 120, i, sim.start, sim.finish, 1)) {
            const b = baseFor(p, surf)
            check(p.kind, p.x, p.z, b.y, b.bottom, b.foot)
          }
        // Marker posts and rail posts reach below the ground at their foot.
        for (let s = 0; s < sim.route.length; s += 48)
          for (const side of [1, -1] as const) {
            const e = edgePoint(ctx, s, side)
            if (!e) continue
            const g = surf.height(e.x, e.z)
            const a = sim.route.at(s)
            expect(Math.min(a.y, g) - 0.3).toBeLessThanOrEqual(g)
            expect(sim.route.closest(e.x, e.z)!.dist).toBeGreaterThanOrEqual(land.limitAt(sim.route.closest(e.x, e.z)!.s) + BODY - 0.05)
          }
        // Streams and rivers: their fading edges tuck under the drawn bank,
        // and they stay below every road they pass (a ford's water may cover
        // its own dipped road, which is what makes it a ford).
        for (const cr of land.crossings) {
          const w = streamSurface(cr, (x, z) => surf.height(x, z))
          for (let k = 0; k < w.pos.length / 3; k++) {
            const x = w.pos[k * 3], y = w.pos[k * 3 + 1], z = w.pos[k * 3 + 2]
            const g = surf.height(x, z)
            if (w.col[k * 4 + 3] === 0) expect(y, `${cr.kind} bank`).toBeLessThanOrEqual(g + 1e-3)
            else expect(y, `${cr.kind} water`).toBeLessThanOrEqual(g + cr.depth + 1e-3)
            const c = sim.route.closest(x, z)
            if (!c || c.dist > land.edge) continue
            const ford = cr.kind === 'splash' && Math.abs(c.s - cr.s) < cr.hw + 4
            expect(y, `${cr.kind} at s=${cr.s.toFixed(0)}`).toBeLessThanOrEqual(ford ? c.y + 0.05 : c.y - 0.1)
          }
        }
      }
      expect(checked).toBeGreaterThan(200)
    }, 120000)
  }
})

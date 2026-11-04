import { describe, expect, it } from 'vitest'
import { RALLIES } from '../data'
import { buildRoute, STEP } from './route'

describe('route generation', () => {
  for (const r of RALLIES) {
    it(`${r.id}: every stage is the requested length and never overlaps itself`, () => {
      for (const st of r.stages) {
        const route = buildRoute({ ...r, seed: st.seed, km: st.km })
        expect(route.length).toBeGreaterThan(st.km * 1000 - 50)
        // Any two samples more than 150 m apart along the road must be at least
        // a road width plus verge apart in space.
        const min = r.half * 2 + 9
        for (let i = 0; i < route.n; i += 3) {
          const c = route.closest(route.x[i], route.z[i])!
          expect(c.dist).toBeLessThan(0.01)
          for (let j = i + 75; j < route.n; j += 5) {
            const d = Math.hypot(route.x[i] - route.x[j], route.z[i] - route.z[j])
            if (d < min) throw new Error(`${st.name}: s=${i * STEP} and s=${j * STEP} are ${d.toFixed(1)} m apart`)
          }
        }
      }
    })
  }

  it('is deterministic for a seed', () => {
    const r = RALLIES[0]
    const a = buildRoute({ ...r, seed: 42, km: 3 })
    const b = buildRoute({ ...r, seed: 42, km: 3 })
    expect(Array.from(a.x.slice(0, 50))).toEqual(Array.from(b.x.slice(0, 50)))
  })

  it('closest() finds the nearest leg, not just a nearby one', () => {
    const r = RALLIES.find((x) => x.id === 'monte')!
    const route = buildRoute({ ...r, seed: 1101, km: 10.5 })
    for (let k = 0; k < 400; k++) {
      const i = Math.floor((k / 400) * (route.n - 1))
      const px = route.x[i] + Math.sin(k) * 30, pz = route.z[i] + Math.cos(k * 1.3) * 30
      const c = route.closest(px, pz)!
      let brute = Infinity
      for (let j = 0; j < route.n - 1; j++) {
        const ax = route.x[j], az = route.z[j], dx = route.x[j + 1] - ax, dz = route.z[j + 1] - az
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
        brute = Math.min(brute, Math.hypot(ax + dx * t - px, az + dz * t - pz))
      }
      expect(c.dist).toBeCloseTo(brute, 4)
    }
  })
})

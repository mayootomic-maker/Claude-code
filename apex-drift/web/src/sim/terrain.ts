import { fbm2, noise2, smoothstep } from '../core/math'
import type { RallyDef } from '../data'
import { STEP, type Route } from './route'

/**
 * Half the width of a car body plus a hair. The physics holds the car's
 * centre at `limitAt(s)`; anything solid must stand at least this much
 * further out, or the body visibly passes through it.
 */
export const BODY = 1.05

export interface Ground {
  /** Height of the surface the car drives on (road or terrain). */
  height(x: number, z: number): number
  /** Natural terrain only, ignoring water and bridges; used for scenery placement. */
  natural(x: number, z: number): number
  /** Lake surface height if (x, z) is open water, else null. */
  water(x: number, z: number): number | null
  /** Where the drivable edge is, from the centreline. */
  readonly edge: number
  /** How far from the centreline the car may go at distance s: verges are drivable, forest and bridges are not. */
  limitAt(s: number): number
  readonly route: Route
}

/**
 * One height function shared by physics, terrain meshes and scenery placement,
 * so the car, the ground you see and the trees all agree on where "the ground" is.
 */
export function makeGround(route: Route, rally: RallyDef, seed: number): Ground {
  const rel = rally.relief
  const n = noise2(seed * 31 + 7)
  const sideN = noise2(seed * 17 + 5)
  const edge = route.half + rally.edge.shoulder
  // Regional character: mountain roads hang on steep valley sides, plains roll gently.
  const STEEP = ['alpine', 'andes', 'japan', 'wales'].includes(rally.biome) ? 1.7 : rally.biome === 'savannah' || rally.biome === 'nordic' ? 0.6 : 1
  const TERRACED = rally.biome === 'med' || rally.biome === 'iberia' || rally.biome === 'andes'
  const hard = rally.edge.up === 'rockwall' || rally.edge.up === 'mosswall' || rally.edge.down === 'rail' || rally.edge.up === 'snowbank'
  const limit = edge + (hard ? 0.4 : 5)

  const natural = (x: number, z: number): number => {
    const c = route.closest(x, z, 600)
    if (!c) return fbm2(n, x / 300, z / 300, 4) * rel.amp * 0.6
    const off = Math.max(0, c.dist - edge)
    // The road is cut into a hillside whose fall line changes slowly along the
    // stage: one side climbs (rock walls, banks), the other drops away.
    const fall = sideN(c.s / 400, 0.3) * rel.side * 0.42 * STEEP
    let side = Math.sign(c.d) * fall * off
    // Mediterranean and Andean hillsides are farmed in terraces.
    if (TERRACED && Math.abs(side) > 1.5) side = Math.sign(side) * (Math.floor(Math.abs(side) / 2.6) * 2.6 + smoothstep(0.75, 1, (Math.abs(side) / 2.6) % 1) * 2.6)
    const rough = fbm2(n, x / 90, z / 90, 4) * Math.min(14, rel.amp * 0.08) * smoothstep(0, 40, off)
    const ditch = -0.45 * smoothstep(0, 1.5, off) * (1 - smoothstep(2.5, 6, off))
    let h = c.y + side + rough + ditch - 0.06
    // Lakes: basins in the low, flat country, well back from the road.
    const lk = lake(x, z, off)
    if (lk > 0) h = h * (1 - lk) + (c.y - 3.2) * lk
    return h
  }

  const lakeN = noise2(seed * 5 + 11)
  const LAKE_T = -0.42 + rally.water.lakes * 0.07
  /** 0 on land, rising to 1 in the middle of a lake. */
  const lake = (x: number, z: number, off: number): number => {
    if (!rally.water.lakes || off < 16) return 0
    const v = fbm2(lakeN, x / 360, z / 360, 3)
    return smoothstep(LAKE_T, LAKE_T - 0.1, v) * smoothstep(16, 30, off)
  }
  const water = (x: number, z: number): number | null => {
    const c = route.closest(x, z, 600)
    if (!c) return null
    return lake(x, z, c.dist - edge) > 0.35 ? c.y - 1.6 : null
  }

  const height = (x: number, z: number): number => {
    const c = route.closest(x, z, 600)
    if (!c) return natural(x, z)
    let h: number
    if (c.dist <= edge) {
      h = c.y
    } else {
      const t = smoothstep(edge, edge + 3, c.dist)
      h = c.y * (1 - t) + natural(x, z) * t
    }
    const bridge = route.featureAt(c.s, 'bridge')
    if (bridge) {
      // A gorge under the bridge; the deck itself stays at road height.
      const u = Math.min(c.s - bridge.s0, bridge.s1 - c.s)
      if (c.dist > route.half + 0.8) h -= 7 * smoothstep(0, 8, u)
    }
    const splash = route.featureAt(c.s, 'splash')
    if (splash) {
      const u = Math.min(c.s - splash.s0, splash.s1 - c.s)
      h -= 0.3 * smoothstep(0, 6, u)
    }
    return h
  }

  // Where another leg of road runs close (hairpins, switchbacks), the verge
  // between them is split down the middle: the car can't cut across, and
  // posts and rails for one leg never stand in the other's drivable strip.
  const near = new Float32Array(route.n)
  for (let i = 0; i < route.n; i++) near[i] = route.otherLeg(i, 30, 2 * (limit + BODY) + 4)
  const legLimit = (s: number): number => {
    const i = Math.min(route.n - 1, Math.max(0, Math.round(s / STEP)))
    let m = Infinity
    for (let k = Math.max(0, i - 3); k <= Math.min(route.n - 1, i + 3); k++) m = Math.min(m, near[k])
    return Math.max(route.half + 0.3, Math.min(limit, m / 2 - BODY - 0.4))
  }
  // On a bridge the parapets stand just outside the road edge.
  const limitAt = (s: number): number => (route.featureAt(s, 'bridge') ? route.half + 0.3 - BODY : legLimit(s))

  return { height, natural, water, edge, limitAt, route }
}

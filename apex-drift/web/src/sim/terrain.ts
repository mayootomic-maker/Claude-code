import { clamp, fbm2, noise2, smoothstep } from '../core/math'
import type { RallyDef } from '../data'
import { landTrend, STEP, type Closest, type Route } from './route'

/**
 * Half the width of a car body plus a hair. The physics holds the car's
 * centre at `limitAt(s)`; anything solid must stand at least this much
 * further out, or the body visibly passes through it.
 */
export const BODY = 1.05

/** How far from the road the landscape is modelled at all; the horizon ring stands beyond. */
export const LAND_REACH = 450

/**
 * A stream or river crossing the road at a ford or under a bridge. It runs
 * across the road and follows the land downhill on either side, so its water
 * never hangs above falling ground.
 */
export interface Crossing {
  kind: 'bridge' | 'splash'
  /** Centre along the route. */
  s: number
  x: number
  z: number
  /** Unit vector along the channel (the road's left normal at the crossing). */
  ux: number
  uz: number
  /** Half width of the channel, measured along the road. */
  hw: number
  /** How far the channel runs either side of the road. */
  len: number
  /** Water level every STEP metres from -len to +len along the channel. */
  level: Float32Array
  /** Channel floor below the water. */
  depth: number
}

export interface GroundSample {
  /** `mesh()` at this point. */
  mesh: number
  /** Distance to the nearest road centreline (999 when far away). */
  dist: number
  water: number | null
  /** Lake level only (no streams), for the lake sheets. */
  lake: number | null
  /** Height of the nearest road, if within reach. */
  roadY: number | null
}

export interface Ground {
  /** Height of the surface the car drives on (road or terrain). */
  height(x: number, z: number): number
  /** Natural terrain only, ignoring the road ribbon; channels and lake basins included. */
  natural(x: number, z: number): number
  /**
   * Height of a terrain mesh vertex at (x, z): the drivable height pushed a
   * little under the road ribbon so it never pokes through, and the gorge
   * floor rather than the deck under a bridge. Every terrain mesh and every
   * prop placement goes through this, so props sit on what is drawn.
   */
  mesh?(x: number, z: number): number
  /** Everything a terrain mesh vertex needs, for the price of one nearest-road search. */
  sample?(x: number, z: number): GroundSample
  /** Lake or stream surface height if (x, z) is open water, else null. */
  water(x: number, z: number): number | null
  /** Lake surface only, without streams (they get their own water). */
  lake?(x: number, z: number): number | null
  /** Where the drivable edge is, from the centreline. */
  readonly edge: number
  /** How far from the centreline the car may go at distance s: verges are drivable, forest and bridges are not. */
  limitAt(s: number): number
  /** Narrow sections: walls or rails right at the road edge on both sides. */
  narrowAt?(s: number): boolean
  readonly crossings?: readonly Crossing[]
  readonly route: Route
}

/** Ridged multifractal: sharp crests where plain noise has round hills. */
function ridged(n: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  let v = 0, a = 0.5, f = 1, w = 1
  for (let o = 0; o < oct; o++) {
    let s = 1 - Math.abs(n(x * f, y * f))
    s *= s * w
    // Each octave is weighted by the one before, so detail gathers on the ridges and the valleys stay smooth: an eroded look.
    w = clamp(s * 1.6, 0, 1)
    v += s * a
    a *= 0.5
    f *= 2.07
  }
  return v
}

/**
 * One height function shared by physics, terrain meshes and scenery placement,
 * so the car, the ground you see and the trees all agree on where "the ground" is.
 */
/** The full ground the stage builder makes; test doubles only implement what physics needs. */
export type Land = Required<Ground>

export function asLand(g: Ground): Land {
  if (!g.mesh || !g.sample || !g.lake || !g.narrowAt || !g.crossings) throw new Error('not a stage ground')
  return g as Land
}

export function makeGround(route: Route, rally: RallyDef, seed: number): Land {
  const rel = rally.relief
  const n = noise2(seed * 31 + 7)
  const sideN = noise2(seed * 17 + 5)
  // The same field the road's elevation was drawn from: far from the road the
  // land returns to it, so distant hills and the road agree on the lie of the land.
  const landN = noise2(seed * 7 + 3)
  const ridgeN = noise2(seed * 13 + 9)
  const peakN = noise2(seed * 3 + 1)
  const edge = route.half + rally.edge.shoulder
  // Regional character: mountain roads hang on steep valley sides, plains roll gently.
  const STEEP = ['alpine', 'andes', 'japan', 'wales'].includes(rally.biome) ? 1.7 : rally.biome === 'savannah' || rally.biome === 'nordic' ? 0.6 : 1
  const MOUNTAIN = ['alpine', 'andes', 'japan'].includes(rally.biome) ? 1 : ['wales', 'med', 'iberia'].includes(rally.biome) ? 0.55 : 0.2
  const TERRACED = rally.biome === 'med' || rally.biome === 'iberia' || rally.biome === 'andes'
  const hard = rally.edge.up === 'rockwall' || rally.edge.up === 'mosswall' || rally.edge.down === 'rail' || rally.edge.up === 'snowbank'
  const limit = edge + (hard ? 0.4 : 5)
  const ridgeAmp = Math.min(26, rel.amp * 0.14) * (0.5 + MOUNTAIN)
  const peakAmp = rel.amp * 1.1 * MOUNTAIN + 12

  /** The open landscape, independent of the road. */
  const land = (x: number, z: number): number => {
    let h = fbm2(landN, x / rel.scale, z / rel.scale, 4) * rel.amp + (rally.style.rhythm ? landTrend(rel, z) : 0)
    // Ridges and side valleys at a few hundred metres, eroded detail on their flanks.
    h += (ridged(ridgeN, x / 210, z / 210, 4) - 0.32) * ridgeAmp * 2
    // Big masses further out: the mountains the stage winds between.
    const pk = ridged(peakN, x / 900 + 3.1, z / 900, 3)
    h += Math.max(0, pk - 0.25) * peakAmp * 1.6
    return h
  }

  /** The land as seen from one leg of road: its height, its hillside, its ditch. */
  const fromLeg = (x: number, z: number, off: number, roadY: number, slope: number, terraces: number): number => {
    // The road is cut into a hillside whose fall line changes slowly along the
    // stage: one side climbs (rock walls, banks), the other drops away. The
    // slope eases off with distance, where the open landscape takes over.
    // Steep beside the road, easing off further out where neighbouring legs and the open land take over.
    const sat = 60 * Math.log1p(off / 60) * (1 - 0.45 * smoothstep(40, 180, off))
    let side = slope * sat
    // Mediterranean and Andean hillsides are farmed in terraces.
    // Only on the hillside beside the road: far out, terraces would stack into cliffs.
    if (TERRACED && terraces > 0 && Math.abs(side) > 1.5 && off < 90) {
      const t = Math.sign(side) * (Math.floor(Math.abs(side) / 2.6) * 2.6 + smoothstep(0.75, 1, (Math.abs(side) / 2.6) % 1) * 2.6)
      side = t + (side - t) * (1 - (1 - smoothstep(50, 90, off)) * terraces)
    }
    const rough = fbm2(n, x / 90, z / 90, 4) * Math.min(14, rel.amp * 0.08) * smoothstep(0, 40, off)
    // Hummocks and hollows at a few metres, only away from the verge.
    const fine = fbm2(n, x / 23 + 11, z / 23, 2) * Math.min(1.6, 0.35 + rel.amp * 0.008) * smoothstep(6, 26, off)
    const ditch = -0.45 * smoothstep(0, 1.5, off) * (1 - smoothstep(2.5, 6, off))
    const near = roadY + side + rough + fine + ditch - 0.06
    // Ridges come up gradually beside the road; far out the land is all its own.
    const ridgeNear = (ridged(ridgeN, x / 210, z / 210, 4) - 0.32) * ridgeAmp * 2 * smoothstep(25, 120, off) * 0.6
    const w = smoothstep(70, LAND_REACH - 40, off)
    let h = w > 0 ? near + ridgeNear + (land(x, z) - near - ridgeNear) * w : near + ridgeNear
    // Lakes: basins in the low, flat country, well back from the road.
    const lk = lake(x, z, off)
    if (lk > 0) h = h * (1 - lk) + (roadY - 3.2) * lk
    return h
  }

  // The hillside's fall at every sample along the road, signed for the left side.
  const fallAt = new Float32Array(route.n)
  for (let i = 0; i < route.n; i++) fallAt[i] = sideN((i * STEP) / 400, 0.3) * rel.side * 0.42 * STEEP

  /**
   * The road as the land beside a point sees it: its height and the signed
   * slope of the hillside it is cut into. Right beside the road that is just
   * the nearest point; further out it is averaged over every stretch of road
   * within a few metres (more further out) of the nearest, so where two legs meet (hairpins,
   * ladders, a bend sweeping round) the land is blended between them instead
   * of jumping by their difference in height, a cliff in the middle of a field.
   */
  const roadAround = (x: number, z: number, c: Closest): { y: number; slope: number; terraces: number } => {
    const y0 = c.y, s0 = Math.sign(c.d) * (fallAt[c.i] + (fallAt[Math.min(route.n - 1, c.i + 1)] - fallAt[c.i]) * c.t)
    const a = smoothstep(edge + 1, edge + 4, c.dist)
    if (a <= 0 || c.dist > LAND_REACH - 30) return { y: y0, slope: s0, terraces: 1 }
    let wy = 0, wyy = 0, ws = 0, wsum = 0
    // Narrow beside the road, so a verge never leans toward the next leg; wider out in the fields.
    const blend = 8 + c.dist * 0.6
    route.forEachNear(x, z, c.dist + blend, (i, t, d, side) => {
      const w = 1 - smoothstep(0, blend, d - c.dist)
      if (w <= 0) return
      const j = Math.min(route.n - 1, i + 1)
      const ry = route.y[i] + (route.y[j] - route.y[i]) * t
      wy += w * ry
      wyy += w * ry * ry
      ws += w * Math.sign(side) * (fallAt[i] + (fallAt[j] - fallAt[i]) * t)
      wsum += w
    })
    if (wsum <= 0) return { y: y0, slope: s0, terraces: 1 }
    // Where legs at different heights are being blended, the hillside is a
    // bank between them; terraces there would stack into a cliff.
    const my = wy / wsum
    const spread = Math.sqrt(Math.max(0, wyy / wsum - my * my))
    return { y: y0 + (my - y0) * a, slope: s0 + (ws / wsum - s0) * a, terraces: 1 - smoothstep(0.4, 1.5, spread * a) }
  }

  const natural0 = (x: number, z: number, c: Closest | null): number => {
    if (!c) return land(x, z)
    const r = roadAround(x, z, c)
    return fromLeg(x, z, Math.max(0, c.dist - edge), r.y, r.slope, r.terraces)
  }

  const lakeN = noise2(seed * 5 + 11)
  const LAKE_T = -0.42 + rally.water.lakes * 0.07
  /** 0 on land, rising to 1 in the middle of a lake. */
  const lake = (x: number, z: number, off: number): number => {
    if (!rally.water.lakes || off < 16 || off > 280) return 0
    const v = fbm2(lakeN, x / 360, z / 360, 3)
    return smoothstep(LAKE_T, LAKE_T - 0.1, v) * smoothstep(16, 30, off) * smoothstep(280, 230, off)
  }

  // A coarse map of how far each 64 m cell is from the road, so the far
  // terrain (most of the map) skips the nearest-road search entirely: a
  // search that finds nothing has to scan every ring out to its limit.
  const CG = 64
  const coarse = new Map<number, number>()
  for (let i = 0; i < route.n; i += 8) {
    const x = route.x[i], z = route.z[i], R = LAND_REACH + CG
    for (let gx = Math.floor((x - R) / CG); gx <= Math.floor((x + R) / CG); gx++)
      for (let gz = Math.floor((z - R) / CG); gz <= Math.floor((z + R) / CG); gz++) {
        const d = Math.hypot(Math.max(0, Math.abs(x - (gx + 0.5) * CG) - CG / 2), Math.max(0, Math.abs(z - (gz + 0.5) * CG) - CG / 2))
        const k = (gx + 32768) * 65536 + (gz + 32768)
        const old = coarse.get(k)
        if (old === undefined || d < old) coarse.set(k, d)
      }
  }
  const closest = (x: number, z: number): Closest | null => {
    // Samples are 16 m apart, so the true distance is at most 8 m less than the coarse one.
    const d = coarse.get((Math.floor(x / CG) + 32768) * 65536 + (Math.floor(z / CG) + 32768))
    if (d === undefined || d > LAND_REACH + 8) return null
    return route.closest(x, z, LAND_REACH)
  }
  const crossings = makeCrossings(route, edge, (x, z) => natural0(x, z, closest(x, z)))

  /** Channel carve at (x, z): how far into the channel (0..1), its floor and water level. */
  const channel = (x: number, z: number): { p: number; floor: number; level: number; cr: Crossing } | null => {
    for (const cr of crossings) {
      const dx = x - cr.x, dz = z - cr.z
      const u = dx * cr.ux + dz * cr.uz
      if (Math.abs(u) > cr.len) continue
      const v = -dx * cr.uz + dz * cr.ux
      if (Math.abs(v) > cr.hw) continue
      const p = smoothstep(cr.hw, cr.hw * 0.35, Math.abs(v)) * smoothstep(cr.len, cr.len - 10, Math.abs(u))
      if (p <= 0) continue
      const f = clamp((u + cr.len) / STEP, 0, cr.level.length - 1.0001)
      const i = Math.floor(f)
      const level = cr.level[i] + (cr.level[i + 1] - cr.level[i]) * (f - i)
      return { p, floor: level - cr.depth, level, cr }
    }
    return null
  }

  const naturalAt = (x: number, z: number, c: Closest | null): number => {
    let h = natural0(x, z, c)
    const ch = channel(x, z)
    if (ch) h = Math.min(h, h + (ch.floor - h) * ch.p)
    return h
  }

  const heightAt = (x: number, z: number, c: Closest | null): number => {
    if (!c) return naturalAt(x, z, c)
    const nat = c.dist > edge || route.featureAt(c.s, 'bridge') ? naturalAt(x, z, c) : 0
    let h: number
    if (c.dist <= edge) {
      h = c.y
    } else {
      const t = smoothstep(edge, edge + 3, c.dist)
      h = c.y * (1 - t) + nat * t
    }
    // Beside a bridge deck the ground falls away into the gorge.
    if (c.dist > route.half + 0.8 && route.featureAt(c.s, 'bridge')) h = Math.min(h, nat)
    const splash = route.featureAt(c.s, 'splash')
    if (splash) {
      const u = Math.min(c.s - splash.s0, splash.s1 - c.s)
      h -= 0.3 * smoothstep(0, 6, u)
    }
    return h
  }

  const height = (x: number, z: number): number => heightAt(x, z, closest(x, z))
  const natural = (x: number, z: number): number => naturalAt(x, z, closest(x, z))
  const meshAt = (x: number, z: number, c: Closest | null): number => {
    let h = heightAt(x, z, c)
    if (!c) return h
    // Under the road ribbon the terrain is pushed down so it can never
    // poke through the surface between grid points.
    if (c.dist < edge + 0.6) h -= 0.35
    // Under a bridge the mesh is the gorge floor; the deck is its own model.
    if (route.featureAt(c.s, 'bridge')) h = Math.min(h, naturalAt(x, z, c))
    return h
  }
  const waterAt = (x: number, z: number, c: Closest | null): number | null => {
    const ch = channel(x, z)
    if (ch && ch.p > 0.3 && (!c || c.dist > route.half + 0.5 || route.featureAt(c.s, 'bridge'))) return ch.level
    if (!c) return null
    return lake(x, z, c.dist - edge) > 0.35 ? roadAround(x, z, c).y - 1.6 : null
  }
  const mesh = (x: number, z: number): number => meshAt(x, z, closest(x, z))
  const water = (x: number, z: number): number | null => waterAt(x, z, closest(x, z))
  const lakeLevel = (x: number, z: number): number | null => {
    const c = closest(x, z)
    return c && lake(x, z, c.dist - edge) > 0.35 ? roadAround(x, z, c).y - 1.6 : null
  }
  const sample = (x: number, z: number): GroundSample => {
    const c = closest(x, z)
    const lk = c && lake(x, z, c.dist - edge) > 0.35 ? roadAround(x, z, c).y - 1.6 : null
    return { mesh: meshAt(x, z, c), dist: c ? c.dist : 999, water: waterAt(x, z, c), lake: lk, roadY: c ? c.y : null }
  }

  const narrow = new Uint8Array(route.n)
  for (const nr of route.narrow) for (let i = Math.max(0, Math.floor(nr.s0 / STEP)); i <= Math.min(route.n - 1, Math.ceil(nr.s1 / STEP)); i++) narrow[i] = 1
  const narrowAt = (s: number): boolean => narrow[Math.min(route.n - 1, Math.max(0, Math.round(s / STEP)))] === 1

  // Where another leg of road runs close (hairpins, switchbacks), the verge
  // between them is split down the middle: the car can't cut across, and
  // posts and rails for one leg never stand in the other's drivable strip.
  const near = new Float32Array(route.n)
  for (let i = 0; i < route.n; i++) near[i] = route.otherLeg(i, 30, 2 * (limit + BODY) + 4)
  const legLimit = (s: number): number => {
    const i = Math.min(route.n - 1, Math.max(0, Math.round(s / STEP)))
    let m = Infinity
    for (let k = Math.max(0, i - 3); k <= Math.min(route.n - 1, i + 3); k++) m = Math.min(m, near[k])
    // In a narrow section the walls stand just off the tarmac.
    const own = narrow[i] ? route.half + 0.3 : limit
    return Math.max(route.half + 0.3, Math.min(own, m / 2 - BODY - 0.4))
  }
  // On a bridge the parapets stand just outside the road edge.
  const limitAt = (s: number): number => (route.featureAt(s, 'bridge') ? route.half + 0.3 - BODY : legLimit(s))

  return { height, natural, mesh, sample, water, lake: lakeLevel, edge, limitAt, narrowAt, crossings, route }
}

/**
 * Lays out the channel for every bridge and ford: straight across the road,
 * stopping short of any other leg of road, its water following the land.
 */
function makeCrossings(route: Route, edge: number, nat: (x: number, z: number) => number): Crossing[] {
  const out: Crossing[] = []
  for (const f of route.features) {
    if (f.kind !== 'bridge' && f.kind !== 'splash') continue
    const s = (f.s0 + f.s1) / 2
    const a = route.at(s)
    const ux = Math.cos(a.heading), uz = -Math.sin(a.heading)
    const bridge = f.kind === 'bridge'
    const hw = bridge ? (f.s1 - f.s0) / 2 - 2.5 : (f.s1 - f.s0) / 2 + 2
    // Run outward until the channel would come near another stretch of road.
    let len = 0
    const maxLen = bridge ? 110 : 80
    for (const side of [1, -1]) {
      let l = 0
      while (l < maxLen) {
        const t = l + 4
        let blocked = false
        for (const v of [-hw, 0, hw]) {
          const x = a.x + ux * t * side - uz * v, z = a.z + uz * t * side + ux * v
          const c = route.closest(x, z, 40)
          if (c && Math.abs(c.s - s) > 40 && c.dist < edge + 22) blocked = true
        }
        if (blocked) break
        l = t
      }
      len = side === 1 ? l : Math.min(len, l)
    }
    if (len < edge + 12) len = edge + 12
    const roadY = a.y
    const cnt = Math.floor((2 * len) / STEP) + 1
    const level = new Float32Array(cnt)
    for (let k = 0; k < cnt; k++) {
      const u = -len + k * STEP
      const x = a.x + ux * u, z = a.z + uz * u
      // The lowest of the land across the channel: the water never stands above either bank.
      const ground = Math.min(nat(x, z), nat(x - uz * hw * 0.75, z + ux * hw * 0.75), nat(x + uz * hw * 0.75, z - ux * hw * 0.75))
      const w = bridge ? smoothstep(edge + 4, edge + 30, Math.abs(u)) : smoothstep(edge + 2, edge + 20, Math.abs(u))
      level[k] = bridge ? roadY - 5.5 + (ground - 4.5 - (roadY - 5.5)) * w : roadY - 0.12 + (ground - 0.35 - (roadY - 0.12)) * w
      // Never above the road it passes under, wherever it is near it.
      if (Math.abs(u) < edge + 6) level[k] = Math.min(level[k], bridge ? roadY - 5.5 : roadY - 0.12)
      // Nor above any road it comes close to further out, where the road
      // bends back alongside the stream: there it runs in a ditch below it.
      for (const v of [-hw, -hw / 2, 0, hw / 2, hw]) {
        const c = route.closest(x - uz * v, z + ux * v, edge + 10)
        if (!c || c.dist > edge + 8) continue
        const atFord = !bridge && Math.abs(c.s - s) < hw + 4 && c.dist < edge
        if (!atFord) level[k] = Math.min(level[k], c.y - (bridge ? 5.5 : 0.5))
      }
    }
    // A river runs on through the gorge at an even fall: never a flat pool
    // under the deck that tips over a waterfall just downstream of it.
    if (bridge) {
      const span = Math.min(30, len - 2)
      const k0 = Math.round((len - span) / STEP), k1 = Math.round((len + span) / STEP)
      for (let k = k0 + 1; k < k1; k++) level[k] = Math.min(level[k], level[k0] + ((level[k1] - level[k0]) * (k - k0)) / (k1 - k0))
    }
    out.push({ kind: f.kind, s, x: a.x, z: a.z, ux, uz, hw, len, level, depth: bridge ? 1.6 : 0.55 })
  }
  return out
}

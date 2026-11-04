import { fbm2, rng, smoothstep } from '../core/math'
import type { RallyDef } from '../data'
import { paceNotes } from '../game/pacenotes'
import type { Route } from '../sim/route'
import { BODY, type Ground } from '../sim/terrain'
import { crownRadius, FOOTPRINT } from './props'

export const TILE = 64

export type PlacedKind = 'tree' | 'rock' | 'shrub' | 'house' | 'tuft' | 'flowers' | 'spectator' | 'board'

/** One thing to put in the world. Solid kinds carry the radius they need clear of the road. */
export interface Placed {
  kind: PlacedKind
  sub: string
  x: number
  z: number
  /** Footprint radius; 0 for soft things the car may pass through. */
  r: number
  yaw: number
  size: number
  seed: number
}

export interface PlanCtx {
  route: Route
  ground: Ground
  rally: RallyDef
  seed: number
  noise: (x: number, y: number) => number
  snowAll: boolean
}

/**
 * The single rule for anything solid: its whole footprint must sit beyond
 * where the car can ever be, plus a margin. Uses the true nearest leg of road,
 * so a tree between two legs of a hairpin is checked against both.
 */
export function clearOfRoad(ctx: PlanCtx, x: number, z: number, r: number, margin = 1.2): { ok: boolean; s: number; d: number } {
  const c = ctx.route.closest(x, z, 600)
  if (!c) return { ok: true, s: 0, d: 999 }
  return { ok: c.dist - r > ctx.ground.limitAt(c.s) + BODY + margin, s: c.s, d: c.dist }
}

export function planTile(ctx: PlanCtx, cx: number, cz: number, key: number, density: number): Placed[] {
  const out: Placed[] = []
  const { rally, route, ground } = ctx
  const r = rng(key ^ ctx.seed)
  const area = TILE * TILE
  const kinds = Object.entries(rally.trees.mix).filter(([, w]) => w > 0)
  const wsum = kinds.reduce((a, [, w]) => a + w, 0)
  const pick = (): string => {
    let x = r() * wsum
    for (const [k, w] of kinds) if ((x -= w) <= 0) return k
    return kinds[0][0]
  }
  const rand = () => (cx + (r() - 0.5) * TILE)
  const randZ = () => (cz + (r() - 0.5) * TILE)
  const trees = Math.round((area / 90) * rally.trees.density * density)
  for (let i = 0; i < trees; i++) {
    const x = rand(), z = randZ()
    const sub = pick()
    const size = 0.85 + r() * 0.35
    const rad = crownRadius(sub, size)
    const cl = clearOfRoad(ctx, x, z, rad)
    if (!cl.ok) continue
    // Thinner right next to the road, so the view opens up.
    if (r() > rally.trees.near + smoothstep(10, 40, cl.d) * (1 - rally.trees.near)) continue
    // Clumps: skip where the low-frequency noise says "meadow".
    if (fbm2(ctx.noise, x / 70, z / 70, 2) < -0.15 && r() < 0.7) continue
    out.push({ kind: 'tree', sub, x, z, r: rad, yaw: 0, size, seed: (r() * 1e9) | 0 })
  }
  const rocks = Math.round((area / 900) * rally.rocks * density)
  for (let i = 0; i < rocks; i++) {
    const x = rand(), z = randZ()
    const size = 0.5 + r() * 1.4
    // A rock's footprint is its widest stretched radius.
    if (!clearOfRoad(ctx, x, z, size * 1.3).ok) continue
    out.push({ kind: 'rock', sub: r() < 0.5 ? 'a' : 'b', x, z, r: size * 1.3, yaw: 0, size, seed: (r() * 1e9) | 0 })
  }
  const bushes = Math.round((area / 500) * rally.bushes * density)
  const bush = rally.biome === 'savannah' ? 'thornbush' : rally.biome === 'andes' ? 'pampas' : 'macchia'
  for (let i = 0; i < bushes; i++) {
    const x = rand(), z = randZ()
    const rad = crownRadius(bush, 0.7)
    if (!clearOfRoad(ctx, x, z, rad).ok) continue
    out.push({ kind: 'shrub', sub: bush, x, z, r: rad, yaw: 0, size: 0.7, seed: (r() * 1e9) | 0 })
  }
  // Grass and flowers may sit on the drivable verge: they are soft.
  if (rally.grass > 0 && !ctx.snowAll) {
    const tufts = Math.round((area / 60) * rally.grass * density)
    for (let i = 0; i < tufts; i++) {
      const x = rand(), z = randZ()
      const c = route.closest(x, z, 300)
      if (c && c.dist < ground.edge + 0.8) continue
      const flowers = r() < 0.12 && fbm2(ctx.noise, x / 25, z / 25, 2) > 0.1
      out.push({ kind: flowers ? 'flowers' : 'tuft', sub: r() < 0.5 ? 'a' : 'b', x, z, r: 0, yaw: 0, size: 1, seed: (r() * 1e9) | 0 })
    }
  }
  // A farmhouse now and then, set back from the road and facing it.
  if (r() < 0.12 * density) {
    const x = cx + (r() - 0.5) * TILE * 0.6, z = cz + (r() - 0.5) * TILE * 0.6
    const cl = clearOfRoad(ctx, x, z, FOOTPRINT.house)
    if (cl.ok && cl.d < 60) {
      const a = route.at(cl.s)
      out.push({ kind: 'house', sub: rally.houses, x, z, r: FOOTPRINT.house, yaw: a.heading + (r() < 0.5 ? 0 : Math.PI), size: 1, seed: (r() * 1e9) | 0 })
    }
  }
  return out
}

/** Chevron boards before tight corners and the crowds that gather at the good spots. */
export function planSegment(ctx: PlanCtx, s0: number, s1: number, segIdx: number, start: number, finish: number, density: number): Placed[] {
  const out: Placed[] = []
  const { route, ground, rally } = ctx
  const r = rng(segIdx * 7919 + ctx.seed)
  for (const note of paceNotes(route, start, finish)) {
    if (note.s < s0 || note.s >= s1) continue
    if (note.kind === 'corner' && note.grade <= 2) {
      for (let k = 0; k < 4; k++) {
        const s = note.s + k * 7
        const a = route.at(s)
        // Outside of the bend as it is *here*: a run of boards can reach into the next corner.
        const outside = a.curv > 0 ? -1 : 1
        const lim = ground.limitAt(s) + BODY + 0.6
        const lx = Math.cos(a.heading) * outside, lz = -Math.sin(a.heading) * outside
        const x = a.x + lx * lim, z = a.z + lz * lim
        if (!clearOfRoad(ctx, x, z, 0.45, 0.1).ok) continue
        out.push({ kind: 'board', sub: k % 2 ? 'y' : 'k', x, z, r: 0.45, yaw: a.heading + Math.PI, size: 1, seed: k })
      }
    }
    if ((note.kind === 'corner' && note.grade <= 2 && r() < rally.spectators * 0.55) || (note.kind === 'jump' && r() < 0.9)) {
      // Fans stand on the inside of the corner, set back from the road.
      const inside = note.kind === 'corner' ? (note.dir === 'left' ? 1 : -1) : r() < 0.5 ? 1 : -1
      const count = 6 + Math.floor(r() * 12 * density)
      for (let k = 0; k < count; k++) {
        const s = note.s + (r() - 0.3) * 30
        const a = route.at(s)
        const off = ground.limitAt(s) + BODY + 3 + r() * 6
        const lx = Math.cos(a.heading) * inside, lz = -Math.sin(a.heading) * inside
        const x = a.x + lx * off, z = a.z + lz * off
        if (!clearOfRoad(ctx, x, z, FOOTPRINT.spectator).ok) continue
        out.push({ kind: 'spectator', sub: '', x, z, r: FOOTPRINT.spectator, yaw: Math.atan2(a.x - x, a.z - z), size: 1, seed: (r() * 1e9) | 0 })
      }
    }
  }
  return out
}

/**
 * Where a rail, wall or marker post goes beside the road at s, or null where
 * it can't stand: on the inside of a bend tighter than the verge, a point
 * straight out from the road lands nearer a later part of the same bend.
 */
export function edgePoint(ctx: PlanCtx, s: number, side: 1 | -1): { x: number; z: number; off: number } | null {
  const a = ctx.route.at(s)
  const off = ctx.ground.limitAt(s) + BODY + 0.05
  const x = a.x + Math.cos(a.heading) * side * off, z = a.z - Math.sin(a.heading) * side * off
  const c = ctx.route.closest(x, z, 400)
  if (c && c.dist < ctx.ground.limitAt(c.s) + BODY - 0.05) return null
  return { x, z, off }
}

import type { Route } from '../sim/route'
import type { Land } from '../sim/terrain'

/** Terrain tile size, metres. Tiles sit on a world grid so nothing overlaps itself on hairpins. */
export const TILE = 64

/**
 * Which diagonal a terrain quad is split along: the one that follows the
 * ground better. Shared by the mesh builder and by `triHeight`, so a height
 * read back from the surface is the height of the triangle that is drawn.
 */
export function splitAD(a: number, b: number, c: number, d: number): boolean {
  return Math.abs(a - d) < Math.abs(b - c)
}

/**
 * Height inside one quad of a terrain grid, on the triangle the renderer
 * draws. Corners: a (0,0), b (+x), c (+z), d (+x,+z); fx, fz in 0..1.
 */
export function triHeight(a: number, b: number, c: number, d: number, fx: number, fz: number): number {
  if (splitAD(a, b, c, d)) return fz >= fx ? a + (d - c) * fx + (c - a) * fz : a + (b - a) * fx + (d - b) * fz
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)
}

/**
 * The ground exactly as drawn. The ground function is smooth; the mesh is
 * triangles between grid vertices, and on a slope or a bank the two differ by
 * tens of centimetres, which is what left trees and posts hovering. Everything
 * placed in the world asks this instead, so it stands on what you see.
 */
export class Surface {
  private readonly cache = new Map<number, number>()

  /** `resAt` gives the grid spacing of the tile at grid cell (gx, gz). */
  constructor(private readonly land: Land, private readonly resAt: (gx: number, gz: number) => number) {}

  /** Mesh vertex height; vertices are always whole metres, so they key a cache exactly. */
  vertex(x: number, z: number): number {
    const k = (Math.round(x) + 131072) * 262144 + (Math.round(z) + 131072)
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    if (this.cache.size > 400000) this.cache.clear()
    const h = this.land.mesh(x, z)
    this.cache.set(k, h)
    return h
  }

  /** Lets a tile that has just sampled its grid share the values. */
  remember(x: number, z: number, h: number): void {
    if (this.cache.size > 400000) this.cache.clear()
    this.cache.set((Math.round(x) + 131072) * 262144 + (Math.round(z) + 131072), h)
  }

  /** Height of the drawn terrain at (x, z). */
  height(x: number, z: number): number {
    const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE)
    const res = this.resAt(gx, gz)
    const x0 = gx * TILE, z0 = gz * TILE
    const cells = TILE / res
    const i = Math.min(cells - 1, Math.max(0, Math.floor((x - x0) / res)))
    const j = Math.min(cells - 1, Math.max(0, Math.floor((z - z0) / res)))
    const ax = x0 + i * res, az = z0 + j * res
    return triHeight(this.vertex(ax, az), this.vertex(ax + res, az), this.vertex(ax, az + res), this.vertex(ax + res, az + res), (x - ax) / res, (z - az) / res)
  }

  /** Lowest drawn ground under a round footprint: where a base has to reach down to. */
  low(x: number, z: number, r: number): number {
    let m = this.height(x, z)
    if (r <= 0) return m
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      m = Math.min(m, this.height(x + Math.cos(a) * r, z + Math.sin(a) * r))
    }
    return m
  }

  /** Highest drawn ground under a round footprint. */
  high(x: number, z: number, r: number): number {
    let m = this.height(x, z)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      m = Math.max(m, this.height(x + Math.cos(a) * r, z + Math.sin(a) * r))
    }
    return m
  }
}

/** Grid spacing of the far terrain, and of anywhere no detailed tile is planned. */
export const FAR_RES = 16

/** Detailed terrain tiles exist this far either side of the road. */
export const NEAR_REACH = 150

/**
 * Every detailed tile along a road and its grid spacing, from how close it
 * comes to the road: finest where you drive past it, coarse at the back of
 * the corridor. Keyed like the world's tile map.
 */
export function planTileRes(route: Route, edge: number, res: readonly [number, number, number]): Map<number, number> {
  const out = new Map<number, number>()
  for (let i = 0; i < route.n; i += 4) {
    const x = route.x[i], z = route.z[i]
    for (let gx = Math.floor((x - NEAR_REACH) / TILE); gx <= Math.floor((x + NEAR_REACH) / TILE); gx++)
      for (let gz = Math.floor((z - NEAR_REACH) / TILE); gz <= Math.floor((z + NEAR_REACH) / TILE); gz++) {
        const key = (gx + 32768) * 65536 + (gz + 32768)
        // Distance from this road sample to the tile's square.
        const d = Math.hypot(Math.max(0, Math.abs(x - (gx + 0.5) * TILE) - TILE / 2), Math.max(0, Math.abs(z - (gz + 0.5) * TILE) - TILE / 2))
        const r = d < edge + 14 ? res[0] : d < 70 ? res[1] : res[2]
        const old = out.get(key)
        if (old === undefined || r < old) out.set(key, r)
      }
  }
  return out
}

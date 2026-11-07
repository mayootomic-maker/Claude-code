import { STEP } from '../sim/route'
import type { Crossing, Ground } from '../sim/terrain'
import { splitAD } from './surface'

/** How far below the nearest road the water must stay, everywhere. */
export const LAKE_BELOW_ROAD = 1.2

/**
 * A stream or river crossing the road: a strip down the middle of its
 * channel at the channel's own level, following the land downhill on either
 * side. Its outer edges fade out and tuck just under the drawn bank, so the
 * water never hangs over ground that falls away.
 */
export function streamSurface(cr: Crossing, ground: (x: number, z: number) => number): { pos: Float32Array; uv: Float32Array; col: Float32Array; idx: number[] } {
  const pts: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
  const w = cr.hw * 0.72
  const across = [-w, -w * 0.55, 0, w * 0.55, w]
  for (let k = 0; k < cr.level.length; k += 2) {
    const u = -cr.len + k * STEP
    const lvl = cr.level[k]
    const end = Math.min(1, (cr.len - Math.abs(u)) / 10)
    for (const v of across) {
      const x = cr.x + cr.ux * u - cr.uz * v, z = cr.z + cr.uz * u + cr.ux * v
      // Faded vertices (the banks and the two tails) tuck under the ground;
      // the rest stay within the channel's depth of it.
      const fade = Math.abs(v) === w || end <= 0
      const g = ground(x, z)
      pts.push(x, fade ? Math.min(lvl, g - 0.05) : Math.min(lvl, g + cr.depth), z)
      uv.push(x / 6, z / 6)
      col.push(1, 1, 1, fade ? 0 : 0.9 * end)
    }
    const row = pts.length / 3 / across.length - 1
    // Wound so the front face is up: across (+v) then along (+u).
    if (row > 0)
      for (let j = 0; j < across.length - 1; j++) {
        const p = (row - 1) * across.length + j, q = row * across.length + j
        idx.push(p, p + 1, q, p + 1, q + 1, q)
      }
  }
  return { pos: new Float32Array(pts), uv: new Float32Array(uv), col: new Float32Array(col), idx }
}

/**
 * The water surface for one terrain tile: only the grid cells that touch a
 * lake, each vertex at its own lake's level. Shore vertices sink just under
 * the ground so the sheet ends inside the bank instead of hanging in the air.
 * A single flat sheet over the whole tile, as before, flooded the road
 * wherever it ran downhill through a tile with a lake in it.
 */
export function lakeSurface(ground: Ground, x0: number, z0: number, n: number, res: number, mesh?: Float32Array): { pos: Float32Array; uv: Float32Array; col: Float32Array; idx: number[] } | null {
  const lvl = new Float32Array(n * n)
  const wet = new Uint8Array(n * n)
  let any = false
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + i * res, z = z0 + j * res
      const w = (ground.lake ?? ground.water)(x, z)
      const k = j * n + i
      if (w !== null) {
        wet[k] = 1
        any = true
      }
      const c = ground.route.closest(x, z, 600)
      const cap = c ? c.y - LAKE_BELOW_ROAD : Infinity
      // Shore vertices sit under the drawn ground (the tile's own heights when given).
      lvl[k] = Math.min(cap, w ?? (mesh ? mesh[k] : ground.height(x, z)) - 0.4)
    }
  if (!any) return null
  const idx: number[] = []
  const used = new Uint8Array(n * n)
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1
      if (!(wet[a] | wet[b] | wet[c] | wet[d])) continue
      // Split like the terrain under it, so a shore triangle never crosses above the bank.
      if (mesh && splitAD(mesh[a], mesh[b], mesh[c], mesh[d])) idx.push(a, c, d, a, d, b)
      else idx.push(a, c, b, b, c, d)
      used[a] = used[b] = used[c] = used[d] = 1
    }
  // Compact to the vertices actually used.
  const remap = new Int32Array(n * n).fill(-1)
  const pos: number[] = [], uv: number[] = [], col: number[] = []
  for (let k = 0; k < n * n; k++)
    if (used[k]) {
      remap[k] = pos.length / 3
      const x = x0 + (k % n) * res, z = z0 + Math.floor(k / n) * res
      pos.push(x, lvl[k], z)
      uv.push(x / 9, z / 9)
      // Open water is nearly opaque; the shore vertices fade it out.
      col.push(1, 1, 1, wet[k] ? 0.93 : 0)
    }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), col: new Float32Array(col), idx: idx.map((k) => remap[k]) }
}

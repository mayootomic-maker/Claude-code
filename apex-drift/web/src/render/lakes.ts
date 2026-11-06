import type { Ground } from '../sim/terrain'

/** How far below the nearest road the water must stay, everywhere. */
export const LAKE_BELOW_ROAD = 1.2

/**
 * The water surface for one terrain tile: only the grid cells that touch a
 * lake, each vertex at its own lake's level. Shore vertices sink just under
 * the ground so the sheet ends inside the bank instead of hanging in the air.
 * A single flat sheet over the whole tile, as before, flooded the road
 * wherever it ran downhill through a tile with a lake in it.
 */
export function lakeSurface(ground: Ground, x0: number, z0: number, n: number, res: number): { pos: Float32Array; uv: Float32Array; col: Float32Array; idx: number[] } | null {
  const lvl = new Float32Array(n * n)
  const wet = new Uint8Array(n * n)
  let any = false
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + i * res, z = z0 + j * res
      const w = ground.water(x, z)
      const k = j * n + i
      if (w !== null) {
        wet[k] = 1
        any = true
      }
      const c = ground.route.closest(x, z, 600)
      const cap = c ? c.y - LAKE_BELOW_ROAD : Infinity
      lvl[k] = Math.min(cap, w ?? ground.height(x, z) - 0.4)
    }
  if (!any) return null
  const idx: number[] = []
  const used = new Uint8Array(n * n)
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1
      if (!(wet[a] | wet[b] | wet[c] | wet[d])) continue
      idx.push(a, c, b, b, c, d)
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

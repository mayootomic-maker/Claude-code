import * as THREE from 'three'
import { CardBuilder, GeoBuilder, PRIM } from './builder'

type R = () => number

/** Footprint radius in metres: what the placer keeps clear of the road. */
export const FOOTPRINT = { house: 7.2, spectator: 0.5 }

interface TreeSpec {
  shape: 'conifer' | 'round' | 'umbrella' | 'shrub' | 'succulent' | 'bamboo' | 'columnar' | 'bare'
  h: [number, number]
  crown: number
  leaf: number
  trunk: number
  snow?: boolean
}

const TREES: Record<string, TreeSpec> = {
  pine: { shape: 'conifer', h: [10, 17], crown: 0.32, leaf: 0x2f5a35, trunk: 0x6b4a33 },
  spruce: { shape: 'conifer', h: [9, 16], crown: 0.36, leaf: 0x234a32, trunk: 0x5a3e2c },
  fir: { shape: 'conifer', h: [10, 15], crown: 0.4, leaf: 0x2a5136, trunk: 0x5a3e2c },
  larch: { shape: 'conifer', h: [10, 16], crown: 0.34, leaf: 0x7d8a3a, trunk: 0x6b4a33 },
  cedar: { shape: 'conifer', h: [14, 22], crown: 0.3, leaf: 0x264a33, trunk: 0x7a4d36 },
  snowpine: { shape: 'conifer', h: [9, 15], crown: 0.34, leaf: 0x2a4a38, trunk: 0x5a3e2c, snow: true },
  snowfir: { shape: 'conifer', h: [8, 13], crown: 0.42, leaf: 0x284636, trunk: 0x5a3e2c, snow: true },
  cypress: { shape: 'columnar', h: [9, 14], crown: 0.16, leaf: 0x2c4a2c, trunk: 0x5a3e2c },
  oak: { shape: 'round', h: [8, 13], crown: 0.5, leaf: 0x4f6e33, trunk: 0x5d4632 },
  maple: { shape: 'round', h: [7, 11], crown: 0.48, leaf: 0xb4542c, trunk: 0x5d4632 },
  birch: { shape: 'round', h: [9, 14], crown: 0.4, leaf: 0x7f9a45, trunk: 0xe6e1d4 },
  birch_bare: { shape: 'bare', h: [8, 12], crown: 0.3, leaf: 0x9a8f86, trunk: 0xd9d4cb },
  eucalyptus: { shape: 'round', h: [12, 18], crown: 0.46, leaf: 0x7a8f6a, trunk: 0xc8b9a2 },
  cork: { shape: 'round', h: [6, 10], crown: 0.6, leaf: 0x55673a, trunk: 0x7a4c30 },
  olive: { shape: 'round', h: [4, 7], crown: 0.65, leaf: 0x8a9a6a, trunk: 0x6e5a48 },
  molle: { shape: 'round', h: [5, 8], crown: 0.6, leaf: 0x6c7f3c, trunk: 0x5d4632 },
  acacia: { shape: 'umbrella', h: [6, 10], crown: 0.9, leaf: 0x6f7f39, trunk: 0x5a4632 },
  stonepine: { shape: 'umbrella', h: [10, 15], crown: 0.6, leaf: 0x3f5a30, trunk: 0x7a5a42 },
  macchia: { shape: 'shrub', h: [1.2, 2.4], crown: 1.2, leaf: 0x5d6e3a, trunk: 0x5d4632 },
  thornbush: { shape: 'shrub', h: [1.4, 2.8], crown: 1.1, leaf: 0x7d7a45, trunk: 0x5d4632 },
  pampas: { shape: 'shrub', h: [1.0, 1.8], crown: 1.0, leaf: 0xc8b98a, trunk: 0x8a7a55 },
  euphorbia: { shape: 'succulent', h: [3, 6], crown: 0.5, leaf: 0x5f7a4a, trunk: 0x5f7a4a },
  cactus: { shape: 'succulent', h: [2, 4], crown: 0.4, leaf: 0x5d7d4c, trunk: 0x5d7d4c },
  bamboo: { shape: 'bamboo', h: [8, 12], crown: 0.2, leaf: 0x7a9a4a, trunk: 0x8aa35a },
}

/** Widest reach of a tree's crown at the given scale, at its tallest: what must stay clear of the road. */
export function crownRadius(kind: string, scale: number): number {
  const t = TREES[kind] ?? TREES.pine
  const h = t.h[1] * scale
  const k = t.shape === 'conifer' ? t.crown * 1.12
    : t.shape === 'round' ? t.crown * 0.85
    : t.shape === 'umbrella' ? t.crown * 0.6
    : t.shape === 'shrub' ? 0.4 + t.crown * 0.7
    : t.shape === 'bamboo' ? 0.2 : 0.25
  return Math.max(1.2, h * k)
}

const SNOW = 0xf2f5f7

/** How far below its footprint's low point a trunk (and its root flare) is sunk. */
export const TREE_SINK = 0.25

/** Foliage colour and rough shape, for distant forest drawn as simple masses. */
export function treeLook(kind: string): { leaf: number; conifer: boolean } {
  const t = TREES[kind] ?? TREES.pine
  return { leaf: t.leaf, conifer: t.shape === 'conifer' || t.shape === 'columnar' }
}

/**
 * A tree standing at (x, y, z), y being the lowest ground under its trunk.
 * With `cards`, the crown also gets alpha-tested leaf or needle cards: the
 * modelled masses give it volume, the cards a ragged, leafy outline.
 */
export function addTree(b: GeoBuilder, kind: string, x: number, y: number, z: number, r: R, scale = 1, cards: CardBuilder | null = null, rich = cards !== null): void {
  const t = TREES[kind] ?? TREES.pine
  const h = (t.h[0] + (t.h[1] - t.h[0]) * r()) * scale
  const yaw = r() * Math.PI * 2
  y -= TREE_SINK
  // Trunks get bark, everything else leaves; succulents are all skin.
  const add = b.add.bind(b)
  b.add = (geo, color, ...rest) => {
    b.surface = color === t.trunk && t.shape !== 'succulent' ? 2 : color === SNOW ? 0 : 3
    add(geo, color, ...rest)
  }
  try {
    tree(b, t, h, x, y, z, yaw, r, cards, rich)
  } finally {
    b.add = add
    b.surface = 0
  }
}

function trunk(b: GeoBuilder, t: TreeSpec, x: number, y: number, z: number, rad: number, len: number, yaw: number, rich: boolean, tiltX = 0, tiltZ = 0): void {
  b.add(rich ? PRIM.taper8 : PRIM.cylTaper, t.trunk, x, y, z, rad, len, rad, yaw, tiltX, tiltZ, 0, 0.05)
  if (!rich) return
  // The flare starts below ground and meets the trunk a little way up.
  b.add(PRIM.flare, t.trunk, x, y - 0.05, z, rad * 1.02, Math.min(0.9, Math.max(0.45, rad * 2.4)), rad * 1.02, yaw + 0.3)
}

/** `rich`: the fuller model (more tiers and clumps, limbs, root flares); off on Low, which keeps the older, lighter trees. */
function tree(b: GeoBuilder, t: TreeSpec, h: number, x: number, y: number, z: number, yaw: number, r: R, cards: CardBuilder | null, rich: boolean): void {
  const c = new THREE.Color()
  switch (t.shape) {
    case 'conifer': {
      // The trunk runs up into the top tier, so no tier ever floats on air.
      trunk(b, t, x, y, z, h * 0.032, h * 0.72, yaw, rich)
      // Irregular tiers, darker underneath and lighter at the tips, so a
      // forest reads as foliage rather than a stack of identical cones.
      const tiers = rich ? 5 + Math.floor(r() * 3) : 4 + Math.floor(r() * 2)
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers
        const rad = h * t.crown * (1 - f * 0.74) * (0.88 + r() * 0.24)
        const ty = y + h * (0.14 + f * 0.66)
        const th = h * (0.3 - f * 0.12)
        c.setHex(t.leaf).offsetHSL(0, 0, -0.05 + f * 0.09)
        const ox = (r() - 0.5) * 0.25, oz = (r() - 0.5) * 0.25
        b.add(PRIM.coneStar, c.getHex(), x + ox, ty, z + oz, rad, th, rad, yaw + i * 0.9, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08, 0.1 + f * 0.3, 0.4 + f * 0.6, 1, r)
        if (t.snow) b.add(PRIM.cone, SNOW, x, ty + th * 0.5, z, rad * 0.6, th * 0.5, rad * 0.6, yaw + i, 0, 0, 0.3, 1)
        if (cards) {
          // Drooping needle sprays around the rim of each tier.
          const n = 5 + Math.floor(rad * 0.8)
          for (let k = 0; k < n; k++) {
            const a = yaw + i * 0.9 + (k / n) * Math.PI * 2 + r() * 0.4
            const ca = Math.cos(a), sa = Math.sin(a)
            const d = rad * (0.62 + r() * 0.2)
            cards.card(x + ox + ca * d, ty + th * 0.18, z + oz + sa * d, rad * 0.95, th * 0.75, -a + Math.PI / 2, 0.55, 1, c.getHex(), ca, 0.8, sa, 0.15 + f * 0.3, 0.5 + f * 0.6, (r() - 0.5) * 0.06)
          }
        }
      }
      break
    }
    case 'columnar':
      trunk(b, t, x, y, z, 0.22, h * 0.3, yaw, rich)
      b.add(PRIM.ico1, t.leaf, x, y + h * 0.55, z, h * t.crown, h * 0.5, h * t.crown, yaw, 0, 0, 0.2, 0.8, 1, r)
      if (cards)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + r()
          cards.card(x + Math.cos(a) * h * t.crown * 0.7, y + h * (0.3 + r() * 0.5), z + Math.sin(a) * h * t.crown * 0.7, h * t.crown * 1.4, h * 0.3, -a + Math.PI / 2, 0.1, 1, t.leaf, Math.cos(a), 0.3, Math.sin(a), 0.2, 0.8)
        }
      break
    case 'round': {
      trunk(b, t, x, y, z, h * 0.034, h * 0.66, yaw, rich)
      // A crown of overlapping clumps spread through the top half, not one ball on a stick.
      const cr = h * t.crown * 0.5
      const n = rich ? 5 + Math.floor(r() * 4) : 4 + Math.floor(r() * 3)
      const cy = y + h * 0.7
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r()
        const up = 0.5 + r() * 0.42
        const off = cr * (0.35 + r() * 0.35) * (1 - (up - 0.5))
        const px = x + Math.cos(a) * off, py = y + h * up, pz = z + Math.sin(a) * off
        c.setHex(t.leaf).offsetHSL(0, 0, (up - 0.7) * 0.12)
        const sx = cr * (0.6 + r() * 0.3), sy = cr * (0.5 + r() * 0.25)
        b.add(PRIM.ico, c.getHex(), px, py, pz, sx, sy, cr * (0.6 + r() * 0.3), r() * 6, 0, 0, 0.5, 1, 1.2, r)
        // A limb from the trunk out to every clump that sits away from it.
        if (rich && off > cr * 0.3) {
          const len = Math.hypot(off, py - (y + h * 0.5))
          b.add(PRIM.cyl, t.trunk, x, y + h * 0.48, z, h * 0.012, len, h * 0.012, Math.PI / 2 - a, Math.atan2(off, py - (y + h * 0.5)), 0, 0.1, 0.5)
        }
        if (cards) {
          // Leaf sprays standing out from each clump toward the light.
          const m = 3
          for (let k = 0; k < m; k++) {
            const b2 = a + (k - 1) * 0.9 + (r() - 0.5) * 0.4
            const nx = px - x + Math.cos(b2) * sx, ny = py - cy + sy * 0.5, nz = pz - z + Math.sin(b2) * sx
            cards.card(px + Math.cos(b2) * sx * 0.55, py + (r() - 0.3) * sy * 0.6, pz + Math.sin(b2) * sx * 0.55, sx * 1.5, sy * 1.6, -b2 + Math.PI / 2 + (r() - 0.5) * 0.6, (r() - 0.5) * 0.7, 0, c.getHex(), nx, ny, nz, 0.5, 1, (r() - 0.5) * 0.08)
          }
        }
      }
      break
    }
    case 'umbrella': {
      const lean = (r() - 0.5) * 0.25
      trunk(b, t, x, y, z, h * 0.035, h * 0.8, yaw, rich, lean, 0)
      const cr = h * t.crown * 0.5
      const tx = x + Math.sin(lean) * h * 0.4
      // A canopy of flattened clumps around a central one: a parasol with some depth, not a disc.
      b.add(PRIM.ico, t.leaf, tx, y + h * 0.84, z, cr * 0.75, h * 0.09, cr * 0.7, yaw, 0, 0, 0.6, 1, 1, r)
      const lumps = 5 + Math.floor(r() * 3)
      for (let k = 0; k < lumps; k++) {
        const a = (k / lumps) * Math.PI * 2 + r() * 0.5, d = cr * (0.45 + r() * 0.25)
        c.setHex(t.leaf).offsetHSL(0, 0, (r() - 0.5) * 0.06)
        b.add(PRIM.ico, c.getHex(), tx + Math.cos(a) * d, y + h * (0.78 + r() * 0.05), z + Math.sin(a) * d, cr * 0.5, h * 0.08, cr * 0.45, a, 0, 0, 0.6, 1, 1, r)
        // Branches fan out from the top of the trunk to each clump.
        if (rich) b.add(PRIM.cyl, t.trunk, tx, y + h * 0.74, z, h * 0.012, Math.hypot(d, h * 0.06), h * 0.012, Math.PI / 2 - a, Math.atan2(d, h * 0.06), 0, 0.3, 0.6)
      }
      if (cards)
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + r() * 0.5, d = cr * (0.55 + r() * 0.4)
          cards.card(tx + Math.cos(a) * d, y + h * (0.8 + r() * 0.08), z + Math.sin(a) * d, cr * 0.8, h * 0.12, -a + Math.PI / 2, 1.2, 0, t.leaf, Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4, 0.6, 1, (r() - 0.5) * 0.08)
        }
      break
    }
    case 'shrub': {
      const n = 2 + Math.floor(r() * 2)
      for (let i = 0; i < n; i++) {
        const px = x + (r() - 0.5) * h * 0.8, pz = z + (r() - 0.5) * h * 0.8
        const sx = h * t.crown * (0.4 + r() * 0.3)
        b.add(PRIM.ico, t.leaf, px, y + h * 0.35, pz, sx, h * 0.45, h * t.crown * (0.4 + r() * 0.3), r() * 6, 0, 0, 0.2, 0.7, 1.3, r)
        if (cards)
          for (let k = 0; k < 2; k++) {
            const a = r() * Math.PI
            cards.card(px, y + h * 0.45, pz, sx * 2.1, h * 0.95, a, 0, 0, t.leaf, Math.cos(a), 0.6, Math.sin(a), 0.1, 0.6, (r() - 0.5) * 0.08)
          }
      }
      break
    }
    case 'succulent': {
      b.add(PRIM.cyl8, t.leaf, x, y, z, 0.3, h, 0.3, yaw)
      const arms = 2 + Math.floor(r() * 3)
      for (let i = 0; i < arms; i++) {
        const a = r() * Math.PI * 2, ah = h * (0.4 + r() * 0.3)
        // Arms start inside the stem, so the joint is closed.
        b.add(PRIM.cyl, t.leaf, x + Math.cos(a) * 0.3, y + ah, z + Math.sin(a) * 0.3, 0.2, h * 0.35, 0.2, a, 0.35 * Math.cos(a), 0.35 * Math.sin(a), 0, 0.1, 1, r)
      }
      break
    }
    case 'bamboo':
      for (let i = 0; i < 7; i++) {
        const ox = (r() - 0.5) * 2.2, oz = (r() - 0.5) * 2.2, hh = h * (0.7 + r() * 0.3)
        b.add(PRIM.cyl, t.trunk, x + ox, y, z + oz, 0.07, hh, 0.07, 0, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12, 0, 0.6)
        b.add(PRIM.cone5, t.leaf, x + ox, y + hh * 0.75, z + oz, 0.9, hh * 0.35, 0.9, r() * 6, 0, 0, 0.5, 1, 1, r)
        if (cards) cards.card(x + ox, y + hh * 0.85, z + oz, 1.8, hh * 0.35, r() * Math.PI, 0.2, 0, t.leaf, ox, 1, oz, 0.5, 1)
      }
      break
    case 'bare':
      trunk(b, t, x, y, z, h * 0.03, h, yaw, rich)
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2
        b.add(PRIM.cyl, t.trunk, x, y + h * (0.45 + r() * 0.4), z, 0.05, h * 0.25, 0.05, a, 0.7, 0, 0, 0.3)
      }
      b.add(PRIM.cone, SNOW, x, y - 0.1, z, 1.1, 0.35, 1.1)
      break
  }
}

/** Grass clump: three crossed blade cards. Soft, so it can stand on the verge. */
export function addGrassCards(cards: CardBuilder, x: number, y: number, z: number, col: number, r: R): void {
  const w = 0.5 + r() * 0.5, h = 0.35 + r() * 0.4
  const a0 = r() * Math.PI
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k / 3) * Math.PI
    cards.card(x, y + h * 0.5 - 0.04, z, w, h, a, (r() - 0.5) * 0.3, 2, col, 0, 1, 0, 0, 1, (r() - 0.5) * 0.1)
  }
}
const FLOWERS = [0xf2f0e6, 0xf2c037, 0xd86a9a, 0x8a7ad8, 0xe8763e]

/** A small clump of meadow flowers: soft, so it can sit on the drivable verge. */
export function addFlowers(b: GeoBuilder, x: number, y: number, z: number, r: R): void {
  const col = FLOWERS[Math.floor(r() * FLOWERS.length)]
  for (let i = 0; i < 4; i++) {
    const fx = x + (r() - 0.5) * 0.8, fz = z + (r() - 0.5) * 0.8, fh = 0.25 + r() * 0.25
    b.add(PRIM.cyl, 0x5a7a3a, fx, y - 0.05, fz, 0.01, fh, 0.01, 0, 0, 0, 0, 0.8)
    b.add(PRIM.ico, col, fx, y + fh, fz, 0.06, 0.04, 0.06, r() * 6, 0, 0, 0.8, 1)
  }
}

export function addRock(b: GeoBuilder, x: number, y: number, z: number, size: number, col: number, r: R): void {
  b.surface = 1
  b.add(PRIM.dodeca, col, x, y + size * 0.25, z, size * (0.8 + r() * 0.5), size * (0.5 + r() * 0.4), size * (0.8 + r() * 0.5), r() * 6, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, 0, 0, 1.4, r)
  b.surface = 0
}

export function addTuft(b: GeoBuilder, x: number, y: number, z: number, col: number, r: R): void {
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI
    b.add(PRIM.cone5, col, x + (r() - 0.5) * 0.4, y - 0.05, z + (r() - 0.5) * 0.4, 0.12, 0.45 + r() * 0.35, 0.03, a, (r() - 0.5) * 0.5, 0, 0, 1, 1.2, r)
  }
}

interface HouseSpec {
  wall: number[]
  roof: number[]
  roofType: 'gable' | 'flat' | 'hip'
  floors: [number, number]
}

const HOUSES: Record<string, HouseSpec> = {
  nordic: { wall: [0x8f2d22, 0xb8862e, 0xe8e1d1], roof: [0x2f3236, 0x3b3f3a], roofType: 'gable', floors: [1, 2] },
  alpine: { wall: [0xe9dfc8, 0xd9c8a5], roof: [0x5b4636, 0x6e4e3a], roofType: 'gable', floors: [2, 3] },
  med: { wall: [0xf1e8d6, 0xe6d3b3, 0xf3efe6], roof: [0xb4583b, 0xa2492f], roofType: 'hip', floors: [1, 2] },
  iberia: { wall: [0xf3efe6, 0xe6dcc6], roof: [0xa9512f, 0xb76240], roofType: 'hip', floors: [1, 2] },
  stone: { wall: [0x8b8780, 0x9a948a], roof: [0x3d4248, 0x464b52], roofType: 'gable', floors: [1, 2] },
  safari: { wall: [0xc9a47a, 0xb48a5c], roof: [0xc8b07a, 0xb59c66], roofType: 'hip', floors: [1, 1] },
  andes: { wall: [0xe8dcc8, 0xd9b48c], roof: [0x9b5a3a, 0x7a4a30], roofType: 'flat', floors: [1, 1] },
  japan: { wall: [0xe9e4d8, 0x8a5a3c], roof: [0x3e4650, 0x2f353d], roofType: 'hip', floors: [1, 2] },
}

/** A house with its floor at y, on a stone plinth that reaches down to `base` (the low side of a slope). */
export function addHouse(b: GeoBuilder, style: string, x: number, y: number, z: number, yaw: number, r: R, base = y - 1.5): void {
  const s = HOUSES[style] ?? HOUSES.nordic
  const w = 6 + r() * 4, d = 5 + r() * 3
  const floors = s.floors[0] + Math.floor(r() * (s.floors[1] - s.floors[0] + 1))
  const h = floors * 2.8
  const wall = s.wall[Math.floor(r() * s.wall.length)], roof = s.roof[Math.floor(r() * s.roof.length)]
  // The plinth reaches down below the lowest corner, so a slope never shows a gap under the walls.
  b.surface = 1
  b.add(PRIM.box, 0x6d675e, x, base, z, w + 0.2, y + 0.2 - base, d + 0.2, yaw)
  b.surface = 0
  b.add(PRIM.box, wall, x, y + 0.2, z, w, h, d, yaw, 0, 0, 0, 0, 0.6, r)
  const top = y + 0.2 + h
  if (s.roofType === 'flat') b.add(PRIM.box, roof, x, top, z, w + 0.3, 0.3, d + 0.3, yaw)
  else if (s.roofType === 'gable') b.add(PRIM.prism, roof, x, top, z, w + 0.6, 2.4, d + 0.8, yaw)
  else {
    b.add(PRIM.prism, roof, x, top, z, w + 0.6, 1.8, d + 0.8, yaw)
    b.add(PRIM.cone, roof, x, top, z, Math.min(w, d) * 0.62, 1.8, Math.min(w, d) * 0.62, yaw + Math.PI / 4)
  }
  // Windows: dark inset squares on the long sides.
  const cos = Math.cos(yaw), sin = Math.sin(yaw)
  for (let f = 0; f < floors; f++)
    for (let i = -1; i <= 1; i += 2)
      for (const side of [-1, 1]) {
        const lx = i * w * 0.25, lz = side * (d / 2 + 0.02)
        b.add(PRIM.boxC, 0x2a3138, x + lx * cos + lz * sin, y + 1.6 + f * 2.8, z - lx * sin + lz * cos, 1.0, 1.1, 0.08, yaw)
      }
  // Chimney.
  if (s.roofType !== 'flat') b.add(PRIM.box, 0x7a6e64, x + w * 0.25 * cos, top + 0.6, z - w * 0.25 * sin, 0.6, 2.2, 0.6, yaw)
}

const JACKETS = [0xd8452f, 0x2f6fd8, 0xf2c037, 0x2e8c55, 0xf0efe9, 0x1f2329, 0xe8762e, 0x7a3fb0]

export function addSpectator(b: GeoBuilder, x: number, y: number, z: number, facing: number, r: R): void {
  const h = 1.6 + r() * 0.25
  const jacket = JACKETS[Math.floor(r() * JACKETS.length)]
  b.add(PRIM.cyl, 0x2c2f38, x, y - 0.1, z, 0.13, h * 0.5, 0.13, facing)
  b.add(PRIM.cylTaper, jacket, x, y + h * 0.42, z, 0.22, h * 0.36, 0.18, facing, 0, 0, 0, 0.15)
  b.add(PRIM.ico, 0xe0b08f, x, y + h * 0.9, z, 0.13, 0.15, 0.13, facing, 0, 0, 0.15, 0.2)
  if (r() < 0.35) b.add(PRIM.box, jacket, x, y + h * 0.97, z, 0.22, 0.1, 0.22, facing)
  // Some wave a flag.
  if (r() < 0.15) {
    b.add(PRIM.cyl, 0x9a8a6a, x + 0.25, y + h * 0.6, z, 0.015, 1.2, 0.015, facing)
    b.add(PRIM.boxC, JACKETS[Math.floor(r() * JACKETS.length)], x + 0.25, y + h * 0.6 + 1.05, z + 0.25, 0.02, 0.35, 0.5, facing, 0, 0, 0.8, 1)
  }
}

/** Footprints for the larger set pieces, used by the planner's clearance check. */
export const LANDMARK_R: Record<string, number> = {
  lighthouse: 5, chapel: 7, church: 8, windmill: 6, barn: 9, ruin: 8, baobab: 8, gate: 4, nuraghe: 7, hut: 6, sauna: 5, estancia: 9,
}

/** Which set piece each rally gets: one memorable shape per country. */
export const LANDMARK: Record<string, string> = {
  finland: 'sauna', kenya: 'baobab', portugal: 'lighthouse', estonia: 'windmill', sardinia: 'nuraghe', argentina: 'estancia',
  wales: 'ruin', croatia: 'church', greece: 'chapel', japan: 'gate', sweden: 'barn', monte: 'hut', school: 'sauna',
}

/**
 * Original set pieces, one per rally, built from primitives like the rest of
 * the scenery. Each sits on the ground at (x, y, z), facing `yaw`.
 */
export function addLandmark(b: GeoBuilder, kind: string, x: number, y: number, z: number, yaw: number, r: R): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
  /** A primitive placed in the landmark's own frame (lx across, lz forward), rotated with it. */
  const put = (geo: THREE.BufferGeometry, col: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
    const [px, pz] = at(lx, lz)
    b.add(geo, col, px, ly, pz, sx, sy, sz, yaw)
  }
  switch (kind) {
    case 'lighthouse': {
      b.add(PRIM.cylTaper, 0x8a8478, x, y - 2, z, 4, 3, 4, 0)
      for (let i = 0; i < 5; i++) b.add(PRIM.cylTaper, i % 2 ? 0xc8402f : 0xf3efe6, x, y + 1 + i * 3.4, z, 1.9 - i * 0.18, 3.4, 1.9 - i * 0.18)
      b.add(PRIM.cyl, 0x2a3138, x, y + 18, z, 1.2, 0.4, 1.2)
      b.add(PRIM.cyl, 0xfff4c8, x, y + 18.4, z, 0.9, 1.6, 0.9)
      b.add(PRIM.cone, 0xc8402f, x, y + 20, z, 1.3, 1.6, 1.3)
      const [hx, hz] = at(5, 0)
      b.add(PRIM.box, 0xf3efe6, hx, y - 0.5, hz, 5, 3.4, 4, yaw)
      b.add(PRIM.prism, 0xb4583b, hx, y + 2.9, hz, 5.4, 1.6, 4.4, yaw)
      break
    }
    case 'chapel': {
      b.add(PRIM.box, 0xf6f4ee, x, y - 1, z, 6, 5, 8, yaw)
      b.add(PRIM.cyl, 0xf6f4ee, x, y + 4, z, 2.3, 1.2, 2.3)
      b.add(PRIM.ico1, 0x2f6fb8, x, y + 5.2, z, 2.3, 1.8, 2.3)
      const [bx, bz] = at(0, -4.5)
      b.add(PRIM.box, 0xf6f4ee, bx, y - 1, bz, 2.2, 8, 2.2, yaw)
      b.add(PRIM.ico1, 0x2f6fb8, bx, y + 7.3, bz, 1.2, 1, 1.2)
      put(PRIM.boxC, 0x2f6fb8, 0, y + 0.4, 4.02, 1.4, 2.4, 0.1)
      break
    }
    case 'church': {
      b.add(PRIM.box, 0xe9e1cf, x, y - 1, z, 8, 7, 14, yaw)
      b.add(PRIM.prism, 0x8a4a36, x, y + 6, z, 8.6, 3.5, 14.6, yaw + Math.PI / 2)
      const [tx, tz] = at(0, 7.5)
      b.add(PRIM.box, 0xe9e1cf, tx, y - 1, tz, 3.6, 16, 3.6, yaw)
      b.add(PRIM.cone, 0x4a5a3a, tx, y + 15, tz, 2.4, 7, 2.4, yaw + Math.PI / 4)
      b.add(PRIM.cyl, 0xd8b04a, tx, y + 22, tz, 0.08, 1.4, 0.08)
      break
    }
    case 'windmill': {
      b.add(PRIM.cylTaper, 0x6a4a32, x, y - 1, z, 3.2, 10, 3.2)
      b.add(PRIM.cone, 0x3a3f44, x, y + 9, z, 3.6, 3, 3.6)
      const [hx, hz] = at(0, 3.4)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + r()
        b.add(PRIM.boxC, 0xe9e1cf, hx, y + 9 + Math.cos(a) * 3.6, hz, 1.4, 7.2, 0.15, yaw, 0, a, 0.2, 0.2)
      }
      break
    }
    case 'barn': {
      b.add(PRIM.box, 0x9a2e22, x, y - 1, z, 12, 6, 8, yaw)
      b.add(PRIM.prism, 0x34383d, x, y + 5, z, 12.6, 3.5, 8.6, yaw)
      for (const lz of [-4.02, 4.02]) put(PRIM.boxC, 0xf3efe6, 0, y + 1, lz, 2.6, 3, 0.1)
      for (let i = 0; i < 3; i++) {
        const [px, pz] = at(-8 + i * 2.2, 3)
        b.add(PRIM.cyl, 0xc9b98a, px, y - 0.2, pz, 0.9, 1.4, 0.9, 0, 0, Math.PI / 2)
      }
      break
    }
    case 'ruin': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const [wx, wz] = at(Math.cos(a) * 5, Math.sin(a) * 5)
        b.add(PRIM.box, 0x7d7a72, wx, y - 1, wz, 3.2, 3 + r() * 6, 1.2, yaw + a + Math.PI / 2, 0, 0, 0, 0, 0.8, r)
      }
      const [tx, tz] = at(-6, -2)
      b.add(PRIM.cylTaper, 0x8a8780, tx, y - 1, tz, 2.2, 13, 2.2)
      break
    }
    case 'baobab': {
      b.add(PRIM.cylTaper, 0x8a7460, x, y - 0.5, z, 2.2, 9, 2.2, 0, 0, 0, 0, 0.1)
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r()
        b.add(PRIM.cylTaper, 0x8a7460, x + Math.cos(a) * 1.5, y + 8, z + Math.sin(a) * 1.5, 0.35, 4, 0.35, a, 0.9, 0, 0.2, 0.5)
        b.add(PRIM.ico, 0x6a7a3a, x + Math.cos(a) * 4, y + 11, z + Math.sin(a) * 4, 1.6, 0.8, 1.6, a, 0, 0, 0.6, 1, 1.2, r)
      }
      break
    }
    case 'gate': {
      for (const lx of [-3, 3]) {
        const [px, pz] = at(lx, 0)
        b.add(PRIM.cyl, 0xc8402f, px, y - 0.5, pz, 0.32, 6.5, 0.32)
      }
      b.add(PRIM.box, 0x1d1f22, x, y + 6, z, 9, 0.6, 0.8, yaw)
      b.add(PRIM.box, 0xc8402f, x, y + 4.8, z, 7.6, 0.45, 0.5, yaw)
      for (let i = 0; i < 12; i++) {
        const [lx, lz] = at(-2 + (i % 2) * 4, 4 + Math.floor(i / 2) * 3)
        b.add(PRIM.box, 0x9a9890, lx, y - 0.3, lz, 0.5, 1.6, 0.5, yaw)
      }
      break
    }
    case 'nuraghe': {
      b.add(PRIM.cylTaper, 0x8f8676, x, y - 1, z, 5, 9, 5, 0, 0, 0, 0, 0, 0.6, r)
      put(PRIM.box, 0x2a2622, 0, y - 0.5, 4.6, 1.2, 2.2, 0.6)
      for (let i = 0; i < 4; i++) {
        const [tx, tz] = at(Math.cos(i * 1.57) * 8, Math.sin(i * 1.57) * 8)
        b.add(PRIM.cylTaper, 0x8f8676, tx, y - 1, tz, 2.4, 5, 2.4)
      }
      break
    }
    case 'hut': {
      b.add(PRIM.box, 0x8a8478, x, y - 1, z, 7, 2.5, 6, yaw)
      b.add(PRIM.box, 0x6a4a32, x, y + 1.5, z, 7, 2.4, 6, yaw)
      b.add(PRIM.prism, 0x3a3f44, x, y + 3.9, z, 8.4, 3, 7.4, yaw)
      put(PRIM.box, 0x8a8478, 2.4, y + 3, 0, 0.8, 3, 0.8)
      put(PRIM.boxC, 0xd8452f, 0, y + 1.6, 3.02, 1.2, 0.8, 0.05)
      break
    }
    case 'sauna': {
      b.add(PRIM.box, 0x7a5a3a, x, y - 0.5, z, 4.5, 3, 3.5, yaw)
      b.add(PRIM.prism, 0x3a3f44, x, y + 2.5, z, 5, 1.6, 4, yaw)
      put(PRIM.box, 0x8a8478, 1.6, y + 2.5, 0, 0.5, 2, 0.5)
      const [jx, jz] = at(0, 4)
      b.add(PRIM.box, 0x8a6a4a, jx, y - 0.6, jz, 1.6, 0.8, 6, yaw)
      break
    }
    case 'estancia': {
      b.add(PRIM.box, 0xf3efe6, x, y - 1, z, 16, 4.5, 7, yaw)
      b.add(PRIM.prism, 0xa9512f, x, y + 3.5, z, 16.6, 2, 7.6, yaw)
      for (let i = -3; i <= 3; i++) {
        const [px, pz] = at(i * 2.4, 4.4)
        b.add(PRIM.cyl, 0x6a4a32, px, y - 0.5, pz, 0.15, 3.6, 0.15)
      }
      put(PRIM.box, 0x6a4a32, 0, y + 3.1, 4.4, 17, 0.15, 2.2)
      break
    }
  }
}

/** Rural detail along open sections: post-and-rail fence, round bales, a telegraph pole. */
export function addFence(b: GeoBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0)
  const yaw = Math.atan2(x1 - x0, z1 - z0)
  // Rails follow the slope between posts and run into them at both ends: no
  // gap at a post, however the ground falls.
  const pitch = Math.atan2(y1 - y0, len)
  b.surface = 2
  b.add(PRIM.box, color, x0, y0 - 0.4, z0, 0.13, 1.6, 0.13, yaw)
  b.add(PRIM.box, color, x1, y1 - 0.4, z1, 0.13, 1.6, 0.13, yaw)
  for (const h of [0.55, 0.95]) b.add(PRIM.boxC, color, (x0 + x1) / 2, (y0 + y1) / 2 + h, (z0 + z1) / 2, 0.06, 0.1, Math.hypot(len, y1 - y0) + 0.12, yaw, -pitch, 0)
  b.surface = 0
}

export function addBale(b: GeoBuilder, x: number, y: number, z: number, yaw: number): void {
  b.add(PRIM.cyl, 0xd2b766, x, y + 0.75, z, 0.75, 1.3, 0.75, yaw, 0, Math.PI / 2)
}

export function addPole(b: GeoBuilder, x: number, y: number, z: number, yaw: number): void {
  b.add(PRIM.cylTaper, 0x5a4a3a, x, y - 0.5, z, 0.14, 8.5, 0.14)
  b.add(PRIM.boxC, 0x5a4a3a, x, y + 7.6, z, 1.8, 0.12, 0.12, yaw + Math.PI / 2)
}

interface AnimalSpec {
  len: number
  h: number
  leg: number
  neck: number
  body: number
  tone2?: number
  stripes?: boolean
  horns?: boolean
}

const ANIMALS: Record<string, AnimalSpec> = {
  zebra: { len: 2.2, h: 1.3, leg: 0.75, neck: 0.6, body: 0xf3efe6, tone2: 0x1b1b1d, stripes: true },
  giraffe: { len: 2.4, h: 2.4, leg: 1.6, neck: 2.2, body: 0xd8a85a, tone2: 0x7a4a22 },
  moose: { len: 2.6, h: 1.9, leg: 1.1, neck: 0.6, body: 0x4a3426, horns: true },
  reindeer: { len: 1.8, h: 1.2, leg: 0.7, neck: 0.55, body: 0x8a7a68, tone2: 0xe8e2d6, horns: true },
  sheep: { len: 1.2, h: 0.85, leg: 0.4, neck: 0.25, body: 0xeeeae0, tone2: 0x2a2624 },
  cow: { len: 2.2, h: 1.4, leg: 0.7, neck: 0.4, body: 0x8a5a3a, tone2: 0xf3efe6 },
  goat: { len: 1.1, h: 0.8, leg: 0.45, neck: 0.35, body: 0xc8b8a0, horns: true },
  deer: { len: 1.5, h: 1.1, leg: 0.7, neck: 0.5, body: 0xa06a3e, horns: true },
  horse: { len: 2.2, h: 1.6, leg: 0.9, neck: 0.75, body: 0x6a4228, tone2: 0x2a1c14 },
}

/** Which animals graze in each region. */
export const FAUNA: Record<string, string[]> = {
  savannah: ['zebra', 'zebra', 'giraffe'], nordic: ['moose'], nordic_snow: ['reindeer'], wales: ['sheep', 'sheep'],
  iberia: ['cow', 'goat'], alpine: ['cow'], med: ['goat', 'sheep'], japan: ['deer'], andes: ['horse', 'cow'],
}

export function animalRadius(kind: string): number {
  const a = ANIMALS[kind]
  return a ? Math.max(1, a.len * 0.6 + (kind === 'giraffe' ? 0.8 : 0)) : 1.5
}

/** A grazing four-legged animal, head down or up, facing `yaw`. Simple shapes, readable from the road. */
export function addAnimal(b: GeoBuilder, kind: string, x: number, y: number, z: number, yaw: number, r: R): void {
  const a = ANIMALS[kind] ?? ANIMALS.cow
  const cos = Math.cos(yaw), sin = Math.sin(yaw)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
  const bodyH = a.h - a.leg
  const bodyY = y + a.leg
  const cy = bodyY + bodyH * 0.5
  const leg = a.stripes ? 0x1b1b1d : kind === 'sheep' ? 0x2a2624 : a.body
  // Body as chest, belly and hindquarters: three overlapping rounded masses give an animal's line, not a disc.
  const masses: [number, number, number, number][] = [[a.len * 0.27, 0.28, 0.55, 0.3], [0, 0.26, 0.5, 0.34], [-a.len * 0.28, 0.27, 0.55, 0.3]]
  masses.forEach(([lz, w, hh, l], i) => {
    const [px, pz] = at(0, lz)
    const col = a.stripes && a.tone2 !== undefined ? (i % 2 ? a.tone2 : a.body) : kind === 'sheep' ? a.body : a.body
    b.add(PRIM.ico1, col, px, cy, pz, a.len * w * 0.5 * (kind === 'sheep' ? 1.4 : 1), bodyH * hh * (kind === 'sheep' ? 1.2 : 1), a.len * l, yaw, 0, 0, 0, 0, 0.5, r)
  })
  if (a.stripes && a.tone2 !== undefined) {
    // Stripes: thin dark hoops around the body.
    for (let i = 0; i < 6; i++) {
      const [px, pz] = at(0, -a.len * 0.4 + i * a.len * 0.16)
      b.add(PRIM.cyl, a.tone2, px, cy, pz, a.len * 0.15, 0.06, bodyH * 0.53, yaw, Math.PI / 2, 0)
    }
  } else if (a.tone2 !== undefined && kind !== 'sheep' && kind !== 'horse') {
    const [qx, qz] = at(a.len * 0.06, -a.len * 0.12)
    b.add(PRIM.ico, a.tone2, qx, cy + bodyH * 0.3, qz, a.len * 0.12, bodyH * 0.18, a.len * 0.16, yaw)
  }
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const [px, pz] = at(lx * a.len * 0.11, lz * a.len * 0.33)
    b.add(PRIM.cylTaper, leg, px, y - 0.05, pz, a.len * 0.045, a.leg + bodyH * 0.35, a.len * 0.045)
  }
  // Tail.
  const [tx, tz] = at(0, -a.len * 0.56)
  b.add(PRIM.cyl, a.tone2 ?? a.body, tx, cy - bodyH * 0.4, tz, 0.03, bodyH * 0.8, 0.03, yaw, -0.25, 0)
  // Neck and head: grazing (head down) or looking about.
  const grazing = r() < 0.55 && kind !== 'giraffe'
  const tilt = grazing ? 2.0 : kind === 'giraffe' ? 0.22 : 0.6
  const [nx, nz] = at(0, a.len * 0.36)
  const neckW = kind === 'giraffe' ? 0.07 : 0.1
  b.add(PRIM.cylTaper, a.body, nx, cy + bodyH * 0.1, nz, a.len * neckW * 0.7, a.neck, a.len * neckW, yaw, tilt, 0)
  const reach = Math.sin(tilt) * a.neck, rise = Math.cos(tilt) * a.neck
  const [hx, hz] = at(0, a.len * 0.36 + reach)
  const hy = cy + bodyH * 0.1 + rise
  const headCol = kind === 'sheep' && a.tone2 !== undefined ? a.tone2 : a.body
  const hl = a.len * 0.17
  b.add(PRIM.ico1, headCol, hx, hy, hz, a.len * 0.075, a.len * 0.08, hl * 0.6, yaw, grazing ? 0.9 : 0.15, 0)
  const [mx, mz] = at(0, a.len * 0.36 + reach + hl * 0.55)
  b.add(PRIM.ico1, headCol, mx, hy - (grazing ? 0.12 : 0.05), mz, a.len * 0.05, a.len * 0.055, hl * 0.4, yaw, grazing ? 0.9 : 0.15, 0)
  for (const side of [-1, 1]) {
    const [ex, ez] = at(side * a.len * 0.06, a.len * 0.36 + reach - hl * 0.25)
    b.add(PRIM.cone5, headCol, ex, hy + a.len * 0.05, ez, 0.04, 0.12, 0.03, yaw, 0, side * 0.7)
    if (a.horns) {
      const [cx, cz] = at(side * a.len * 0.04, a.len * 0.36 + reach - hl * 0.15)
      const antler = kind === 'moose' || kind === 'reindeer' || kind === 'deer'
      b.add(PRIM.cyl, kind === 'moose' ? 0xc8b48a : 0x5a4434, cx, hy + a.len * 0.05, cz, 0.025, antler ? 0.45 : 0.22, 0.025, yaw, -0.3, side * 0.5)
      if (antler) b.add(PRIM.boxC, kind === 'moose' ? 0xc8b48a : 0x5a4434, cx + side * 0.2 * Math.cos(yaw), hy + a.len * 0.05 + 0.42, cz - side * 0.2 * Math.sin(yaw), 0.3, 0.04, 0.16, yaw)
    }
  }
}

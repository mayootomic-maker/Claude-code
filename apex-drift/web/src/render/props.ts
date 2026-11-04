import * as THREE from 'three'
import { GeoBuilder, PRIM } from './builder'

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
  birch: { shape: 'round', h: [9, 14], crown: 0.3, leaf: 0x7f9a45, trunk: 0xe6e1d4 },
  birch_bare: { shape: 'bare', h: [8, 12], crown: 0.3, leaf: 0x9a8f86, trunk: 0xd9d4cb },
  eucalyptus: { shape: 'round', h: [14, 22], crown: 0.28, leaf: 0x7a8f6a, trunk: 0xc8b9a2 },
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

export function addTree(b: GeoBuilder, kind: string, x: number, y: number, z: number, r: R, scale = 1): void {
  const t = TREES[kind] ?? TREES.pine
  const h = (t.h[0] + (t.h[1] - t.h[0]) * r()) * scale
  const yaw = r() * Math.PI * 2
  // Sink the base a little so a slope never shows a floating trunk.
  y -= 0.4
  switch (t.shape) {
    case 'conifer': {
      b.add(PRIM.cyl, t.trunk, x, y, z, h * 0.035, h * 0.4, h * 0.035, yaw, 0, 0, 0, 0)
      // Irregular tiers, darker underneath and lighter at the tips, so a
      // forest reads as foliage rather than a stack of identical cones.
      const tiers = 4 + Math.floor(r() * 2)
      const c = new THREE.Color()
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers
        const rad = h * t.crown * (1 - f * 0.72) * (0.88 + r() * 0.24)
        const ty = y + h * (0.16 + f * 0.62)
        const th = h * (0.34 - f * 0.12)
        c.setHex(t.leaf).offsetHSL(0, 0, -0.05 + f * 0.09)
        b.add(PRIM.cone, c.getHex(), x + (r() - 0.5) * 0.3, ty, z + (r() - 0.5) * 0.3, rad, th, rad, yaw + i * 0.9, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08, 0.1 + f * 0.3, 0.4 + f * 0.6, 1, r)
        if (t.snow) b.add(PRIM.cone, SNOW, x, ty + th * 0.5, z, rad * 0.6, th * 0.5, rad * 0.6, yaw + i, 0, 0, 0.3, 1)
      }
      break
    }
    case 'columnar':
      b.add(PRIM.cyl, t.trunk, x, y, z, 0.25, h * 0.2, 0.25, yaw)
      b.add(PRIM.ico1, t.leaf, x, y + h * 0.55, z, h * t.crown, h * 0.5, h * t.crown, yaw, 0, 0, 0.2, 0.8, 1, r)
      break
    case 'round': {
      b.add(PRIM.cylTaper, t.trunk, x, y, z, h * 0.04, h * 0.55, h * 0.04, yaw)
      const cr = h * t.crown * 0.5
      const n = 2 + Math.floor(r() * 3)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r()
        const off = cr * 0.45
        b.add(PRIM.ico, t.leaf, x + Math.cos(a) * off, y + h * (0.62 + r() * 0.12), z + Math.sin(a) * off, cr * (0.75 + r() * 0.35), cr * (0.65 + r() * 0.3), cr * (0.75 + r() * 0.35), r() * 6, 0, 0, 0.5, 1, 1.2, r)
      }
      break
    }
    case 'umbrella': {
      const lean = (r() - 0.5) * 0.25
      b.add(PRIM.cylTaper, t.trunk, x, y, z, h * 0.035, h * 0.78, h * 0.035, yaw, lean, 0)
      const cr = h * t.crown * 0.5
      b.add(PRIM.cyl, t.leaf, x + Math.sin(lean) * h * 0.4, y + h * 0.78, z, cr, h * 0.12, cr * (0.85 + r() * 0.3), yaw, 0, 0, 0.6, 1, 1, r)
      b.add(PRIM.ico, t.leaf, x + Math.sin(lean) * h * 0.4, y + h * 0.86, z, cr * 0.9, h * 0.07, cr * 0.8, yaw, 0, 0, 0.6, 1, 1, r)
      break
    }
    case 'shrub': {
      const n = 2 + Math.floor(r() * 2)
      for (let i = 0; i < n; i++)
        b.add(PRIM.ico, t.leaf, x + (r() - 0.5) * h * 0.8, y + h * 0.35, z + (r() - 0.5) * h * 0.8, h * t.crown * (0.4 + r() * 0.3), h * 0.45, h * t.crown * (0.4 + r() * 0.3), r() * 6, 0, 0, 0.2, 0.7, 1.3, r)
      break
    }
    case 'succulent': {
      b.add(PRIM.cyl, t.leaf, x, y, z, 0.3, h, 0.3, yaw)
      const arms = 2 + Math.floor(r() * 3)
      for (let i = 0; i < arms; i++) {
        const a = r() * Math.PI * 2, ah = h * (0.4 + r() * 0.3)
        b.add(PRIM.cyl, t.leaf, x + Math.cos(a) * 0.5, y + ah, z + Math.sin(a) * 0.5, 0.2, h * 0.35, 0.2, a, 0.35 * Math.cos(a), 0.35 * Math.sin(a), 0, 0.1, 1, r)
      }
      break
    }
    case 'bamboo':
      for (let i = 0; i < 7; i++) {
        const ox = (r() - 0.5) * 2.2, oz = (r() - 0.5) * 2.2, hh = h * (0.7 + r() * 0.3)
        b.add(PRIM.cyl, t.trunk, x + ox, y, z + oz, 0.07, hh, 0.07, 0, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12, 0, 0.6)
        b.add(PRIM.cone5, t.leaf, x + ox, y + hh * 0.75, z + oz, 0.9, hh * 0.35, 0.9, r() * 6, 0, 0, 0.5, 1, 1, r)
      }
      break
    case 'bare':
      b.add(PRIM.cylTaper, t.trunk, x, y, z, h * 0.03, h, h * 0.03, yaw)
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2
        b.add(PRIM.cyl, t.trunk, x, y + h * (0.45 + r() * 0.4), z, 0.05, h * 0.25, 0.05, a, 0.7, 0, 0, 0.3)
      }
      b.add(PRIM.cone, SNOW, x, y - 0.1, z, 1.1, 0.35, 1.1)
      break
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
  b.add(PRIM.dodeca, col, x, y + size * 0.25, z, size * (0.8 + r() * 0.5), size * (0.5 + r() * 0.4), size * (0.8 + r() * 0.5), r() * 6, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, 0, 0, 1.4, r)
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

export function addHouse(b: GeoBuilder, style: string, x: number, y: number, z: number, yaw: number, r: R): void {
  const s = HOUSES[style] ?? HOUSES.nordic
  const w = 6 + r() * 4, d = 5 + r() * 3
  const floors = s.floors[0] + Math.floor(r() * (s.floors[1] - s.floors[0] + 1))
  const h = floors * 2.8
  const wall = s.wall[Math.floor(r() * s.wall.length)], roof = s.roof[Math.floor(r() * s.roof.length)]
  // Foundation reaches 1.5 m into the ground so slopes never show a gap.
  b.add(PRIM.box, 0x6d675e, x, y - 1.5, z, w + 0.2, 1.7, d + 0.2, yaw)
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

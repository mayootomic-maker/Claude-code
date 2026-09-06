/**
 * Designs the bot can build, and the palettes it builds them from.
 *
 * A design is a function from a few parameters to a `Blueprint`. Nothing here
 * touches the world, which is the point: a design can be costed, checked and
 * argued about before a single block is placed, and the same blueprint drives
 * the material list, the build order and the progress check.
 *
 * The palette is chosen separately from the shape. "A house" does not mean an
 * oak house — it means walls, a floor, a roof and windows, made of whatever the
 * bot can most cheaply get hold of. `choosePalette` asks the acquisition
 * planner to price the candidates for each role and takes the cheapest, so a
 * house near a forest comes out wooden and one on a mountainside comes out
 * stone, without either being written down.
 */

import { Draft, type Blueprint, type Role } from './blueprint.js'

export type Palette = Record<Role, string>

/**
 * Candidates per role, in preference order for ties.
 *
 * Only blocks that are ordinary full cubes, deliberately. Stairs and slabs
 * would make prettier roofs, but their orientation is derived from where the
 * player is standing and looking when they place it, which is not something the
 * builder can guarantee — a roof of wrongly-facing stairs looks far worse than
 * one made of honest blocks.
 */
export const ROLE_CANDIDATES: Record<Role, readonly string[]> = {
  floor: ['oak_planks', 'spruce_planks', 'birch_planks', 'stone_bricks', 'cobblestone', 'stone', 'dirt'],
  wall: ['oak_planks', 'spruce_planks', 'birch_planks', 'cobblestone', 'stone_bricks', 'stone', 'dirt'],
  accent: ['oak_log', 'spruce_log', 'birch_log', 'stone_bricks', 'cobblestone'],
  roof: ['cobblestone', 'stone_bricks', 'oak_planks', 'spruce_planks', 'stone', 'dirt'],
  window: ['glass'],
  light: ['torch'],
  door: ['oak_door', 'spruce_door', 'birch_door'],
  furniture: ['crafting_table'],
  path: ['cobblestone', 'gravel', 'dirt'],
}

/** The palette used when nothing better is known; every candidate list's head. */
export const DEFAULT_PALETTE: Palette = {
  floor: 'oak_planks',
  wall: 'oak_planks',
  accent: 'oak_log',
  roof: 'cobblestone',
  window: 'glass',
  light: 'torch',
  door: 'oak_door',
  furniture: 'crafting_table',
  path: 'cobblestone',
}

export interface PaletteSource {
  /** Seconds to obtain one, or Infinity. */
  unitCost(item: string): number
}

/**
 * Pick the cheapest workable block for each role.
 *
 * `held` biases toward what is already in the inventory: a stack of cobblestone
 * already carried beats planks that are marginally cheaper in theory, because
 * the theory does not include walking back to a forest.
 */
export function choosePalette(
  source: PaletteSource,
  held: ReadonlyMap<string, number> = new Map(),
  overrides: Partial<Palette> = {},
): Palette {
  const chosen = {} as Palette
  for (const role of Object.keys(ROLE_CANDIDATES) as Role[]) {
    const override = overrides[role]
    if (override) {
      chosen[role] = override
      continue
    }
    let best: { block: string; cost: number } | null = null
    for (const candidate of ROLE_CANDIDATES[role]) {
      const owned = held.get(candidate) ?? 0
      const cost = owned > 0 ? 0 : source.unitCost(candidate)
      if (!Number.isFinite(cost)) continue
      if (!best || cost < best.cost) best = { block: candidate, cost }
    }
    chosen[role] = best?.block ?? DEFAULT_PALETTE[role]
  }
  return chosen
}

export interface HouseOptions {
  readonly width?: number
  readonly depth?: number
  /** Height of the walls, floor to eaves. */
  readonly height?: number
  readonly palette?: Palette
  readonly windows?: boolean
  readonly furnished?: boolean
}

/**
 * A house: floor, walls with corner posts, windows, a doorway, a pitched roof,
 * and enough furniture to actually live in.
 *
 * The roof is a gable rather than a flat lid, because a flat lid is what makes
 * a build read as "a bot did this". It is stepped out of full blocks with a
 * one-block overhang, and the triangular gable ends are filled in — the bit
 * people forget, which leaves a house with two open holes under the roof for
 * mobs to wander into.
 */
export function house(options: HouseOptions = {}): Blueprint {
  const width = clamp(options.width ?? 7, 5, 24)
  const depth = clamp(options.depth ?? 7, 5, 24)
  const height = clamp(options.height ?? 4, 3, 8)
  const p = options.palette ?? DEFAULT_PALETTE
  const draft = new Draft('house')

  const maxX = width - 1
  const maxZ = depth - 1

  // Floor.
  draft.box({ x: 0, y: 0, z: 0 }, { x: maxX, y: 0, z: maxZ }, p.floor, 'floor')

  // Walls, then corner posts over the top of them.
  draft.shell({ x: 0, y: 1, z: 0 }, { x: maxX, y: height, z: maxZ }, p.wall, 'wall')
  for (const [cx, cz] of [[0, 0], [0, maxZ], [maxX, 0], [maxX, maxZ]] as const) {
    for (let y = 1; y <= height; y++) draft.set(cx, y, cz, p.accent, 'accent')
  }

  // Doorway: a two-high gap in the middle of the front wall.
  const doorX = Math.floor(width / 2)
  draft.clear(doorX, 1, 0)
  draft.clear(doorX, 2, 0)
  draft.set(doorX, 1, 0, p.door, 'door', true)

  // Windows at eye level, skipping corners and the doorway.
  if (options.windows !== false && height >= 3) {
    const y = 2
    for (let x = 2; x <= maxX - 2; x += 2) {
      if (x !== doorX) draft.set(x, y, 0, p.window, 'window', true)
      draft.set(x, y, maxZ, p.window, 'window', true)
    }
    for (let z = 2; z <= maxZ - 2; z += 2) {
      draft.set(0, y, z, p.window, 'window', true)
      draft.set(maxX, y, z, p.window, 'window', true)
    }
  }

  gableRoof(draft, width, depth, height, p)

  if (options.furnished !== false) {
    furnish(draft, width, depth, doorX, p)
  }

  // Standing just outside the door, which is where a build should leave you.
  return draft.finish({ x: doorX, y: 1, z: -1 })
}

/**
 * A stepped gable roof with a one-block overhang, and filled gable ends.
 *
 * Each course rises one block and steps in one from each side until the two
 * sides meet at the ridge. The triangle left underneath at the front and back
 * is filled with wall material — miss that and the house has a hole at each end
 * big enough for anything to walk through.
 */
function gableRoof(draft: Draft, width: number, depth: number, height: number, p: Palette): void {
  const left = -1
  const right = width
  const front = -1
  const back = depth

  const courses = Math.floor((right - left) / 2) + 1
  for (let k = 0; k < courses; k++) {
    const y = height + 1 + k
    const lx = left + k
    const rx = right - k
    if (lx > rx) break

    for (let z = front; z <= back; z++) {
      draft.set(lx, y, z, p.roof, 'roof')
      if (rx !== lx) draft.set(rx, y, z, p.roof, 'roof')
    }

    // Gable ends: the wall triangle between the two roof edges.
    for (let x = lx + 1; x <= rx - 1; x++) {
      if (x < 0 || x > width - 1) continue
      draft.set(x, y, 0, p.wall, 'wall')
      draft.set(x, y, depth - 1, p.wall, 'wall')
    }
  }
}

/** Enough to make it a home: a workbench, a furnace, storage and light. */
function furnish(draft: Draft, width: number, depth: number, doorX: number, p: Palette): void {
  const backZ = depth - 2
  const centre = Math.floor(width / 2)

  draft.set(centre - 1, 1, backZ, 'crafting_table', 'furniture', true)
  draft.set(centre, 1, backZ, 'furnace', 'furniture', true)
  draft.set(centre + 1, 1, backZ, 'chest', 'furniture', true)

  // Torches in the interior corners, away from the door so they are not the
  // first thing knocked out on the way in.
  for (const [x, z] of [
    [1, 1],
    [width - 2, 1],
    [1, depth - 2],
    [width - 2, depth - 2],
  ] as const) {
    if (x === doorX && z === 1) continue
    draft.set(x, 1, z, p.light, 'light', true)
  }
}

export interface HutOptions {
  readonly size?: number
  readonly palette?: Palette
}

/** A one-room shelter. What you build when the sun is going down. */
export function hut(options: HutOptions = {}): Blueprint {
  const size = clamp(options.size ?? 5, 3, 9)
  const p = options.palette ?? DEFAULT_PALETTE
  const draft = new Draft('hut')
  const max = size - 1

  draft.box({ x: 0, y: 0, z: 0 }, { x: max, y: 0, z: max }, p.floor, 'floor')
  draft.shell({ x: 0, y: 1, z: 0 }, { x: max, y: 3, z: max }, p.wall, 'wall')
  draft.box({ x: 0, y: 4, z: 0 }, { x: max, y: 4, z: max }, p.roof, 'roof')

  const doorX = Math.floor(size / 2)
  draft.clear(doorX, 1, 0)
  draft.clear(doorX, 2, 0)
  draft.set(1, 1, 1, p.light, 'light', true)

  return draft.finish({ x: doorX, y: 1, z: -1 })
}

export interface TowerOptions {
  readonly height?: number
  readonly size?: number
  readonly palette?: Palette
}

/** A lookout tower with a railed platform on top. */
export function tower(options: TowerOptions = {}): Blueprint {
  const height = clamp(options.height ?? 12, 4, 40)
  const size = clamp(options.size ?? 5, 3, 9)
  const p = options.palette ?? DEFAULT_PALETTE
  const draft = new Draft('tower')
  const max = size - 1

  draft.shell({ x: 0, y: 0, z: 0 }, { x: max, y: height - 1, z: max }, p.wall, 'wall')
  for (let y = 0; y < height; y++) {
    for (const [cx, cz] of [[0, 0], [0, max], [max, 0], [max, max]] as const) {
      draft.set(cx, y, cz, p.accent, 'accent')
    }
  }

  // Platform, then a one-block parapet around it.
  draft.box({ x: 0, y: height, z: 0 }, { x: max, y: height, z: max }, p.floor, 'floor')
  draft.shell({ x: 0, y: height + 1, z: 0 }, { x: max, y: height + 1, z: max }, p.wall, 'wall')
  draft.set(1, height + 1, 1, p.light, 'light', true)

  const doorX = Math.floor(size / 2)
  draft.clear(doorX, 0, 0)
  draft.clear(doorX, 1, 0)

  return draft.finish({ x: doorX, y: 0, z: -1 })
}

export interface StorageOptions {
  readonly chests?: number
  readonly palette?: Palette
}

/**
 * A storage room: a walled room lined with chests along both side walls.
 *
 * Sized from the number of chests asked for rather than the other way round, so
 * "build me somewhere to put sixteen chests" produces a room that fits sixteen
 * chests.
 */
export function storageRoom(options: StorageOptions = {}): Blueprint {
  const chests = clamp(options.chests ?? 8, 2, 32)
  const p = options.palette ?? DEFAULT_PALETTE
  const perSide = Math.ceil(chests / 2)
  const depth = clamp(perSide + 3, 5, 24)
  const width = 5
  const draft = new Draft('storage room')
  const maxX = width - 1
  const maxZ = depth - 1

  draft.box({ x: 0, y: 0, z: 0 }, { x: maxX, y: 0, z: maxZ }, p.floor, 'floor')
  draft.shell({ x: 0, y: 1, z: 0 }, { x: maxX, y: 3, z: maxZ }, p.wall, 'wall')
  draft.box({ x: 0, y: 4, z: 0 }, { x: maxX, y: 4, z: maxZ }, p.roof, 'roof')

  const doorX = Math.floor(width / 2)
  draft.clear(doorX, 1, 0)
  draft.clear(doorX, 2, 0)

  // Chests against both side walls, leaving the middle clear to walk down.
  let placed = 0
  for (let z = 2; z < maxZ && placed < chests; z++) {
    draft.set(1, 1, z, 'chest', 'furniture')
    placed++
    if (placed < chests) {
      draft.set(maxX - 1, 1, z, 'chest', 'furniture')
      placed++
    }
  }

  draft.set(2, 1, 1, p.light, 'light', true)
  draft.set(2, 1, maxZ - 1, p.light, 'light', true)

  return draft.finish({ x: doorX, y: 1, z: -1 })
}

export interface WallOptions {
  readonly length?: number
  readonly height?: number
  readonly palette?: Palette
}

/** A straight wall, for fencing something off. */
export function wall(options: WallOptions = {}): Blueprint {
  const length = clamp(options.length ?? 10, 2, 64)
  const height = clamp(options.height ?? 3, 1, 12)
  const p = options.palette ?? DEFAULT_PALETTE
  const draft = new Draft('wall')
  draft.box({ x: 0, y: 0, z: 0 }, { x: length - 1, y: height - 1, z: 0 }, p.wall, 'wall')
  return draft.finish({ x: 0, y: 0, z: -1 })
}

export interface PlatformOptions {
  readonly width?: number
  readonly depth?: number
  readonly palette?: Palette
}

/** A flat floor. Useful for levelling a slope before building on it. */
export function platform(options: PlatformOptions = {}): Blueprint {
  const width = clamp(options.width ?? 9, 1, 48)
  const depth = clamp(options.depth ?? 9, 1, 48)
  const p = options.palette ?? DEFAULT_PALETTE
  const draft = new Draft('platform')
  draft.box({ x: 0, y: 0, z: 0 }, { x: width - 1, y: 0, z: depth - 1 }, p.floor, 'floor')
  return draft.finish({ x: 0, y: 1, z: -1 })
}

export interface DesignRequest {
  readonly kind: 'house' | 'hut' | 'tower' | 'storage' | 'wall' | 'platform'
  readonly width?: number
  readonly depth?: number
  readonly height?: number
  readonly size?: number
  readonly length?: number
  readonly chests?: number
  readonly palette?: Palette
}

/** Build the blueprint a request names. */
export function design(request: DesignRequest): Blueprint {
  const palette = request.palette
  switch (request.kind) {
    case 'house':
      return house({ width: request.width, depth: request.depth, height: request.height, palette })
    case 'hut':
      return hut({ size: request.size ?? request.width, palette })
    case 'tower':
      return tower({ height: request.height, size: request.size ?? request.width, palette })
    case 'storage':
      return storageRoom({ chests: request.chests, palette })
    case 'wall':
      return wall({ length: request.length ?? request.width, height: request.height, palette })
    case 'platform':
      return platform({ width: request.width, depth: request.depth, palette })
  }
}

export const DESIGN_KINDS: readonly DesignRequest['kind'][] = [
  'house',
  'hut',
  'tower',
  'storage',
  'wall',
  'platform',
]

function clamp(value: number, min: number, max: number): number {
  const n = Math.round(value)
  if (!Number.isFinite(n)) return min
  return n < min ? min : n > max ? max : n
}

/**
 * A structure, as data.
 *
 * Everything downstream reads from this one representation: the bill of
 * materials the acquisition planner works from, the layer ordering the builder
 * follows, the site footprint, and the progress check that lets a half-built
 * house be resumed. Keeping the design separate from the act of building is
 * what makes "plan the whole thing, then go and do it" possible at all — you
 * cannot cost a house you are discovering as you place it.
 *
 * Coordinates are relative to the blueprint's own origin, which sits at the
 * minimum corner with y=0 as the floor. `place` turns them into world
 * positions.
 */

import type { Vec3Like } from '../memory/types.js'

/** What a block is for, so the material can be chosen later. */
export type Role =
  | 'floor'
  | 'wall'
  | 'accent'
  | 'roof'
  | 'window'
  | 'light'
  | 'door'
  | 'furniture'
  | 'path'

export interface Placement {
  readonly x: number
  readonly y: number
  readonly z: number
  /** Concrete block name, resolved from the role by `resolve`. */
  readonly block: string
  readonly role: Role
  /**
   * Skip without failing the build if this cannot be placed. Decoration and
   * furniture are optional; a load-bearing wall is not.
   */
  readonly optional?: boolean
}

export interface Blueprint {
  readonly name: string
  readonly placements: readonly Placement[]
  /** Cells that must be left empty — doorways, the interior, window holes. */
  readonly voids: readonly Vec3Like[]
  readonly size: { readonly x: number; readonly y: number; readonly z: number }
  /** Where a person walks in, relative to the origin. Used to orient the build. */
  readonly entrance: Vec3Like
}

export interface Materials {
  /** Block name -> how many are needed. */
  readonly required: ReadonlyMap<string, number>
  readonly total: number
}

/** Count what a blueprint needs, optional pieces included. */
export function materialsFor(blueprint: Blueprint): Materials {
  const required = new Map<string, number>()
  for (const p of blueprint.placements) {
    required.set(p.block, (required.get(p.block) ?? 0) + 1)
  }
  return { required, total: blueprint.placements.length }
}

/** Count only what the build genuinely cannot proceed without. */
export function essentialMaterials(blueprint: Blueprint): Materials {
  const required = new Map<string, number>()
  let total = 0
  for (const p of blueprint.placements) {
    if (p.optional) continue
    required.set(p.block, (required.get(p.block) ?? 0) + 1)
    total++
  }
  return { required, total }
}

/** The ground area the structure occupies, for site selection. */
export function footprint(blueprint: Blueprint): Array<{ x: number; z: number }> {
  const seen = new Set<string>()
  const out: Array<{ x: number; z: number }> = []
  for (const p of blueprint.placements) {
    const key = `${p.x},${p.z}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x: p.x, z: p.z })
  }
  return out
}

/**
 * Turn blueprint coordinates into world coordinates.
 *
 * `facing` rotates the design about its own centre in 90 degree steps, so a
 * house can be turned to face a road or the sunrise without every generator
 * needing to know about orientation.
 */
export function place(
  blueprint: Blueprint,
  origin: Vec3Like,
  facing: Facing = 'north',
): Blueprint {
  const turns = TURNS[facing]
  if (turns === 0 && origin.x === 0 && origin.y === 0 && origin.z === 0) return blueprint

  const rotated = blueprint.placements.map((p) => {
    const { x, z } = rotate(p.x, p.z, blueprint.size, turns)
    return { ...p, x: x + origin.x, y: p.y + origin.y, z: z + origin.z }
  })
  const voids = blueprint.voids.map((v) => {
    const { x, z } = rotate(v.x, v.z, blueprint.size, turns)
    return { x: x + origin.x, y: v.y + origin.y, z: z + origin.z }
  })
  const entrance = rotate(blueprint.entrance.x, blueprint.entrance.z, blueprint.size, turns)

  return {
    ...blueprint,
    placements: rotated,
    voids,
    size: turns % 2 === 0 ? blueprint.size : { ...blueprint.size, x: blueprint.size.z, z: blueprint.size.x },
    entrance: {
      x: entrance.x + origin.x,
      y: blueprint.entrance.y + origin.y,
      z: entrance.z + origin.z,
    },
  }
}

export type Facing = 'north' | 'east' | 'south' | 'west'

const TURNS: Record<Facing, number> = { north: 0, east: 1, south: 2, west: 3 }

function rotate(
  x: number,
  z: number,
  size: { x: number; z: number },
  turns: number,
): { x: number; z: number } {
  let cx = x
  let cz = z
  let width = size.x
  let depth = size.z
  for (let i = 0; i < turns; i++) {
    const nx = depth - 1 - cz
    const nz = cx
    cx = nx
    cz = nz
    const w = width
    width = depth
    depth = w
  }
  return { x: cx, z: cz }
}

/**
 * A builder for assembling designs without index arithmetic everywhere.
 *
 * Later writes to the same cell win, which is what lets a design lay down a
 * solid wall and then punch a window through it — the natural way to describe
 * a building, and much less error-prone than working out in advance which
 * cells the window will occupy.
 */
export class Draft {
  private readonly cells = new Map<string, Placement>()
  private readonly holes = new Map<string, Vec3Like>()

  constructor(readonly name: string) {}

  set(x: number, y: number, z: number, block: string, role: Role, optional = false): this {
    const key = `${x},${y},${z}`
    this.holes.delete(key)
    this.cells.set(key, { x, y, z, block, role, optional })
    return this
  }

  /** Mark a cell as deliberately empty, removing anything already there. */
  clear(x: number, y: number, z: number): this {
    const key = `${x},${y},${z}`
    this.cells.delete(key)
    this.holes.set(key, { x, y, z })
    return this
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(`${x},${y},${z}`)
  }

  /** Fill an inclusive box. */
  box(
    from: Vec3Like,
    to: Vec3Like,
    block: string,
    role: Role,
    optional = false,
  ): this {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          this.set(x, y, z, block, role, optional)
        }
      }
    }
    return this
  }

  /** Fill only the outer shell of a box, leaving the inside untouched. */
  shell(from: Vec3Like, to: Vec3Like, block: string, role: Role): this {
    const x0 = Math.min(from.x, to.x)
    const x1 = Math.max(from.x, to.x)
    const y0 = Math.min(from.y, to.y)
    const y1 = Math.max(from.y, to.y)
    const z0 = Math.min(from.z, to.z)
    const z1 = Math.max(from.z, to.z)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const onEdge = x === x0 || x === x1 || z === z0 || z === z1
          if (onEdge) this.set(x, y, z, block, role)
        }
      }
    }
    return this
  }

  clearBox(from: Vec3Like, to: Vec3Like): this {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          this.clear(x, y, z)
        }
      }
    }
    return this
  }

  finish(entrance: Vec3Like): Blueprint {
    const placements = [...this.cells.values()]
    let maxX = 0
    let maxY = 0
    let maxZ = 0
    for (const p of placements) {
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      maxZ = Math.max(maxZ, p.z)
    }
    return {
      name: this.name,
      placements,
      voids: [...this.holes.values()],
      size: { x: maxX + 1, y: maxY + 1, z: maxZ + 1 },
      entrance,
    }
  }
}

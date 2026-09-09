/**
 * Putting blocks down: shelters, lighting, and small structures.
 *
 * The shelter is the one that earns its place. Night falls, mobs spawn, and the
 * correct response for a player caught in the open is not to fight — it is to
 * dig two blocks into a hillside and seal the door. That takes about eight
 * seconds and reliably survives until morning.
 */

import { Vec3 } from 'vec3'
import { equipTool } from './survive.js'
import { checkCancelled, fail, ok, type SkillContext, type SkillResult } from './types.js'

/** Blocks worth spending on a wall, cheapest first. */
const BUILDING_BLOCKS = ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite', 'netherrack', 'oak_planks']

export function pickBuildingBlock(ctx: SkillContext): string | null {
  const held = new Map(ctx.bot.inventory.items().map((i) => [i.name, i.count] as const))
  return BUILDING_BLOCKS.find((name) => (held.get(name) ?? 0) > 0) ?? null
}

/**
 * Place a specific block at a specific position.
 *
 * Placement in Minecraft is always relative: you click a face of an existing
 * block. So this looks for any solid neighbour to build off, and reports
 * honestly when the spot is floating in mid-air with nothing to attach to.
 */
export async function placeAt(
  ctx: SkillContext,
  position: Vec3,
  blockName: string,
): Promise<SkillResult> {
  const target = ctx.bot.blockAt(position)
  if (target && target.boundingBox === 'block') return ok(`${position} is already solid`)

  const item = ctx.bot.inventory.items().find((i) => i.name === blockName)
  if (!item) return fail(`no ${blockName} to place`)

  const faces: Vec3[] = [
    new Vec3(0, -1, 0), new Vec3(0, 1, 0),
    new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
    new Vec3(0, 0, -1), new Vec3(0, 0, 1),
  ]

  if (ctx.bot.entity.position.distanceTo(position) > 4) {
    const travel = await ctx.nav.travelTo(position, { range: 3 })
    if (!travel.arrived) return fail(`could not reach ${format(position)}`)
  }

  await ctx.bot.equip(item, 'hand')
  for (const face of faces) {
    const reference = ctx.bot.blockAt(position.plus(face))
    if (!reference || reference.boundingBox !== 'block') continue
    try {
      await ctx.golem.gate('reflex')
      await ctx.golem.lookAt(position.offset(0.5, 0.5, 0.5), 0.4)
      // The face vector points from the reference block back toward the target.
      await ctx.bot.placeBlock(reference, face.scaled(-1))
      return ok(`placed ${blockName} at ${format(position)}`)
    } catch {
      continue
    }
  }
  return fail(`nothing to build off at ${format(position)}`)
}

/**
 * Seal the bot into a small safe pocket.
 *
 * Digs into the ground rather than building a box on the surface: a hole is
 * three blocks of work instead of nine, and it cannot be seen from a distance.
 */
export async function shelter(ctx: SkillContext): Promise<SkillResult> {
  const material = pickBuildingBlock(ctx)
  if (!material) return fail('nothing to build a shelter out of')

  const base = ctx.bot.entity.position.floored()

  // Dig two down and one along, so the bot ends up under an overhang it made.
  const pit = base.offset(0, -1, 0)
  const floor = ctx.bot.blockAt(pit)
  if (floor && ctx.bot.canDigBlock(floor)) {
    await ctx.golem.lookAt(pit.offset(0.5, 0.5, 0.5), 0.4)
    try {
      await ctx.bot.dig(floor)
    } catch {
      return fail('could not dig down for a shelter')
    }
  }

  await new Promise((r) => setTimeout(r, 500))

  // Seal every opening around head and foot level, and the ceiling.
  const openings = [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    new Vec3(1, 1, 0), new Vec3(-1, 1, 0), new Vec3(0, 1, 1), new Vec3(0, 1, -1),
    new Vec3(0, 2, 0),
  ]

  const here = ctx.bot.entity.position.floored()
  let sealed = 0
  for (const offset of openings) {
    checkCancelled(ctx)
    const spot = here.plus(offset)
    const existing = ctx.bot.blockAt(spot)
    if (existing && existing.boundingBox === 'block') continue
    const result = await placeAt(ctx, spot, material)
    if (result.ok) sealed++
  }

  await light(ctx)
  return sealed > 0
    ? ok(`sealed in with ${sealed} blocks of ${material}`, { sealed })
    : fail('could not seal a shelter')
}

/** Put a torch down if it is dark and we have one. */
export async function light(ctx: SkillContext): Promise<SkillResult> {
  const torch = ctx.bot.inventory.items().find((i) => i.name === 'torch')
  if (!torch) return ok('no torches')

  const here = ctx.bot.entity.position.floored()
  const block = ctx.bot.blockAt(here)
  if (block && block.light >= 8) return ok('bright enough already')

  await equipTool(ctx, 'torch')
  const floor = ctx.bot.blockAt(here.offset(0, -1, 0))
  if (!floor || floor.boundingBox !== 'block') return fail('no floor to stand a torch on')

  try {
    await ctx.golem.lookAt(here.offset(0.5, 0, 0.5), 0.4)
    await ctx.bot.placeBlock(floor, new Vec3(0, 1, 0))
    return ok('placed a torch')
  } catch (error) {
    return fail(`could not place a torch: ${String(error)}`)
  }
}

/**
 * Build a rectangular box of a given size, hollow, with a doorway.
 *
 * Small on purpose. Anything larger wants a schematic format and a materials
 * plan, and a half-finished mansion is worse than no mansion.
 */
export async function buildRoom(
  ctx: SkillContext,
  width: number,
  depth: number,
  height: number,
  blockName?: string,
): Promise<SkillResult> {
  const material = blockName ?? pickBuildingBlock(ctx)
  if (!material) return fail('nothing to build with')

  const w = clampSize(width)
  const d = clampSize(depth)
  const h = Math.max(2, Math.min(6, Math.round(height)))
  const origin = ctx.bot.entity.position.floored().offset(2, 0, 2)

  const needed = 2 * (w + d) * h + w * d
  const have = ctx.bot.inventory.items()
    .filter((i) => i.name === material)
    .reduce((n, i) => n + i.count, 0)
  if (have < needed) {
    return fail(`need about ${needed} ${material} for a ${w}x${d}x${h} room, have ${have}`)
  }

  let placed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        checkCancelled(ctx)
        const isWall = x === 0 || z === 0 || x === w - 1 || z === d - 1
        if (!isWall) continue
        // Leave a two-high doorway in the middle of one wall.
        if (z === 0 && x === Math.floor(w / 2) && y < 2) continue
        const result = await placeAt(ctx, origin.offset(x, y, z), material)
        if (result.ok) placed++
      }
    }
  }

  // Roof.
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      checkCancelled(ctx)
      const result = await placeAt(ctx, origin.offset(x, h, z), material)
      if (result.ok) placed++
    }
  }

  return ok(`built a ${w}x${d}x${h} room out of ${placed} ${material}`, { placed })
}

function clampSize(n: number): number {
  return Math.max(3, Math.min(12, Math.round(n)))
}

function format(v: Vec3): string {
  return `${v.x}, ${v.y}, ${v.z}`
}

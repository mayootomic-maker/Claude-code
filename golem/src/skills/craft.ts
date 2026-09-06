/**
 * Crafting and smelting.
 *
 * The awkward part is that our planner and mineflayer's `recipesFor` are two
 * different views of the same recipe book, and they have to agree. The planner
 * decides *that* a thing should be crafted from a particular set of inputs;
 * mineflayer needs its own Recipe object to actually place items in the grid.
 * So the planner's decision is re-resolved here against what the bot is holding
 * — which is also the point where "the plan said I had three planks but I have
 * two" surfaces as a clean failure instead of a silent no-op.
 */

import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import { inventoryMap } from '../bot/world.js'
import { checkCancelled, fail, ok, type SkillContext, type SkillResult } from './types.js'

/** Craft until the inventory holds `count` more of the item than it does now. */
export async function craft(ctx: SkillContext, itemName: string, count: number): Promise<SkillResult> {
  const item = ctx.data.item(itemName)
  if (!item) return fail(`there is no item called "${itemName}"`)

  const before = inventoryMap(ctx.bot).get(itemName) ?? 0

  // Try without a table first. `recipesFor(id, meta, minCount, table)` returns
  // only what is craftable right now, so an empty list here means either the
  // recipe needs a table or the ingredients are not actually present.
  let table: Block | null = null
  let recipes = ctx.bot.recipesFor(item.id, null, 1, null)

  if (recipes.length === 0) {
    table = await ensureCraftingTable(ctx)
    if (!table) return fail(`need a crafting table to make ${itemName} and could not place one`)
    recipes = ctx.bot.recipesFor(item.id, null, 1, table)
  }

  const recipe = recipes[0]
  if (!recipe) {
    return fail(`cannot craft ${itemName} right now — missing ingredients`, { item: itemName })
  }

  const perCraft = recipe.result.count || 1
  const times = Math.max(1, Math.ceil(count / perCraft))

  await ctx.golem.gate('normal')
  try {
    await ctx.bot.craft(recipe, times, table ?? undefined)
  } catch (error) {
    return fail(`crafting ${itemName} failed: ${String(error)}`)
  }

  const after = inventoryMap(ctx.bot).get(itemName) ?? 0
  if (after <= before) return fail(`crafting ${itemName} produced nothing`)
  return ok(`crafted ${after - before} ${itemName}`, { item: itemName, made: after - before })
}

/**
 * Find a crafting table within reach, or place one from the inventory.
 *
 * Placing it and leaving it is on purpose: a player who needs a table twice
 * does not pick it back up in between.
 */
export async function ensureCraftingTable(ctx: SkillContext): Promise<Block | null> {
  return ensureStation(ctx, 'crafting_table')
}

export async function ensureFurnace(ctx: SkillContext): Promise<Block | null> {
  return ensureStation(ctx, 'furnace')
}

async function ensureStation(ctx: SkillContext, blockName: string): Promise<Block | null> {
  const info = ctx.data.block(blockName)
  if (!info) return null

  const existing = ctx.bot.findBlock({ matching: info.id, maxDistance: 24, count: 1 })
  if (existing) {
    const distance = ctx.bot.entity.position.distanceTo(existing.position)
    if (distance > 3.5) {
      const travel = await ctx.nav.travelTo(existing.position, { range: 2 })
      if (!travel.arrived) return null
    }
    return existing
  }

  const carried = ctx.bot.inventory.items().find((i) => i.name === blockName)
  if (!carried) return null

  const placed = await placeBlockNearby(ctx, blockName)
  if (!placed.ok) return null
  return ctx.bot.findBlock({ matching: info.id, maxDistance: 6, count: 1 })
}

/**
 * Put a block down somewhere sensible next to the bot.
 *
 * Placement needs a reference block and a face to build off, so this looks for
 * a solid block with air above it within arm's reach and builds on top.
 */
export async function placeBlockNearby(ctx: SkillContext, blockName: string): Promise<SkillResult> {
  const item = ctx.bot.inventory.items().find((i) => i.name === blockName)
  if (!item) return fail(`no ${blockName} in the inventory`)

  const origin = ctx.bot.entity.position.floored()
  const candidates: Vec3[] = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dz === 0) continue
        candidates.push(origin.offset(dx, dy, dz))
      }
    }
  }
  candidates.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))

  for (const position of candidates) {
    const support = ctx.bot.blockAt(position)
    const above = ctx.bot.blockAt(position.offset(0, 1, 0))
    if (!support || !above) continue
    if (support.boundingBox !== 'block') continue
    if (above.boundingBox !== 'empty') continue

    await ctx.golem.gate('normal')
    try {
      await ctx.bot.equip(item, 'hand')
      await ctx.golem.lookAt(position.offset(0.5, 1, 0.5), 0.4)
      await ctx.bot.placeBlock(support, new Vec3(0, 1, 0))
      return ok(`placed ${blockName}`, { at: position })
    } catch {
      // That spot did not work; try the next one rather than giving up.
      continue
    }
  }
  return fail(`nowhere to place a ${blockName}`)
}

/**
 * Smelt items in a furnace.
 *
 * Waits for the output rather than assuming it: a furnace with too little fuel
 * silently produces less than asked, and returning success for a smelt that did
 * not happen makes the caller's inventory check the thing that fails, several
 * steps later, with no useful message.
 */
export async function smelt(
  ctx: SkillContext,
  itemName: string,
  count: number,
  inputName: string,
  fuelName: string,
  fuelCount: number,
): Promise<SkillResult> {
  const furnaceBlock = await ensureFurnace(ctx)
  if (!furnaceBlock) return fail('need a furnace and could not find or place one')

  const input = ctx.bot.inventory.items().find((i) => i.name === inputName)
  if (!input) return fail(`no ${inputName} to smelt`)
  const fuel = ctx.bot.inventory.items().find((i) => i.name === fuelName)
  if (!fuel) return fail(`no ${fuelName} to burn`)

  await ctx.golem.gate('normal')
  const furnace = await ctx.bot.openFurnace(furnaceBlock)

  try {
    await furnace.putFuel(fuel.type, null, Math.min(fuelCount, fuel.count))
    await furnace.putInput(input.type, null, Math.min(count, input.count))

    // Ten seconds per item plus slack for the furnace to light.
    const deadline = Date.now() + count * 12_000 + 15_000
    let taken = 0
    while (taken < count && Date.now() < deadline) {
      checkCancelled(ctx)
      await new Promise((r) => setTimeout(r, 1_000))
      const output = furnace.outputItem()
      if (!output) continue
      await furnace.takeOutput()
      taken += output.count
    }

    if (taken === 0) return fail(`the furnace produced no ${itemName}`)
    return ok(`smelted ${taken} ${itemName}`, { item: itemName, made: taken })
  } catch (error) {
    return fail(`smelting failed: ${String(error)}`)
  } finally {
    furnace.close()
  }
}

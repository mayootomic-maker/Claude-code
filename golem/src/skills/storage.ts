/**
 * Chests: putting things in and taking things out.
 *
 * The bot keeps a small kit — tools, food, blocks to bridge with — and deposits
 * the rest. Without that rule it either deposits its own pickaxe and then
 * cannot mine, or it fills up with cobblestone and cannot pick up the diamonds
 * it went down there for.
 */

import type { Block } from 'prismarine-block'
import { inventoryMap } from '../bot/world.js'
import { fail, ok, type SkillContext, type SkillResult } from './types.js'

/** Never deposited: the bot needs these to function. */
const KEEP_PATTERNS = [
  /_pickaxe$/, /_axe$/, /_shovel$/, /_sword$/, /_hoe$/,
  /_helmet$/, /_chestplate$/, /_leggings$/, /_boots$/,
  /^torch$/, /^crafting_table$/, /^furnace$/, /^water_bucket$/, /^shield$/,
]

/** Kept in limited quantity: useful to carry, not worth hoarding on the belt. */
const KEEP_SOME: Readonly<Record<string, number>> = {
  cobblestone: 64,
  dirt: 32,
  coal: 16,
  oak_planks: 32,
}

function isFood(ctx: SkillContext, name: string): boolean {
  const item = ctx.data.item(name)
  return item ? ctx.data.food(item.id) !== null : false
}

async function nearestChest(ctx: SkillContext, maxDistance = 32): Promise<Block | null> {
  const chest = ctx.bot.findBlock({
    matching: (block) =>
      block != null && (block.name === 'chest' || block.name === 'barrel' || block.name === 'trapped_chest'),
    maxDistance,
    count: 1,
  })
  if (!chest) return null
  if (ctx.bot.entity.position.distanceTo(chest.position) > 3.5) {
    const travel = await ctx.nav.travelTo(chest.position, { range: 2 })
    if (!travel.arrived) return null
  }
  return chest
}

/**
 * Deposit everything not needed to keep working.
 *
 * `only` narrows it to particular items when the caller knows what it wants
 * stored; otherwise the keep rules decide.
 */
export async function deposit(ctx: SkillContext, only?: readonly string[]): Promise<SkillResult> {
  const chest = await nearestChest(ctx)
  if (!chest) return fail('no chest nearby')

  await ctx.golem.gate('normal')
  const container = await ctx.bot.openContainer(chest)
  let stored = 0
  const storedNames: string[] = []

  try {
    for (const item of ctx.bot.inventory.items()) {
      if (only && !only.includes(item.name)) continue
      if (!only) {
        if (KEEP_PATTERNS.some((p) => p.test(item.name))) continue
        if (isFood(ctx, item.name)) continue
        const keep = KEEP_SOME[item.name]
        if (keep !== undefined && item.count <= keep) continue
      }

      const amount = only ? item.count : Math.max(0, item.count - (KEEP_SOME[item.name] ?? 0))
      if (amount <= 0) continue

      try {
        await container.deposit(item.type, null, amount)
        stored += amount
        storedNames.push(`${amount} ${item.name}`)
      } catch {
        // A full chest throws. Stop rather than hammering it.
        break
      }
    }
  } finally {
    container.close()
  }

  return stored > 0
    ? ok(`stored ${storedNames.join(', ')}`, { stored })
    : ok('nothing worth storing')
}

export async function withdraw(
  ctx: SkillContext,
  itemName: string,
  count: number,
): Promise<SkillResult> {
  const chest = await nearestChest(ctx)
  if (!chest) return fail('no chest nearby')

  const item = ctx.data.item(itemName)
  if (!item) return fail(`there is no item called "${itemName}"`)

  await ctx.golem.gate('normal')
  const container = await ctx.bot.openContainer(chest)
  try {
    const available = container
      .containerItems()
      .filter((i) => i.name === itemName)
      .reduce((n, i) => n + i.count, 0)

    if (available === 0) return fail(`the chest has no ${itemName}`)
    const amount = Math.min(count, available)
    await container.withdraw(item.id, null, amount)
    return ok(`took ${amount} ${itemName}`, { item: itemName, count: amount })
  } catch (error) {
    return fail(`could not take ${itemName}: ${String(error)}`)
  } finally {
    container.close()
  }
}

/** What is in the nearest chest, for answering "what have we got stored?". */
export async function listChest(ctx: SkillContext): Promise<SkillResult> {
  const chest = await nearestChest(ctx)
  if (!chest) return fail('no chest nearby')

  const container = await ctx.bot.openContainer(chest)
  try {
    const totals = new Map<string, number>()
    for (const item of container.containerItems()) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
    }
    const summary = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${n} ${name}`)
    return ok(summary.length > 0 ? summary.join(', ') : 'the chest is empty', {
      contents: Object.fromEntries(totals),
    })
  } finally {
    container.close()
  }
}


export function carrying(ctx: SkillContext, itemName: string): number {
  return inventoryMap(ctx.bot).get(itemName) ?? 0
}

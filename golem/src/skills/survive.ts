/**
 * Staying alive, and the reflexes that run without being asked.
 *
 * These are the behaviours that make the difference between a bot that
 * completes a two-hour mining task and one that dies twenty minutes in with a
 * full inventory. They are checked continuously by the agent loop rather than
 * being things the model has to remember to do — a language model asked to
 * "mine diamonds" will not reliably notice it is on fire.
 */

import { Vec3 } from 'vec3'
import { TOOL_TIERS } from '../mc/data.js'
import { inventoryMap } from '../bot/world.js'
import { fail, ok, type SkillContext, type SkillResult } from './types.js'

/** Below this, stop what we are doing and deal with it. */
export const DANGER_HEALTH = 8
/** Below this, eat before carrying on; sprinting stops at 6 anyway. */
export const HUNGRY_FOOD = 16

/** Foods the bot should not eat even when starving, and why. */
const AVOID_EATING = new Set([
  'rotten_flesh', // hunger effect
  'spider_eye', // poison
  'poisonous_potato',
  'pufferfish',
  'chicken', // raw, food poisoning
  'suspicious_stew',
  'golden_apple', // too valuable to eat as a snack
  'enchanted_golden_apple',
  'chorus_fruit', // teleports you somewhere random
])

export async function equipTool(ctx: SkillContext, itemName: string): Promise<SkillResult> {
  const current = ctx.bot.heldItem
  if (current?.name === itemName) return ok(`already holding ${itemName}`)

  const item = ctx.bot.inventory.items().find((i) => i.name === itemName)
  if (!item) return fail(`no ${itemName} in the inventory`)

  try {
    // Swapping to the right tool is a hotbar keypress, not a decision, so it
    // gets a reflex-speed gate rather than a full reaction delay.
    await ctx.golem.gate('reflex')
    await ctx.bot.equip(item, 'hand')
    return ok(`equipped ${itemName}`)
  } catch (error) {
    return fail(`could not equip ${itemName}: ${String(error)}`)
  }
}

/** Put on the best armour carried, for each slot. */
export async function equipArmour(ctx: SkillContext): Promise<SkillResult> {
  const slots = [
    ['helmet', 'head'],
    ['chestplate', 'torso'],
    ['leggings', 'legs'],
    ['boots', 'feet'],
  ] as const

  const held = ctx.bot.inventory.items()
  let worn = 0

  for (const [piece, destination] of slots) {
    let best: { name: string; rank: number } | null = null
    for (const item of held) {
      if (!item.name.endsWith(`_${piece}`)) continue
      const tier = item.name.slice(0, item.name.length - piece.length - 1)
      const rank = TOOL_TIERS.indexOf(tier as never)
      const score = rank >= 0 ? rank : tier === 'leather' ? -1 : -2
      if (!best || score > best.rank) best = { name: item.name, rank: score }
    }
    if (!best) continue
    const item = held.find((i) => i.name === best.name)
    if (!item) continue
    try {
      await ctx.bot.equip(item, destination)
      worn++
    } catch {
      // A full slot with better armour already in it throws; that is fine.
    }
  }
  return ok(worn > 0 ? `put on ${worn} pieces of armour` : 'no armour worth wearing')
}

/**
 * Eat something, choosing by saturation rather than by hunger points.
 *
 * Saturation is what actually determines how long before the bot is hungry
 * again, so eating the most filling thing carried means fewer interruptions.
 */
export async function eat(ctx: SkillContext): Promise<SkillResult> {
  if ((ctx.bot.food ?? 20) >= 20) return ok('not hungry')

  const edible = ctx.bot.inventory
    .items()
    .map((item) => ({ item, food: ctx.data.food(item.type) }))
    .filter((entry) => entry.food !== null && !AVOID_EATING.has(entry.item.name))
    .sort((a, b) => (b.food!.saturation ?? 0) - (a.food!.saturation ?? 0))

  const choice = edible[0]
  if (!choice) return fail('nothing safe to eat')

  try {
    await ctx.golem.gate('normal')
    await ctx.bot.equip(choice.item, 'hand')
    await ctx.bot.consume()
    return ok(`ate ${choice.item.name}`, { item: choice.item.name })
  } catch (error) {
    return fail(`could not eat: ${String(error)}`)
  }
}

/**
 * Break away from a fight and put distance between us and it.
 *
 * Runs directly away from the threat rather than pathing to a safe place,
 * because pathfinding takes time the bot does not have at four hearts. Twenty
 * blocks is past most mobs' pursuit range.
 */
export async function flee(ctx: SkillContext, fromPosition?: Vec3): Promise<SkillResult> {
  const here = ctx.bot.entity.position
  const threat =
    fromPosition ??
    ctx.bot.nearestEntity((e) => e.type === 'hostile' || e.kind === 'Hostile mobs')?.position

  if (!threat) return ok('nothing to run from')

  const away = here.minus(threat).normalize().scaled(20)
  const destination = here.plus(new Vec3(away.x, 0, away.z))

  const travel = await ctx.nav.travelTo(destination, { range: 4, timeoutMs: 15_000, canDig: false })
  return travel.arrived
    ? ok('got away')
    : fail(`could not get away: ${travel.reason}`)
}

/**
 * The continuous safety check.
 *
 * Returns an action the caller should take before doing anything else, or null
 * when things are fine. Kept as a pure-ish decision rather than acting directly
 * so the agent loop stays in charge of what interrupts what.
 */
export type Urgency =
  | { readonly kind: 'flee'; readonly reason: string }
  | { readonly kind: 'eat'; readonly reason: string }
  | { readonly kind: 'fight'; readonly reason: string; readonly entityId: number }
  | { readonly kind: 'surface'; readonly reason: string }

export function assessDanger(ctx: SkillContext): Urgency | null {
  const health = ctx.bot.health ?? 20
  const food = ctx.bot.food ?? 20
  const inventory = inventoryMap(ctx.bot)

  const hostile = ctx.bot.nearestEntity(
    (entity) =>
      (entity.type === 'hostile' || entity.kind === 'Hostile mobs') &&
      entity.position.distanceTo(ctx.bot.entity.position) < 12,
  )

  if (health <= DANGER_HEALTH && hostile) {
    return { kind: 'flee', reason: `on ${Math.round(health)} health with a ${hostile.name ?? 'mob'} nearby` }
  }

  if (health < 20 && food >= HUNGRY_FOOD && !hostile) {
    // Regeneration runs off saturation, so the fix for low health with a full
    // belly is to wait, not to eat.
    return null
  }

  if (food <= HUNGRY_FOOD) {
    const hasFood = [...inventory.keys()].some(
      (name) => !AVOID_EATING.has(name) && ctx.data.food(ctx.data.item(name)?.id ?? -1) !== null,
    )
    if (hasFood) return { kind: 'eat', reason: `food at ${Math.round(food)}` }
  }

  if (hostile) {
    const distance = hostile.position.distanceTo(ctx.bot.entity.position)
    const creeper = hostile.name === 'creeper'
    // A creeper close enough to hurt is a running problem, not a fighting one.
    if (creeper && distance < 5) return { kind: 'flee', reason: 'creeper too close' }
    if (distance < 6 && health > DANGER_HEALTH) {
      return { kind: 'fight', reason: `a ${hostile.name ?? 'mob'} is on us`, entityId: hostile.id }
    }
  }

  if ((ctx.bot.oxygenLevel ?? 20) < 6) {
    return { kind: 'surface', reason: 'running out of air' }
  }

  return null
}

/** Sleep in a bed if there is one, which skips the night and sets spawn. */
export async function sleep(ctx: SkillContext): Promise<SkillResult> {
  const bed = ctx.bot.findBlock({
    matching: (block) => block != null && block.name.endsWith('_bed'),
    maxDistance: 32,
    count: 1,
  })
  if (!bed) return fail('no bed nearby')

  const travel = await ctx.nav.travelTo(bed.position, { range: 2 })
  if (!travel.arrived) return fail(`could not reach the bed: ${travel.reason}`)

  try {
    await ctx.golem.gate('normal')
    await ctx.bot.sleep(bed)
    return ok('went to sleep')
  } catch (error) {
    return fail(`could not sleep: ${String(error)}`)
  }
}


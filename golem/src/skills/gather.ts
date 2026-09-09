/**
 * Getting things: mining, hunting, and running a whole acquisition plan.
 *
 * `acquire` is where the planner meets the world. The plan says what to do in
 * what order; this does it, and re-plans when reality disagrees — which it
 * does constantly. The ore vein was smaller than the cluster estimate, the
 * pickaxe broke, something else picked up the drops. Re-planning from the
 * current inventory after each failure is what turns a brittle script into
 * something that finishes.
 */

import type { Block } from 'prismarine-block'
import { bestHeldTool } from '../mc/mining.js'
import { inventoryMap } from '../bot/world.js'
import type { Plan, Step } from '../plan/acquire.js'
import { checkCancelled, fail, ok, type SkillContext, type SkillResult } from './types.js'
import { craft, smelt } from './craft.js'
import { equipTool } from './survive.js'

/** How many times a plan may be rebuilt before we admit it is not working. */
const MAX_REPLANS = 4

export async function acquire(
  ctx: SkillContext,
  itemName: string,
  count: number,
): Promise<SkillResult> {
  const target = ctx.data.item(itemName)
  if (!target) return fail(`there is no item called "${itemName}"`)

  for (let attempt = 0; attempt <= MAX_REPLANS; attempt++) {
    checkCancelled(ctx)
    const held = inventoryMap(ctx.bot).get(itemName) ?? 0
    if (held >= count) {
      return ok(`have ${held} ${itemName}`, { item: itemName, count: held })
    }

    const planner = ctx.planner.withKnowledge({ searchOverrides: ctx.memory.searchTimes() })
    const plan = planner.plan(itemName, count, inventoryMap(ctx.bot))

    if (!plan.feasible) {
      return fail(
        `cannot get ${itemName}: no way to obtain ${plan.missing.join(', ')}`,
        { missing: plan.missing },
      )
    }

    ctx.log.info('plan', {
      goal: `${count}x ${itemName}`,
      steps: plan.steps.length,
      minutes: Math.round(plan.seconds / 60),
      attempt,
    })

    const outcome = await runPlan(ctx, plan)
    if (outcome.ok) continue // loop re-checks the inventory and exits if done
    if (outcome.data?.fatal) return outcome
    ctx.log.warn('step failed, replanning', { reason: outcome.detail })
  }

  const held = inventoryMap(ctx.bot).get(itemName) ?? 0
  return held >= count
    ? ok(`have ${held} ${itemName}`)
    : fail(`gave up after ${MAX_REPLANS} attempts; have ${held} of ${count} ${itemName}`)
}

async function runPlan(ctx: SkillContext, plan: Plan): Promise<SkillResult> {
  for (const step of plan.steps) {
    checkCancelled(ctx)
    const result = await runStep(ctx, step)
    if (!result.ok) return result
  }
  return ok('plan complete')
}

async function runStep(ctx: SkillContext, step: Step): Promise<SkillResult> {
  switch (step.kind) {
    case 'have':
      return ok(`already holding ${step.count} ${step.item}`)
    case 'mine':
      return mineFor(ctx, step.block, step.item, step.count, step.tool)
    case 'hunt':
      return hunt(ctx, step.entity, step.item, step.count)
    case 'craft':
      return craft(ctx, step.item, step.count)
    case 'smelt':
      return smelt(ctx, step.item, step.count, step.input, step.fuel, step.fuelCount)
  }
}

/**
 * Mine `count` of an item out of a named block kind.
 *
 * Stops early when the inventory reaches the target rather than mining the
 * planned number of blocks: the plan's block count is derived from average
 * drop yields, and averages are wrong in both directions on any given vein.
 */
export async function mineFor(
  ctx: SkillContext,
  blockName: string,
  itemName: string,
  count: number,
  preferredTool: string | null = null,
): Promise<SkillResult> {
  const blockInfo = ctx.data.block(blockName)
  if (!blockInfo) return fail(`there is no block called "${blockName}"`)

  if (preferredTool) await equipTool(ctx, preferredTool)

  const startingCount = inventoryMap(ctx.bot).get(itemName) ?? 0
  let mined = 0
  let misses = 0

  while ((inventoryMap(ctx.bot).get(itemName) ?? 0) < startingCount + count) {
    checkCancelled(ctx)
    if (misses >= 3) {
      return fail(`ran out of reachable ${blockName} after ${mined} blocks`, { mined })
    }

    const found = ctx.bot.findBlock({ matching: blockInfo.id, maxDistance: 96, count: 1 })
    if (!found) {
      // Nothing in range. The caller decides whether to explore or give up.
      return fail(`no ${blockName} within range`, { mined, needsExploration: true })
    }

    const result = await breakBlock(ctx, found)
    if (result.ok) {
      mined++
      misses = 0
      ctx.memory.sawBlock(blockName, found.position, ctx.bot.entity.position)
    } else {
      misses++
    }
  }

  return ok(`mined ${mined} ${blockName}`, { mined, item: itemName })
}

/** Walk to a block, look at it properly, and break it. */
export async function breakBlock(ctx: SkillContext, block: Block): Promise<SkillResult> {
  const distance = ctx.bot.entity.position.distanceTo(block.position)
  if (distance > 4) {
    const travel = await ctx.nav.travelTo(block.position, { range: 3 })
    if (!travel.arrived) return fail(`could not reach the ${block.name}: ${travel.reason}`)
  }

  // Re-read: the world may have changed while we walked, and digging a block
  // that is no longer there throws rather than returning.
  const current = ctx.bot.blockAt(block.position)
  if (!current || current.name !== block.name) return fail(`the ${block.name} is gone`)

  // A live prismarine Block is not the same shape as the static block table
  // entry the tool model works from, so look the static one up by name.
  const info = ctx.data.block(current.name)
  const tool = info
    ? bestHeldTool(ctx.data, info, ctx.bot.inventory.items().map((i) => i.name))
    : null
  if (tool) await equipTool(ctx, tool)
  if (!ctx.bot.canDigBlock(current)) return fail(`cannot break ${current.name}`)

  await ctx.golem.gate('normal')
  // Aim at the centre of the block's face. A wide target: nobody centres the
  // crosshair precisely on a block they are about to break.
  await ctx.golem.lookAt(current.position.offset(0.5, 0.5, 0.5), 0.35)

  try {
    await ctx.bot.dig(current)
  } catch (error) {
    return fail(`digging failed: ${String(error)}`)
  }

  // Give the drops a moment to fly out and be collected before moving on.
  await collectNearbyDrops(ctx)
  return ok(`broke ${current.name}`)
}

/**
 * Walk over anything that dropped nearby.
 *
 * Items are pulled in by proximity, so this is just standing near them; the
 * only reason it needs code at all is that the bot otherwise walks off before
 * the pickup radius does its work.
 */
export async function collectNearbyDrops(ctx: SkillContext, radius = 6): Promise<void> {
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    const drop = ctx.bot.nearestEntity(
      (entity) =>
        entity.name === 'item' &&
        entity.position.distanceTo(ctx.bot.entity.position) < radius,
    )
    if (!drop) return
    if (drop.position.distanceTo(ctx.bot.entity.position) < 1.2) {
      await new Promise((r) => setTimeout(r, 250))
      continue
    }
    const travel = await ctx.nav.travelTo(drop.position, { range: 0, timeoutMs: 4_000 })
    if (!travel.arrived) return
  }
}

export async function hunt(
  ctx: SkillContext,
  entityName: string,
  itemName: string,
  count: number,
): Promise<SkillResult> {
  const startingCount = inventoryMap(ctx.bot).get(itemName) ?? 0
  let kills = 0

  while ((inventoryMap(ctx.bot).get(itemName) ?? 0) < startingCount + count) {
    checkCancelled(ctx)
    const target = ctx.bot.nearestEntity((entity) => entity.name === entityName)
    if (!target) return fail(`no ${entityName} nearby`, { kills, needsExploration: true })

    const result = await killEntity(ctx, target.id)
    if (!result.ok) return result
    kills++
    await collectNearbyDrops(ctx)
  }
  return ok(`killed ${kills} ${entityName}`, { kills })
}

/** Chase and hit something until it stops existing. */
export async function killEntity(ctx: SkillContext, entityId: number): Promise<SkillResult> {
  const deadline = Date.now() + 60_000
  const best = bestWeapon(ctx)
  if (best) await equipTool(ctx, best)

  while (Date.now() < deadline) {
    checkCancelled(ctx)
    const target = ctx.bot.entities[entityId]
    if (!target || !target.isValid) return ok('target is down')

    const distance = ctx.bot.entity.position.distanceTo(target.position)
    if (distance > 3.5) {
      const travel = await ctx.nav.travelTo(target.position, { range: 2, timeoutMs: 12_000 })
      if (!travel.arrived && travel.reason !== 'interrupted') {
        return fail(`could not reach the target: ${travel.reason}`)
      }
      continue
    }

    await ctx.golem.gate('reflex')
    // A mob's head is a narrow target and it is moving, so aim gets the full
    // Fitts treatment here rather than the loose aim used for blocks.
    await ctx.golem.lookAt(target.position.offset(0, target.height * 0.85, 0), 0.08)
    ctx.bot.attack(target)
    // Attack cooldown: swinging faster than this does no extra damage and is a
    // very loud tell.
    await new Promise((r) => setTimeout(r, 620 + Math.random() * 180))
  }
  return fail('gave up on the target')
}

function bestWeapon(ctx: SkillContext): string | null {
  const ranked = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe']
  const held = new Set(ctx.bot.inventory.items().map((i) => i.name))
  return ranked.find((name) => held.has(name)) ?? null
}


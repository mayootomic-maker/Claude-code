/**
 * How long a block takes to break, and with what.
 *
 * The dig-time formula here is vanilla's, not an approximation. It was checked
 * against known in-game values before anything was built on it: a diamond
 * pickaxe on stone comes out at 6 ticks (0.30 s) and on obsidian at 188 ticks
 * (9.4 s), both of which match the game. See `test/mining.test.ts`.
 */

import { GameData, TIER_SPEED, TOOL_TIERS, type BlockInfo, type ToolClass, type ToolTier } from './data.js'

/** Ticks per second. Every duration in the planner is in seconds; this converts. */
export const TPS = 20

const CLASS_FROM_SUFFIX: Record<string, ToolClass> = {
  pickaxe: 'pickaxe',
  axe: 'axe',
  shovel: 'shovel',
  hoe: 'hoe',
  shears: 'shears',
  sword: 'sword',
}

export interface ToolRequirement {
  /** The tool class that speeds this block up, if any. */
  toolClass: ToolClass | null
  /**
   * The lowest tier that yields a drop. `null` means the block drops for
   * anything, including a bare hand.
   */
  minTier: ToolTier | null
}

/**
 * What tool a block wants.
 *
 * Two independent signals have to be combined. `material` carries the tool
 * *class* for ordinary blocks (`mineable/pickaxe`), but ore-grade blocks carry
 * `incorrect_for_wooden_tool` instead, which says nothing about class. For
 * those, the class is read back out of `harvestTools`, which lists exactly the
 * item ids that produce a drop.
 */
export function toolRequirement(data: GameData, block: BlockInfo): ToolRequirement {
  let toolClass: ToolClass | null = null
  for (const part of block.material.split(';')) {
    const suffix = part.startsWith('mineable/') ? part.slice('mineable/'.length) : null
    if (suffix && CLASS_FROM_SUFFIX[suffix]) {
      toolClass = CLASS_FROM_SUFFIX[suffix] as ToolClass
      break
    }
  }

  let minTier: ToolTier | null = null
  const harvest = block.harvestTools
  if (harvest) {
    let bestIndex = Number.POSITIVE_INFINITY
    for (const idStr of Object.keys(harvest)) {
      const name = data.itemName(Number(idStr))
      const parsed = parseToolName(name)
      if (!parsed) continue
      if (!toolClass) toolClass = parsed.toolClass
      const index = TOOL_TIERS.indexOf(parsed.tier)
      if (index >= 0 && index < bestIndex) bestIndex = index
    }
    if (Number.isFinite(bestIndex)) minTier = TOOL_TIERS[bestIndex] ?? null
  }

  return { toolClass, minTier }
}

export function parseToolName(name: string): { tier: ToolTier; toolClass: ToolClass } | null {
  const underscore = name.indexOf('_')
  if (underscore < 0) return null
  const tier = name.slice(0, underscore) as ToolTier
  const suffix = name.slice(underscore + 1)
  const toolClass = CLASS_FROM_SUFFIX[suffix]
  if (!toolClass || !TOOL_TIERS.includes(tier)) return null
  return { tier, toolClass }
}

export function toolItemName(tier: ToolTier, toolClass: ToolClass): string {
  return `${tier}_${toolClass}`
}

/** Whether breaking this block with this tool actually yields its drop. */
export function canHarvest(data: GameData, block: BlockInfo, toolName: string | null): boolean {
  const { minTier } = toolRequirement(data, block)
  if (!minTier) return true
  if (!toolName) return false
  const parsed = parseToolName(toolName)
  if (!parsed) return false
  const required = toolRequirement(data, block).toolClass
  if (required && parsed.toolClass !== required) return false
  return TOOL_TIERS.indexOf(parsed.tier) >= TOOL_TIERS.indexOf(minTier)
}

/**
 * Break time in ticks, by the vanilla formula.
 *
 * `speed / hardness` is progress per tick, divided by 30 when the tool can
 * harvest the block and by 100 when it cannot — that 3.33x penalty is why
 * mining stone bare-handed feels the way it does.
 */
export function digTimeTicks(data: GameData, block: BlockInfo, toolName: string | null): number {
  if (!block.diggable || block.hardness === null || block.hardness < 0) {
    return Number.POSITIVE_INFINITY
  }
  if (block.hardness === 0) return 0

  const req = toolRequirement(data, block)
  let speed = 1
  if (toolName) {
    const parsed = parseToolName(toolName)
    // A tool of the wrong class is exactly as slow as a bare hand.
    if (parsed && (!req.toolClass || parsed.toolClass === req.toolClass)) {
      speed = TIER_SPEED[parsed.tier] ?? 1
    }
  }

  const harvests = canHarvest(data, block, toolName)
  const damagePerTick = speed / block.hardness / (harvests ? 30 : 100)
  return Math.ceil(1 / damagePerTick)
}

export function digTimeSeconds(data: GameData, block: BlockInfo, toolName: string | null): number {
  return digTimeTicks(data, block, toolName) / TPS
}

/**
 * The fastest tool for this block out of what is actually held.
 *
 * Returns null when bare hands are the best available option, which is a real
 * answer and not a failure — most blocks are hand-breakable.
 */
export function bestHeldTool(
  data: GameData,
  block: BlockInfo,
  heldItemNames: readonly string[],
): string | null {
  let best: string | null = null
  let bestTicks = digTimeTicks(data, block, null)
  let bestHarvests = canHarvest(data, block, null)

  for (const name of heldItemNames) {
    if (!parseToolName(name)) continue
    const ticks = digTimeTicks(data, block, name)
    const harvests = canHarvest(data, block, name)
    // Harvesting at all beats being fast: a tool that drops nothing is useless
    // however quickly it breaks the block.
    if (harvests !== bestHarvests ? harvests : ticks < bestTicks) {
      best = name
      bestTicks = ticks
      bestHarvests = harvests
    }
  }
  return best
}

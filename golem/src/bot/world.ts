/**
 * What the bot can see, compressed to what a language model can use.
 *
 * The temptation is to hand the model everything — every block in a 64-block
 * radius, every entity, the full inventory with NBT. That is both far too many
 * tokens and, more importantly, worse: a model given a wall of coordinates
 * reasons about coordinates. What it needs is the same summary a player would
 * give if you asked what was going on. Counts, names, distances, and the two or
 * three things that actually matter right now.
 */

import type { Bot } from 'mineflayer'
import type { Vec3 } from 'vec3'
import type { GameData } from '../mc/data.js'

export interface WorldSnapshot {
  readonly position: { x: number; y: number; z: number }
  readonly dimension: string
  readonly biome: string
  readonly health: number
  readonly food: number
  readonly oxygen: number
  readonly timeOfDay: string
  readonly isDay: boolean
  readonly raining: boolean
  readonly lightLevel: number
  readonly onGround: boolean
  readonly inventory: ReadonlyArray<{ item: string; count: number }>
  readonly equipped: { hand: string | null; armour: string[] }
  readonly nearbyBlocks: ReadonlyArray<{ block: string; count: number; nearest: number }>
  readonly nearbyEntities: ReadonlyArray<{ name: string; kind: string; distance: number; count: number }>
  readonly threats: ReadonlyArray<{ name: string; distance: number }>
  readonly players: ReadonlyArray<{ name: string; distance: number | null }>
}

/** Mobs that will actively come after the bot, as opposed to merely existing. */
const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged',
  'creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'slime', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'blaze', 'ghast',
  'magma_cube', 'wither_skeleton', 'piglin_brute', 'hoglin', 'zoglin',
  'guardian', 'elder_guardian', 'shulker', 'warden', 'breeze',
])

/** Blocks worth mentioning unprompted. Everything else is scenery. */
const NOTABLE = new Set([
  'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore',
  'copper_ore', 'deepslate_copper_ore', 'gold_ore', 'deepslate_gold_ore',
  'redstone_ore', 'deepslate_redstone_ore', 'lapis_ore', 'deepslate_lapis_ore',
  'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
  'ancient_debris', 'nether_quartz_ore', 'nether_gold_ore',
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'anvil',
  'enchanting_table', 'brewing_stand', 'bed', 'lava', 'water',
  'spawner', 'bell', 'beehive', 'obsidian', 'nether_portal', 'end_portal_frame',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'sugar_cane', 'pumpkin', 'melon',
])

export interface SnapshotOptions {
  /** How far to scan for blocks. Larger costs real time in the block walker. */
  readonly blockRadius?: number
  readonly entityRadius?: number
  /** Cap on distinct block kinds reported, cheapest-to-read first. */
  readonly blockKinds?: number
}

export function snapshot(bot: Bot, data: GameData, options: SnapshotOptions = {}): WorldSnapshot {
  const radius = options.blockRadius ?? 24
  const entityRadius = options.entityRadius ?? 32
  const position = bot.entity.position

  return {
    position: { x: round(position.x), y: round(position.y), z: round(position.z) },
    dimension: bot.game?.dimension ?? 'overworld',
    biome: biomeName(bot, data, position),
    health: round(bot.health ?? 20),
    food: round(bot.food ?? 20),
    oxygen: round(bot.oxygenLevel ?? 20),
    timeOfDay: describeTime(bot.time?.timeOfDay ?? 0),
    isDay: (bot.time?.timeOfDay ?? 0) < 12_000,
    raining: bot.isRaining ?? false,
    lightLevel: bot.blockAt(position)?.light ?? 0,
    onGround: bot.entity.onGround,
    inventory: summariseInventory(bot),
    equipped: {
      hand: bot.heldItem?.name ?? null,
      armour: armourNames(bot),
    },
    nearbyBlocks: summariseBlocks(bot, radius, options.blockKinds ?? 12),
    nearbyEntities: summariseEntities(bot, entityRadius),
    threats: threats(bot, entityRadius),
    players: otherPlayers(bot),
  }
}

function summariseInventory(bot: Bot): Array<{ item: string; count: number }> {
  const totals = new Map<string, number>()
  for (const item of bot.inventory.items()) {
    totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  }
  return [...totals.entries()]
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count)
}

/** Inventory as the planner wants it: item name to total count. */
export function inventoryMap(bot: Bot): Map<string, number> {
  const totals = new Map<string, number>()
  for (const item of bot.inventory.items()) {
    totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  }
  // Held and worn items are real possessions but are not in `items()`.
  for (const slot of [bot.heldItem, ...armourItems(bot)]) {
    if (slot) totals.set(slot.name, (totals.get(slot.name) ?? 0) + slot.count)
  }
  return totals
}

function armourItems(bot: Bot) {
  // Slots 5-8 are the armour slots in the player window.
  return [5, 6, 7, 8].map((slot) => bot.inventory.slots[slot]).filter((x) => x != null)
}

function armourNames(bot: Bot): string[] {
  return armourItems(bot).map((item) => item.name)
}

function summariseBlocks(
  bot: Bot,
  radius: number,
  limit: number,
): Array<{ block: string; count: number; nearest: number }> {
  const found = new Map<string, { count: number; nearest: number }>()
  const origin = bot.entity.position

  // `findBlocks` with a matcher is the only scan that does not walk the whole
  // chunk section in JS. Asking for the notable set specifically keeps this off
  // the hot path — a full radius-24 sweep costs tens of milliseconds per call
  // and this runs on every agent turn.
  const positions = bot.findBlocks({
    matching: (block) => block != null && NOTABLE.has(block.name),
    maxDistance: radius,
    count: 512,
  })

  for (const pos of positions) {
    const block = bot.blockAt(pos)
    if (!block) continue
    const distance = origin.distanceTo(pos)
    const entry = found.get(block.name)
    if (!entry) found.set(block.name, { count: 1, nearest: distance })
    else {
      entry.count++
      entry.nearest = Math.min(entry.nearest, distance)
    }
  }

  return [...found.entries()]
    .map(([block, { count, nearest }]) => ({ block, count, nearest: round(nearest) }))
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, limit)
}

function summariseEntities(
  bot: Bot,
  radius: number,
): Array<{ name: string; kind: string; distance: number; count: number }> {
  const groups = new Map<string, { kind: string; distance: number; count: number }>()
  const origin = bot.entity.position

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue
    const name = entity.name ?? entity.displayName ?? 'unknown'
    const distance = origin.distanceTo(entity.position)
    if (distance > radius) continue
    const entry = groups.get(name)
    if (!entry) groups.set(name, { kind: entity.type ?? 'other', distance, count: 1 })
    else {
      entry.count++
      entry.distance = Math.min(entry.distance, distance)
    }
  }

  return [...groups.entries()]
    .map(([name, rest]) => ({ name, ...rest, distance: round(rest.distance) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12)
}

function threats(bot: Bot, radius: number): Array<{ name: string; distance: number }> {
  const origin = bot.entity.position
  const out: Array<{ name: string; distance: number }> = []
  for (const entity of Object.values(bot.entities)) {
    const name = entity.name ?? ''
    if (!HOSTILE.has(name)) continue
    const distance = origin.distanceTo(entity.position)
    if (distance > radius) continue
    out.push({ name, distance: round(distance) })
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, 8)
}

function otherPlayers(bot: Bot): Array<{ name: string; distance: number | null }> {
  const out: Array<{ name: string; distance: number | null }> = []
  for (const player of Object.values(bot.players)) {
    if (player.username === bot.username) continue
    const entity = player.entity
    out.push({
      name: player.username,
      distance: entity ? round(bot.entity.position.distanceTo(entity.position)) : null,
    })
  }
  return out.slice(0, 12)
}

function biomeName(bot: Bot, data: GameData, position: Vec3): string {
  try {
    const id = bot.world.getBiome(position)
    return data.raw.biomes[id]?.name ?? 'unknown'
  } catch {
    // Biome data is not always loaded for the block underfoot.
    return 'unknown'
  }
}

/**
 * Minecraft's clock, in words.
 *
 * The model does not need to know it is tick 13188; it needs to know the sun
 * just went down, because that changes what it should be doing.
 */
export function describeTime(timeOfDay: number): string {
  const t = ((timeOfDay % 24_000) + 24_000) % 24_000
  if (t < 1_000) return 'dawn'
  if (t < 6_000) return 'morning'
  if (t < 9_000) return 'midday'
  if (t < 12_000) return 'afternoon'
  if (t < 13_000) return 'sunset'
  if (t < 18_000) return 'night'
  if (t < 22_000) return 'late night'
  return 'before dawn'
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

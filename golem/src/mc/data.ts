/**
 * The offline game database.
 *
 * Everything the planner reasons about — what a block drops, how long it takes
 * to break with which tool, what a recipe consumes and yields — comes from
 * `minecraft-data`, which ships the extracted vanilla tables. No part of the
 * planner guesses at game rules, and nothing here needs a running server.
 */

import mcDataLoader from 'minecraft-data'

export type ToolClass = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword'

/**
 * Tool tiers in harvest order. The index is the tier level: a block that needs
 * an iron pickaxe is harvestable by anything at index >= 3.
 *
 * Gold sits between wood and stone despite mining *fastest* of all, because
 * harvest level and mining speed are separate axes in Minecraft. Sorting this
 * list by speed — the obvious mistake — would have the planner send the bot
 * after diamonds with a golden pickaxe, which mines them fast and drops
 * nothing.
 */
export const TOOL_TIERS = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'] as const
export type ToolTier = (typeof TOOL_TIERS)[number]

/**
 * Mining speed multiplier per tier, read off `materials['mineable/pickaxe']`
 * in the shipped data rather than typed from memory.
 */
export const TIER_SPEED: Record<ToolTier, number> = {
  wooden: 2,
  golden: 12,
  stone: 4,
  iron: 6,
  diamond: 8,
  netherite: 9,
}


export interface BlockInfo {
  id: number
  name: string
  displayName: string
  hardness: number | null
  diggable: boolean
  material: string
  /** Item ids this block drops with no silk touch and a valid tool. */
  drops: number[]
  harvestTools?: Record<string, boolean>
}

export interface ItemInfo {
  id: number
  name: string
  displayName: string
  stackSize: number
  maxDurability?: number
}

/** A crafting recipe, normalised across the two shapes the data ships. */
export interface Recipe {
  /** Item id produced. */
  resultId: number
  /** How many the recipe yields per craft. */
  resultCount: number
  /** Ingredient id -> how many that one craft consumes. */
  ingredients: Map<number, number>
  /** Shaped recipes need a 3x3 grid; shapeless 2x2 ones can be made in-hand. */
  needsTable: boolean
}

export class GameData {
  readonly raw: ReturnType<typeof mcDataLoader>
  readonly version: string

  /** Recipes keyed by the item they produce. Built once; the raw table is by id. */
  private readonly recipesByResult = new Map<number, Recipe[]>()
  /** Block ids that drop a given item id, for "where do I mine this" lookups. */
  private readonly blocksDropping = new Map<number, number[]>()
  /** Entity names that drop a given item id. */
  private readonly entitiesDropping = new Map<number, string[]>()
  /** `${sourceKey}:${itemId}` -> expected units dropped per break/kill. */
  private readonly dropYields = new Map<string, number>()

  constructor(version: string) {
    const raw = mcDataLoader(version)
    if (!raw) throw new Error(`No minecraft-data for version ${version}`)
    this.raw = raw
    this.version = raw.version.minecraftVersion ?? version
    this.indexRecipes()
    this.indexDrops()
  }

  private indexRecipes(): void {
    for (const [resultIdStr, list] of Object.entries(this.raw.recipes)) {
      const resultId = Number(resultIdStr)
      const normalised: Recipe[] = []
      for (const entry of list as unknown[]) {
        const recipe = normaliseRecipe(resultId, entry)
        if (recipe) normalised.push(recipe)
      }
      if (normalised.length > 0) this.recipesByResult.set(resultId, normalised)
    }
  }

  private indexDrops(): void {
    for (const block of this.raw.blocksArray) {
      if (!block.diggable) continue
      for (const itemId of block.drops ?? []) {
        push(this.blocksDropping, Number(itemId), block.id)
      }
    }
    // `blockLoot` is richer than `drops` — it knows raw_iron comes from iron_ore
    // rather than the ore item itself, which `drops` gets wrong for ores.
    for (const loot of Object.values(this.raw.blockLoot)) {
      const block = this.raw.blocksByName[loot.block]
      if (!block) continue
      for (const drop of loot.drops ?? []) {
        if (drop.silkTouch) continue // we do not assume a silk touch tool
        const item = this.raw.itemsByName[drop.item]
        if (!item) continue
        push(this.blocksDropping, item.id, block.id, true)
        this.dropYields.set(`b${block.id}:${item.id}`, expectedDrop(drop))
      }
    }
    for (const loot of Object.values(this.raw.entityLoot)) {
      for (const drop of loot.drops ?? []) {
        const item = this.raw.itemsByName[drop.item]
        if (!item) continue
        push(this.entitiesDropping, item.id, loot.entity, true)
        this.dropYields.set(`e${loot.entity}:${item.id}`, expectedDrop(drop))
      }
    }
  }

  item(nameOrId: string | number): ItemInfo | null {
    const it = typeof nameOrId === 'number' ? this.raw.items[nameOrId] : this.raw.itemsByName[nameOrId]
    return (it as ItemInfo | undefined) ?? null
  }

  block(nameOrId: string | number): BlockInfo | null {
    const b = typeof nameOrId === 'number' ? this.raw.blocks[nameOrId] : this.raw.blocksByName[nameOrId]
    return (b as BlockInfo | undefined) ?? null
  }

  itemName(id: number): string {
    return this.raw.items[id]?.name ?? `item:${id}`
  }

  blockName(id: number): string {
    return this.raw.blocks[id]?.name ?? `block:${id}`
  }

  recipesFor(itemId: number): Recipe[] {
    return this.recipesByResult.get(itemId) ?? []
  }

  /** Block ids that yield this item when mined with an appropriate tool. */
  blocksDroppingItem(itemId: number): number[] {
    return this.blocksDropping.get(itemId) ?? []
  }

  entitiesDroppingItem(itemId: number): string[] {
    return this.entitiesDropping.get(itemId) ?? []
  }

  /**
   * Expected units of `itemId` from breaking one `blockId`.
   *
   * Redstone ore yields 4-5 per block and iron ore 1-2, so treating every drop
   * as one would have the planner mine four times the redstone it needs.
   */
  blockYield(blockId: number, itemId: number): number {
    return this.dropYields.get(`b${blockId}:${itemId}`) ?? 1
  }

  entityYield(entityName: string, itemId: number): number {
    return this.dropYields.get(`e${entityName}:${itemId}`) ?? 1
  }

  food(itemId: number): { foodPoints: number; saturation: number } | null {
    const f = this.raw.foods[itemId]
    return f ? { foodPoints: f.foodPoints, saturation: f.saturation } : null
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V, unshift = false): void {
  const list = map.get(key)
  if (!list) {
    map.set(key, [value])
  } else if (!list.includes(value)) {
    if (unshift) list.unshift(value)
    else list.push(value)
  }
}

/**
 * The shipped recipe table uses two shapes: `inShape` (a grid, possibly with
 * nulls and ragged rows) and `ingredients` (a flat shapeless list). Both are
 * flattened here into ingredient counts, because the planner only cares about
 * what is consumed, never where in the grid it goes — mineflayer's own
 * `craft()` places the items from its own recipe object.
 */
function normaliseRecipe(resultId: number, entry: unknown): Recipe | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as {
    result?: { id?: number; count?: number } | number
    inShape?: (number | null)[][]
    ingredients?: (number | null)[]
  }

  const resultCount =
    typeof e.result === 'object' && e.result !== null && typeof e.result.count === 'number'
      ? e.result.count
      : 1

  const ingredients = new Map<number, number>()
  let width = 0
  let height = 0

  if (Array.isArray(e.inShape)) {
    height = e.inShape.length
    for (const row of e.inShape) {
      if (!Array.isArray(row)) continue
      width = Math.max(width, row.length)
      for (const cell of row) {
        if (cell === null || cell === undefined) continue
        ingredients.set(cell, (ingredients.get(cell) ?? 0) + 1)
      }
    }
  } else if (Array.isArray(e.ingredients)) {
    for (const cell of e.ingredients) {
      if (cell === null || cell === undefined) continue
      ingredients.set(cell, (ingredients.get(cell) ?? 0) + 1)
    }
    // A shapeless recipe fits a 2x2 grid only if it has at most four items.
    width = ingredients.size <= 4 ? 2 : 3
    height = width
  } else {
    return null
  }

  if (ingredients.size === 0) return null
  return { resultId, resultCount, ingredients, needsTable: width > 2 || height > 2 }
}

/**
 * Expected units from one loot roll: the average of the stack range, scaled by
 * the chance it drops at all.
 *
 * `dropChance` needs care. Ore loot tables split on silk touch and give each
 * branch 0.5, so iron_ore's raw_iron entry reads `dropChance: 0.5` — but that
 * 0.5 is conditional on *not* having silk touch, which the bot never has. Read
 * literally it would halve every ore yield and send the bot mining twice the
 * rock it needs. A `noSilkTouch` branch is certain for us.
 */
function expectedDrop(drop: {
  dropChance?: number
  noSilkTouch?: boolean
  stackSizeRange?: (number | null)[]
}): number {
  const range = drop.stackSizeRange
  let mean = 1
  if (Array.isArray(range) && range.length > 0) {
    const low = typeof range[0] === 'number' ? range[0] : 1
    const high = typeof range[1] === 'number' ? range[1] : low
    mean = (low + high) / 2
  }
  const chance =
    drop.noSilkTouch === true
      ? 1
      : typeof drop.dropChance === 'number' && drop.dropChance > 0
        ? drop.dropChance
        : 1
  return Math.max(mean * chance, 0.01)
}

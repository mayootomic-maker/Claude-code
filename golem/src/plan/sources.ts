/**
 * Every way to obtain every item, enumerated once.
 *
 * A "source" is one concrete way to get one item: a recipe, a smelt, a
 * particular block broken with a particular tool, or a mob killed. Each has a
 * fixed overhead and a list of other items it depends on. That makes the whole
 * game a weighted hypergraph — items are nodes, sources are hyperedges — which
 * is what lets `solve.ts` find genuinely optimal routes rather than plausible
 * ones.
 */

import type { GameData, Recipe } from '../mc/data.js'
import { TOOL_TIERS, type ToolClass, type ToolTier } from '../mc/data.js'
import { canHarvest, digTimeSeconds, toolItemName, toolRequirement } from '../mc/mining.js'
import { PREFERRED_FUELS, burnSeconds, smeltRecipesFor, type SmeltRecipe } from '../mc/smelting.js'
import type { SmeltRecipe as Smelt } from '../mc/smelting.js'
import {
  CRAFT_SECONDS,
  PICKUP_SECONDS,
  SMELT_SECONDS,
  STATION_ACCESS_SECONDS,
  TOOL_AMORTISED_USES,
  clusterSize,
  huntSeconds,
  searchSeconds,
} from './cost.js'

export interface Dependency {
  readonly item: string
  /** How many of `item` one *unit of output* needs, before yield division. */
  readonly perBatch: number
}

interface SourceBase {
  /** Item name produced. */
  readonly output: string
  /** Fixed seconds per batch, independent of what the inputs cost. */
  readonly overhead: number
  /** How many outputs one batch produces. */
  readonly batch: number
  readonly deps: readonly Dependency[]
}

export type Source =
  | (SourceBase & { readonly kind: 'mine'; readonly block: string; readonly tool: string | null })
  | (SourceBase & { readonly kind: 'hunt'; readonly entity: string })
  | (SourceBase & { readonly kind: 'craft'; readonly recipe: Recipe; readonly needsTable: boolean })
  | (SourceBase & { readonly kind: 'smelt'; readonly smelt: Smelt; readonly fuel: string })

export interface SourceOptions {
  /** Block or entity names, and item names, the planner must not route through. */
  readonly forbidden?: ReadonlySet<string>
  /** Block name -> real seconds to a remembered deposit, replacing the prior. */
  readonly searchOverrides?: ReadonlyMap<string, number>
}

/**
 * Blocks that generate in the world despite having a crafting recipe, and so
 * survive the craftable-means-player-made rule in `generatesNaturally`.
 */
const NATURAL_BUT_CRAFTABLE: ReadonlySet<string> = new Set([
  'clay',
  'melon',
  'bone_block',
  'packed_ice',
  'blue_ice',
  'glowstone',
  'sea_lantern',
])

const GROWING_MATERIALS = ['plant', 'gourd', 'leaves', 'vine_or_glow_lichen'] as const

/** Enumerate every source for every item in the game. */
export function buildSources(data: GameData, options: SourceOptions = {}): Source[] {
  const sources: Source[] = []
  const forbidden = options.forbidden

  for (const item of data.raw.itemsArray) {
    if (forbidden?.has(item.name)) continue

    for (const recipe of data.recipesFor(item.id)) {
      const deps: Dependency[] = []
      let banned = false
      for (const [ingredientId, qty] of recipe.ingredients) {
        const name = data.itemName(ingredientId)
        if (forbidden?.has(name)) {
          banned = true
          break
        }
        deps.push({ item: name, perBatch: qty })
      }
      if (banned) continue
      sources.push({
        kind: 'craft',
        output: item.name,
        overhead: CRAFT_SECONDS + (recipe.needsTable ? STATION_ACCESS_SECONDS : 0),
        batch: recipe.resultCount,
        deps,
        recipe,
        needsTable: recipe.needsTable,
      })
    }

    for (const smelt of smeltRecipesFor(item.name)) {
      if (forbidden?.has(smelt.input)) continue
      for (const fuel of PREFERRED_FUELS) {
        const burn = burnSeconds(fuel)
        if (burn <= 0 || forbidden?.has(fuel)) continue
        sources.push({
          kind: 'smelt',
          output: item.name,
          overhead: SMELT_SECONDS + STATION_ACCESS_SECONDS,
          batch: smelt.count,
          deps: [
            { item: smelt.input, perBatch: 1 },
            // A smelt burns only the fraction of a fuel it actually needs: coal
            // burns 80 seconds and a smelt takes 10, so an eighth of a coal.
            // Charging a whole one makes ore look eight times dearer than it is.
            { item: fuel, perBatch: SMELT_SECONDS / burn },
          ],
          smelt,
          fuel,
        })
      }
    }

    for (const entity of data.entitiesDroppingItem(item.id)) {
      if (forbidden?.has(entity)) continue
      const perKill = data.entityYield(entity, item.id)
      if (perKill <= 0) continue
      sources.push({
        kind: 'hunt',
        output: item.name,
        overhead: huntSeconds(entity) + PICKUP_SECONDS,
        batch: perKill,
        deps: [],
        entity,
      })
    }

    sources.push(...miningSources(data, item.id, item.name, options))
  }

  return sources
}

/**
 * Mining sources: one per (block, tool tier) pairing that actually harvests.
 *
 * Tool tier is not assumed, it is enumerated and costed — the tool's own
 * amortised price plus the digging it enables. That is what makes the planner
 * reach for a stone pickaxe to break stone and an iron one to break diamond
 * ore, without either being written down anywhere. Pairings that need a tool
 * appear as sources that *depend* on it, so the solver can never schedule the
 * mining before the tool exists.
 */
function miningSources(
  data: GameData,
  itemId: number,
  itemName: string,
  options: SourceOptions,
): Source[] {
  const out: Source[] = []

  for (const blockId of data.blocksDroppingItem(itemId)) {
    const block = data.block(blockId)
    if (!block || !block.diggable) continue
    if (options.forbidden?.has(block.name)) continue
    if (!generatesNaturally(data, block.name)) continue

    const yieldPer = data.blockYield(blockId, itemId)
    if (yieldPer <= 0) continue

    // Finding a vein or a tree costs once and pays out across the whole
    // cluster; charging the full search per block makes ore look absurd.
    const find = searchSeconds(block.name, options.searchOverrides) / clusterSize(block.name)
    const req = toolRequirement(data, block)

    for (const tool of toolOptions(req.toolClass, req.minTier)) {
      if (!canHarvest(data, block, tool)) continue
      const dig = digTimeSeconds(data, block, tool)
      if (!Number.isFinite(dig)) continue
      if (tool && options.forbidden?.has(tool)) continue

      out.push({
        kind: 'mine',
        output: itemName,
        overhead: find + dig + PICKUP_SECONDS,
        batch: yieldPer,
        deps: tool ? [{ item: tool, perBatch: 1 / TOOL_AMORTISED_USES }] : [],
        block: block.name,
        tool,
      })
    }
  }
  return out
}

/** Bare hands plus every tier of the relevant class at or above `minTier`. */
function toolOptions(toolClass: ToolClass | null, minTier: ToolTier | null): Array<string | null> {
  const options: Array<string | null> = [null]
  if (!toolClass) return options
  const floor = minTier ? Math.max(TOOL_TIERS.indexOf(minTier), 0) : 0
  for (let i = floor; i < TOOL_TIERS.length; i++) {
    const tier = TOOL_TIERS[i]
    if (tier) options.push(toolItemName(tier, toolClass))
  }
  return options
}

/**
 * Whether a block can be found in the world rather than only placed there.
 *
 * Nothing in the shipped data marks this, so the test is: does the block have a
 * crafting recipe? A craftable block is one a player made. Without this the
 * planner cheerfully proposes mining an iron block out of the ground, which
 * prices iron at a few seconds and poisons every plan downstream of it.
 */
export function generatesNaturally(data: GameData, blockName: string): boolean {
  if (NATURAL_BUT_CRAFTABLE.has(blockName)) return true
  const block = data.block(blockName)
  // Growing things are always natural, and they need the exemption: the `wheat`
  // crop block shares its name with the `wheat` item, which is craftable from a
  // hay bale. The name collision alone would have the planner decide that wheat
  // cannot be farmed.
  if (block && GROWING_MATERIALS.some((m) => block.material.includes(m))) return true
  const item = data.item(blockName)
  // A block with no item form is either something that grows — already handled
  // above — or the placed form of an item: `redstone_wire` is dust on the
  // ground, `tripwire` is placed string. Treating those as natural has the
  // planner "mine" redstone off the floor for a fraction of its real cost.
  if (!item) return false
  return data.recipesFor(item.id).length === 0
}

export type { Recipe, SmeltRecipe }

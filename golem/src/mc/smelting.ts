/**
 * Furnace recipes and fuels.
 *
 * `minecraft-data` ships crafting recipes but no smelting table — asking it for
 * iron_ingot returns only the 3x3-nuggets and iron-block recipes, never the
 * ore. Without this file the planner would conclude that the only way to get
 * iron is to already have iron. So the table is hand-written here, and
 * `test/smelting.test.ts` asserts every name in it resolves against the game
 * database, which is what stops it silently rotting across game versions.
 */

export interface SmeltRecipe {
  /** Item name produced. */
  readonly output: string
  /** Item name consumed, one per smelt. */
  readonly input: string
  /** How many outputs one input yields. Always 1 in vanilla, kept explicit. */
  readonly count: number
  /** Seconds in a regular furnace. Blasting/smoking halves it. */
  readonly seconds: number
  readonly kind: 'ore' | 'food' | 'material'
}

const ORE_SMELT_SECONDS = 10

/** input -> output, for the ores and raw materials worth planning around. */
const ORES: ReadonlyArray<readonly [string, string]> = [
  ['raw_iron', 'iron_ingot'],
  ['raw_gold', 'gold_ingot'],
  ['raw_copper', 'copper_ingot'],
  ['iron_ore', 'iron_ingot'],
  ['deepslate_iron_ore', 'iron_ingot'],
  ['gold_ore', 'gold_ingot'],
  ['deepslate_gold_ore', 'gold_ingot'],
  ['copper_ore', 'copper_ingot'],
  ['deepslate_copper_ore', 'copper_ingot'],
  ['nether_gold_ore', 'gold_ingot'],
  ['ancient_debris', 'netherite_scrap'],
]

const MATERIALS: ReadonlyArray<readonly [string, string]> = [
  ['sand', 'glass'],
  ['red_sand', 'glass'],
  ['cobblestone', 'stone'],
  ['stone', 'smooth_stone'],
  ['cobbled_deepslate', 'deepslate'],
  ['clay_ball', 'brick'],
  ['clay', 'terracotta'],
  ['netherrack', 'nether_brick'],
  ['cactus', 'green_dye'],
  ['kelp', 'dried_kelp'],
  ['sea_pickle', 'lime_dye'],
  ['chorus_fruit', 'popped_chorus_fruit'],
  ['wet_sponge', 'sponge'],
  ['basalt', 'smooth_basalt'],
  ['quartz_block', 'smooth_quartz'],
  ['sandstone', 'smooth_sandstone'],
  ['red_sandstone', 'smooth_red_sandstone'],
  ['oak_log', 'charcoal'],
  ['birch_log', 'charcoal'],
  ['spruce_log', 'charcoal'],
  ['jungle_log', 'charcoal'],
  ['acacia_log', 'charcoal'],
  ['dark_oak_log', 'charcoal'],
]

const FOODS: ReadonlyArray<readonly [string, string]> = [
  ['porkchop', 'cooked_porkchop'],
  ['beef', 'cooked_beef'],
  ['chicken', 'cooked_chicken'],
  ['mutton', 'cooked_mutton'],
  ['rabbit', 'cooked_rabbit'],
  ['cod', 'cooked_cod'],
  ['salmon', 'cooked_salmon'],
  ['potato', 'baked_potato'],
]

export const SMELT_RECIPES: readonly SmeltRecipe[] = [
  ...ORES.map(([input, output]) => ({ input, output, count: 1, seconds: ORE_SMELT_SECONDS, kind: 'ore' as const })),
  ...MATERIALS.map(([input, output]) => ({ input, output, count: 1, seconds: ORE_SMELT_SECONDS, kind: 'material' as const })),
  ...FOODS.map(([input, output]) => ({ input, output, count: 1, seconds: ORE_SMELT_SECONDS, kind: 'food' as const })),
]

const BY_OUTPUT = new Map<string, SmeltRecipe[]>()
for (const recipe of SMELT_RECIPES) {
  const list = BY_OUTPUT.get(recipe.output)
  if (list) list.push(recipe)
  else BY_OUTPUT.set(recipe.output, [recipe])
}

export function smeltRecipesFor(outputItemName: string): readonly SmeltRecipe[] {
  return BY_OUTPUT.get(outputItemName) ?? []
}

/**
 * Fuels, as item name -> seconds of burn time.
 *
 * The planner uses this to charge smelting its real fuel cost. A furnace burns
 * one coal for 80 seconds, so eight smelts; charging a whole coal per smelt
 * would make ore look eight times more expensive than it is and push the
 * planner toward silly alternatives.
 */
export const FUELS: Readonly<Record<string, number>> = {
  lava_bucket: 1000,
  coal_block: 800,
  dried_kelp_block: 200,
  blaze_rod: 120,
  coal: 80,
  charcoal: 80,
  oak_planks: 15,
  birch_planks: 15,
  spruce_planks: 15,
  jungle_planks: 15,
  acacia_planks: 15,
  dark_oak_planks: 15,
  oak_log: 15,
  birch_log: 15,
  spruce_log: 15,
  stick: 5,
}

/** Fuels ordered by how readily the bot can usually get them. */
export const PREFERRED_FUELS: readonly string[] = ['coal', 'charcoal', 'coal_block', 'oak_planks', 'stick']

export function burnSeconds(itemName: string): number {
  return FUELS[itemName] ?? 0
}


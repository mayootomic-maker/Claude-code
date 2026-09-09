/**
 * The cost model.
 *
 * Every plan is scored in one currency: expected seconds of play. That is the
 * only unit in which "mine three more iron" and "kill four more cows" are
 * comparable, and comparing them is the whole job.
 *
 * Two kinds of number live here, and the difference matters:
 *
 *  - **Measured.** Dig times come from vanilla's own formula over the shipped
 *    block table (`mc/mining.ts`), verified against known in-game values.
 *  - **Prior.** How long it takes to *find* a diamond ore cannot be derived
 *    from any table — it depends on the world, the y-level, and luck. The
 *    numbers below are priors, used only to rank alternatives against each
 *    other. At runtime `PlanContext.searchOverrides` replaces them with the
 *    real distance to deposits the bot has actually seen, so a remembered vein
 *    always beats a guess.
 *
 * Priors that only ever rank options do not need to be right in absolute
 * terms; they need to be right in *order*. Diamonds must cost more than iron,
 * and iron more than stone.
 */

/** Seconds to place items in a grid and take the result. */
export const CRAFT_SECONDS = 1.6

/** Seconds to walk to a crafting table or furnace already placed nearby. */
export const STATION_ACCESS_SECONDS = 3


/** One furnace smelt, from the vanilla furnace tick rate. */
export const SMELT_SECONDS = 10

/** Seconds to pick up a dropped item and confirm it landed in the inventory. */
export const PICKUP_SECONDS = 0.8

/**
 * Seconds to locate one instance of a block, before any digging.
 *
 * Anything absent falls through to `DEFAULT_SEARCH_SECONDS`. Ores are keyed by
 * their real block names, deepslate variants included, because at the depths
 * where diamonds live the deepslate form is what the bot will actually meet.
 */
export const SEARCH_SECONDS: Readonly<Record<string, number>> = {
  // Surface, effectively underfoot.
  dirt: 2,
  grass_block: 2,
  sand: 3,
  gravel: 4,
  stone: 3,
  cobblestone: 3,
  deepslate: 6,
  cobbled_deepslate: 6,
  clay: 25,
  // Crops. Finding a village farm or a wild patch, not planting one — the bot
  // plants deliberately via the farming skill rather than as a side effect of
  // wanting wheat.
  wheat: 60,
  potatoes: 70,
  carrots: 70,
  beetroots: 90,
  sugar_cane: 35,
  pumpkin: 60,
  melon: 70,
  sweet_berry_bush: 50,
  brown_mushroom: 40,
  red_mushroom: 40,
  // Trees. Finding one is fast; the six logs on it are then nearly free, which
  // the per-block amortisation below accounts for.
  oak_log: 12,
  birch_log: 14,
  spruce_log: 14,
  jungle_log: 30,
  acacia_log: 30,
  dark_oak_log: 30,
  // Ores, roughly by how long a competent player spends per find.
  coal_ore: 20,
  deepslate_coal_ore: 25,
  copper_ore: 25,
  deepslate_copper_ore: 30,
  iron_ore: 35,
  deepslate_iron_ore: 40,
  lapis_ore: 90,
  deepslate_lapis_ore: 95,
  redstone_ore: 70,
  deepslate_redstone_ore: 70,
  gold_ore: 110,
  deepslate_gold_ore: 110,
  diamond_ore: 260,
  deepslate_diamond_ore: 240,
  emerald_ore: 400,
  deepslate_emerald_ore: 400,
  ancient_debris: 700,
  obsidian: 120,
  // Structures and liquids.
  water: 20,
  lava: 90,
}

export const DEFAULT_SEARCH_SECONDS = 45

/**
 * How many blocks of a kind are typically reachable once one is found.
 *
 * Ore generates in veins and trees in trunks, so the search cost is paid once
 * and split across the whole cluster. Ignoring this makes ore look far more
 * expensive than it is and pushes the planner toward absurd substitutions.
 */
export const CLUSTER_SIZE: Readonly<Record<string, number>> = {
  oak_log: 6,
  birch_log: 6,
  spruce_log: 8,
  jungle_log: 8,
  acacia_log: 6,
  dark_oak_log: 8,
  coal_ore: 12,
  deepslate_coal_ore: 12,
  copper_ore: 9,
  deepslate_copper_ore: 9,
  iron_ore: 6,
  deepslate_iron_ore: 6,
  gold_ore: 5,
  deepslate_gold_ore: 5,
  redstone_ore: 6,
  deepslate_redstone_ore: 6,
  lapis_ore: 6,
  deepslate_lapis_ore: 6,
  diamond_ore: 3,
  deepslate_diamond_ore: 3,
  emerald_ore: 1,
  deepslate_emerald_ore: 1,
  ancient_debris: 2,
  stone: 64,
  cobblestone: 64,
  deepslate: 64,
  dirt: 32,
  sand: 32,
  gravel: 24,
  wheat: 12,
  potatoes: 9,
  carrots: 9,
  beetroots: 9,
  sugar_cane: 6,
  pumpkin: 3,
  melon: 4,
}

export const DEFAULT_CLUSTER_SIZE = 4

/**
 * Seconds to find, approach and kill one of a mob, including the risk premium
 * of taking damage. Hostiles cost more than their fight length because losing
 * a fight costs the whole inventory.
 */
export const HUNT_SECONDS: Readonly<Record<string, number>> = {
  // Golems and bosses drop desirable materials and would otherwise look like a
  // bargain — an iron golem carries four ingots. They are priced by what it
  // actually takes: finding a village or building one, and surviving the fight.
  iron_golem: 900,
  snow_golem: 300,
  wither: 3000,
  ender_dragon: 3000,
  elder_guardian: 900,
  warden: 3000,
  ravager: 600,
  piglin_brute: 400,
  cow: 40,
  pig: 40,
  sheep: 35,
  chicken: 35,
  rabbit: 60,
  squid: 50,
  zombie: 45,
  skeleton: 70,
  spider: 55,
  creeper: 90,
  enderman: 150,
  blaze: 240,
  wither_skeleton: 300,
  ghast: 260,
  slime: 90,
  witch: 200,
}

/**
 * Unlisted mobs are assumed awkward rather than easy. An optimistic default
 * makes every rare mob drop look like a shortcut, and the planner will take it.
 */
export const DEFAULT_HUNT_SECONDS = 300

/**
 * How many block-breaks a tool is amortised over when the planner charges for
 * making one.
 *
 * Real durability would be exact, but the bot rarely mines a tool to death
 * before it is replaced or lost on death, so charging the full tool cost
 * against a single-block plan would be wrong in the other direction. Capping at
 * 64 keeps a pickaxe from looking free on a thousand-block job.
 */
export const TOOL_AMORTISED_USES = 64

/** Seconds of walking charged per block of horizontal distance. */
export const SECONDS_PER_BLOCK_TRAVEL = 0.25

export function searchSeconds(blockName: string, overrides?: ReadonlyMap<string, number>): number {
  const override = overrides?.get(blockName)
  if (override !== undefined) return override
  return SEARCH_SECONDS[blockName] ?? DEFAULT_SEARCH_SECONDS
}

export function clusterSize(blockName: string): number {
  return CLUSTER_SIZE[blockName] ?? DEFAULT_CLUSTER_SIZE
}

export function huntSeconds(entityName: string): number {
  return HUNT_SECONDS[entityName] ?? DEFAULT_HUNT_SECONDS
}

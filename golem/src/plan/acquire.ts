/**
 * Turning optimal costs into an ordered list of things to actually do.
 *
 * `solve.ts` answers "what is the cheapest way to get one of these, and via
 * which source". This walks that answer against a simulated inventory and emits
 * concrete steps, spending what is already held and reusing what each step
 * leaves over.
 *
 * The walk needs no cycle detection. Knuth's algorithm settles an item strictly
 * after every input its chosen source consumes, so following `via` always moves
 * to items that settled earlier and must terminate.
 */

import type { GameData } from '../mc/data.js'
import { bestHeldTool, digTimeSeconds, toolRequirement } from '../mc/mining.js'
import { burnSeconds } from '../mc/smelting.js'
import { CRAFT_SECONDS, SMELT_SECONDS, STATION_ACCESS_SECONDS } from './cost.js'
import { blockers, solveCosts, type CostTable } from './solve.js'
import type { Source, SourceOptions } from './sources.js'

export interface Ingredient {
  readonly item: string
  readonly count: number
}

export type Step =
  | { readonly kind: 'have'; readonly item: string; readonly count: number }
  | {
      readonly kind: 'mine'
      readonly item: string
      readonly count: number
      readonly block: string
      readonly tool: string | null
      readonly breaks: number
      readonly seconds: number
    }
  | {
      readonly kind: 'hunt'
      readonly item: string
      readonly count: number
      readonly entity: string
      readonly kills: number
      readonly seconds: number
    }
  | {
      readonly kind: 'craft'
      readonly item: string
      readonly count: number
      readonly times: number
      readonly needsTable: boolean
      readonly consumes: readonly Ingredient[]
      readonly seconds: number
    }
  | {
      readonly kind: 'smelt'
      readonly item: string
      readonly count: number
      readonly input: string
      readonly fuel: string
      readonly fuelCount: number
      readonly seconds: number
    }

export interface Plan {
  readonly goal: Ingredient
  readonly steps: readonly Step[]
  /** Total estimated seconds. */
  readonly seconds: number
  readonly feasible: boolean
  /**
   * The specific items that have no route, not the goal that needed them.
   * "Cannot obtain a nether star" is actionable; "cannot make a beacon" is not.
   */
  readonly missing: readonly string[]
}

/**
 * A planner bound to one world view.
 *
 * The cost table covers every item in the game and takes ~50 ms to build, so it
 * is built once and reused for every plan. It only needs rebuilding when the
 * bot's knowledge of the world changes enough to move the numbers — when it
 * finds a new ore deposit, say — which `withKnowledge` handles.
 */
export class Planner {
  readonly costs: CostTable

  constructor(
    private readonly data: GameData,
    private readonly options: SourceOptions = {},
  ) {
    this.costs = solveCosts(data, options)
  }

  /** A new planner that knows what this one knows, plus fresher search times. */
  withKnowledge(options: SourceOptions): Planner {
    return new Planner(this.data, { ...this.options, ...options })
  }

  /** Seconds to obtain one more of an item, or Infinity if there is no route. */
  unitCost(itemName: string): number {
    return this.costs.cost.get(itemName) ?? Number.POSITIVE_INFINITY
  }

  /** Whether the bot could obtain this item at all, given what it knows. */
  obtainable(itemName: string): boolean {
    return this.costs.cost.has(itemName)
  }

  /**
   * The cheapest items obtainable right now, for answering "what can I make?".
   * Sorted by cost, so the head of the list is what is within easy reach.
   */
  cheapest(limit = 20, filter?: (item: string) => boolean): Array<{ item: string; seconds: number }> {
    const out: Array<{ item: string; seconds: number }> = []
    for (const [item, seconds] of this.costs.cost) {
      if (filter && !filter(item)) continue
      out.push({ item, seconds })
    }
    out.sort((a, b) => a.seconds - b.seconds)
    return out.slice(0, limit)
  }

  plan(itemName: string, count: number, inventory: ReadonlyMap<string, number> = new Map()): Plan {
    return new Emitter(this.data, this.costs, inventory).run(itemName, count)
  }
}

class Emitter {
  private readonly sim: Map<string, number>
  private readonly steps: Step[] = []
  private readonly missing = new Set<string>()
  private readonly stations = { table: false, furnace: false }
  /** Termination guard for station acquisition, which is not part of `via`. */
  private readonly active = new Set<string>()

  constructor(
    private readonly data: GameData,
    private readonly costs: CostTable,
    inventory: ReadonlyMap<string, number>,
  ) {
    this.sim = new Map(inventory)
    this.stations.table = (this.sim.get('crafting_table') ?? 0) > 0
    this.stations.furnace = (this.sim.get('furnace') ?? 0) > 0
  }

  run(itemName: string, count: number): Plan {
    const ok = this.ensure(itemName, count)
    const steps = ok ? Emitter.coalesce(this.steps) : []
    const seconds = steps.reduce((t, s) => t + ('seconds' in s ? s.seconds : 0), 0)
    return {
      goal: { item: itemName, count },
      steps,
      seconds: ok ? seconds : 0,
      feasible: ok,
      missing: ok ? [] : [...this.missing],
    }
  }

  /**
   * Merge repeated gathering of the same thing into its first appearance.
   *
   * The walk emits a separate mining step each time an item is needed, so a
   * plan can say "mine 1 iron ore" and then "mine 2 iron ore" a few steps
   * later. Hoisting the later one earlier is always safe — gathering only adds
   * to the inventory, and the first occurrence already sits after whatever tool
   * it needed. Crafting and smelting are left alone, since those consume.
   */
  private static coalesce(steps: Step[]): Step[] {
    const out: Step[] = []
    const firstIndex = new Map<string, number>()

    for (const step of steps) {
      if (step.kind !== 'mine' && step.kind !== 'hunt') {
        out.push(step)
        continue
      }
      const key =
        step.kind === 'mine'
          ? `mine:${step.item}:${step.block}:${step.tool ?? ''}`
          : `hunt:${step.item}:${step.entity}`
      const at = firstIndex.get(key)
      if (at === undefined) {
        firstIndex.set(key, out.length)
        out.push(step)
        continue
      }
      const existing = out[at]
      if (!existing) continue
      if (existing.kind === 'mine' && step.kind === 'mine') {
        out[at] = {
          ...existing,
          count: existing.count + step.count,
          breaks: existing.breaks + step.breaks,
          seconds: existing.seconds + step.seconds,
        }
      } else if (existing.kind === 'hunt' && step.kind === 'hunt') {
        out[at] = {
          ...existing,
          count: existing.count + step.count,
          kills: existing.kills + step.kills,
          seconds: existing.seconds + step.seconds,
        }
      }
    }
    return out
  }

  private ensure(itemName: string, count: number): boolean {
    if (count <= 0) return true

    const held = this.sim.get(itemName) ?? 0
    if (held > 0) {
      const taken = Math.min(held, count)
      this.sim.set(itemName, held - taken)
      this.steps.push({ kind: 'have', item: itemName, count: taken })
      count -= taken
      if (count <= 0) return true
    }

    if (this.active.has(itemName)) {
      this.missing.add(itemName)
      return false
    }

    const source = this.costs.via.get(itemName)
    if (!source) {
      for (const blocker of blockers(this.costs, itemName)) this.missing.add(blocker)
      return false
    }

    this.active.add(itemName)
    try {
      switch (source.kind) {
        case 'mine':
          return this.mine(itemName, count, source)
        case 'hunt':
          return this.hunt(itemName, count, source)
        case 'craft':
          return this.craft(itemName, count, source)
        case 'smelt':
          return this.smelt(itemName, count, source)
      }
    } finally {
      this.active.delete(itemName)
    }
  }

  private mine(itemName: string, count: number, source: Source & { kind: 'mine' }): boolean {
    const block = this.data.block(source.block)
    const breaks = Math.ceil(count / source.batch)
    let tool = source.tool

    if (block && tool && (this.sim.get(tool) ?? 0) === 0) {
      const required = toolRequirement(this.data, block).minTier !== null
      // A required tool is not a choice. An optional one has to pay for itself:
      // chopping three logs by hand beats crafting an axe first, chopping forty
      // does not. Without this the bot mines a tree to build the axe it wanted
      // in order to mine the tree.
      const savings =
        breaks *
        (digTimeSeconds(this.data, block, null) - digTimeSeconds(this.data, block, tool))
      const worth = required || savings > (this.costs.cost.get(tool) ?? Number.POSITIVE_INFINITY)

      if (worth) {
        if (!this.ensure(tool, 1)) return false
        // Tools are equipment, not ingredients — used, never spent.
        this.sim.set(tool, (this.sim.get(tool) ?? 0) + 1)
      } else {
        tool = this.bestHeld(block)
      }
    }

    this.steps.push({
      kind: 'mine',
      item: itemName,
      count,
      block: source.block,
      tool,
      breaks,
      seconds: breaks * source.overhead,
    })
    this.bank(itemName, Math.floor(breaks * source.batch) - count)
    return true
  }

  private hunt(itemName: string, count: number, source: Source & { kind: 'hunt' }): boolean {
    const kills = Math.ceil(count / source.batch)
    this.steps.push({
      kind: 'hunt',
      item: itemName,
      count,
      entity: source.entity,
      kills,
      seconds: kills * source.overhead,
    })
    this.bank(itemName, Math.floor(kills * source.batch) - count)
    return true
  }

  private craft(itemName: string, count: number, source: Source & { kind: 'craft' }): boolean {
    const times = Math.ceil(count / source.batch)

    if (source.needsTable && !this.stations.table && !this.active.has('crafting_table')) {
      if (!this.ensure('crafting_table', 1)) return false
      this.sim.set('crafting_table', (this.sim.get('crafting_table') ?? 0) + 1)
      this.stations.table = true
    }

    const consumes: Ingredient[] = []
    for (const dep of source.deps) {
      const needed = dep.perBatch * times
      consumes.push({ item: dep.item, count: needed })
      if (!this.ensure(dep.item, needed)) return false
    }

    this.steps.push({
      kind: 'craft',
      item: itemName,
      count,
      times,
      needsTable: source.needsTable,
      consumes,
      seconds: times * CRAFT_SECONDS + (source.needsTable ? STATION_ACCESS_SECONDS : 0),
    })
    this.bank(itemName, times * source.batch - count)
    return true
  }

  private smelt(itemName: string, count: number, source: Source & { kind: 'smelt' }): boolean {
    const times = Math.ceil(count / source.batch)

    if (!this.stations.furnace && !this.active.has('furnace')) {
      if (!this.ensure('furnace', 1)) return false
      this.sim.set('furnace', (this.sim.get('furnace') ?? 0) + 1)
      this.stations.furnace = true
    }

    if (!this.ensure(source.smelt.input, times)) return false

    // Fuel is charged in whole items here even though the cost model prices it
    // fractionally: you cannot put a fifth of a coal in a furnace.
    const burn = burnSeconds(source.fuel)
    const fuelCount = Math.max(1, Math.ceil((times * SMELT_SECONDS) / burn))
    if (!this.ensure(source.fuel, fuelCount)) return false

    this.steps.push({
      kind: 'smelt',
      item: itemName,
      count,
      input: source.smelt.input,
      fuel: source.fuel,
      fuelCount,
      seconds: times * SMELT_SECONDS + STATION_ACCESS_SECONDS,
    })
    this.bank(itemName, times * source.batch - count)
    return true
  }

  private bank(itemName: string, surplus: number): void {
    if (surplus > 0) this.sim.set(itemName, (this.sim.get(itemName) ?? 0) + surplus)
  }

  private bestHeld(block: NonNullable<ReturnType<GameData['block']>>): string | null {
    const held = [...this.sim.entries()].filter(([, n]) => n > 0).map(([name]) => name)
    return bestHeldTool(this.data, block, held)
  }
}

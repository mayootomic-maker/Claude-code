import { beforeAll, describe, expect, it } from 'vitest'
import { GameData } from '../src/mc/data.js'
import { Planner, type Plan, type Step } from '../src/plan/acquire.js'
import { blockers, solveCosts } from '../src/plan/solve.js'

let data: GameData
let planner: Planner

beforeAll(() => {
  data = new GameData('1.21.4')
  planner = new Planner(data)
})

const kinds = (plan: Plan, kind: Step['kind']) => plan.steps.filter((s) => s.kind === kind)
const mentions = (plan: Plan, item: string) =>
  plan.steps.some((s) => s.item === item || (s.kind === 'craft' && s.consumes.some((c) => c.item === item)))

describe('cost table', () => {
  it('prices most of the game and does it quickly', () => {
    const started = Date.now()
    const table = solveCosts(data)
    expect(table.cost.size).toBeGreaterThan(800)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('orders the tech tree the way the game does', () => {
    const cost = (item: string) => planner.unitCost(item)
    expect(cost('oak_planks')).toBeLessThan(cost('wooden_pickaxe'))
    expect(cost('wooden_pickaxe')).toBeLessThan(cost('stone_pickaxe'))
    expect(cost('stone_pickaxe')).toBeLessThan(cost('iron_pickaxe'))
    expect(cost('iron_pickaxe')).toBeLessThan(cost('diamond_pickaxe'))
    expect(cost('diamond')).toBeLessThan(cost('netherite_ingot'))
  })

  it('settles every input before the source that consumes it', () => {
    // This is the property that lets the emitter walk `via` with no cycle
    // detection at all. If it ever stops holding, plans can loop.
    const table = solveCosts(data)
    for (const [item, source] of table.via) {
      const outputOrder = table.order.get(item)
      expect(outputOrder, item).toBeDefined()
      for (const dep of source.deps) {
        expect(table.order.get(dep.item), `${dep.item} before ${item}`).toBeLessThan(outputOrder!)
      }
    }
  })
})

describe('what counts as a source', () => {
  it('will not mine blocks that only exist because a player placed them', () => {
    // Mining an iron block out of the ground prices iron at a few seconds and
    // poisons every plan downstream of it.
    for (const placed of ['iron_block', 'diamond_block', 'gold_block', 'crafting_table']) {
      const plan = planner.plan(placed, 1)
      expect(kinds(plan, 'mine').some((s) => s.kind === 'mine' && s.block === placed), placed).toBe(false)
    }
  })

  it('still farms crops, whose blocks share a name with a craftable item', () => {
    // `wheat` the crop and `wheat` the craftable-from-hay item collide, and the
    // naive placed-block rule concludes wheat cannot be farmed.
    const plan = planner.plan('wheat', 3)
    expect(plan.feasible).toBe(true)
    expect(kinds(plan, 'mine').some((s) => s.kind === 'mine' && s.block === 'wheat')).toBe(true)
  })

  it('will not scrape redstone off the floor', () => {
    // `redstone_wire` is placed dust, not a natural block, and it has no item
    // form — which the first version of the rule read as "natural".
    const plan = planner.plan('redstone', 1)
    const mined = kinds(plan, 'mine').filter((s) => s.kind === 'mine' && s.item === 'redstone')
    expect(mined.length).toBeGreaterThan(0)
    for (const step of mined) if (step.kind === 'mine') expect(step.block).not.toBe('redstone_wire')
  })

  it('does not treat an iron golem as a cheap source of iron', () => {
    // The regression that started all this: a context-dependent infinity leaked
    // out of its cache, deleted smelting from the options, and left fighting a
    // golem as the cheapest remaining route to an ingot.
    const plan = planner.plan('shield', 1)
    expect(plan.feasible).toBe(true)
    expect(kinds(plan, 'hunt').some((s) => s.kind === 'hunt' && s.entity === 'iron_golem')).toBe(false)
    expect(kinds(plan, 'smelt').some((s) => s.kind === 'smelt' && s.item === 'iron_ingot')).toBe(true)
  })
})

describe('progression', () => {
  it('bootstraps a diamond pickaxe through the whole tech tree, in order', () => {
    const plan = planner.plan('diamond_pickaxe', 1)
    expect(plan.feasible).toBe(true)

    const order = plan.steps.map((s) => `${s.kind}:${s.item}`)
    const at = (needle: string) => order.findIndex((s) => s === needle)
    expect(at('craft:crafting_table')).toBeGreaterThanOrEqual(0)
    expect(at('craft:wooden_pickaxe')).toBeGreaterThan(at('craft:crafting_table'))
    expect(at('craft:stone_pickaxe')).toBeGreaterThan(at('craft:wooden_pickaxe'))
    expect(at('craft:iron_pickaxe')).toBeGreaterThan(at('craft:stone_pickaxe'))
    expect(at('craft:diamond_pickaxe')).toBeGreaterThan(at('craft:iron_pickaxe'))
  })

  it('never mines a block with a tool that cannot harvest it', () => {
    for (const goal of ['diamond_pickaxe', 'piston', 'enchanting_table', 'bucket', 'rail']) {
      const plan = planner.plan(goal, 1)
      for (const step of plan.steps) {
        if (step.kind !== 'mine') continue
        const block = data.block(step.block)
        expect(block, step.block).not.toBeNull()
        // Import-free harvest check: the planner must never emit a mine step
        // whose tool fails the same gate the cost model applied.
        expect(canHarvestStep(step.block, step.tool), `${goal}: ${step.block}/${step.tool}`).toBe(true)
      }
    }
  })

  it('acquires a required tool before the step that needs it', () => {
    const plan = planner.plan('diamond_pickaxe', 1)
    const madeAt = new Map<string, number>()
    plan.steps.forEach((step, i) => {
      if (step.kind === 'craft') madeAt.set(step.item, i)
    })
    plan.steps.forEach((step, i) => {
      if (step.kind !== 'mine' || !step.tool) return
      const made = madeAt.get(step.tool)
      if (made !== undefined) expect(made, `${step.tool} before mining ${step.block}`).toBeLessThan(i)
    })
  })

  it('does not craft a tool it does not need for a handful of blocks', () => {
    // Chopping three logs by hand beats crafting an axe first. The bot must not
    // mine a tree in order to build the axe it wanted for mining the tree.
    const plan = planner.plan('crafting_table', 1)
    expect(mentions(plan, 'wooden_axe')).toBe(false)
    expect(plan.feasible).toBe(true)
  })
})

describe('inventory', () => {
  it('spends what is already held instead of gathering it again', () => {
    const stocked = planner.plan(
      'iron_pickaxe',
      1,
      new Map([
        ['iron_ingot', 3],
        ['stick', 2],
        ['crafting_table', 1],
      ]),
    )
    expect(stocked.feasible).toBe(true)
    expect(kinds(stocked, 'mine')).toHaveLength(0)
    expect(kinds(stocked, 'craft')).toHaveLength(1)
    expect(stocked.seconds).toBeLessThan(planner.plan('iron_pickaxe', 1).seconds)
  })

  it('counts each held item once, not once per requirement', () => {
    const plan = planner.plan('stick', 8, new Map([['oak_planks', 4]]))
    const have = kinds(plan, 'have').filter((s) => s.item === 'oak_planks')
    const total = have.reduce((n, s) => n + s.count, 0)
    expect(total).toBeLessThanOrEqual(4)
  })

  it('reuses the surplus a recipe leaves behind', () => {
    // One log makes four planks; a plan needing three must not fell two trees.
    const plan = planner.plan('oak_planks', 3, new Map())
    const logs = kinds(plan, 'mine').reduce((n, s) => n + (s.kind === 'mine' ? s.breaks : 0), 0)
    expect(logs).toBe(1)
  })

  it('scales up without scaling the step count', () => {
    const one = planner.plan('torch', 4)
    const many = planner.plan('torch', 64)
    expect(many.seconds).toBeGreaterThan(one.seconds)
    expect(many.steps.length).toBeLessThan(one.steps.length * 3)
  })
})

describe('impossible goals', () => {
  it('names the thing it cannot get, not the thing that needed it', () => {
    const plan = planner.plan('beacon', 1)
    expect(plan.feasible).toBe(false)
    expect(plan.missing).toContain('nether_star')
    expect(plan.steps).toEqual([])
  })

  it('reports blockers rather than throwing', () => {
    const table = solveCosts(data)
    expect(blockers(table, 'cake')).toContain('milk_bucket')
    expect(planner.obtainable('nether_star')).toBe(false)
  })

  it('honours forbidden mobs, blocks and items', () => {
    const noIron = new Planner(data, { forbidden: new Set(['iron_ore', 'deepslate_iron_ore']) })
    const plan = noIron.plan('iron_ingot', 1)
    for (const step of plan.steps) {
      if (step.kind === 'mine') expect(step.block).not.toBe('iron_ore')
    }
  })
})

describe('knowledge changes the answer', () => {
  it('prefers a remembered deposit over a guessed one', () => {
    const blind = new Planner(data)
    const knows = new Planner(data, { searchOverrides: new Map([['deepslate_diamond_ore', 5]]) })
    expect(knows.unitCost('diamond')).toBeLessThan(blind.unitCost('diamond'))
  })
})

/** Mirrors the harvest gate without importing it, so the test is independent. */
function canHarvestStep(blockName: string, tool: string | null): boolean {
  const block = data.block(blockName)
  if (!block) return false
  const harvest = block.harvestTools
  if (!harvest) return true
  if (!tool) return false
  const item = data.item(tool)
  return item ? Object.hasOwn(harvest, String(item.id)) : false
}

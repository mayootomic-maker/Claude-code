/**
 * The verbs the model is allowed to use.
 *
 * The division of labour matters more than the list. The model is *not* asked
 * to work out that a diamond pickaxe needs three diamonds, which need an iron
 * pickaxe, which needs a furnace. It asks for a diamond pickaxe and the planner
 * solves the tree exactly. What the model is for is the part no search can do:
 * reading "set us up for a night raid" and deciding that means armour, food,
 * torches and a bed.
 *
 * So the tools are coarse. A tool per keypress would put the model in charge of
 * things it is worse at than the code is, and would cost a round trip per
 * block.
 */

import { inventoryMap, snapshot } from '../bot/world.js'
import { acquire, hunt, killEntity, mineFor } from '../skills/gather.js'
import { craft, placeBlockNearby } from '../skills/craft.js'
import { buildRoom, light, placeAt, shelter } from '../skills/build.js'
import { explore, follow, goTo, goToPlace, idle } from '../skills/movement.js'
import { deposit, listChest, withdraw } from '../skills/storage.js'
import { eat, equipArmour, equipTool, flee, sleep as sleepInBed } from '../skills/survive.js'
import { fail, ok, type SkillContext, type SkillResult } from '../skills/types.js'
import { Vec3 } from 'vec3'

export interface JsonSchema {
  readonly type: 'object'
  readonly properties: Record<string, unknown>
  readonly required?: readonly string[]
}

export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly input: JsonSchema
  readonly run: (ctx: SkillContext, args: Record<string, unknown>) => Promise<SkillResult>
}

// Hand-rolled argument reading. The model's arguments are untrusted input like
// any other, and a wrong type here would surface as an incomprehensible failure
// deep inside a skill rather than as "you passed a string where a number goes".
function str(args: Record<string, unknown>, key: string, fallback?: string): string {
  const value = args[key]
  if (typeof value === 'string' && value.length > 0) return value
  if (fallback !== undefined) return fallback
  throw new BadArgument(`"${key}" must be a non-empty string`)
}

function num(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // Models routinely send numbers as strings; accepting that is not laxity,
  // it is the difference between a task completing and a task failing on a
  // formatting detail nobody cares about.
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  if (fallback !== undefined) return fallback
  throw new BadArgument(`"${key}" must be a number`)
}

function count(args: Record<string, unknown>, key = 'count', fallback = 1): number {
  const n = Math.floor(num(args, key, fallback))
  if (n < 1) throw new BadArgument(`"${key}" must be at least 1`)
  // A model that asks for 10000 cobblestone has misunderstood something; the
  // cap turns a runaway task into a bounded one.
  return Math.min(n, 2304)
}

export class BadArgument extends Error {}

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'look_around',
    description:
      'Report the current surroundings: position, health, hunger, time of day, inventory, nearby blocks, mobs and players. Call this when you need to know the current state, and after anything surprising.',
    input: { type: 'object', properties: {} },
    async run(ctx) {
      const view = snapshot(ctx.bot, ctx.data)
      return ok('had a look around', { snapshot: view })
    },
  },
  {
    name: 'plan',
    description:
      'Work out how to obtain an item, WITHOUT doing any of it. Returns the ordered steps and an estimate in minutes, or says what makes it impossible. Use this to check the cost of something before committing to it, or to answer questions about what it would take.',
    input: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Minecraft item id, e.g. diamond_pickaxe' },
        count: { type: 'number', description: 'How many. Defaults to 1.' },
      },
      required: ['item'],
    },
    async run(ctx, args) {
      const item = str(args, 'item')
      const wanted = count(args)
      const planner = ctx.planner.withKnowledge({ searchOverrides: ctx.memory.searchTimes() })
      const result = planner.plan(item, wanted, inventoryMap(ctx.bot))
      if (!result.feasible) {
        return fail(`cannot obtain ${item}: no route to ${result.missing.join(', ')}`, {
          missing: result.missing,
        })
      }
      return ok(`${wanted}x ${item}: about ${Math.max(1, Math.round(result.seconds / 60))} minutes`, {
        minutes: Math.round(result.seconds / 60),
        steps: result.steps.map(describeStep),
      })
    },
  },
  {
    name: 'acquire',
    description:
      'Obtain an item, doing whatever it takes: mining, crafting, smelting, hunting, and building the tools needed along the way. This is the main tool. Prefer it over mine_block and craft_item — it works out the whole dependency tree itself and re-plans when something goes wrong.',
    input: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Minecraft item id, e.g. iron_pickaxe' },
        count: { type: 'number' },
      },
      required: ['item'],
    },
    run: (ctx, args) => acquire(ctx, str(args, 'item'), count(args)),
  },
  {
    name: 'mine_block',
    description:
      'Mine a specific kind of block that is already nearby. Use acquire instead unless you specifically want this block kind broken, e.g. clearing stone.',
    input: {
      type: 'object',
      properties: {
        block: { type: 'string', description: 'Block id, e.g. deepslate_diamond_ore' },
        count: { type: 'number' },
      },
      required: ['block'],
    },
    run(ctx, args) {
      const blockName = str(args, 'block')
      const info = ctx.data.block(blockName)
      if (!info) return Promise.resolve(fail(`there is no block called "${blockName}"`))
      const drop = info.drops[0]
      const itemName = drop !== undefined ? ctx.data.itemName(drop) : blockName
      return mineFor(ctx, blockName, itemName, count(args))
    },
  },
  {
    name: 'craft_item',
    description: 'Craft an item from ingredients already held. Fails if anything is missing; acquire handles that case for you.',
    input: {
      type: 'object',
      properties: { item: { type: 'string' }, count: { type: 'number' } },
      required: ['item'],
    },
    run: (ctx, args) => craft(ctx, str(args, 'item'), count(args)),
  },
  {
    name: 'go_to',
    description: 'Walk to specific coordinates.',
    input: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        range: { type: 'number', description: 'How close is close enough. Default 2.' },
      },
      required: ['x', 'y', 'z'],
    },
    run: (ctx, args) => goTo(ctx, num(args, 'x'), num(args, 'y'), num(args, 'z'), num(args, 'range', 2)),
  },
  {
    name: 'go_to_place',
    description: 'Walk to a saved, named place such as "home" or "the mine".',
    input: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (ctx, args) => goToPlace(ctx, str(args, 'name')),
  },
  {
    name: 'remember_place',
    description: 'Save the current position under a name, so it can be walked back to later.',
    input: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        note: { type: 'string', description: 'Optional description of what is here.' },
      },
      required: ['name'],
    },
    async run(ctx, args) {
      const name = str(args, 'name')
      const p = ctx.bot.entity.position
      ctx.memory.remember(
        name,
        { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        ctx.bot.game?.dimension ?? 'overworld',
        args['note'] === undefined ? undefined : str(args, 'note'),
      )
      await ctx.memory.save()
      return ok(`saved this spot as "${name}"`)
    },
  },
  {
    name: 'explore',
    description:
      'Wander outward to find something not currently in range, or just to see what is around. Give looking_for to stop as soon as that block is spotted.',
    input: {
      type: 'object',
      properties: {
        looking_for: { type: 'string', description: 'Block id to search for.' },
        max_distance: { type: 'number' },
      },
    },
    run: (ctx, args) =>
      explore(ctx, {
        lookingFor: args['looking_for'] === undefined ? undefined : str(args, 'looking_for'),
        maxDistance: num(args, 'max_distance', 256),
      }),
  },
  {
    name: 'follow_player',
    description: 'Walk after a player and keep up with them.',
    input: {
      type: 'object',
      properties: { player: { type: 'string' }, range: { type: 'number' } },
      required: ['player'],
    },
    run: (ctx, args) => follow(ctx, str(args, 'player'), num(args, 'range', 3)),
  },
  {
    name: 'attack',
    description: 'Attack the nearest mob of a kind, or the nearest hostile mob if no kind is given.',
    input: { type: 'object', properties: { target: { type: 'string' } } },
    async run(ctx, args) {
      const wanted = args['target'] === undefined ? null : str(args, 'target')
      const entity = ctx.bot.nearestEntity((e) =>
        wanted ? e.name === wanted : e.type === 'hostile' || e.kind === 'Hostile mobs',
      )
      if (!entity) return fail(wanted ? `no ${wanted} nearby` : 'no hostile mobs nearby')
      return killEntity(ctx, entity.id)
    },
  },
  {
    name: 'hunt',
    description: 'Kill a kind of mob repeatedly until enough of a drop has been collected.',
    input: {
      type: 'object',
      properties: {
        entity: { type: 'string' }, item: { type: 'string' }, count: { type: 'number' },
      },
      required: ['entity', 'item'],
    },
    run: (ctx, args) => hunt(ctx, str(args, 'entity'), str(args, 'item'), count(args)),
  },
  {
    name: 'flee',
    description: 'Break off and run away from whatever is attacking.',
    input: { type: 'object', properties: {} },
    run: (ctx) => flee(ctx),
  },
  {
    name: 'eat',
    description: 'Eat the most filling safe food carried.',
    input: { type: 'object', properties: {} },
    run: (ctx) => eat(ctx),
  },
  {
    name: 'equip',
    description: 'Hold a specific item, or put on the best armour carried.',
    input: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Item to hold. Omit to equip armour instead.' },
      },
    },
    run: (ctx, args) =>
      args['item'] === undefined ? equipArmour(ctx) : equipTool(ctx, str(args, 'item')),
  },
  {
    name: 'place_block',
    description: 'Put a block down, either at given coordinates or just somewhere sensible nearby.',
    input: {
      type: 'object',
      properties: {
        block: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      },
      required: ['block'],
    },
    run(ctx, args) {
      const blockName = str(args, 'block')
      if (args['x'] === undefined) return placeBlockNearby(ctx, blockName)
      return placeAt(ctx, new Vec3(num(args, 'x'), num(args, 'y'), num(args, 'z')), blockName)
    },
  },
  {
    name: 'shelter',
    description:
      'Dig in and seal up for safety. The right response to nightfall in the open, or to being overwhelmed.',
    input: { type: 'object', properties: {} },
    run: (ctx) => shelter(ctx),
  },
  {
    name: 'build_room',
    description: 'Build a hollow rectangular room with a doorway, between 3x3 and 12x12.',
    input: {
      type: 'object',
      properties: {
        width: { type: 'number' }, depth: { type: 'number' },
        height: { type: 'number' }, block: { type: 'string' },
      },
      required: ['width', 'depth'],
    },
    run: (ctx, args) =>
      buildRoom(
        ctx,
        num(args, 'width'),
        num(args, 'depth'),
        num(args, 'height', 3),
        args['block'] === undefined ? undefined : str(args, 'block'),
      ),
  },
  {
    name: 'place_torch',
    description: 'Light the current spot if it is dark.',
    input: { type: 'object', properties: {} },
    run: (ctx) => light(ctx),
  },
  {
    name: 'sleep',
    description: 'Sleep in a nearby bed to skip the night and set the respawn point.',
    input: { type: 'object', properties: {} },
    run: (ctx) => sleepInBed(ctx),
  },
  {
    name: 'store_items',
    description: 'Put things into a nearby chest. With no list, stores everything not needed to keep working.',
    input: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
    },
    run(ctx, args) {
      const items = args['items']
      return deposit(ctx, Array.isArray(items) ? items.map(String) : undefined)
    },
  },
  {
    name: 'take_items',
    description: 'Take something out of a nearby chest.',
    input: {
      type: 'object',
      properties: { item: { type: 'string' }, count: { type: 'number' } },
      required: ['item'],
    },
    run: (ctx, args) => withdraw(ctx, str(args, 'item'), count(args)),
  },
  {
    name: 'check_chest',
    description: 'List what is in the nearest chest.',
    input: { type: 'object', properties: {} },
    run: (ctx) => listChest(ctx),
  },
  {
    name: 'say',
    description:
      'Say something in chat. Use this to answer the owner, or to tell them something worth knowing. Keep it short and casual, the way a person types in game.',
    input: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    async run(ctx, args) {
      const message = str(args, 'message')
      await ctx.golem.say(message)
      return ok(`said: ${message}`)
    },
  },
  {
    name: 'wait',
    description: 'Stand by for a number of seconds. Useful for waiting out the night or a furnace.',
    input: {
      type: 'object',
      properties: { seconds: { type: 'number' } },
      required: ['seconds'],
    },
    run: (ctx, args) => idle(ctx, Math.min(600, Math.max(1, num(args, 'seconds')))),
  },
  {
    name: 'done',
    description:
      'Finish the current task and report what happened. Call this when the task is complete, or when it cannot be completed and you have said why.',
    input: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One line on what was achieved.' },
        succeeded: { type: 'boolean' },
      },
      required: ['summary'],
    },
    async run(_ctx, args) {
      const summary = str(args, 'summary')
      const succeeded = args['succeeded'] !== false
      return { ok: succeeded, detail: summary, data: { finished: true } }
    },
  },
]

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolSpec> = new Map(TOOLS.map((t) => [t.name, t]))

function describeStep(step: {
  kind: string
  item: string
  count: number
  block?: string
  entity?: string
  input?: string
}): string {
  switch (step.kind) {
    case 'have':
      return `already have ${step.count} ${step.item}`
    case 'mine':
      return `mine ${step.block} for ${step.count} ${step.item}`
    case 'hunt':
      return `hunt ${step.entity} for ${step.count} ${step.item}`
    case 'craft':
      return `craft ${step.count} ${step.item}`
    case 'smelt':
      return `smelt ${step.input} into ${step.count} ${step.item}`
    default:
      return `${step.kind} ${step.count} ${step.item}`
  }
}

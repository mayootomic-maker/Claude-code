/**
 * Getting from here to there.
 *
 * `mineflayer-pathfinder` does the search; this wraps it with the things that
 * make the difference between a bot that arrives and a bot that gets stuck:
 * a timeout, a stuck detector, and permission rules about what it may break or
 * place on the way.
 *
 * The stuck detector matters more than it sounds. Pathfinder happily reports a
 * path and then makes no progress at all — snagged on a fence post, standing in
 * a doorway, walking into a wall it thinks it can pass. Without a watchdog the
 * whole agent hangs on a promise that never settles.
 */

import type { Bot } from 'mineflayer'
// mineflayer-pathfinder is CommonJS: under ESM its named exports are not
// reliably detected, so it is imported as a default and destructured. This is
// a runtime failure that typechecking does not catch.
import pathfinderPkg from 'mineflayer-pathfinder'
// Types are erased at compile time, so importing them by name is safe even
// though importing the values by name is not.
import type { Movements as MovementsType, goals as GoalTypes } from 'mineflayer-pathfinder'

const { Movements, goals } = pathfinderPkg
import { Vec3 } from 'vec3'
import { sleep } from './bot.js'
import type { Logger } from '../util/log.js'

export interface TravelOptions {
  /** How close counts as arrived. */
  readonly range?: number
  readonly timeoutMs?: number
  /** Allow breaking blocks to make a way through. */
  readonly canDig?: boolean
  /** Allow bridging gaps with blocks from the inventory. */
  readonly canPlace?: boolean
  /** Never step into these, whatever the path cost says. */
  readonly avoid?: readonly string[]
}

export interface TravelResult {
  readonly arrived: boolean
  readonly reason: 'arrived' | 'timeout' | 'stuck' | 'no-path' | 'interrupted'
  readonly distance: number
}

const DEFAULT_AVOID = ['lava', 'fire', 'magma_block', 'cactus', 'sweet_berry_bush', 'powder_snow']

export class Navigator {
  constructor(
    private readonly bot: Bot,
    private readonly log: Logger,
  ) {}

  /** Configure what the bot is willing to do to reach somewhere. */
  private movements(options: TravelOptions): MovementsType {
    const movements = new Movements(this.bot)
    movements.canDig = options.canDig ?? true
    movements.allow1by1towers = options.canPlace ?? true
    movements.allowParkour = true
    movements.allowSprinting = true

    for (const name of [...DEFAULT_AVOID, ...(options.avoid ?? [])]) {
      const block = this.bot.registry.blocksByName[name]
      if (block) movements.blocksToAvoid.add(block.id)
    }
    // Never tear up a chest or a crafting table to shorten a walk. The path is
    // not worth the base.
    for (const name of ['chest', 'trapped_chest', 'barrel', 'furnace', 'crafting_table', 'ender_chest', 'bed']) {
      const block = this.bot.registry.blocksByName[name]
      if (block) movements.blocksCantBreak.add(block.id)
    }
    return movements
  }

  async travelTo(target: Vec3, options: TravelOptions = {}): Promise<TravelResult> {
    const range = options.range ?? 1
    const timeoutMs = options.timeoutMs ?? 90_000
    const goal = new goals.GoalNear(target.x, target.y, target.z, range)
    return this.pursue(goal, target, timeoutMs, options)
  }

  /** Walk to within `range` of an entity, following it as it moves. */
  async follow(entityId: number, range = 3, timeoutMs = 30_000): Promise<TravelResult> {
    const entity = this.bot.entities[entityId]
    if (!entity) return { arrived: false, reason: 'no-path', distance: Infinity }
    const goal = new goals.GoalFollow(entity, range)
    return this.pursue(goal, entity.position, timeoutMs, {}, true)
  }

  private async pursue(
    goal: GoalTypes.Goal,
    target: Vec3,
    timeoutMs: number,
    options: TravelOptions,
    dynamic = false,
  ): Promise<TravelResult> {
    this.bot.pathfinder.setMovements(this.movements(options))

    const started = Date.now()
    let lastPosition = this.bot.entity.position.clone()
    let lastProgress = started
    let finished: TravelResult | null = null

    const walk = this.bot.pathfinder
      .goto(goal)
      .then(() => {
        finished = { arrived: true, reason: 'arrived' as const, distance: this.distanceTo(target) }
      })
      .catch((error: unknown) => {
        const message = String(error)
        // Pathfinder throws for both "no route exists" and "the goal moved",
        // and only the first is worth reporting as a failure.
        finished = {
          arrived: false,
          reason: message.includes('No path') ? ('no-path' as const) : ('interrupted' as const),
          distance: this.distanceTo(target),
        }
      })

    while (!finished) {
      if (Date.now() - started > timeoutMs) {
        this.stop()
        return { arrived: false, reason: 'timeout', distance: this.distanceTo(target) }
      }

      const here = this.bot.entity.position
      if (here.distanceTo(lastPosition) > 0.6) {
        lastPosition = here.clone()
        lastProgress = Date.now()
      } else if (Date.now() - lastProgress > 6_000 && !dynamic) {
        // Six seconds without moving half a block means snagged, not slow.
        this.log.warn('stuck while travelling', { target: format(target) })
        this.stop()
        await this.unstick()
        return { arrived: false, reason: 'stuck', distance: this.distanceTo(target) }
      }
      await sleep(250)
    }

    await walk
    return finished
  }

  /**
   * Shove out of a snag: jump, and shuffle sideways for a moment.
   *
   * Crude on purpose. The point is to break whatever geometric tie has the bot
   * pinned so the next path attempt starts from somewhere new, not to be clever
   * about why it was pinned.
   */
  private async unstick(): Promise<void> {
    const sideways = Math.random() < 0.5 ? 'left' : 'right'
    this.bot.setControlState('jump', true)
    this.bot.setControlState(sideways, true)
    await sleep(400)
    this.bot.setControlState('jump', false)
    this.bot.setControlState(sideways, false)
    this.bot.setControlState('back', true)
    await sleep(300)
    this.bot.setControlState('back', false)
  }

  stop(): void {
    try {
      this.bot.pathfinder.stop()
      this.bot.pathfinder.setGoal(null)
    } catch {
      // Stopping an already-stopped pathfinder is not an error worth raising.
    }
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint'] as const) {
      this.bot.setControlState(control, false)
    }
  }

  private distanceTo(target: Vec3): number {
    return this.bot.entity.position.distanceTo(target)
  }
}

function format(v: Vec3): string {
  return `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`
}

/**
 * The skill contract.
 *
 * A skill is one thing the bot knows how to do, and every one of them returns
 * a result rather than throwing. That is deliberate: skills fail constantly and
 * ordinarily — the ore ran out, the mob moved, the path closed — and a failure
 * that arrives as a value can be handed back to the planner or the model as
 * information. A failure that arrives as an exception just ends the turn.
 */

import type { Bot } from 'mineflayer'
import type { GameData } from '../mc/data.js'
import type { Planner } from '../plan/acquire.js'
import type { GolemBot } from '../bot/bot.js'
import type { Navigator } from '../bot/nav.js'
import type { Memory } from '../memory/store.js'
import type { Logger } from '../util/log.js'

export interface SkillContext {
  readonly golem: GolemBot
  readonly bot: Bot
  readonly data: GameData
  readonly planner: Planner
  readonly nav: Navigator
  readonly memory: Memory
  readonly log: Logger
  /** Resolves true when the current task has been cancelled. */
  readonly cancelled: () => boolean
}

export interface SkillResult {
  readonly ok: boolean
  /** One line, written for a person reading chat. */
  readonly detail: string
  /** Anything the model or caller might want to branch on. */
  readonly data?: Record<string, unknown>
}

export const ok = (detail: string, data?: Record<string, unknown>): SkillResult => ({ ok: true, detail, data })
export const fail = (detail: string, data?: Record<string, unknown>): SkillResult => ({ ok: false, detail, data })

/** Thrown only for cancellation, which is control flow rather than failure. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

export function checkCancelled(ctx: SkillContext): void {
  if (ctx.cancelled()) throw new Cancelled()
}

/**
 * The agent loop.
 *
 * One task at a time. The model is asked what to do, a tool runs, the result
 * goes back, repeat — until it calls `done` or runs out of budget.
 *
 * Two things sit outside that loop on purpose. Reflexes (eat, flee, fight back)
 * run on their own timer between tool calls, because a model asked to "mine
 * diamonds" does not reliably notice it is on fire, and waiting for the next
 * round trip to find out is how bots die with full inventories. And the whole
 * dependency-solving job belongs to the planner, so the loop is usually only a
 * handful of turns long even for a task like "get me a beacon".
 */

import { GolemBot } from '../bot/bot.js'
import { snapshot, inventoryMap } from '../bot/world.js'
import { Navigator } from '../bot/nav.js'
import type { GameData } from '../mc/data.js'
import type { Planner } from '../plan/acquire.js'
import type { Memory } from '../memory/store.js'
import { Cancelled, type SkillContext, type SkillResult } from '../skills/types.js'
import { assessDanger, eat, flee } from '../skills/survive.js'
import { killEntity } from '../skills/gather.js'
import { BadArgument, TOOLS, TOOLS_BY_NAME } from './tools.js'
import { createModel, type LanguageModel, type Message } from './llm.js'
import { SYSTEM_PROMPT, describeHistory, describeSituation } from './prompt.js'
import type { Logger } from '../util/log.js'

export interface AgentOptions {
  readonly golem: GolemBot
  readonly data: GameData
  readonly planner: Planner
  readonly memory: Memory
  readonly model: LanguageModel
  readonly log: Logger
  /** Hard cap on tool calls per task, so a confused model cannot run forever. */
  readonly maxSteps?: number
  /** How often to run the survival reflexes, in milliseconds. */
  readonly reflexIntervalMs?: number
}

export interface TaskOutcome {
  readonly ok: boolean
  readonly summary: string
  readonly steps: number
  readonly seconds: number
}

export class Agent {
  private readonly ctx: SkillContext
  private readonly log: Logger
  private cancelling = false
  private running = false
  private reflexTimer: NodeJS.Timeout | null = null
  private reflexBusy = false

  constructor(private readonly options: AgentOptions) {
    this.log = options.log
    const nav = new Navigator(options.golem.bot, this.log.child('nav'))
    this.ctx = {
      golem: options.golem,
      bot: options.golem.bot,
      data: options.data,
      planner: options.planner,
      nav,
      memory: options.memory,
      log: this.log.child('skill'),
      cancelled: () => this.cancelling,
    }
  }

  get busy(): boolean {
    return this.running
  }

  /** Stop the current task at the next safe point. */
  cancel(): void {
    if (!this.running) return
    this.cancelling = true
    this.ctx.nav.stop()
  }

  /**
   * Start the reflex loop.
   *
   * Runs whether or not a task is in progress: an idle bot standing in the dark
   * still needs to notice the skeleton.
   */
  startReflexes(): void {
    if (this.reflexTimer) return
    const interval = this.options.reflexIntervalMs ?? 1_500
    this.reflexTimer = setInterval(() => void this.reflex(), interval)
  }

  stopReflexes(): void {
    if (this.reflexTimer) clearInterval(this.reflexTimer)
    this.reflexTimer = null
  }

  private async reflex(): Promise<void> {
    // Reflexes must never overlap each other, and must never fight the task for
    // the same body: one at a time, and only between tool calls.
    if (this.reflexBusy || !this.options.golem.spawned) return
    this.reflexBusy = true
    try {
      const danger = assessDanger(this.ctx)
      if (!danger) return
      this.log.info('reflex', { kind: danger.kind, reason: danger.reason })

      switch (danger.kind) {
        case 'eat':
          await eat(this.ctx)
          break
        case 'flee':
          await flee(this.ctx)
          break
        case 'fight':
          await killEntity(this.ctx, danger.entityId)
          break
        case 'surface':
          // Straight up is the fastest way out of water, and the only one that
          // works when the shore is further away than the remaining air.
          this.ctx.bot.setControlState('jump', true)
          setTimeout(() => this.ctx.bot.setControlState('jump', false), 3_000)
          break
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        this.log.warn('reflex failed', { error: String(error) })
      }
    } finally {
      this.reflexBusy = false
    }
  }

  /** Run one task to completion. */
  async run(task: string, from?: string): Promise<TaskOutcome> {
    if (this.running) {
      return { ok: false, summary: 'already busy with something else', steps: 0, seconds: 0 }
    }
    this.running = true
    this.cancelling = false

    const startedAt = Date.now()
    const maxSteps = this.options.maxSteps ?? 24
    const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input: t.input }))

    const situation = describeSituation(snapshot(this.ctx.bot, this.ctx.data))
    const history = describeHistory(
      this.options.memory.recent(5).map((e) => ({ task: e.task, outcome: e.outcome, detail: e.detail })),
    )

    const messages: Message[] = [
      {
        role: 'user',
        text: [
          from ? `${from} says: ${task}` : `Task: ${task}`,
          '',
          situation,
          history ? `\n${history}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ]

    let steps = 0
    let summary = 'stopped without a result'
    let succeeded = false

    try {
      while (steps < maxSteps) {
        if (this.cancelling) {
          summary = 'cancelled'
          break
        }

        const reply = await this.options.model.respond(SYSTEM_PROMPT, messages, tools)

        // Text with no tool call means the model has said its piece and has
        // nothing left to do. Treat that as the end rather than prompting it
        // again, which just produces a second goodbye.
        if (reply.toolCalls.length === 0) {
          if (reply.text) await this.options.golem.say(reply.text)
          summary = reply.text || 'nothing to do'
          succeeded = true
          break
        }

        messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls })

        let finished = false
        for (const call of reply.toolCalls) {
          steps++
          const result = await this.invoke(call.name, call.input)
          this.log.info('tool', { name: call.name, ok: result.ok, detail: result.detail })

          messages.push({
            role: 'tool',
            callId: call.id,
            text: renderResult(result),
            failed: !result.ok,
          })

          if (result.data?.['finished'] === true) {
            summary = result.detail
            succeeded = result.ok
            finished = true
            break
          }
        }
        if (finished) break
      }

      if (steps >= maxSteps) summary = `gave up after ${maxSteps} steps`
    } catch (error) {
      if (error instanceof Cancelled) {
        summary = 'cancelled'
      } else {
        summary = `something went wrong: ${String(error)}`
        this.log.error('task failed', { error: String(error) })
      }
    } finally {
      this.running = false
      this.cancelling = false
      this.ctx.nav.stop()
    }

    const seconds = (Date.now() - startedAt) / 1000
    this.options.memory.record({
      at: Date.now(),
      task,
      outcome: succeeded ? 'done' : summary === 'cancelled' ? 'cancelled' : 'failed',
      detail: summary,
      seconds: Math.round(seconds),
    })
    await this.options.memory.save().catch(() => {
      /* a failed memory write must not fail the task */
    })

    return { ok: succeeded, summary, steps, seconds }
  }

  private async invoke(name: string, input: Record<string, unknown>): Promise<SkillResult> {
    const tool = TOOLS_BY_NAME.get(name)
    if (!tool) {
      return { ok: false, detail: `there is no tool called "${name}"` }
    }
    try {
      return await tool.run(this.ctx, input)
    } catch (error) {
      if (error instanceof Cancelled) throw error
      if (error instanceof BadArgument) {
        return { ok: false, detail: `bad arguments for ${name}: ${error.message}` }
      }
      // A skill that throws is a bug, but the loop has to keep going: hand the
      // model the error so it can try something else.
      this.log.error('tool threw', { name, error: String(error) })
      return { ok: false, detail: `${name} failed: ${String(error)}` }
    }
  }

  /** What the bot is carrying, for the status line and the dashboard. */
  inventory(): Map<string, number> {
    return inventoryMap(this.ctx.bot)
  }
}

/**
 * Render a tool result for the model.
 *
 * Structured data is folded in as JSON only when there is any — a bare
 * `{"data":{}}` on every result is noise the model has to read past on every
 * turn, and it adds up over a long task.
 */
function renderResult(result: SkillResult): string {
  const extra = result.data ? withoutInternals(result.data) : null
  const suffix = extra && Object.keys(extra).length > 0 ? `\n${JSON.stringify(extra)}` : ''
  return `${result.ok ? 'OK' : 'FAILED'}: ${result.detail}${suffix}`
}

function withoutInternals(data: Record<string, unknown>): Record<string, unknown> {
  const { finished: _finished, ...rest } = data
  return rest
}

export function createAgentModel(options: {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  logger?: Logger
}): LanguageModel {
  const provider = options.provider === 'openai' ? 'openai' : 'anthropic'
  return createModel({
    provider,
    model: options.model ?? (provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'),
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    logger: options.logger,
  })
}

/**
 * The in-game chat interface.
 *
 * This is the whole user interface for most people: you type at the bot in
 * chat and it does the thing. The design goal is that nothing needs to be
 * learned — any sentence addressed to the bot is a task, and the handful of
 * words that mean something specific ("stop", "status") are the ones a person
 * would try first anyway.
 */

import type { Agent } from '../brain/agent.js'
import type { GolemBot } from '../bot/bot.js'
import { snapshot } from '../bot/world.js'
import type { GameData } from '../mc/data.js'
import type { Memory } from '../memory/store.js'
import type { Logger } from '../util/log.js'

export interface ChatOptions {
  readonly golem: GolemBot
  readonly agent: Agent
  readonly data: GameData
  readonly memory: Memory
  readonly log: Logger
  /** Players allowed to give orders. Empty means anyone. */
  readonly owners: readonly string[]
}

/** Words that mean something specific rather than being a task. */
const STOP_WORDS = new Set(['stop', 'cancel', 'halt', 'wait', 'stop!', 'abort'])
const STATUS_WORDS = new Set(['status', 'what are you doing', 'wyd', 'sitrep', 'report'])
const HELP_WORDS = new Set(['help', 'commands', '?', 'what can you do'])

export function attachChat(options: ChatOptions): void {
  const { golem, agent, memory, log, owners } = options
  const bot = golem.bot
  const self = () => bot.username.toLowerCase()

  bot.on('chat', (username, message) => {
    if (username === bot.username) return

    const addressed = extractCommand(message, self())
    if (addressed === null) return

    if (owners.length > 0 && !owners.some((o) => o.toLowerCase() === username.toLowerCase())) {
      log.debug('ignoring order from a non-owner', { username })
      return
    }

    void handle(username, addressed).catch((error: unknown) => {
      log.error('chat handler failed', { error: String(error) })
    })
  })

  async function handle(username: string, text: string): Promise<void> {
    const normalised = text.trim().toLowerCase()

    if (STOP_WORDS.has(normalised)) {
      if (!agent.busy) {
        await golem.say('not doing anything', 'reflex')
        return
      }
      agent.cancel()
      await golem.say('ok, stopping', 'reflex')
      return
    }

    if (STATUS_WORDS.has(normalised)) {
      await golem.say(status(), 'reflex')
      return
    }

    if (HELP_WORDS.has(normalised)) {
      await golem.say('just tell me what you want. "stop" to stop, "status" to check in.', 'reflex')
      return
    }

    if (agent.busy) {
      // Queueing would be worse: by the time the first task finishes the second
      // is usually stale. Say so and let the person decide.
      await golem.say('busy right now — say stop first', 'reflex')
      return
    }

    log.info('task received', { from: username, task: text })
    const outcome = await agent.run(text, username)
    log.info('task finished', { ok: outcome.ok, summary: outcome.summary, steps: outcome.steps })
  }

  function status(): string {
    const view = snapshot(bot, options.data)
    const parts = [
      agent.busy ? 'working on something' : 'idle',
      `${view.health}/20 hp`,
      `${view.food}/20 food`,
      `at ${view.position.x}, ${view.position.y}, ${view.position.z}`,
    ]
    const last = memory.recent(1)[0]
    if (last) parts.push(`last: ${last.task} (${last.outcome})`)
    return parts.join(', ')
  }
}

/**
 * Decide whether a chat line is aimed at the bot, and strip the address off.
 *
 * Accepts "golem, do x", "golem do x", "@golem do x" and a bare "golem" as a
 * greeting. Returns null for anything not addressed to it, so the bot does not
 * respond to every line in a busy server's chat.
 */
export function extractCommand(message: string, botName: string): string | null {
  const trimmed = message.trim()
  const lower = trimmed.toLowerCase()
  const name = botName.toLowerCase()

  for (const prefix of [`@${name}`, name]) {
    if (!lower.startsWith(prefix)) continue
    const rest = trimmed.slice(prefix.length).replace(/^[\s,:>-]+/, '')
    return rest.length > 0 ? rest : 'say hello'
  }
  return null
}

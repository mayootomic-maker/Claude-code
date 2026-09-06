/**
 * The body: a mineflayer connection with the humanisation layer wired into it.
 *
 * Two things matter here. First, every head movement goes through `Aim` rather
 * than `bot.look` directly — a single stray snap-to-target undoes the whole
 * layer, so the raw call is wrapped and the humanised one is the only one the
 * skills can reach. Second, the bot pauses: `gate()` is awaited before any
 * deliberate action and blocks while the persona is taking one of its breaks.
 */

import mineflayer, { type Bot, type BotOptions } from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { Aim, lookAt, type Orientation } from '../human/aim.js'
import { makePersona, type Persona, type PersonaOverrides } from '../human/profile.js'
import { Rhythm } from '../human/rhythm.js'
import { Typist } from '../human/typing.js'
import { createLogger, type Logger } from '../util/log.js'

export interface GolemBotOptions {
  readonly host: string
  readonly port?: number
  readonly username: string
  readonly version?: string
  /** 'offline' for a LAN world or cracked server; 'microsoft' for a real account. */
  readonly auth?: 'offline' | 'microsoft'
  readonly persona?: PersonaOverrides
  /** Set false to drive the bot at machine speed. Off by default for a reason. */
  readonly humanise?: boolean
  readonly logger?: Logger
}

/** Physics runs at 20 Hz; the aim loop is driven off the same tick. */
const TICK_SECONDS = 1 / 20

export class GolemBot {
  readonly bot: Bot
  readonly persona: Persona
  readonly rhythm: Rhythm
  readonly aim: Aim
  readonly typist: Typist
  readonly log: Logger

  private readonly humanise: boolean
  private spawnedAt: number | null = null
  private pausedUntil = 0
  private disposed = false

  constructor(options: GolemBotOptions) {
    this.log = options.logger ?? createLogger('bot')
    this.humanise = options.humanise ?? true
    this.persona = makePersona(options.username, options.persona)
    this.rhythm = new Rhythm(this.persona, { now: () => this.sessionSeconds() })
    this.aim = new Aim(this.persona, () => this.rhythm.fatigue())
    this.typist = new Typist(this.persona, () => this.rhythm.fatigue())

    const botOptions: BotOptions = {
      host: options.host,
      port: options.port ?? 25565,
      username: options.username,
      auth: options.auth ?? 'offline',
      ...(options.version ? { version: options.version } : {}),
    }
    this.bot = mineflayer.createBot(botOptions)
    this.bot.loadPlugin(pathfinderPkg.pathfinder)
    this.wire()
  }

  private wire(): void {
    this.bot.once('spawn', () => {
      this.spawnedAt = Date.now()
      this.aim.reset({ yaw: this.bot.entity.yaw, pitch: this.bot.entity.pitch })
      this.log.info('spawned', { username: this.bot.username, persona: describe(this.persona) })
    })

    // The aim loop. Running it on physicsTick rather than a timer keeps head
    // movement in lockstep with the server's own 20 Hz, so the motion lands on
    // tick boundaries the way a real client's does.
    this.bot.on('physicsTick', () => {
      if (!this.humanise || this.disposed) return
      const { yaw, pitch } = this.aim.step(TICK_SECONDS)
      void this.bot.look(yaw, pitch, true).catch(() => {
        /* look fails harmlessly while the world is loading */
      })
    })

    this.bot.on('error', (error) => this.log.error('client error', { error: String(error) }))
    this.bot.on('kicked', (reason) => this.log.warn('kicked', { reason }))
    this.bot.on('end', (reason) => this.log.warn('disconnected', { reason }))
  }

  get spawned(): boolean {
    return this.spawnedAt !== null
  }

  /** Resolves once the world is loaded and the bot has a position. */
  async ready(timeoutMs = 30_000): Promise<void> {
    if (this.spawned) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting to spawn')), timeoutMs)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      this.bot.once('spawn', done)
      this.bot.once('end', (reason) => {
        clearTimeout(timer)
        reject(new Error(`disconnected before spawning: ${reason}`))
      })
    })
  }

  private sessionSeconds(): number {
    return this.spawnedAt === null ? 0 : (Date.now() - this.spawnedAt) / 1000
  }

  /**
   * Await this before any deliberate action.
   *
   * It contributes the reaction delay, and it blocks outright while the persona
   * is on a break. Skills call it rather than implementing their own pauses, so
   * that "the bot never stops for an hour" cannot be reintroduced one skill at
   * a time.
   */
  async gate(urgency: 'reflex' | 'normal' | 'considered' = 'normal'): Promise<void> {
    if (!this.humanise) return
    this.rhythm.record()

    const now = Date.now()
    if (now < this.pausedUntil) await sleep(this.pausedUntil - now)

    const pause = this.rhythm.breakCheck()
    if (pause.pause) {
      this.pausedUntil = Date.now() + pause.seconds * 1000
      this.log.debug('taking a break', { seconds: Math.round(pause.seconds) })
      await sleep(pause.seconds * 1000)
    }

    await sleep(this.rhythm.reaction(urgency) * 1000)
  }

  /** Turn to face a point, taking as long as a person would. */
  async lookAt(point: Vec3, targetWidth = 0.12): Promise<void> {
    const eye = this.bot.entity.position.offset(0, this.bot.entity.height ?? 1.62, 0)
    const target = lookAt(eye, point)
    await this.lookTo(target, targetWidth)
  }

  async lookTo(target: Orientation, targetWidth = 0.12): Promise<void> {
    if (!this.humanise) {
      await this.bot.look(target.yaw, target.pitch, true)
      return
    }
    this.aim.moveTo(target, targetWidth)
    // The physicsTick loop is doing the actual moving; just wait for it.
    const deadline = Date.now() + 5_000
    while (this.aim.busy && Date.now() < deadline) await sleep(25)
  }

  /** Glance somewhere for a moment and then carry on. Pure idle behaviour. */
  async glanceAround(): Promise<void> {
    if (!this.humanise) return
    const here = this.aim.orientation
    await this.lookTo(
      {
        yaw: here.yaw + (Math.random() - 0.5) * 1.8,
        pitch: (Math.random() - 0.5) * 0.8,
      },
      0.9,
    )
  }

  /** Say something, typed at the persona's speed with its quirks. */
  async say(text: string, urgency: 'reflex' | 'normal' | 'considered' = 'normal'): Promise<void> {
    if (!this.humanise) {
      this.bot.chat(text.slice(0, 250))
      return
    }
    for (const line of this.typist.compose(text, urgency)) {
      await sleep(line.delay * 1000)
      this.bot.chat(line.text.slice(0, 250))
    }
  }

  dispose(reason = 'done'): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.bot.quit(reason)
    } catch {
      // Already gone; nothing to close.
    }
  }
}

function describe(persona: Persona): string {
  return `reaction ${Math.round(persona.reaction * 1000)}ms, ${Math.round(persona.wpm)} wpm, boldness ${persona.boldness.toFixed(2)}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

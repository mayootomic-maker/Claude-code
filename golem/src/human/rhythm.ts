/**
 * When the bot acts, as opposed to what it does.
 *
 * Three things separate human timing from machine timing, and all three are
 * here: responses arrive after a variable delay rather than instantly, sustained
 * play gets slower rather than staying constant, and people stop for a moment
 * every so often for no reason the game can see.
 */

import { Rng, clamp } from '../util/random.js'
import { personaRng, type Persona } from './profile.js'

export interface RhythmClock {
  /** Seconds since the session began. */
  now(): number
}

export class Rhythm {
  private readonly rng: Rng
  private startedAt: number | null = null
  private lastBreakAt = 0
  private breakUntil = 0
  private actions = 0

  constructor(
    private readonly persona: Persona,
    private readonly clock: RhythmClock,
  ) {
    this.rng = personaRng(persona, 'rhythm')
  }

  private elapsed(): number {
    const now = this.clock.now()
    if (this.startedAt === null) this.startedAt = now
    return now - this.startedAt
  }

  /**
   * How much slower everything is right now, as a multiplier on durations.
   *
   * Ramps in only after the persona's stamina is spent, and saturates rather
   * than growing without bound — a tired player is slower, not asleep.
   */
  fatigue(): number {
    const over = this.elapsed() - this.persona.staminaSeconds
    if (over <= 0) return 1
    // Saturating curve: half the full penalty after another stamina period.
    const progress = over / (over + this.persona.staminaSeconds)
    return 1 + this.persona.fatigueFactor * progress
  }

  /**
   * A reaction delay in seconds: the gap between something becoming true and
   * the bot doing anything about it.
   *
   * Log-normal, because human latencies are right-skewed. A symmetric
   * distribution would produce impossibly fast responses as often as slow ones,
   * and it is the impossibly fast ones that read as machine.
   */
  reaction(urgency: 'reflex' | 'normal' | 'considered' = 'normal'): number {
    const scale = urgency === 'reflex' ? 0.7 : urgency === 'considered' ? 2.4 : 1
    const median = this.persona.reaction * scale * this.fatigue()
    return this.rng.latency(median, this.persona.reactionSigma, 0.08, 6)
  }

  /** A short pause between two parts of one deliberate action. */
  beat(): number {
    return this.rng.latency(0.12 * this.fatigue(), 0.5, 0.03, 1.5)
  }

  /**
   * Whether the bot should idle for a moment, and for how long.
   *
   * Real players stop: they alt-tab, drink something, read chat. A bot that
   * never pauses across an hour of mining is the single loudest tell there is,
   * louder than any individual movement.
   */
  breakCheck(): { pause: true; seconds: number } | { pause: false } {
    const now = this.clock.now()
    if (now < this.breakUntil) return { pause: true, seconds: this.breakUntil - now }

    const sinceLast = now - this.lastBreakAt
    // Rate is per minute; convert to a per-check probability using the gap.
    const p = clamp(this.persona.breakRate * (sinceLast / 60), 0, 0.5)
    if (!this.rng.chance(p)) return { pause: false }

    // Most breaks are a few seconds. A few are long enough to matter.
    const seconds = this.rng.chance(0.15)
      ? this.rng.range(30, 180)
      : this.rng.range(1.5, 12)
    this.lastBreakAt = now
    this.breakUntil = now + seconds
    return { pause: true, seconds }
  }

  /** Note that an action happened, for the interest model below. */
  record(): void {
    this.actions++
  }

  /**
   * Whether to do something aimless right now — look around, jump, check the
   * inventory. Rises with the persona's curiosity and with how long the bot has
   * been grinding at one repetitive thing.
   */
  wantsToFidget(): boolean {
    const boredom = clamp(this.actions / 400, 0, 1)
    return this.rng.chance(0.02 + this.persona.curiosity * boredom * 0.08)
  }

  resetInterest(): void {
    this.actions = 0
  }
}

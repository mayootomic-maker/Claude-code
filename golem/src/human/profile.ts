/**
 * A persona: the stable set of quirks that make one bot feel like one person.
 *
 * Everything is derived from a seed rather than sampled fresh, because a player
 * whose reaction time, aim and typing habits resample on every launch is not a
 * person — it is a different person each session, which is exactly the tell
 * this layer exists to remove. The same seed always produces the same player.
 *
 * The parameter ranges below are drawn from the ordinary spread of human
 * performance: simple visual reaction times cluster around 250 ms with a long
 * right tail, comfortable typing runs 35-75 WPM, and pointing movements follow
 * Fitts's law with a slope somewhere near 100 ms per bit.
 */

import { Rng, hashString } from '../util/random.js'

export interface Persona {
  readonly name: string
  readonly seed: string

  /** Median simple reaction time, seconds. */
  readonly reaction: number
  /** Log-normal spread of reaction times. Higher is more erratic. */
  readonly reactionSigma: number

  /** Fitts's law intercept, seconds — the floor on any aiming movement. */
  readonly aimIntercept: number
  /** Fitts's law slope, seconds per bit of index of difficulty. */
  readonly aimSlope: number
  /** Typical fraction of the distance the first ballistic movement covers. */
  readonly aimPrecision: number
  /** Amplitude of idle hand tremor, degrees. */
  readonly tremor: number

  /** Typing speed, words per minute. */
  readonly wpm: number
  /** Chance of mistyping any given character. */
  readonly typoRate: number
  /** Chance of noticing and correcting a sent typo. */
  readonly correctionRate: number

  /** Seconds of continuous play before attention starts to slip. */
  readonly staminaSeconds: number
  /** How strongly fatigue stretches timings by the end of a long session. */
  readonly fatigueFactor: number
  /** Chance per minute of taking a short unprompted break. */
  readonly breakRate: number

  /** How much the player looks around while walking, 0-1. */
  readonly curiosity: number
  /** Willingness to take risks: fight rather than flee, dig down, jump gaps. */
  readonly boldness: number
}

export interface PersonaOverrides extends Partial<Omit<Persona, 'name' | 'seed'>> {}

/**
 * Build a persona from a seed string.
 *
 * The seed is usually the bot's username, so a bot called "Tom" always plays
 * the same way — including across reinstalls, since nothing is stored.
 */
export function makePersona(seed: string, overrides: PersonaOverrides = {}): Persona {
  const rng = new Rng(`persona:${seed}`)

  const base: Persona = {
    name: seed,
    seed,
    reaction: rng.range(0.19, 0.32),
    reactionSigma: rng.range(0.22, 0.42),
    aimIntercept: rng.range(0.05, 0.12),
    aimSlope: rng.range(0.075, 0.135),
    aimPrecision: rng.range(0.82, 0.95),
    tremor: rng.range(0.18, 0.55),
    wpm: rng.range(34, 78),
    typoRate: rng.range(0.008, 0.035),
    correctionRate: rng.range(0.25, 0.75),
    staminaSeconds: rng.range(45 * 60, 120 * 60),
    fatigueFactor: rng.range(0.12, 0.35),
    breakRate: rng.range(0.004, 0.02),
    curiosity: rng.range(0.25, 0.85),
    boldness: rng.range(0.2, 0.85),
  }

  return { ...base, ...overrides }
}

/** A fresh RNG stream for a persona, so different subsystems do not interfere. */
export function personaRng(persona: Persona, stream: string): Rng {
  return new Rng(hashString(`${persona.seed}:${stream}`))
}

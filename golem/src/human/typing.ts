/**
 * Chat that reads as typed rather than emitted.
 *
 * Minecraft chat is sent whole, so there is nothing to animate — which means
 * the tells are different from aiming. They are: replying instantly, replying
 * with the same latency every time, and never once making a mistake. This
 * models all three.
 *
 * Typos use keyboard adjacency, so a slip produces "hekp" rather than "hexp" —
 * a random substitution reads as corruption, not as a person typing quickly.
 */

import { Rng } from '../util/random.js'
import { personaRng, type Persona } from './profile.js'

/** QWERTY neighbours. A finger that misses lands on the key next door. */
const NEIGHBOURS: Readonly<Record<string, string>> = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc',
  g: 'ftyhbv', h: 'gyujnb', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop',
  m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft',
  s: 'awedxz', t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc',
  y: 'tghu', z: 'asx',
  '1': '2q', '2': '13w', '3': '24e', '4': '35r', '5': '46t',
  '6': '57y', '7': '68u', '8': '79i', '9': '80o', '0': '9p',
}

export interface TypedMessage {
  /** Seconds to wait before this line is sent. */
  readonly delay: number
  readonly text: string
}

export class Typist {
  private readonly rng: Rng

  constructor(
    private readonly persona: Persona,
    private readonly fatigue: () => number = () => 1,
  ) {
    this.rng = personaRng(persona, 'typing')
  }

  /**
   * Seconds it would take this persona to type `text`.
   *
   * WPM is defined on five-character words, and real typing is bursty rather
   * than metronomic, so each character gets its own jittered interval.
   */
  duration(text: string): number {
    const perChar = 60 / (this.persona.wpm * 5) * this.fatigue()
    let total = 0
    for (const ch of text) {
      // Space and punctuation are where people pause to think.
      const weight = ch === ' ' ? 1.6 : /[.,!?]/.test(ch) ? 2.2 : 1
      total += this.rng.latency(perChar * weight, 0.45, perChar * 0.25, perChar * 8)
    }
    return total
  }

  /**
   * Compose a chat reply as the one or two lines a person would actually send.
   *
   * A typo that slips through is sometimes followed by the "*correction" line
   * that everyone sends, and sometimes just left there — noticing every mistake
   * is its own kind of inhuman.
   */
  compose(text: string, thinkingFor: 'reflex' | 'normal' | 'considered' = 'normal'): TypedMessage[] {
    const think =
      thinkingFor === 'reflex'
        ? this.rng.range(0.15, 0.5)
        : thinkingFor === 'considered'
          ? this.rng.range(1.2, 4)
          : this.rng.range(0.4, 1.6)

    const { typed, mistakes } = this.applyTypos(text)
    const lines: TypedMessage[] = [{ delay: think + this.duration(typed), text: typed }]

    const worthFixing = mistakes.find((m) => m.original.length > 2)
    if (worthFixing && this.rng.chance(this.persona.correctionRate)) {
      lines.push({
        delay: this.rng.range(0.6, 2.2) + this.duration(worthFixing.original),
        text: `*${worthFixing.original}`,
      })
    }
    return lines
  }

  /** Introduce keyboard-adjacent slips at the persona's typo rate. */
  private applyTypos(text: string): { typed: string; mistakes: Array<{ original: string }> } {
    const chars = [...text]
    const mistakes: Array<{ original: string }> = []
    let changedWord: string | null = null

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!
      const lower = ch.toLowerCase()
      const near = NEIGHBOURS[lower]
      if (!near || !this.rng.chance(this.persona.typoRate * this.fatigue())) continue

      const replacement = this.rng.pick([...near])
      chars[i] = ch === lower ? replacement : replacement.toUpperCase()
      changedWord = wordAt(text, i)
      if (changedWord) mistakes.push({ original: changedWord })
    }

    return { typed: chars.join(''), mistakes }
  }
}

function wordAt(text: string, index: number): string | null {
  let start = index
  let end = index
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--
  while (end < text.length - 1 && !/\s/.test(text[end + 1]!)) end++
  const word = text.slice(start, end + 1)
  return word.length > 0 ? word : null
}

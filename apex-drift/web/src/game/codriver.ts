import { clamp } from '../core/math'
import type { Notes } from './save'
import { BREAK, callable, type Note } from './pacenotes'

/** One thing for the co-driver to say. */
export interface Call {
  words: string[]
  /** Where the first note in the call starts, metres along the route: once the car is past it, the call is stale. */
  at: number
}

/** Seconds between the starts of two calls, unless a corner is about to arrive. */
const MIN_GAP = 1.6
/** A corner this many seconds away is called now, spacing or not. */
const IMMINENT = 1.3
/** At most this many notes in one breath. */
const MAX_NOTES = 2
/** Straights shorter than this are not called: "into", "50", "80" between corners was most of the chatter. */
const MIN_DISTANCE = 100

/**
 * Decides when the co-driver speaks, and says as little as will do. A call
 * comes a fixed amount of *time* ahead of the corner (so it scales with speed),
 * each note is called at most once, only notes that change how you drive are
 * called at all, and calls are spaced so each can be heard. A note that follows
 * close behind another is read with it in the same call instead of crowding in
 * straight after it.
 */
export class CoDriver {
  private next = 0
  private lastAt = -Infinity
  private arrow = 0

  constructor(private readonly notes: Note[], private mode: Notes) {}

  setMode(m: Notes): void {
    this.mode = m
  }

  /** Skip notes already behind the car, e.g. after a reset further up the road. */
  seek(s: number): void {
    this.next = this.notes.findIndex((n) => n.s > s)
    if (this.next < 0) this.next = this.notes.length
    this.lastAt = -Infinity
  }

  /** Whether a note is worth breath in the current mode. */
  private calls(n: Note): boolean {
    if (this.mode === 'off') return false
    // A 6 is flat out; telling the driver about it only buries the corners that matter.
    if (n.kind === 'corner') return n.grade <= 5
    if (n.kind === 'jump') return true
    if (this.mode === 'corners') return false
    return n.kind === 'crest' || n.kind === 'splash' || n.kind === 'patch' || n.kind === 'finish'
  }

  /** The call to make now, or null. `t` is the stage clock in seconds. */
  update(s: number, speed: number, t: number): Call | null {
    if (this.mode === 'off') return null
    const notes = this.notes
    // Notes the car has reached are never called late.
    while (this.next < notes.length && notes[this.next].s <= s) this.next++
    // Ones this mode leaves out are looked past, not consumed, so switching mode mid-stage loses nothing ahead.
    let i = this.next
    while (i < notes.length && !this.calls(notes[i])) i++
    if (i >= notes.length) return null
    const v = Math.max(speed, 5)
    const n = notes[i]
    const d = n.s - s
    if (d > clamp(v * 3.2, 55, 200)) return null
    if (t - this.lastAt < MIN_GAP && d > Math.max(25, v * IMMINENT)) return null
    // Read the next note with this one if it follows too closely to get a call of its own.
    const group = [n]
    let end = i + 1
    for (let k = end; k < notes.length && group.length < MAX_NOTES; k++) {
      const m = notes[k]
      if (!this.calls(m)) continue
      if (m.s - group[group.length - 1].s > Math.max(45, v * MIN_GAP * 1.2)) break
      group.push(m)
      end = k + 1
    }
    this.next = end
    this.lastAt = t
    const words: string[] = []
    for (const g of group) {
      if (words.length) words.push(BREAK)
      words.push(...this.say(g))
    }
    // A long straight out of a corner is worth knowing; a short one, or one after a crest, is not.
    const last = group[group.length - 1]
    if (this.mode === 'full' && last.kind === 'corner') {
      let after: Note | undefined
      for (let k = end; k < notes.length && !after; k++) if (this.calls(notes[k])) after = notes[k]
      const dist = after ? callable(after.s - last.s) : 0
      if (dist >= MIN_DISTANCE) words.push(String(dist))
    }
    return { words, at: n.s }
  }

  private say(n: Note): string[] {
    switch (n.kind) {
      case 'corner': {
        const w = [n.dir ?? 'left', n.grade === 0 ? 'hairpin' : String(n.grade)]
        // Tightening is the one modifier that can put you off the road; "long" and "opens" can wait.
        if (this.mode === 'full' && n.tightens) w.push('tightens')
        return w
      }
      case 'jump':
        return ['jump']
      case 'crest':
        return ['crest']
      case 'splash':
        return ['watersplash']
      case 'patch':
        return ['caution', n.surface === 'ice' ? 'ice' : n.surface === 'mud' ? 'mud' : n.surface === 'sand' ? 'sand' : 'rough']
      case 'finish':
        return ['flyingfinish']
      default:
        return []
    }
  }

  /** The corner the car is approaching, for the on-screen arrow; gentle ones too, though they are not called. */
  upcoming(s: number): Note | null {
    const notes = this.notes
    if (this.arrow > 0 && notes[this.arrow - 1].s > s - 10) this.arrow = 0
    while (this.arrow < notes.length && notes[this.arrow].s <= s - 10) this.arrow++
    for (let i = this.arrow; i < notes.length; i++) if (notes[i].kind === 'corner') return notes[i]
    return null
  }
}

import { clamp } from '../core/math'
import type { Notes } from './save'
import { words, type Note } from './pacenotes'

/**
 * Decides when the co-driver speaks. A call comes a fixed amount of *time*
 * ahead of the corner (so it scales with speed), each note is called once,
 * and back-to-back notes linked with "into" are read together as one call.
 */
export class CoDriver {
  private next = 0

  constructor(private readonly notes: Note[], private mode: Notes) {}

  setMode(m: Notes): void {
    this.mode = m
  }

  /** Skip notes already behind the car, e.g. after a reset further up the road. */
  seek(s: number): void {
    this.next = this.notes.findIndex((n) => n.s > s)
    if (this.next < 0) this.next = this.notes.length
  }

  /** Returns the words to say now, or null. */
  update(s: number, speed: number): string[] | null {
    if (this.mode === 'off' || this.next >= this.notes.length) return null
    const lead = clamp(speed * 2.6, 45, 170)
    const n = this.notes[this.next]
    if (n.s - s > lead) return null
    const out: string[] = []
    // Read a chain of linked notes as one breath.
    let k = this.next
    while (k < this.notes.length) {
      const cur = this.notes[k]
      if (this.mode === 'full' || cur.kind === 'corner' || cur.kind === 'jump' || cur.kind === 'finish') out.push(...this.say(cur))
      k++
      if (cur.link !== 0 || out.length > 8) break
    }
    this.next = k
    return out.length ? out : null
  }

  private say(n: Note): string[] {
    const w = words(n)
    if (this.mode === 'full') return w
    // Corners only: direction and grade, nothing else.
    return w.filter((x) => x === 'left' || x === 'right' || x === 'hairpin' || /^[1-6]$/.test(x) || x === 'jump' || x === 'flyingfinish')
  }

  /** The note the car is approaching, for the on-screen arrow. */
  upcoming(s: number): Note | null {
    for (let i = Math.max(0, this.next - 2); i < this.notes.length; i++) if (this.notes[i].s > s - 10 && this.notes[i].kind === 'corner') return this.notes[i]
    return null
  }
}

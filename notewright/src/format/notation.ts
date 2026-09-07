/**
 * The compact note notation.
 *
 * A song file has to be two things at once: something the app round-trips
 * without loss, and something a person can read in a diff and understand what
 * changed musically. A JSON array of `{time, pitch, duration, velocity}`
 * objects fails the second test — a one-note change becomes twelve lines of
 * numbers. So patterns are written as step strings:
 *
 *     "C4~2 . E4 G4 | [C4 E4 G4]~4 . . ."      melodic
 *     "x... ..x. x... x.x."                    a drum lane
 *
 * Timing is kept in beats internally, not steps, so changing a pattern's grid
 * re-renders the string without moving a single note.
 */

export interface Note {
  /** Beats from the start of the pattern. */
  at: number
  /** MIDI pitch, 0-127. */
  pitch: number
  /** Beats. */
  length: number
  /** 0-1. */
  velocity: number
}

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  message: string
  /** Where in the source string, for pointing at the offending token. */
  where?: string
}

export interface ParseResult<T> {
  value: T
  issues: Issue[]
}

/** `1/16` → 4 steps per beat. A trailing `t` makes the division triplet. */
export function stepsPerBeat(grid: string): number {
  const match = /^1\/(\d+)(t?)$/.exec(grid.trim())
  if (!match) return 4
  const [, denominator = '16', triplet = ''] = match
  const base = Number(denominator) / 4
  return triplet === 't' ? base * 1.5 : base
}

export const GRIDS = ['1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'] as const

/** Beats-per-step, the multiplier that turns a step index into a beat offset. */
export function beatsPerStep(grid: string): number {
  return 1 / stepsPerBeat(grid)
}

const EPSILON = 1e-6

function nearlyInteger(value: number): boolean {
  return Math.abs(value - Math.round(value)) < EPSILON
}

// ---------------------------------------------------------------------------
// Melodic streams
// ---------------------------------------------------------------------------

import { midiToNote, noteToMidi } from '../engine/theory'

interface Modifiers {
  length: number
  velocity: number
}

const DEFAULT_VELOCITY = 0.8

/**
 * Velocities are quantised to three decimals on the way in. The serializer
 * writes three decimals, so without this a round trip could shave a
 * ten-thousandth off every note and call the file "changed" in git for ever.
 */
export function quantiseVelocity(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

/** Splits `C#4~2@0.6` into its pitch and its suffixes. */
function splitModifiers(token: string, issues: Issue[]): { head: string; mods: Partial<Modifiers> } {
  const mods: Partial<Modifiers> = {}
  let head = token
  const suffix = /([~@])(-?\d*\.?\d+)$/
  for (;;) {
    const match = suffix.exec(head)
    if (!match) break
    const [whole = '', symbol = '', digits = ''] = match
    const amount = Number(digits)
    if (!Number.isFinite(amount)) {
      issues.push({ severity: 'error', message: `Not a number: "${digits}"`, where: token })
      break
    }
    if (symbol === '~') {
      if (amount <= 0) issues.push({ severity: 'error', message: `Length must be positive`, where: token })
      else mods.length = amount
    } else if (mods.velocity === undefined) {
      mods.velocity = quantiseVelocity(amount > 1 ? amount / 127 : amount)
    }
    head = head.slice(0, head.length - whole.length)
  }
  return { head, mods }
}

/**
 * Tokenises a stream, treating `[...]` as one token so chord members do not
 * each become their own step.
 */
function tokenise(source: string, issues: Issue[]): string[] {
  const tokens: string[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ''
    if (/\s/.test(char) || char === '|') {
      index += 1
      continue
    }
    if (char === '[') {
      const close = source.indexOf(']', index)
      if (close === -1) {
        issues.push({ severity: 'error', message: 'Unclosed chord bracket', where: source.slice(index, index + 12) })
        break
      }
      let end = close + 1
      while (end < source.length && /[~@\d.-]/.test(source[end] ?? '')) end += 1
      tokens.push(source.slice(index, end))
      index = end
      continue
    }
    let end = index
    while (end < source.length && !/[\s|[]/.test(source[end] ?? '')) end += 1
    tokens.push(source.slice(index, end))
    index = end
  }
  return tokens
}

/**
 * Parses a melodic step stream.
 *
 * `.` rests, `-` holds the previous step's notes one step longer, `~n` sets a
 * length in steps outright, `@v` sets velocity, `[a b c]` is a chord.
 */
export function parseNoteStream(source: string | readonly string[], grid: string): ParseResult<Note[]> {
  const issues: Issue[] = []
  const text = Array.isArray(source) ? source.join(' | ') : String(source)
  const perStep = beatsPerStep(grid)
  const tokens = tokenise(text, issues)
  const notes: Note[] = []
  let previous: Note[] = []

  tokens.forEach((token, step) => {
    if (token === '.' || token === '_') {
      previous = []
      return
    }
    if (token === '-') {
      if (previous.length === 0) {
        issues.push({ severity: 'warning', message: 'A hold with nothing to hold', where: `step ${step + 1}` })
        return
      }
      for (const note of previous) note.length += perStep
      return
    }

    const { head, mods } = splitModifiers(token, issues)
    const at = step * perStep
    const length = (mods.length ?? 1) * perStep
    const velocity = mods.velocity ?? DEFAULT_VELOCITY

    if (head.startsWith('[')) {
      const inner = head.slice(1, head.indexOf(']'))
      const members = inner.split(/\s+/).filter(Boolean)
      const chord: Note[] = []
      for (const member of members) {
        const parsed = splitModifiers(member, issues)
        const pitch = noteToMidi(parsed.head)
        if (pitch === null) {
          issues.push({ severity: 'error', message: `Not a pitch: "${parsed.head}"`, where: token })
          continue
        }
        chord.push({
          at,
          pitch,
          length: parsed.mods.length === undefined ? length : parsed.mods.length * perStep,
          velocity: parsed.mods.velocity ?? velocity,
        })
      }
      notes.push(...chord)
      previous = chord
      return
    }

    const pitch = noteToMidi(head)
    if (pitch === null) {
      issues.push({ severity: 'error', message: `Not a pitch: "${token}"`, where: `step ${step + 1}` })
      previous = []
      return
    }
    const note: Note = { at, pitch, length, velocity }
    notes.push(note)
    previous = [note]
  })

  notes.sort((a, b) => a.at - b.at || a.pitch - b.pitch)
  return { value: notes, issues }
}

function formatModifiers(steps: number, velocity: number): string {
  const length = nearlyInteger(steps) && Math.round(steps) === 1 ? '' : `~${round(steps)}`
  // Exact, not approximate: a velocity of 0.797 written as "no suffix" would
  // read back as 0.8, an edit nobody made. The fuzz round-trip test found this.
  const level = Math.abs(velocity - DEFAULT_VELOCITY) < EPSILON ? '' : `@${round(velocity)}`
  return `${length}${level}`
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * Renders notes back to a step stream, or returns null when they do not sit on
 * the grid — in which case the caller keeps the explicit object form rather
 * than quietly moving somebody's music onto the nearest step.
 */
export function formatNoteStream(
  notes: readonly Note[],
  grid: string,
  beatsPerBar: number,
  bars: number,
): string[] | null {
  const perStep = beatsPerStep(grid)
  const stepsPerBar = beatsPerBar / perStep
  if (!nearlyInteger(stepsPerBar)) return null
  const totalSteps = Math.round(stepsPerBar) * bars

  const byStep = new Map<number, Note[]>()
  for (const note of notes) {
    const step = note.at / perStep
    if (!nearlyInteger(step) || !nearlyInteger(note.length / perStep)) return null
    const index = Math.round(step)
    if (index < 0 || index >= totalSteps) return null
    const bucket = byStep.get(index)
    if (bucket) bucket.push(note)
    else byStep.set(index, [note])
  }

  const cells: string[] = []
  for (let step = 0; step < totalSteps; step++) {
    const here = byStep.get(step)
    if (!here || here.length === 0) {
      cells.push('.')
      continue
    }
    const sorted = [...here].sort((a, b) => a.pitch - b.pitch)
    if (sorted.length === 1) {
      const note = sorted[0]!
      cells.push(midiToNote(note.pitch) + formatModifiers(note.length / perStep, note.velocity))
      continue
    }
    const sharedLength = sorted.every((note) => note.length === sorted[0]!.length)
    const sharedVelocity = sorted.every((note) => note.velocity === sorted[0]!.velocity)
    const members = sorted.map((note) => {
      const own =
        (sharedLength ? '' : formatModifiers(note.length / perStep, DEFAULT_VELOCITY)) +
        (sharedVelocity ? '' : `@${round(note.velocity)}`)
      return midiToNote(note.pitch) + own
    })
    const group =
      (sharedLength ? formatModifiers(sorted[0]!.length / perStep, DEFAULT_VELOCITY) : '') +
      (sharedVelocity && Math.abs(sorted[0]!.velocity - DEFAULT_VELOCITY) >= EPSILON
        ? `@${round(sorted[0]!.velocity)}`
        : '')
    cells.push(`[${members.join(' ')}]${group}`)
  }

  return chunkIntoBars(cells, Math.round(stepsPerBar), Math.round(stepsPerBeat(grid)), ' ')
}

/** Bars become array entries; beats inside a bar are separated by a space. */
function chunkIntoBars(cells: readonly string[], stepsInBar: number, stepsInBeat: number, join: string): string[] {
  const bars: string[] = []
  for (let start = 0; start < cells.length; start += stepsInBar) {
    const bar = cells.slice(start, start + stepsInBar)
    const beats: string[] = []
    for (let offset = 0; offset < bar.length; offset += stepsInBeat) {
      beats.push(bar.slice(offset, offset + stepsInBeat).join(join))
    }
    bars.push(beats.join(join === '' ? ' ' : '  '))
  }
  return bars
}

// ---------------------------------------------------------------------------
// Drum lanes
// ---------------------------------------------------------------------------

/** One character per step: `.` rest, `x` hit, `X` accent, `o` ghost, `-` hold, `0`-`9` velocity in tenths. */
export function parseLane(source: string | readonly string[], grid: string): ParseResult<Note[]> {
  const issues: Issue[] = []
  const text = Array.isArray(source) ? source.join('') : String(source)
  const perStep = beatsPerStep(grid)
  const notes: Note[] = []
  let step = 0
  let previous: Note | null = null

  for (const char of text) {
    if (/\s/.test(char) || char === '|') continue
    if (char === '.' || char === '_') {
      previous = null
      step += 1
      continue
    }
    if (char === '-') {
      if (previous) previous.length += perStep
      else issues.push({ severity: 'warning', message: 'A hold with nothing to hold', where: `step ${step + 1}` })
      step += 1
      continue
    }
    let velocity: number
    if (char === 'x') velocity = 0.8
    else if (char === 'X') velocity = 1
    else if (char === 'o') velocity = 0.45
    else if (char >= '1' && char <= '9') velocity = Number(char) / 10
    else {
      issues.push({ severity: 'error', message: `Unknown lane symbol "${char}"`, where: `step ${step + 1}` })
      step += 1
      previous = null
      continue
    }
    // Pitch is filled in by the caller from the kit's lane map; 0 is a placeholder.
    const note: Note = { at: step * perStep, pitch: 0, length: perStep, velocity }
    notes.push(note)
    previous = note
    step += 1
  }

  return { value: notes, issues }
}

export function formatLane(
  notes: readonly Note[],
  grid: string,
  beatsPerBar: number,
  bars: number,
): string[] | null {
  const perStep = beatsPerStep(grid)
  const stepsInBar = beatsPerBar / perStep
  if (!nearlyInteger(stepsInBar)) return null
  const totalSteps = Math.round(stepsInBar) * bars
  const cells: string[] = new Array(totalSteps).fill('.')

  for (const note of notes) {
    const step = note.at / perStep
    if (!nearlyInteger(step)) return null
    const index = Math.round(step)
    if (index < 0 || index >= totalSteps) return null
    const symbol = velocitySymbol(note.velocity)
    if (symbol === null) return null
    cells[index] = symbol
    const heldSteps = Math.round(note.length / perStep)
    if (!nearlyInteger(note.length / perStep)) return null
    for (let offset = 1; offset < heldSteps && index + offset < totalSteps; offset++) {
      cells[index + offset] = '-'
    }
  }

  return chunkIntoBars(cells, Math.round(stepsInBar), Math.round(stepsPerBeat(grid)), '')
}

/**
 * The lane alphabet can express tenths, the ghost level and a full accent, and
 * nothing else. Anything outside it returns null so the caller falls back to
 * the explicit note form — silently snapping a velocity would be an edit the
 * user never made.
 */
function velocitySymbol(velocity: number): string | null {
  if (Math.abs(velocity - 1) < EPSILON) return 'X'
  if (Math.abs(velocity - 0.8) < EPSILON) return 'x'
  if (Math.abs(velocity - 0.45) < EPSILON) return 'o'
  const tenths = velocity * 10
  if (!nearlyInteger(tenths) || tenths < 1 || tenths > 9) return null
  return String(Math.round(tenths))
}

/** The velocity levels a drum lane can hold, for the step editor to snap to. */
export const LANE_VELOCITIES = [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const

/**
 * Pitch, scale and chord arithmetic.
 *
 * Everything downstream speaks MIDI note numbers. Names exist only at the two
 * edges: the song file, which humans read and write, and the piano roll, which
 * labels its keys. Keeping the middle numeric is what lets transposition,
 * quantisation and scale-snapping be plain integer maths.
 */

export const A4_MIDI = 69

/** Semitone offsets of the natural notes from C, indexed by letter. */
const LETTER_SEMITONES: Readonly<Record<string, number>> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

/** Matches `C4`, `f#-1`, `Bbb10`, and bare MIDI numbers like `60`. */
const NOTE_NAME = /^([A-Ga-g])([#b♯♭]*)(-?\d{1,2})$/

/**
 * `C4` is middle C, MIDI 60 — scientific pitch notation, the convention every
 * Swiss-army chart and every DAW piano roll agrees on. (Yamaha's C3 = 60 is the
 * notable dissenter; we are not it.)
 */
export function noteToMidi(name: string): number | null {
  const text = name.trim()
  if (text === '') return null

  if (/^-?\d+$/.test(text)) {
    const midi = Number(text)
    return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null
  }

  const match = NOTE_NAME.exec(text)
  if (!match) return null
  const [, letter = '', accidentals = '', octave = '0'] = match

  let semitone = LETTER_SEMITONES[letter.toLowerCase()]
  if (semitone === undefined) return null
  for (const accidental of accidentals) {
    if (accidental === '#' || accidental === '♯') semitone += 1
    else if (accidental === 'b' || accidental === '♭') semitone -= 1
    else return null
  }

  const midi = (Number(octave) + 1) * 12 + semitone
  return midi >= 0 && midi <= 127 ? midi : null
}

export function midiToNote(midi: number, spelling: 'sharp' | 'flat' = 'sharp'): string {
  const rounded = Math.round(midi)
  const names = spelling === 'flat' ? FLAT_NAMES : SHARP_NAMES
  const pitchClass = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${names[pitchClass]}${octave}`
}

export function midiToFreq(midi: number, tuning = 440): number {
  return tuning * Math.pow(2, (midi - A4_MIDI) / 12)
}

export function isBlackKey(midi: number): boolean {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12
  return pitchClass === 1 || pitchClass === 3 || pitchClass === 6 || pitchClass === 8 || pitchClass === 10
}

/** Interval sets, in semitones from the root. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'pentatonic major': [0, 2, 4, 7, 9],
  'pentatonic minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  'whole tone': [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const satisfies Record<string, readonly number[]>

export type ScaleName = keyof typeof SCALES
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[]

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  root: number
  scale: ScaleName
}

/** `"A minor"`, `"F# dorian"`, `"Eb major"`. Defaults to C major on nonsense. */
export function parseKey(text: string): Key {
  const trimmed = text.trim()
  const split = /^([A-Ga-g][#b♯♭]*)\s*(.*)$/.exec(trimmed)
  if (!split) return { root: 0, scale: 'major' }
  const [, tonic = 'C', rest = ''] = split
  const root = noteToMidi(`${tonic}4`)
  const scale = rest.trim().toLowerCase()
  const named = SCALE_NAMES.find((candidate) => candidate === scale)
  return {
    root: root === null ? 0 : ((root % 12) + 12) % 12,
    scale: named ?? (scale === '' ? 'major' : scale.startsWith('min') ? 'minor' : 'major'),
  }
}

export function formatKey(key: Key): string {
  return `${SHARP_NAMES[key.root]} ${key.scale}`
}

export function isInKey(midi: number, key: Key): boolean {
  const degree = (((Math.round(midi) - key.root) % 12) + 12) % 12
  return (SCALES[key.scale] as readonly number[]).includes(degree)
}

/** Nearest pitch inside the key. Ties round up, so runs stay ascending. */
export function snapToKey(midi: number, key: Key): number {
  const rounded = Math.round(midi)
  for (let distance = 0; distance <= 6; distance++) {
    if (isInKey(rounded + distance, key)) return rounded + distance
    if (isInKey(rounded - distance, key)) return rounded - distance
  }
  return rounded
}

/**
 * A chord built from the notes of the key, stacked in thirds above a root.
 *
 * Thirds *of the scale*, not of the chromatic scale: on the sixth degree of a
 * major key this gives a minor chord without anyone having to ask for one,
 * which is why the chord tool suggests chords that belong to the song rather
 * than a major triad the user then fixes by ear.
 */
export function chordFromScale(key: Key, root: number, tones = 3): number[] {
  const intervals = SCALES[key.scale] as readonly number[]
  const snapped = snapToKey(root, key)
  const degree = intervals.indexOf((((snapped - key.root) % 12) + 12) % 12)
  if (degree < 0) return [snapped]

  const pitches: number[] = []
  for (let tone = 0; tone < tones; tone++) {
    const index = degree + tone * 2
    const wrapped = ((index % intervals.length) + intervals.length) % intervals.length
    const octaves = Math.floor(index / intervals.length)
    const pitch = snapped - (intervals[degree] ?? 0) + (intervals[wrapped] ?? 0) + octaves * 12
    if (pitch >= 0 && pitch <= 127) pitches.push(pitch)
  }
  return pitches
}

/** Triad on a scale degree, for naming chords by number rather than by pitch. */
export function diatonicTriad(key: Key, degree: number, octave = 3): number[] {
  const intervals = SCALES[key.scale] as readonly number[]
  const wrapped = ((degree % intervals.length) + intervals.length) % intervals.length
  const root = key.root + (octave + 1) * 12 + (intervals[wrapped] ?? 0)
  return chordFromScale(key, root, 3)
}

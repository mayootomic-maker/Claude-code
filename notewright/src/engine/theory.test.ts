import { describe, expect, it } from 'vitest'
import {
  chordFromScale,
  diatonicTriad,
  formatKey,
  isBlackKey,
  isInKey,
  midiToFreq,
  midiToNote,
  noteToMidi,
  parseKey,
  snapToKey,
} from './theory'

describe('note names', () => {
  it('places middle C at 60', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(midiToNote(60)).toBe('C4')
  })

  it('spans the whole MIDI range', () => {
    expect(noteToMidi('C-1')).toBe(0)
    expect(noteToMidi('G9')).toBe(127)
    expect(noteToMidi('G#9')).toBeNull()
  })

  it('reads accidentals, including ones that cross an octave', () => {
    expect(noteToMidi('C#4')).toBe(61)
    expect(noteToMidi('Db4')).toBe(61)
    expect(noteToMidi('Cb4')).toBe(59)
    expect(noteToMidi('B#3')).toBe(60)
    expect(noteToMidi('Fbb4')).toBe(63)
    expect(noteToMidi('c♯4')).toBe(61)
  })

  it('accepts bare MIDI numbers so imported data needs no translation', () => {
    expect(noteToMidi('60')).toBe(60)
    expect(noteToMidi('128')).toBeNull()
  })

  it('rejects rubbish rather than guessing', () => {
    for (const bad of ['', 'H4', 'C', '4C', 'C4x', 'C#', '  ']) {
      expect(noteToMidi(bad)).toBeNull()
    }
  })

  it('round-trips every pitch in the range', () => {
    for (let midi = 0; midi <= 127; midi++) {
      expect(noteToMidi(midiToNote(midi))).toBe(midi)
      expect(noteToMidi(midiToNote(midi, 'flat'))).toBe(midi)
    }
  })
})

describe('frequency', () => {
  it('tunes A4 to 440 and doubles per octave', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9)
    expect(midiToFreq(81)).toBeCloseTo(880, 9)
    expect(midiToFreq(57)).toBeCloseTo(220, 9)
  })

  it('honours a different concert pitch', () => {
    expect(midiToFreq(69, 432)).toBeCloseTo(432, 9)
  })

  it('agrees with the published value for middle C', () => {
    expect(midiToFreq(60)).toBeCloseTo(261.6255653, 6)
  })
})

describe('keyboard geometry', () => {
  it('knows which keys are black', () => {
    expect([60, 62, 64, 65, 67, 69, 71].every((midi) => !isBlackKey(midi))).toBe(true)
    expect([61, 63, 66, 68, 70].every(isBlackKey)).toBe(true)
  })
})

describe('keys and scales', () => {
  it('parses the shapes people actually write', () => {
    expect(parseKey('A minor')).toEqual({ root: 9, scale: 'minor' })
    expect(parseKey('F# dorian')).toEqual({ root: 6, scale: 'dorian' })
    expect(parseKey('Eb')).toEqual({ root: 3, scale: 'major' })
    expect(parseKey('c minor')).toEqual({ root: 0, scale: 'minor' })
  })

  it('falls back to C major instead of throwing at the boundary', () => {
    expect(parseKey('')).toEqual({ root: 0, scale: 'major' })
    expect(parseKey('nonsense')).toEqual({ root: 0, scale: 'major' })
  })

  it('formats back to something it can re-read', () => {
    const key = parseKey('A minor')
    expect(formatKey(key)).toBe('A minor')
    expect(parseKey(formatKey(key))).toEqual(key)
  })

  it('tests membership across octaves', () => {
    const aMinor = parseKey('A minor')
    expect(isInKey(noteToMidi('C4')!, aMinor)).toBe(true)
    expect(isInKey(noteToMidi('C#4')!, aMinor)).toBe(false)
    expect(isInKey(noteToMidi('G2')!, aMinor)).toBe(true)
  })

  it('snaps to the nearest member, never out of the key', () => {
    const aMinor = parseKey('A minor')
    for (let midi = 36; midi < 84; midi++) {
      const snapped = snapToKey(midi, aMinor)
      expect(isInKey(snapped, aMinor)).toBe(true)
      expect(Math.abs(snapped - midi)).toBeLessThanOrEqual(1)
    }
  })
})

describe('chords', () => {
  it('stacks thirds from inside the key', () => {
    const aMinor = parseKey('A minor')
    expect(chordFromScale(aMinor, noteToMidi('A3')!, 3).map((m) => midiToNote(m))).toEqual(['A3', 'C4', 'E4'])
    expect(chordFromScale(aMinor, noteToMidi('G3')!, 3).map((m) => midiToNote(m))).toEqual(['G3', 'B3', 'D4'])
    expect(chordFromScale(aMinor, noteToMidi('E3')!, 4).map((m) => midiToNote(m))).toEqual(['E3', 'G3', 'B3', 'D4'])
  })

  it('pulls a root outside the key onto it first', () => {
    const cMajor = parseKey('C major')
    expect(chordFromScale(cMajor, noteToMidi('C#4')!, 3).map((m) => midiToNote(m))).toEqual(['D4', 'F4', 'A4'])
  })

  it('never leaves the key', () => {
    const dorian = parseKey('D dorian')
    for (let root = 40; root < 80; root++) {
      for (const pitch of chordFromScale(dorian, root, 4)) {
        expect(isInKey(pitch, dorian)).toBe(true)
        expect(pitch).toBeGreaterThanOrEqual(0)
        expect(pitch).toBeLessThanOrEqual(127)
      }
    }
  })

  it('builds triads from the key, so suggestions belong to the song', () => {
    const aMinor = parseKey('A minor')
    for (let degree = 0; degree < 7; degree++) {
      for (const pitch of diatonicTriad(aMinor, degree)) {
        expect(isInKey(pitch, aMinor)).toBe(true)
      }
    }
    expect(diatonicTriad(aMinor, 0, 3).map((m) => midiToNote(m))).toEqual(['A3', 'C4', 'E4'])
  })
})

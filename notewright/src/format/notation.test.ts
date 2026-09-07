import { describe, expect, it } from 'vitest'
import {
  beatsPerStep,
  formatLane,
  formatNoteStream,
  parseLane,
  parseNoteStream,
  stepsPerBeat,
  type Note,
} from './notation'
import { midiToNote, noteToMidi } from '../engine/theory'

const pitches = (notes: readonly Note[]): string[] => notes.map((note) => midiToNote(note.pitch))

describe('grids', () => {
  it('counts steps per beat, triplets included', () => {
    expect(stepsPerBeat('1/4')).toBe(1)
    expect(stepsPerBeat('1/8')).toBe(2)
    expect(stepsPerBeat('1/16')).toBe(4)
    expect(stepsPerBeat('1/32')).toBe(8)
    expect(stepsPerBeat('1/8t')).toBe(3)
    expect(stepsPerBeat('1/16t')).toBe(6)
  })

  it('falls back to sixteenths rather than dividing by zero', () => {
    expect(stepsPerBeat('nonsense')).toBe(4)
    expect(beatsPerStep('1/16')).toBe(0.25)
  })
})

describe('melodic streams', () => {
  it('reads pitches onto the grid', () => {
    const { value, issues } = parseNoteStream('C4 . E4 G4', '1/16')
    expect(issues).toEqual([])
    expect(pitches(value)).toEqual(['C4', 'E4', 'G4'])
    expect(value.map((note) => note.at)).toEqual([0, 0.5, 0.75])
    expect(value.every((note) => note.length === 0.25)).toBe(true)
  })

  it('ignores bar lines and extra whitespace, which are there for the reader', () => {
    const spaced = parseNoteStream('C4 .  .  . | E4 . . .', '1/16').value
    const dense = parseNoteStream('C4...E4...', '1/16').value
    expect(dense.length).toBe(0) // `C4...E4...` is one token, not five: pitches need separating
    expect(spaced.map((note) => note.at)).toEqual([0, 1])
  })

  it('extends a note with holds', () => {
    const { value } = parseNoteStream('C4 - - - E4', '1/16')
    expect(value[0]!.length).toBe(1)
    expect(value[1]!.at).toBe(1)
  })

  it('warns about a hold with nothing before it instead of failing silently', () => {
    const { value, issues } = parseNoteStream('- C4', '1/16')
    expect(value).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning' })
  })

  it('takes an explicit length and velocity', () => {
    const { value } = parseNoteStream('C4~4@0.5 . . .', '1/16')
    expect(value[0]).toEqual({ at: 0, pitch: 60, length: 1, velocity: 0.5 })
  })

  it('reads velocity given in MIDI units', () => {
    expect(parseNoteStream('C4@127', '1/16').value[0]!.velocity).toBe(1)
    expect(parseNoteStream('C4@64', '1/16').value[0]!.velocity).toBe(0.504)
  })

  it('reads chords, with per-note overrides beating the group', () => {
    const { value } = parseNoteStream('[C4 E4 G4]~8@0.6 . [C3 G3@0.3]', '1/16')
    expect(pitches(value.slice(0, 3))).toEqual(['C4', 'E4', 'G4'])
    expect(value.slice(0, 3).every((note) => note.length === 2 && note.velocity === 0.6)).toBe(true)
    expect(value[4]!.velocity).toBe(0.3)
  })

  it('holds every note of a chord', () => {
    const { value } = parseNoteStream('[C4 E4] - -', '1/16')
    expect(value.map((note) => note.length)).toEqual([0.75, 0.75])
  })

  it('reports an unreadable pitch with the token that caused it', () => {
    const { issues } = parseNoteStream('C4 H9 E4', '1/16')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toContain('H9')
  })

  it('reports an unclosed chord bracket', () => {
    const { issues } = parseNoteStream('[C4 E4', '1/16')
    expect(issues[0]!.message).toContain('Unclosed')
  })

  it('accepts an array of bars, which is how multi-bar patterns are stored', () => {
    const { value } = parseNoteStream(['C4 . . .', 'E4 . . .'], '1/4')
    expect(value.map((note) => note.at)).toEqual([0, 4])
  })
})

describe('melodic serialisation', () => {
  const roundTrip = (source: string, grid = '1/16', bars = 1): string[] => {
    const { value } = parseNoteStream(source, grid)
    const written = formatNoteStream(value, grid, 4, bars)
    expect(written).not.toBeNull()
    return written!
  }

  it('writes one entry per bar, grouped by beat', () => {
    expect(roundTrip('C4 . . . E4 . . . G4 . . . B4 . . .')).toEqual([
      'C4 . . .  E4 . . .  G4 . . .  B4 . . .',
    ])
  })

  it('canonicalises holds into an explicit length', () => {
    expect(roundTrip('C4 - - - . . . . . . . . . . . .')).toEqual(['C4~4 . . .  . . . .  . . . .  . . . .'])
  })

  it('round-trips chords', () => {
    const written = roundTrip('[C4 E4 G4]~2@0.6 . . . . . . . . . . . . . . .')
    expect(written[0]!.startsWith('[C4 E4 G4]~2@0.6')).toBe(true)
    expect(pitches(parseNoteStream(written, '1/16').value)).toEqual(['C4', 'E4', 'G4'])
  })

  it('refuses to write notes that are off the grid', () => {
    const offGrid: Note[] = [{ at: 0.1, pitch: 60, length: 0.25, velocity: 0.8 }]
    expect(formatNoteStream(offGrid, '1/16', 4, 1)).toBeNull()
  })

  it('refuses to write notes past the end of the pattern', () => {
    const beyond: Note[] = [{ at: 8, pitch: 60, length: 0.25, velocity: 0.8 }]
    expect(formatNoteStream(beyond, '1/16', 4, 1)).toBeNull()
  })

  it('survives a fuzz round trip without moving a note', () => {
    let seed = 20260907
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let trial = 0; trial < 300; trial++) {
      const grid = (['1/8', '1/16', '1/4'] as const)[Math.floor(random() * 3)]!
      const bars = 1 + Math.floor(random() * 3)
      const steps = Math.round((4 / beatsPerStep(grid)) * bars)
      const notes: Note[] = []
      const used = new Set<string>()
      for (let index = 0; index < steps; index++) {
        if (random() < 0.45) continue
        const step = Math.floor(random() * steps)
        const pitch = 36 + Math.floor(random() * 60)
        const key = `${step}:${pitch}`
        if (used.has(key)) continue
        used.add(key)
        notes.push({
          at: step * beatsPerStep(grid),
          pitch,
          length: (1 + Math.floor(random() * 4)) * beatsPerStep(grid),
          velocity: Math.round(random() * 1000) / 1000,
        })
      }
      notes.sort((a, b) => a.at - b.at || a.pitch - b.pitch)
      const written = formatNoteStream(notes, grid, 4, bars)
      expect(written, `trial ${trial}`).not.toBeNull()
      const reread = parseNoteStream(written!, grid)
      expect(reread.issues, `trial ${trial}`).toEqual([])
      expect(reread.value.length, `trial ${trial}`).toBe(notes.length)
      reread.value.forEach((note, index) => {
        const original = notes[index]!
        expect(note.pitch, `trial ${trial} note ${index}`).toBe(original.pitch)
        expect(note.at).toBeCloseTo(original.at, 9)
        expect(note.length).toBeCloseTo(original.length, 9)
        expect(note.velocity).toBeCloseTo(original.velocity, 9)
      })
    }
  })
})

describe('drum lanes', () => {
  it('reads one character per step', () => {
    const { value, issues } = parseLane('x... ..x. x... x...', '1/16')
    expect(issues).toEqual([])
    expect(value.map((note) => note.at)).toEqual([0, 1.5, 2, 3])
  })

  it('reads the velocity alphabet', () => {
    const { value } = parseLane('xXo5', '1/16')
    expect(value.map((note) => note.velocity)).toEqual([0.8, 1, 0.45, 0.5])
  })

  it('holds a hit across steps, for open hats and slides', () => {
    const { value } = parseLane('x---', '1/16')
    expect(value).toHaveLength(1)
    expect(value[0]!.length).toBe(1)
  })

  it('names the offending symbol rather than dropping the lane', () => {
    const { value, issues } = parseLane('x.q.', '1/16')
    expect(value).toHaveLength(1)
    expect(issues[0]!.message).toContain('q')
  })

  it('round-trips, bar by bar', () => {
    const source = ['x... ..x. x... x.x.', 'X..o ..x. x--- ....']
    const { value } = parseLane(source, '1/16')
    expect(formatLane(value, '1/16', 4, 2)).toEqual(source)
  })

  it('refuses to write a velocity its alphabet cannot express', () => {
    const odd: Note[] = [{ at: 0, pitch: 0, length: 0.25, velocity: 0.77 }]
    expect(formatLane(odd, '1/16', 4, 1)).toBeNull()
  })
})

describe('pitch and lane notations agree on timing', () => {
  it('puts a lane hit and a note on the same beat', () => {
    const lane = parseLane('...x', '1/16').value[0]!
    const note = parseNoteStream('. . . C4', '1/16').value[0]!
    expect(lane.at).toBe(note.at)
    expect(noteToMidi('C4')).toBe(note.pitch)
  })
})

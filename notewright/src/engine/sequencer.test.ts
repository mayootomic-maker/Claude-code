import { describe, expect, it } from 'vitest'
import { automationValueAt, beatToSeconds, buildTimeline, timelineDuration } from './sequencer'
import { parseSong } from '../format/parse'
import type { Song } from '../format/types'

function song(overrides: Record<string, unknown> = {}): Song {
  return parseSong({
    format: 'notewright/1',
    title: 'T',
    tempo: 120,
    timeSignature: '4/4',
    tracks: [
      { id: 'drums', name: 'Drums', instrument: { type: 'drums' } },
      { id: 'lead', name: 'Lead', instrument: { type: 'synth' } },
    ],
    patterns: [
      { id: 'beat', track: 'drums', bars: 1, grid: '1/16', lanes: { kick: 'x... .... x... ....' } },
      { id: 'riff', track: 'lead', bars: 2, grid: '1/8', notes: ['C4 . . . . . . .', 'E4 . . . . . . .'] },
    ],
    sections: [
      { id: 'a', name: 'A', bars: 4, clips: ['beat', 'riff'] },
      { id: 'b', name: 'B', bars: 4, clips: [{ pattern: 'riff', transpose: 7 }] },
    ],
    ...overrides,
  }).value
}

describe('arranging', () => {
  it('lays sections end to end', () => {
    const { sections, totalBars, totalBeats } = buildTimeline(song())
    expect(sections.map((section) => section.startBar)).toEqual([0, 4])
    expect(totalBars).toBe(8)
    expect(totalBeats).toBe(32)
  })

  it('repeats a clip to fill its section', () => {
    const { notes } = buildTimeline(song())
    const kicks = notes.filter((note) => note.lane === 'kick')
    expect(kicks).toHaveLength(8) // Two per bar, four bars.
    expect(kicks.map((note) => note.at)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
  })

  it('repeats a two-bar pattern half as often', () => {
    const { notes } = buildTimeline(song())
    const lead = notes.filter((note) => note.trackId === 'lead' && note.sectionId === 'a')
    expect(lead.map((note) => note.at)).toEqual([0, 4, 8, 12])
  })

  it('honours an explicit repeat count', () => {
    const arranged = song({
      sections: [{ id: 'a', name: 'A', bars: 8, clips: [{ pattern: 'beat', times: 2 }] }],
    })
    expect(buildTimeline(arranged).notes).toHaveLength(4)
  })

  it('starts a clip at an offset inside its section', () => {
    const arranged = song({
      sections: [{ id: 'a', name: 'A', bars: 4, clips: [{ pattern: 'beat', at: 2, times: 1 }] }],
    })
    expect(buildTimeline(arranged).notes.map((note) => note.at)).toEqual([8, 10])
  })

  it('transposes melodic notes but leaves drums alone', () => {
    const { notes } = buildTimeline(song())
    const sectionB = notes.filter((note) => note.sectionId === 'b')
    expect(sectionB[0]!.pitch).toBe(67) // C4 up a fifth.
    const arranged = song({
      sections: [{ id: 'a', name: 'A', bars: 1, clips: [{ pattern: 'beat', transpose: 12 }] }],
    })
    expect(buildTimeline(arranged).notes.every((note) => note.pitch === 0)).toBe(true)
  })

  it('drops a note transposed off the end of the keyboard rather than wrapping it', () => {
    const arranged = song({
      sections: [{ id: 'a', name: 'A', bars: 2, clips: [{ pattern: 'riff', transpose: 48 }] }],
    })
    const notes = buildTimeline(arranged).notes
    expect(notes.every((note) => note.pitch >= 0 && note.pitch <= 127)).toBe(true)
  })

  it('does not let a clip spill past the end of its section', () => {
    const arranged = song({
      sections: [{ id: 'a', name: 'A', bars: 1, clips: [{ pattern: 'riff', times: 4 }] }],
    })
    const notes = buildTimeline(arranged).notes
    expect(notes.every((note) => note.at < 4)).toBe(true)
  })

  it('ignores a clip whose pattern was removed', () => {
    const broken = song()
    broken.patterns = broken.patterns.filter((pattern) => pattern.id !== 'beat')
    expect(buildTimeline(broken).notes.every((note) => note.trackId === 'lead')).toBe(true)
  })

  it('keeps the section and pattern a note came from', () => {
    const { notes } = buildTimeline(song())
    expect(notes[0]!.sectionId).toBe('a')
    expect(new Set(notes.map((note) => note.patternId))).toEqual(new Set(['beat', 'riff']))
  })

  it('returns notes in time order', () => {
    const { notes } = buildTimeline(song())
    for (let index = 1; index < notes.length; index++) {
      expect(notes[index]!.at).toBeGreaterThanOrEqual(notes[index - 1]!.at)
    }
  })
})

describe('swing', () => {
  const swung = (amount: number): number[] =>
    buildTimeline(
      song({
        swing: amount,
        patterns: [
          { id: 'beat', track: 'drums', bars: 1, grid: '1/16', lanes: { hat: 'xxxx xxxx xxxx xxxx' } },
        ],
        sections: [{ id: 'a', name: 'A', bars: 1, clips: ['beat'] }],
      }),
    ).notes.map((note) => note.at)

  it('changes nothing at zero', () => {
    expect(swung(0)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75])
  })

  it('pushes every other sixteenth towards the triplet', () => {
    const full = swung(1)
    expect(full[0]).toBeCloseTo(0, 9)
    expect(full[1]).toBeCloseTo(1 / 3, 9) // Fully swung lands exactly on the triplet.
    expect(full[2]).toBeCloseTo(0.5, 9)
    expect(full[3]).toBeCloseTo(0.75 + 1 / 12, 9)
  })

  it('is proportional in between', () => {
    expect(swung(0.5)[1]).toBeCloseTo(0.25 + 1 / 24, 9)
  })

  it('swings eighths on an eighth-note grid', () => {
    const notes = buildTimeline(
      song({
        swing: 1,
        patterns: [{ id: 'beat', track: 'drums', bars: 1, grid: '1/8', lanes: { hat: 'xxxx xxxx' } }],
        sections: [{ id: 'a', name: 'A', bars: 1, clips: ['beat'] }],
      }),
    ).notes
    expect(notes[1]!.at).toBeCloseTo(2 / 3, 9)
  })

  it('leaves a note that is not on its grid where the musician put it', () => {
    const drifted = song({ swing: 1 })
    drifted.patterns[0]!.lanes['kick'] = [{ at: 0.1, pitch: 0, length: 0.25, velocity: 0.8 }]
    drifted.sections = [{ id: 'a', name: 'A', bars: 1, clips: [{ pattern: 'beat', at: 0, times: 1, transpose: 0 }] }]
    expect(buildTimeline(drifted).notes[0]!.at).toBeCloseTo(0.1, 9)
  })
})

describe('time', () => {
  it('converts beats to seconds at the song tempo', () => {
    expect(beatToSeconds(4, 120)).toBe(2)
    expect(beatToSeconds(4, 60)).toBe(4)
  })

  it('measures a song by its longest tail, not its last bar line', () => {
    const arranged = song()
    arranged.patterns[1]!.notes = [{ at: 0, pitch: 60, length: 40, velocity: 0.8 }]
    const timeline = buildTimeline(arranged)
    expect(timelineDuration(timeline, 120, 0)).toBeGreaterThan(beatToSeconds(32, 120))
  })
})

describe('automation', () => {
  const points = [
    { at: 0, value: 400 },
    { at: 8, value: 4000 },
    { at: 16, value: 400 },
  ]

  it('holds the first and last values outside the lane', () => {
    expect(automationValueAt(points, -5)).toBe(400)
    expect(automationValueAt(points, 100)).toBe(400)
  })

  it('ramps linearly between points', () => {
    expect(automationValueAt(points, 4)).toBe(2200)
    expect(automationValueAt(points, 8)).toBe(4000)
    expect(automationValueAt(points, 12)).toBe(2200)
  })

  it('has nothing to say when the lane is empty', () => {
    expect(automationValueAt([], 3)).toBeNull()
  })

  it('does not divide by zero when two points share a beat', () => {
    expect(automationValueAt([{ at: 4, value: 1 }, { at: 4, value: 9 }], 4)).toBe(9)
  })
})

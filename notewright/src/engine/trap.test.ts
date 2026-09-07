import { describe, expect, it } from 'vitest'
import { buildTimeline, duckBeats } from './sequencer'
import { parseSong } from '../format/parse'
import { serialiseSong } from '../format/serialize'
import { TEMPLATES } from '../state/templates'
import type { Song } from '../format/types'

function beat(overrides: Record<string, unknown> = {}): Song {
  return parseSong({
    format: 'notewright/1',
    title: 'T',
    tempo: 140,
    timeSignature: '4/4',
    tracks: [
      { id: 'drums', name: 'Drums', instrument: { type: 'drums' } },
      {
        id: '808',
        name: '808',
        instrument: { type: '808' },
        duck: { from: 'drums', lane: 'kick', amount: 0.6, release: 0.12 },
      },
    ],
    patterns: [
      { id: 'd', track: 'drums', bars: 1, grid: '1/16', lanes: { kick: 'x... .... x... ....', hat: 'x.x. x.x. x.x. x.x.' } },
      { id: 'b', track: '808', bars: 1, grid: '1/16', notes: 'F1~8 . . .  . . . .  C2~8 . . .  . . . .' },
    ],
    sections: [{ id: 'a', name: 'A', bars: 2, clips: ['d', 'b'] }],
    ...overrides,
  }).value
}

describe('the 808', () => {
  it('is its own instrument, not a synth preset', () => {
    const song = beat()
    expect(song.tracks[1]!.instrument.type).toBe('808')
    if (song.tracks[1]!.instrument.type !== '808') throw new Error('unreachable')
    expect(song.tracks[1]!.instrument.drop).toBeGreaterThan(0)
    expect(song.tracks[1]!.instrument.glide).toBeGreaterThan(0)
  })

  it('round-trips through the file', () => {
    const first = beat()
    const text = serialiseSong(first)
    const second = parseSong(JSON.parse(text)).value
    expect(second.tracks[1]!.instrument).toEqual(first.tracks[1]!.instrument)
    expect(serialiseSong(second)).toBe(text)
  })

  it('writes only what differs from the default', () => {
    const document = JSON.parse(serialiseSong(beat()))
    expect(document.tracks[1].instrument).toEqual({ type: '808' })
  })
})

describe('ducking', () => {
  it('dips on every kick, and only on kicks', () => {
    const timeline = buildTimeline(beat())
    const ducks = duckBeats(beat(), timeline)
    expect(ducks.get('808')).toEqual([0, 2, 4, 6])
  })

  it('follows any hit when no lane is named', () => {
    const song = beat()
    song.tracks[1]!.duck = { from: 'drums', lane: '', amount: 0.6, release: 0.12 }
    const ducks = duckBeats(song, buildTimeline(song))
    // Kicks and hats together, with hits sharing a beat counted once.
    expect(ducks.get('808')!.length).toBeGreaterThan(8)
  })

  it('counts two hits on one beat as a single dip', () => {
    const song = beat()
    song.tracks[1]!.duck = { from: 'drums', lane: '', amount: 0.6, release: 0.12 }
    const beats = duckBeats(song, buildTimeline(song)).get('808')!
    expect(new Set(beats).size).toBe(beats.length)
  })

  it('says so when it points at a track that is not there', () => {
    const { value, issues } = parseSong({
      format: 'notewright/1',
      title: 'T',
      tracks: [{ id: 'a', name: 'A', instrument: { type: '808' }, duck: { from: 'ghost', amount: 0.5 } }],
    })
    expect(issues.some((issue) => issue.message.includes('ghost'))).toBe(true)
    expect(value.tracks[0]!.duck).not.toBeNull()
  })

  it('refuses a track ducking itself', () => {
    const { value, issues } = parseSong({
      format: 'notewright/1',
      title: 'T',
      tracks: [{ id: 'a', name: 'A', instrument: { type: '808' }, duck: { from: 'a', amount: 0.5 } }],
    })
    expect(value.tracks[0]!.duck).toBeNull()
    expect(issues.some((issue) => issue.message.includes('cannot duck itself'))).toBe(true)
  })

  it('can name a track defined after it', () => {
    const { value, issues } = parseSong({
      format: 'notewright/1',
      title: 'T',
      tracks: [
        { id: 'bass', name: 'B', instrument: { type: '808' }, duck: { from: 'drums', lane: 'kick', amount: 0.5 } },
        { id: 'drums', name: 'D', instrument: { type: 'drums' } },
      ],
    })
    expect(value.tracks[0]!.duck?.from).toBe('drums')
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('reports a problem once, not once per parsing pass', () => {
    const { issues } = parseSong({
      format: 'notewright/1',
      title: 'T',
      tempo: 'fast',
      tracks: [{ id: 'a', name: 'A', instrument: { type: '808' } }],
    })
    expect(issues.filter((issue) => issue.where === 'tempo')).toHaveLength(1)
  })
})

describe('slides', () => {
  it('are written as overlapping notes', () => {
    const song = beat({
      patterns: [
        { id: 'd', track: 'drums', bars: 1, grid: '1/16', lanes: { kick: 'x...' } },
        // F1 lasts ten steps; C2 starts on the eighth, so they overlap.
        { id: 'b', track: '808', bars: 1, grid: '1/16', notes: 'F1~10 . . .  . . . .  C2~4 . . .  . . . .' },
      ],
    })
    const notes = song.patterns[1]!.notes
    expect(notes[0]!.at + notes[0]!.length).toBeGreaterThan(notes[1]!.at)
  })
})

describe('the starter templates', () => {
  it('all build a song that plays', () => {
    for (const template of TEMPLATES) {
      const song = template.build()
      const timeline = buildTimeline(song)
      if (template.id === 'empty') {
        expect(timeline.notes).toHaveLength(0)
        continue
      }
      expect(timeline.notes.length, template.id).toBeGreaterThan(50)
      expect(timeline.totalBars, template.id).toBeGreaterThan(8)
    }
  })

  it('put the clap on beat three, which is what makes it half-time', () => {
    const song = TEMPLATES[0]!.build()
    const claps = buildTimeline(song).notes.filter((note) => note.lane === 'clap')
    expect(claps.length).toBeGreaterThan(0)
    expect(claps.every((note) => Math.abs((note.at % 4) - 2) < 1e-6)).toBe(true)
  })

  it('duck the 808 out of the kick', () => {
    const song = TEMPLATES[0]!.build()
    const bass = song.tracks.find((track) => track.instrument.type === '808')
    expect(bass?.duck?.from).toBe('drums')
    expect(bass?.duck?.lane).toBe('kick')
  })

  it('survive a save and a reload unchanged', () => {
    for (const template of TEMPLATES) {
      const text = serialiseSong(template.build())
      const reread = parseSong(JSON.parse(text))
      expect(reread.issues, template.id).toEqual([])
      expect(serialiseSong(reread.value), template.id).toBe(text)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { parseSong, parseSongText } from './parse'
import { serialiseSong } from './serialize'
import { defaultDrumKit, defaultSynth } from './defaults'
import { beatsPerBar, type Song } from './types'

const minimal = {
  format: 'notewright/1',
  title: 'Test',
  tempo: 128,
  timeSignature: '4/4',
  key: 'A minor',
  tracks: [
    { id: 'drums', name: 'Drums', instrument: { type: 'drums' } },
    {
      id: 'bass',
      name: 'Bass',
      gain: -8,
      sends: { reverb: 0.2 },
      instrument: { type: 'synth', mono: true, glide: 0.04, filter: { frequency: 700 } },
      effects: [{ type: 'drive', amount: 0.5 }],
      automation: [{ target: 'instrument.filter.frequency', points: '0:400 16:3000 32:400' }],
    },
  ],
  patterns: [
    { id: 'beat', track: 'drums', bars: 1, grid: '1/16', lanes: { kick: 'x... ..x. x... ....', hat: 'x.x. x.x. x.x. x.x.' } },
    { id: 'line', track: 'bass', bars: 1, grid: '1/16', notes: 'A1~4 . . . E2 . . . A1 . . . G1~2 . . .' },
  ],
  sections: [
    { id: 'verse', name: 'Verse', bars: 8, clips: ['beat', { pattern: 'line', transpose: 0 }] },
    { id: 'chorus', name: 'Chorus', bars: 8, clips: ['beat', { pattern: 'line', at: 1, times: 3, transpose: 5 }] },
  ],
}

const strip = (song: Song): unknown =>
  JSON.parse(JSON.stringify(song, (key, value) => (key === 'offGrid' ? undefined : value)))

describe('reading a song', () => {
  it('reads a document with only the fields that matter', () => {
    const { value, issues } = parseSong(minimal)
    expect(issues).toEqual([])
    expect(value.title).toBe('Test')
    expect(value.tempo).toBe(128)
    expect(value.tracks).toHaveLength(2)
    expect(value.tracks[0]!.instrument.type).toBe('drums')
    expect(value.patterns[1]!.notes[0]).toMatchObject({ pitch: 33, length: 1 })
  })

  it('fills every omitted field from the defaults', () => {
    const { value } = parseSong(minimal)
    const bass = value.tracks[1]!
    expect(bass.instrument.type).toBe('synth')
    if (bass.instrument.type !== 'synth') throw new Error('unreachable')
    expect(bass.instrument.filter.frequency).toBe(700)
    expect(bass.instrument.filter.resonance).toBe(defaultSynth().filter.resonance)
    expect(bass.instrument.mono).toBe(true)
    expect(value.tracks[0]!.instrument).toEqual(defaultDrumKit())
  })

  it('reads a drum kit lane by lane', () => {
    const { value } = parseSong(minimal)
    const beat = value.patterns[0]!
    expect(Object.keys(beat.lanes).sort()).toEqual(['hat', 'kick'])
    expect(beat.lanes['kick']!.map((note) => note.at)).toEqual([0, 1.5, 2])
    expect(beat.lanes['hat']).toHaveLength(8)
  })

  it('reads automation written as beat:value pairs', () => {
    const { value } = parseSong(minimal)
    expect(value.tracks[1]!.automation[0]!.points).toEqual([
      { at: 0, value: 400 },
      { at: 16, value: 3000 },
      { at: 32, value: 400 },
    ])
  })
})

describe('the boundary holds', () => {
  it('survives being handed nothing at all', () => {
    for (const rubbish of [null, undefined, 42, 'a string', [], true]) {
      const { value, issues } = parseSong(rubbish)
      expect(value.format).toBe('notewright/1')
      expect(value.tracks).toEqual([])
      expect(Array.isArray(issues)).toBe(true)
    }
  })

  it('reports malformed JSON instead of throwing', () => {
    const result = parseSongText('{ "title": ')
    expect(result.value).toBeNull()
    expect(result.issues[0]!.message).toContain('not valid JSON')
  })

  it('clamps out-of-range numbers and says so', () => {
    const { value, issues } = parseSong({ ...minimal, tempo: 100000, swing: -3 })
    expect(value.tempo).toBe(400)
    expect(value.swing).toBe(0)
    expect(issues.filter((issue) => issue.where === 'tempo')).toHaveLength(1)
  })

  it('keeps a default when a field is the wrong type', () => {
    const { value, issues } = parseSong({ ...minimal, title: 42, tracks: 'not a list' })
    expect(value.title).toBe('Untitled')
    expect(value.tracks).toEqual([])
    expect(issues.some((issue) => issue.where === 'title')).toBe(true)
  })

  it('drops a clip pointing at a pattern that does not exist, loudly', () => {
    const { value, issues } = parseSong({
      ...minimal,
      sections: [{ id: 's', name: 'S', bars: 4, clips: ['beat', 'ghost'] }],
    })
    expect(value.sections[0]!.clips.map((clip) => clip.pattern)).toEqual(['beat'])
    expect(issues.some((issue) => issue.message.includes('ghost'))).toBe(true)
  })

  it('flags a pattern on a track that does not exist', () => {
    const { issues } = parseSong({
      ...minimal,
      patterns: [...minimal.patterns, { id: 'orphan', track: 'nowhere', bars: 1, grid: '1/16', notes: 'C4' }],
    })
    expect(issues.some((issue) => issue.message.includes('nowhere'))).toBe(true)
  })

  it('flags a lane the kit does not have', () => {
    const { issues } = parseSong({
      ...minimal,
      patterns: [{ id: 'beat', track: 'drums', bars: 1, grid: '1/16', lanes: { triangle: 'x...' } }],
    })
    expect(issues.some((issue) => issue.message.includes('triangle'))).toBe(true)
  })

  it('drops duplicate ids rather than letting two things answer to one name', () => {
    const { value, issues } = parseSong({
      ...minimal,
      tracks: [...minimal.tracks, { id: 'bass', name: 'Impostor', instrument: { type: 'fm' } }],
    })
    expect(value.tracks).toHaveLength(2)
    expect(value.tracks[1]!.name).toBe('Bass')
    expect(issues.some((issue) => issue.severity === 'error')).toBe(true)
  })

  it('warns when notes fall past the end of their pattern', () => {
    const { issues } = parseSong({
      ...minimal,
      patterns: [{ id: 'long', track: 'bass', bars: 1, grid: '1/16', notes: ['C4 . . .  . . . .  . . . .  . . . .', 'E4'] }],
    })
    expect(issues.some((issue) => issue.message.includes('will not be heard'))).toBe(true)
  })

  it('notes a format version it does not recognise but still reads the song', () => {
    const { value, issues } = parseSong({ ...minimal, format: 'notewright/99' })
    expect(value.tracks).toHaveLength(2)
    expect(issues.some((issue) => issue.where === 'format')).toBe(true)
  })
})

describe('writing a song', () => {
  it('round-trips without changing a thing', () => {
    const first = parseSong(minimal).value
    const text = serialiseSong(first)
    const second = parseSongText(text)
    expect(second.value).not.toBeNull()
    expect(second.issues).toEqual([])
    expect(strip(second.value!)).toEqual(strip(first))
  })

  it('is byte-stable, so an unchanged song is an unchanged file', () => {
    const song = parseSong(minimal).value
    const once = serialiseSong(song)
    const twice = serialiseSong(parseSong(JSON.parse(once)).value)
    expect(twice).toBe(once)
  })

  it('writes only what differs from the defaults', () => {
    const text = serialiseSong(parseSong(minimal).value)
    const document = JSON.parse(text)
    expect(document.tracks[0].instrument).toEqual({ type: 'drums' })
    expect(document.tracks[1].instrument).toEqual({
      type: 'synth',
      filter: { frequency: 700 },
      mono: true,
      glide: 0.04,
    })
    expect(text.length).toBeLessThan(2600)
  })

  it('writes patterns as step strings a person can read', () => {
    const document = JSON.parse(serialiseSong(parseSong(minimal).value))
    expect(document.patterns[0].lanes.kick).toBe('x... ..x. x... ....')
    expect(document.patterns[1].notes).toBe('A1~4 . . .  E2 . . .  A1 . . .  G1~2 . . .')
  })

  it('falls back to explicit notes when they are off the grid, rather than moving them', () => {
    const song = parseSong(minimal).value
    song.patterns[1]!.notes = [{ at: 0.1, pitch: 60, length: 0.3, velocity: 0.62 }]
    const document = JSON.parse(serialiseSong(song))
    expect(document.patterns[1].notes).toEqual([{ at: 0.1, pitch: 'C4', length: 0.3, velocity: 0.62 }])
    const reread = parseSong(document).value
    expect(reread.patterns[1]!.notes).toEqual([{ at: 0.1, pitch: 60, length: 0.3, velocity: 0.62 }])
  })

  it('keeps a clip terse when it has nothing special to say', () => {
    const document = JSON.parse(serialiseSong(parseSong(minimal).value))
    expect(document.sections[0].clips).toEqual(['beat', 'line'])
    expect(document.sections[1].clips[1]).toEqual({ pattern: 'line', at: 1, times: 3, transpose: 5 })
  })

  it('writes automation back as beat:value pairs', () => {
    const document = JSON.parse(serialiseSong(parseSong(minimal).value))
    expect(document.tracks[1].automation).toEqual([
      { target: 'instrument.filter.frequency', points: '0:400 16:3000 32:400' },
    ])
  })
})

describe('time signatures', () => {
  it('counts beats in a bar', () => {
    expect(beatsPerBar('4/4')).toBe(4)
    expect(beatsPerBar('3/4')).toBe(3)
    expect(beatsPerBar('6/8')).toBe(3)
    expect(beatsPerBar('7/8')).toBe(3.5)
    expect(beatsPerBar('nonsense')).toBe(4)
  })

  it('reports a time signature it cannot read', () => {
    const { value, issues } = parseSong({ ...minimal, timeSignature: 'common' })
    expect(value.timeSignature).toBe('4/4')
    expect(issues.some((issue) => issue.where === 'timeSignature')).toBe(true)
  })
})

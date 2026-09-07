/**
 * Writing a song file.
 *
 * Two properties matter more than compactness. The output has to be *stable* —
 * saving a song nobody changed must produce a byte-identical file, or every
 * save becomes a noisy commit. And it has to be *sparse* — a track writes only
 * the parameters that differ from the defaults, so the file reads as "what
 * makes this song this song" rather than three hundred lines of synth
 * boilerplate you have to skim past to find the melody.
 */
import { formatLane, formatNoteStream, type Note } from './notation'
import { defaultEffect, defaultInstrument, defaultMaster, defaultTrack } from './defaults'
import { midiToNote } from '../engine/theory'
import { beatsPerBar, FORMAT, type Automation, type Pattern, type Song, type Track } from './types'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function roundNumber(value: number): number {
  // Six decimals is finer than any parameter here is audible at, and it keeps
  // 0.1 + 0.2 out of the file.
  return Math.round(value * 1e6) / 1e6
}

function same(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return roundNumber(left) === roundNumber(right)
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => same(item, right[index]))
  }
  if (typeof left === 'object' && typeof right === 'object' && left !== null && right !== null) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
    )
  }
  return false
}

/**
 * Drops everything that matches the default. Arrays are all-or-nothing: a kit
 * or an oscillator pair is a definition, and half of one written out with the
 * unchanged half elided would be harder to read, not easier.
 */
function prune(value: unknown, fallback: unknown): Json | undefined {
  if (same(value, fallback)) return undefined
  if (typeof value === 'number') return roundNumber(value)
  if (Array.isArray(value)) return value.map((item) => deepJson(item)) as Json[]
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, Json> = {}
    const defaults = (typeof fallback === 'object' && fallback !== null ? fallback : {}) as Record<string, unknown>
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const pruned = prune(item, defaults[key])
      if (pruned !== undefined) result[key] = pruned
    }
    return result
  }
  return value as Json
}

function deepJson(value: unknown): Json {
  if (typeof value === 'number') return roundNumber(value)
  if (Array.isArray(value)) return value.map(deepJson)
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = deepJson(item)
    return result
  }
  return value as Json
}

function explicitNotes(notes: readonly Note[]): Json[] {
  return notes.map((note) => ({
    at: roundNumber(note.at),
    pitch: midiToNote(note.pitch),
    length: roundNumber(note.length),
    velocity: roundNumber(note.velocity),
  }))
}

/** One bar stays a plain string; more become an array, one entry per bar. */
function collapse(bars: string[] | null): Json | undefined {
  if (bars === null) return undefined
  if (bars.length === 0) return undefined
  if (bars.length === 1) return bars[0] as Json
  return bars as Json[]
}

function serialisePattern(pattern: Pattern, beatsInBar: number): Json {
  const result: Record<string, Json> = {
    id: pattern.id,
    track: pattern.track,
    bars: pattern.bars,
    grid: pattern.grid,
  }

  if (pattern.notes.length > 0) {
    const stream = collapse(formatNoteStream(pattern.notes, pattern.grid, beatsInBar, pattern.bars))
    result['notes'] = stream ?? explicitNotes(pattern.notes)
  }

  const laneIds = Object.keys(pattern.lanes).filter((id) => (pattern.lanes[id] ?? []).length > 0)
  if (laneIds.length > 0) {
    const lanes: Record<string, Json> = {}
    for (const id of laneIds) {
      const notes = pattern.lanes[id] ?? []
      const written = collapse(formatLane(notes, pattern.grid, beatsInBar, pattern.bars))
      lanes[id] = written ?? explicitNotes(notes)
    }
    result['lanes'] = lanes
  }

  return result
}

function serialiseAutomation(lane: Automation): Json {
  return {
    target: lane.target,
    points: lane.points.map((point) => `${roundNumber(point.at)}:${roundNumber(point.value)}`).join(' '),
  }
}

function serialiseTrack(track: Track, index: number): Json {
  const fallback = defaultTrack(track.id, track.name, defaultInstrument(track.instrument.type), index)
  const result: Record<string, Json> = { id: track.id, name: track.name }

  if (track.colour !== fallback.colour) result['colour'] = track.colour
  if (!same(track.gain, fallback.gain)) result['gain'] = roundNumber(track.gain)
  if (!same(track.pan, fallback.pan)) result['pan'] = roundNumber(track.pan)
  if (track.mute) result['mute'] = true
  if (track.solo) result['solo'] = true
  if (track.sends.delay !== 0 || track.sends.reverb !== 0) {
    const sends: Record<string, Json> = {}
    if (track.sends.delay !== 0) sends['delay'] = roundNumber(track.sends.delay)
    if (track.sends.reverb !== 0) sends['reverb'] = roundNumber(track.sends.reverb)
    result['sends'] = sends
  }

  // The type is what selects the defaults, so it is always written even when
  // everything else about the instrument is stock.
  const instrument = prune(track.instrument, defaultInstrument(track.instrument.type))
  result['instrument'] =
    instrument === undefined || instrument === null || typeof instrument !== 'object' || Array.isArray(instrument)
      ? { type: track.instrument.type }
      : { type: track.instrument.type, ...instrument }

  if (track.effects.length > 0) {
    result['effects'] = track.effects.map((item) => {
      const pruned = prune(item, defaultEffect(item.type))
      const body = pruned === undefined || pruned === null || typeof pruned !== 'object' || Array.isArray(pruned) ? {} : pruned
      return { type: item.type, ...body } as Json
    })
  }

  if (track.automation.length > 0) result['automation'] = track.automation.map(serialiseAutomation)

  return result
}

export function serialiseSong(song: Song): string {
  const beatsInBar = beatsPerBar(song.timeSignature)
  const document: Record<string, Json> = {
    format: FORMAT,
    title: song.title,
  }
  if (song.artist !== '') document['artist'] = song.artist
  document['tempo'] = roundNumber(song.tempo)
  document['timeSignature'] = song.timeSignature
  document['key'] = song.key
  if (song.swing !== 0) document['swing'] = roundNumber(song.swing)

  const master = prune(song.master, defaultMaster())
  if (master !== undefined && master !== null && typeof master === 'object' && !Array.isArray(master) && Object.keys(master).length > 0) {
    document['master'] = master
  }

  document['tracks'] = song.tracks.map(serialiseTrack)
  document['patterns'] = song.patterns.map((pattern) => serialisePattern(pattern, beatsInBar))
  document['sections'] = song.sections.map((section) => ({
    id: section.id,
    name: section.name,
    bars: section.bars,
    clips: section.clips.map((clip) => {
      if (clip.at === 0 && clip.times === null && clip.transpose === 0) return clip.pattern
      const result: Record<string, Json> = { pattern: clip.pattern }
      if (clip.at !== 0) result['at'] = clip.at
      if (clip.times !== null) result['times'] = clip.times
      if (clip.transpose !== 0) result['transpose'] = clip.transpose
      return result
    }),
  }))

  return `${JSON.stringify(document, null, 2)}\n`
}

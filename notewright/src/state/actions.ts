/**
 * Every change a song can undergo.
 *
 * The views call these rather than reaching into the document themselves, so
 * that "delete a track" means the same thing — and cleans up the same orphaned
 * patterns and clips — wherever it is invoked from.
 */
import { defaultTrack, TRACK_COLOURS } from '../format/defaults'
import { instrumentFromPreset } from '../engine/presets'
import type { Clip, Instrument, Pattern, Section, Track } from '../format/types'
import type { Note } from '../format/notation'
import { beatsPerStep, rollNotes } from '../format/notation'
import { uniqueId, type Store } from './store'

export function addTrack(store: Store, presetId: string, name: string): string {
  const id = uniqueId(name, store.get().song.tracks.map((track) => track.id))
  store.edit((song) => {
    const instrument = instrumentFromPreset(presetId)
    const track = defaultTrack(id, name, instrument ?? { type: 'synth' } as Instrument, song.tracks.length)
    track.colour = TRACK_COLOURS[song.tracks.length % TRACK_COLOURS.length] ?? track.colour
    song.tracks.push(track)
  })
  store.select({ trackId: id })
  return id
}

/** Removing a track takes its patterns and their clips with it. */
export function removeTrack(store: Store, trackId: string): void {
  store.edit((song) => {
    const orphaned = song.patterns.filter((pattern) => pattern.track === trackId).map((pattern) => pattern.id)
    song.tracks = song.tracks.filter((track) => track.id !== trackId)
    song.patterns = song.patterns.filter((pattern) => pattern.track !== trackId)
    for (const section of song.sections) {
      section.clips = section.clips.filter((clip) => !orphaned.includes(clip.pattern))
    }
  })
  store.select({ trackId: null, patternId: null })
}

export function updateTrack(store: Store, trackId: string, change: (track: Track) => void, history = true): void {
  store.edit((song) => {
    const track = song.tracks.find((candidate) => candidate.id === trackId)
    if (track) change(track)
  }, { history })
}

export function moveTrack(store: Store, trackId: string, direction: -1 | 1): void {
  store.edit((song) => {
    const index = song.tracks.findIndex((track) => track.id === trackId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= song.tracks.length) return
    const [moved] = song.tracks.splice(index, 1)
    if (moved) song.tracks.splice(target, 0, moved)
  })
}

export function addPattern(store: Store, trackId: string, name?: string): string {
  const song = store.get().song
  const track = song.tracks.find((candidate) => candidate.id === trackId)
  const base = name ?? `${track?.name ?? 'pattern'} ${song.patterns.filter((p) => p.track === trackId).length + 1}`
  const id = uniqueId(base, song.patterns.map((pattern) => pattern.id))
  store.edit((draft) => {
    draft.patterns.push({ id, track: trackId, bars: 1, grid: '1/16', notes: [], lanes: {}, offGrid: false })
  })
  store.select({ patternId: id, trackId })
  return id
}

export function duplicatePattern(store: Store, patternId: string): string | null {
  const song = store.get().song
  const source = song.patterns.find((pattern) => pattern.id === patternId)
  if (!source) return null
  const id = uniqueId(`${source.id} copy`, song.patterns.map((pattern) => pattern.id))
  store.edit((draft) => {
    const original = draft.patterns.find((pattern) => pattern.id === patternId)
    if (original) draft.patterns.push({ ...structuredClone(original), id })
  })
  store.select({ patternId: id })
  return id
}

export function removePattern(store: Store, patternId: string): void {
  store.edit((song) => {
    song.patterns = song.patterns.filter((pattern) => pattern.id !== patternId)
    for (const section of song.sections) {
      section.clips = section.clips.filter((clip) => clip.pattern !== patternId)
    }
  })
  store.select({ patternId: null })
}

export function updatePattern(store: Store, patternId: string, change: (pattern: Pattern) => void, history = true): void {
  store.edit((song) => {
    const pattern = song.patterns.find((candidate) => candidate.id === patternId)
    if (pattern) change(pattern)
  }, { history })
}

export function addSection(store: Store, afterId?: string): string {
  const song = store.get().song
  const id = uniqueId(`section ${song.sections.length + 1}`, song.sections.map((section) => section.id))
  store.edit((draft) => {
    const section: Section = { id, name: `Section ${draft.sections.length + 1}`, bars: 8, clips: [] }
    const index = afterId ? draft.sections.findIndex((candidate) => candidate.id === afterId) : -1
    if (index >= 0) draft.sections.splice(index + 1, 0, section)
    else draft.sections.push(section)
  })
  store.select({ sectionId: id })
  return id
}

export function duplicateSection(store: Store, sectionId: string): void {
  const song = store.get().song
  const id = uniqueId(`${sectionId} copy`, song.sections.map((section) => section.id))
  store.edit((draft) => {
    const index = draft.sections.findIndex((section) => section.id === sectionId)
    const source = draft.sections[index]
    if (!source) return
    draft.sections.splice(index + 1, 0, { ...structuredClone(source), id, name: `${source.name} copy` })
  })
  store.select({ sectionId: id })
}

export function removeSection(store: Store, sectionId: string): void {
  store.edit((song) => {
    song.sections = song.sections.filter((section) => section.id !== sectionId)
  })
  store.select({ sectionId: null })
}

export function updateSection(store: Store, sectionId: string, change: (section: Section) => void, history = true): void {
  store.edit((song) => {
    const section = song.sections.find((candidate) => candidate.id === sectionId)
    if (section) change(section)
  }, { history })
}

export function moveSection(store: Store, sectionId: string, direction: -1 | 1): void {
  store.edit((song) => {
    const index = song.sections.findIndex((section) => section.id === sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= song.sections.length) return
    const [moved] = song.sections.splice(index, 1)
    if (moved) song.sections.splice(target, 0, moved)
  })
}

/** Adds a clip if the section does not have that pattern, removes it if it does. */
export function toggleClip(store: Store, sectionId: string, patternId: string): void {
  store.edit((song) => {
    const section = song.sections.find((candidate) => candidate.id === sectionId)
    if (!section) return
    const existing = section.clips.findIndex((clip) => clip.pattern === patternId)
    if (existing >= 0) section.clips.splice(existing, 1)
    else section.clips.push({ pattern: patternId, at: 0, times: null, transpose: 0 })
  })
}

export function updateClip(
  store: Store,
  sectionId: string,
  patternId: string,
  change: (clip: Clip) => void,
): void {
  store.edit((song) => {
    const section = song.sections.find((candidate) => candidate.id === sectionId)
    const clip = section?.clips.find((candidate) => candidate.pattern === patternId)
    if (clip) change(clip)
  })
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function sortNotes(notes: Note[]): void {
  notes.sort((left, right) => left.at - right.at || left.pitch - right.pitch)
}

/**
 * Adds notes as one edit.
 *
 * Plural on purpose: stamping a chord is one action a person took, so it has to
 * be one step to undo. Calling a singular add three times made three.
 */
export function addNotes(store: Store, patternId: string, notes: readonly Note[]): void {
  if (notes.length === 0) return
  updatePattern(store, patternId, (pattern) => {
    for (const note of notes) pattern.notes.push({ ...note })
    sortNotes(pattern.notes)
  })
}

export function removeNotes(store: Store, patternId: string, indices: readonly number[]): void {
  const drop = new Set(indices)
  updatePattern(store, patternId, (pattern) => {
    pattern.notes = pattern.notes.filter((_, index) => !drop.has(index))
  })
}

export function replaceNotes(store: Store, patternId: string, notes: Note[], history = true): void {
  updatePattern(
    store,
    patternId,
    (pattern) => {
      pattern.notes = notes.map((note) => ({ ...note }))
      sortNotes(pattern.notes)
    },
    history,
  )
}

/**
 * Sets one cell of a drum lane, as a single hit or as a roll.
 *
 * A cell is everything inside one step, not just what sits exactly on it, so
 * clicking a step that holds a roll clears the whole roll rather than one of
 * its hits.
 */
export function setStep(
  store: Store,
  patternId: string,
  laneId: string,
  step: number,
  options: { velocity?: number; roll?: number; clear?: boolean } = {},
): void {
  updatePattern(store, patternId, (pattern) => {
    const perStep = beatsPerStep(pattern.grid)
    const at = step * perStep
    const lane = pattern.lanes[laneId] ?? []
    const outside = lane.filter((note) => note.at < at - 1e-9 || note.at >= at + perStep - 1e-9)

    if (options.clear) {
      pattern.lanes[laneId] = outside
      return
    }

    const roll = Math.max(1, Math.round(options.roll ?? 1))
    const velocity = options.velocity ?? 0.8
    const placed =
      roll > 1
        ? rollNotes(step, perStep, roll, velocity >= 0.95 ? 1 : 0.8)
        : [{ at, pitch: 0, length: perStep, velocity }]

    pattern.lanes[laneId] = [...outside, ...placed].sort((left, right) => left.at - right.at)
  })
}

/** What is in a step: nothing, a single hit, or a roll of some size. */
export function stepContents(
  pattern: Pattern,
  laneId: string,
  step: number,
): { count: number; velocity: number } | null {
  const perStep = beatsPerStep(pattern.grid)
  const at = step * perStep
  const inside = (pattern.lanes[laneId] ?? []).filter(
    (note) => note.at >= at - 1e-9 && note.at < at + perStep - 1e-9,
  )
  if (inside.length === 0) return null
  return { count: inside.length, velocity: Math.max(...inside.map((note) => note.velocity)) }
}

export function clearLane(store: Store, patternId: string, laneId: string): void {
  updatePattern(store, patternId, (pattern) => {
    delete pattern.lanes[laneId]
  })
}

/** Nudges the whole pattern up or down, staying inside the keyboard. */
export function transposePattern(store: Store, patternId: string, semitones: number): void {
  updatePattern(store, patternId, (pattern) => {
    if (pattern.notes.some((note) => note.pitch + semitones < 0 || note.pitch + semitones > 127)) return
    for (const note of pattern.notes) note.pitch += semitones
  })
}

/**
 * Application state.
 *
 * One object, one subscribe function, and an undo stack of whole song
 * snapshots. A song is small — a few thousand notes at most — so cloning it on
 * every edit costs less than the bugs that come with sharing structure between
 * the history and the live document.
 */
import { parseSong, parseSongText } from '../format/parse'
import { serialiseSong } from '../format/serialize'
import type { Issue } from '../format/notation'
import type { Song } from '../format/types'

export type View = 'arrange' | 'edit' | 'mix' | 'files'

export interface Selection {
  trackId: string | null
  patternId: string | null
  sectionId: string | null
  /** Notes selected in the editor, as indices into the pattern's note list. */
  notes: number[]
  /** The drum lane the step editor is focused on. */
  laneId: string | null
}

export interface AppState {
  song: Song
  /** File base name, without `.song.json`. */
  name: string
  issues: Issue[]
  view: View
  selection: Selection
  /** Set when the document differs from what is on disk. */
  dirty: boolean
  /** Transient message for the status line. */
  notice: { text: string; tone: 'info' | 'error' } | null
  undoDepth: number
  redoDepth: number
}

const HISTORY_LIMIT = 120

function emptySong(): Song {
  return parseSong({
    format: 'notewright/1',
    title: 'Untitled',
    tempo: 120,
    timeSignature: '4/4',
    key: 'C major',
  }).value
}

export class Store {
  private state: AppState
  private listeners = new Set<() => void>()
  private past: Song[] = []
  private future: Song[] = []

  constructor(initial?: Partial<AppState>) {
    this.state = {
      song: emptySong(),
      name: 'untitled',
      issues: [],
      view: 'arrange',
      selection: { trackId: null, patternId: null, sectionId: null, notes: [], laneId: null },
      dirty: false,
      notice: null,
      undoDepth: 0,
      redoDepth: 0,
      ...initial,
    }
  }

  get(): AppState {
    return this.state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private set(changes: Partial<AppState>): void {
    this.state = { ...this.state, ...changes, undoDepth: this.past.length, redoDepth: this.future.length }
    this.emit()
  }

  /**
   * Edits the song. `history: false` is for continuous gestures — dragging a
   * fader should be one undo step, not four hundred.
   */
  edit(mutate: (song: Song) => void, options: { history?: boolean } = {}): void {
    const keepHistory = options.history !== false
    if (keepHistory) {
      this.past.push(structuredClone(this.state.song))
      if (this.past.length > HISTORY_LIMIT) this.past.shift()
      this.future = []
    }
    const next = structuredClone(this.state.song)
    mutate(next)
    this.set({ song: next, dirty: true })
  }

  /** Opens a gesture: one snapshot now, then `history: false` edits until it ends. */
  beginGesture(): void {
    this.past.push(structuredClone(this.state.song))
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.set({})
  }

  undo(): void {
    const previous = this.past.pop()
    if (!previous) {
      this.notify('Nothing left to undo', 'info')
      return
    }
    this.future.push(structuredClone(this.state.song))
    this.set({ song: previous, dirty: true, selection: this.pruneSelection(previous) })
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) {
      this.notify('Nothing to redo', 'info')
      return
    }
    this.past.push(structuredClone(this.state.song))
    this.set({ song: next, dirty: true, selection: this.pruneSelection(next) })
  }

  /**
   * A selection pointing at something that no longer exists would crash the
   * editor, so it falls back to the first of each kind. Landing on the first
   * track rather than on nothing also means opening a song puts you in front of
   * some music instead of an empty panel asking you to choose.
   */
  private pruneSelection(song: Song): Selection {
    const current = this.state.selection
    const trackId = song.tracks.some((track) => track.id === current.trackId)
      ? current.trackId
      : (song.tracks[0]?.id ?? null)
    const pattern = song.patterns.some((candidate) => candidate.id === current.patternId)
      ? song.patterns.find((candidate) => candidate.id === current.patternId)
      : song.patterns.find((candidate) => candidate.track === trackId)
    return {
      trackId,
      patternId: pattern?.id ?? null,
      sectionId: song.sections.some((section) => section.id === current.sectionId)
        ? current.sectionId
        : (song.sections[0]?.id ?? null),
      notes: [],
      laneId: current.laneId,
    }
  }

  select(changes: Partial<Selection>): void {
    const next = { ...this.state.selection, ...changes }
    if (changes.trackId !== undefined && changes.patternId === undefined) {
      const current = this.state.song.patterns.find((pattern) => pattern.id === next.patternId)
      if (!current || current.track !== changes.trackId) {
        next.patternId = this.state.song.patterns.find((pattern) => pattern.track === changes.trackId)?.id ?? null
        next.notes = []
      }
    }
    this.set({ selection: next })
  }

  setView(view: View): void {
    this.set({ view })
  }

  notify(text: string, tone: 'info' | 'error' = 'info'): void {
    this.set({ notice: { text, tone } })
  }

  clearNotice(): void {
    if (this.state.notice) this.set({ notice: null })
  }

  markSaved(): void {
    this.set({ dirty: false })
  }

  /** Replaces the document wholesale — opening a file, or a file changing on disk. */
  load(song: Song, name: string, issues: Issue[], options: { dirty?: boolean; keepHistory?: boolean } = {}): void {
    if (options.keepHistory) {
      this.past.push(structuredClone(this.state.song))
      this.future = []
    } else {
      this.past = []
      this.future = []
    }
    this.state = { ...this.state, song, name }
    this.set({
      song,
      name,
      issues,
      dirty: options.dirty ?? false,
      selection: this.pruneSelection(song),
    })
  }

  loadText(text: string, name: string): boolean {
    const result = parseSongText(text)
    if (!result.value) {
      this.set({ issues: result.issues })
      this.notify(result.issues[0]?.message ?? 'That file could not be read', 'error')
      return false
    }
    this.load(result.value, name, result.issues)
    const errors = result.issues.filter((issue) => issue.severity === 'error').length
    if (errors > 0) this.notify(`Loaded with ${errors} problem${errors === 1 ? '' : 's'} — see the Files tab`, 'error')
    return true
  }

  text(): string {
    return serialiseSong(this.state.song)
  }
}

export function newSongNamed(title: string): Song {
  return parseSong({
    format: 'notewright/1',
    title,
    tempo: 120,
    timeSignature: '4/4',
    key: 'C major',
    tracks: [],
    patterns: [],
    sections: [{ id: 'section-1', name: 'A', bars: 8, clips: [] }],
  }).value
}

/** Ids are readable so a hand-edited file stays hand-editable. */
export function uniqueId(base: string, taken: readonly string[]): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stem = slug === '' ? 'item' : slug
  if (!taken.includes(stem)) return stem
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${stem}-${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${stem}-${Date.now()}`
}

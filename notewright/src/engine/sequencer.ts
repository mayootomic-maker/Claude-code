/**
 * Turning an arrangement into a list of notes with times on them.
 *
 * This is deliberately pure: sections in, events out, no audio context in
 * sight. Everything that decides *when* a note happens — repeats, transposes,
 * swing, a pattern that does not divide evenly into its section — is decided
 * here where it can be tested by reading numbers, rather than by listening.
 */
import { beatsPerBar, type Song, type Track } from '../format/types'
import type { Note } from '../format/notation'
import { stepsPerBeat } from '../format/notation'

export interface ScheduledNote {
  trackId: string
  /** Beats from the start of the song. */
  at: number
  /** Beats. Notes may ring past the end of their section; that is a tail, not a bug. */
  length: number
  pitch: number
  velocity: number
  /** Set when the track is a drum kit: which lane struck. */
  lane: string | null
  /** Where this came from, so the UI can highlight the clip that is sounding. */
  sectionId: string
  patternId: string
}

export interface SectionSpan {
  id: string
  name: string
  /** Bars from the start of the song. */
  startBar: number
  bars: number
  startBeat: number
  beats: number
}

export interface Timeline {
  notes: ScheduledNote[]
  sections: SectionSpan[]
  totalBars: number
  totalBeats: number
  beatsInBar: number
}

/**
 * Swing delays every other subdivision. At 1 an eighth-note swing lands exactly
 * on the triplet, which is the feel everyone means by "fully swung"; a sixteenth
 * swing is the same shape one division down.
 */
function applySwing(at: number, amount: number, grid: string): number {
  if (amount <= 0) return at
  const perBeat = stepsPerBeat(grid)
  const division = perBeat >= 4 ? 4 : 2
  const position = at * division
  const offset = position - Math.floor(position)
  if (Math.abs(offset) > 1e-6) return at // Not on a division of its own grid; leave it alone.
  const isOffBeat = Math.round(position) % 2 === 1
  if (!isOffBeat) return at
  // A third of the division is the distance to the triplet.
  return at + (amount / division) * (1 / 3)
}

function repeatCount(clipAt: number, patternBars: number, sectionBars: number, times: number | null): number {
  if (times !== null) return times
  const available = sectionBars - clipAt
  if (available <= 0) return 0
  return Math.max(1, Math.floor(available / patternBars))
}

function emit(
  target: ScheduledNote[],
  note: Note,
  options: {
    track: Track
    offsetBeats: number
    transpose: number
    swing: number
    grid: string
    lane: string | null
    sectionId: string
    patternId: string
    sectionEndBeat: number
  },
): void {
  const shifted = applySwing(note.at, options.swing, options.grid) + options.offsetBeats
  // A note that starts after its section has ended belongs to nothing; playing
  // it would drag one section's tail over the next section's downbeat.
  if (shifted >= options.sectionEndBeat - 1e-9) return
  const pitch = options.lane === null ? note.pitch + options.transpose : note.pitch
  if (pitch < 0 || pitch > 127) return
  target.push({
    trackId: options.track.id,
    at: shifted,
    length: note.length,
    pitch,
    velocity: note.velocity,
    lane: options.lane,
    sectionId: options.sectionId,
    patternId: options.patternId,
  })
}

export function buildTimeline(song: Song): Timeline {
  const beatsInBar = beatsPerBar(song.timeSignature)
  const notes: ScheduledNote[] = []
  const sections: SectionSpan[] = []
  const patterns = new Map(song.patterns.map((pattern) => [pattern.id, pattern]))
  const tracks = new Map(song.tracks.map((track) => [track.id, track]))

  let bar = 0
  for (const section of song.sections) {
    const span: SectionSpan = {
      id: section.id,
      name: section.name,
      startBar: bar,
      bars: section.bars,
      startBeat: bar * beatsInBar,
      beats: section.bars * beatsInBar,
    }
    sections.push(span)
    const sectionEndBeat = span.startBeat + span.beats

    for (const clip of section.clips) {
      const pattern = patterns.get(clip.pattern)
      if (!pattern) continue
      const track = tracks.get(pattern.track)
      if (!track) continue
      const repeats = repeatCount(clip.at, pattern.bars, section.bars, clip.times)

      for (let repeat = 0; repeat < repeats; repeat++) {
        const offsetBeats = span.startBeat + (clip.at + repeat * pattern.bars) * beatsInBar
        if (offsetBeats >= sectionEndBeat) break
        const shared = {
          track,
          offsetBeats,
          transpose: clip.transpose,
          swing: song.swing,
          grid: pattern.grid,
          sectionId: section.id,
          patternId: pattern.id,
          sectionEndBeat,
        }
        for (const note of pattern.notes) emit(notes, note, { ...shared, lane: null })
        for (const [laneId, laneNotes] of Object.entries(pattern.lanes)) {
          for (const note of laneNotes) emit(notes, note, { ...shared, lane: laneId })
        }
      }
    }
    bar += section.bars
  }

  notes.sort((left, right) => left.at - right.at || left.pitch - right.pitch)

  return { notes, sections, totalBars: bar, totalBeats: bar * beatsInBar, beatsInBar }
}

/**
 * The beats at which each ducked track should dip, keyed by track id.
 *
 * Computed from the arrangement rather than from the audio, which is what makes
 * this exact: there is no detector to mistime, and a render is identical every
 * time.
 */
export function duckBeats(song: Song, timeline: Timeline): Map<string, number[]> {
  const result = new Map<string, number[]>()
  for (const track of song.tracks) {
    const duck = track.duck
    if (!duck) continue
    const beats: number[] = []
    for (const note of timeline.notes) {
      if (note.trackId !== duck.from) continue
      if (duck.lane !== '' && note.lane !== duck.lane) continue
      // Two hits on the same beat are one dip.
      if (beats.length > 0 && Math.abs(beats[beats.length - 1]! - note.at) < 1e-6) continue
      beats.push(note.at)
    }
    if (beats.length > 0) result.set(track.id, beats)
  }
  return result
}

export function secondsPerBeat(tempo: number): number {
  return 60 / tempo
}

export function beatToSeconds(beat: number, tempo: number): number {
  return beat * secondsPerBeat(tempo)
}

/**
 * The value of an automation lane at a given beat, with linear ramps between
 * points. Two points on the same beat are how you write an instant jump, so a
 * tie resolves to the later one — at the moment of the step you want the new
 * value, not the old one.
 */
export function automationValueAt(points: readonly { at: number; value: number }[], beat: number): number | null {
  if (points.length === 0) return null
  const first = points[0]!
  if (beat < first.at) return first.value

  let index = 0
  for (let candidate = 1; candidate < points.length; candidate++) {
    if (points[candidate]!.at <= beat) index = candidate
    else break
  }

  const previous = points[index]!
  const next = points[index + 1]
  if (!next) return previous.value

  const span = next.at - previous.at
  if (span <= 0) return next.value
  return previous.value + (next.value - previous.value) * ((beat - previous.at) / span)
}

/** How long the song rings for, tail included — what the exporter renders. */
export function timelineDuration(timeline: Timeline, tempo: number, tailSeconds: number): number {
  let lastBeat = timeline.totalBeats
  for (const note of timeline.notes) lastBeat = Math.max(lastBeat, note.at + note.length)
  return beatToSeconds(lastBeat, tempo) + tailSeconds
}

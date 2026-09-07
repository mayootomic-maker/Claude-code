/**
 * Starting notes on a graph.
 *
 * Shared by live playback and the offline render on purpose. Choke groups and
 * mono retriggering are musical behaviour, not playback plumbing — if the
 * exporter had its own copy, the day one of them gained a fix would be the day
 * the file stopped sounding like the app.
 */
import type { DrumLane, Song, Track } from '../format/types'
import type { Graph } from './graph'
import type { ScheduledNote } from './sequencer'
import { startVoice, type VoiceHandle } from './voices'

interface LiveVoice {
  handle: VoiceHandle
  trackId: string
  choke: number
}

/** What the last note on a track was, so the next one knows whether to slide. */
interface Trailing {
  handle: VoiceHandle
  pitch: number
  /** Context time the note was written to end at, release aside. */
  until: number
}

export class NoteScheduler {
  private live: LiveVoice[] = []
  private mono = new Map<string, VoiceHandle>()
  private trailing = new Map<string, Trailing>()

  constructor(
    private readonly context: BaseAudioContext,
    private graph: Graph,
    private song: Song,
    private samples: Map<string, AudioBuffer>,
  ) {}

  update(graph: Graph, song: Song, samples: Map<string, AudioBuffer>): void {
    if (graph !== this.graph) {
      this.live = []
      this.mono.clear()
      this.trailing.clear()
    }
    this.graph = graph
    this.song = song
    this.samples = samples
  }

  private trackOf(id: string): Track | undefined {
    return this.song.tracks.find((track) => track.id === id)
  }

  private laneOf(track: Track, laneId: string | null): DrumLane | undefined {
    if (track.instrument.type !== 'drums' || laneId === null) return undefined
    return track.instrument.lanes.find((lane) => lane.id === laneId)
  }

  start(note: ScheduledNote, when: number, holdSeconds: number): VoiceHandle | null {
    const track = this.trackOf(note.trackId)
    const nodes = track ? this.graph.tracks.get(note.trackId) : undefined
    if (!track || !nodes) return null
    const lane = this.laneOf(track, note.lane)
    if (track.instrument.type === 'drums' && !lane) return null
    return this.spawn(track, nodes.input, lane, {
      pitch: note.pitch,
      velocity: note.velocity,
      when,
      hold: holdSeconds,
    })
  }

  /** One note now, held until the caller lets go. Used by the on-screen keys. */
  preview(trackId: string, pitch: number, velocity: number, laneId: string | null): (() => void) | null {
    const track = this.trackOf(trackId)
    const nodes = track ? this.graph.tracks.get(trackId) : undefined
    if (!track || !nodes) return null
    const lane = this.laneOf(track, laneId)
    if (track.instrument.type === 'drums' && !lane) return null
    const handle = this.spawn(track, nodes.input, lane, {
      pitch,
      velocity,
      when: this.context.currentTime + 0.004,
      hold: 8,
    })
    if (!handle) return null
    return () => handle.release(this.context.currentTime)
  }

  /**
   * Whether this note begins before the previous one on the track finished.
   *
   * Overlapping notes are how a slide is written in every piano roll there is,
   * so that is what triggers one here — no separate marker on the note.
   */
  private slides(track: Track): boolean {
    if (track.instrument.type === '808') return track.instrument.glide > 0
    return track.instrument.type === 'synth' && track.instrument.mono && track.instrument.glide > 0
  }

  private spawn(
    track: Track,
    destination: AudioNode,
    lane: DrumLane | undefined,
    request: { pitch: number; velocity: number; when: number; hold: number },
  ): VoiceHandle | null {
    // A choke group is a hi-hat pedal: the open hat has to stop the instant the
    // closed one is struck, or a pattern using both turns to mush.
    if (lane && lane.choke > 0) {
      for (const voice of this.live) {
        if (voice.trackId === track.id && voice.choke === lane.choke) voice.handle.release(request.when)
      }
      this.live = this.live.filter((voice) => !(voice.trackId === track.id && voice.choke === lane.choke))
    }

    const previous = this.trailing.get(track.id)
    const legato = previous !== undefined && request.when < previous.until - 1e-4

    if (this.slides(track) && legato) {
      // Bend the voice that is already sounding. A slide that started a second
      // voice and cut the first would click, because the waveform would jump.
      const bent = previous.handle.slide?.(request.pitch, request.when, request.hold)
      if (bent !== undefined && bent !== null) {
        this.trailing.set(track.id, {
          handle: previous.handle,
          pitch: request.pitch,
          until: request.when + request.hold,
        })
        return previous.handle
      }
    }

    if (track.instrument.type === 'synth' && track.instrument.mono) {
      this.mono.get(track.id)?.release(request.when)
    }

    const buffer =
      track.instrument.type === 'sampler' ? (this.samples.get(track.instrument.sample) ?? null) : undefined

    const glides = this.slides(track)
    const handle = startVoice(this.context, destination, track.instrument, {
      ...request,
      ...(lane ? { lane } : {}),
      ...(buffer !== undefined ? { buffer } : {}),
      // A mono synth glides from wherever it was; an 808 only bends when the
      // notes actually overlap, which is what a slide means in this music.
      ...(glides && previous !== undefined && (legato || track.instrument.type === 'synth')
        ? { from: previous.pitch }
        : {}),
    })
    if (!handle) return null

    this.live.push({ handle, trackId: track.id, choke: lane?.choke ?? 0 })
    if (track.instrument.type === 'synth' && track.instrument.mono) this.mono.set(track.id, handle)
    if (!lane) {
      this.trailing.set(track.id, { handle, pitch: request.pitch, until: request.when + request.hold })
    }
    return handle
  }

  releaseAll(at: number): void {
    for (const voice of this.live) voice.handle.release(at)
    this.live = []
    this.mono.clear()
    this.trailing.clear()
  }

  /**
   * Unhooks voices whose sound is over. The margin is there so a voice is never
   * cut while its last exponential ramp is still audible.
   */
  prune(now: number): void {
    if (this.live.length === 0) return
    const cutoff = now - 0.08
    const finished = this.live.filter((voice) => voice.handle.endsAt <= cutoff)
    if (finished.length === 0) return
    for (const voice of finished) voice.handle.dispose()
    this.live = this.live.filter((voice) => voice.handle.endsAt > cutoff)
  }
}

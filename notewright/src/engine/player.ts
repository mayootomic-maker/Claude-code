/**
 * Live playback.
 *
 * Web Audio schedules ahead of time; JavaScript timers do not run on time. So
 * nothing here plays a note when a timer fires — a timer only ever *books*
 * notes a little way into the future, and the audio clock plays them exactly
 * when asked. That is why the groove does not stumble when the UI is busy
 * repainting a piano roll.
 */
import { automationValueAt, buildTimeline, type ScheduledNote, type Timeline } from './sequencer'
import { anySoloed, buildGraph, faderGain, readMeter, resolveTarget, type Graph } from './graph'
import { NoteScheduler } from './schedule'
import { clamp, dbToGain } from './audio'
import type { Song } from '../format/types'

/** How far ahead notes are booked. Long enough to survive a stalled frame. */
const LOOKAHEAD_SECONDS = 0.22
const TICK_MILLISECONDS = 25

export interface PlayerState {
  playing: boolean
  /** Song position in beats. */
  beat: number
}

export interface Loop {
  enabled: boolean
  startBeat: number
  endBeat: number
}

/**
 * Anything the engine cannot do on its own and must not fail silently about:
 * a sampler track whose file never loaded, most often.
 */
export interface EngineWarning {
  trackId: string
  message: string
}

export class Player {
  private graph: Graph
  private timeline: Timeline
  private song: Song
  private structure: string
  private samples: Map<string, AudioBuffer>

  private timer: ReturnType<typeof setInterval> | null = null
  private startedAtTime = 0
  private startedAtCursor = 0
  private scheduledTo = 0
  private pausedBeat = 0
  private playing = false

  private voices: NoteScheduler
  private meterScratch = new Float32Array(256)

  loop: Loop = { enabled: false, startBeat: 0, endBeat: 16 }
  metronome = false
  warnings: EngineWarning[] = []

  constructor(
    private readonly context: AudioContext,
    song: Song,
    samples: Map<string, AudioBuffer> = new Map(),
  ) {
    this.song = song
    this.samples = samples
    this.timeline = buildTimeline(song)
    this.structure = structureSignature(song)
    this.graph = buildGraph(context, song, { meters: true })
    this.voices = new NoteScheduler(context, this.graph, song, samples)
    this.collectWarnings()
  }

  // -------------------------------------------------------------------------
  // Song changes
  // -------------------------------------------------------------------------

  /**
   * Takes a new version of the song without stopping.
   *
   * Most edits — a fader, a note, a filter cutoff — need no more than a
   * parameter change and are inaudible as edits. Changes that alter the shape
   * of the graph (an effect added, an instrument swapped, the tempo) need it
   * rebuilt, and that does cut sounding voices; it is faded rather than
   * snapped so the edit is a breath, not a click.
   */
  setSong(song: Song): void {
    const previous = this.song
    this.song = song
    this.timeline = buildTimeline(song)

    const signature = structureSignature(song)
    if (signature !== this.structure) {
      this.structure = signature
      this.rebuild()
    } else {
      this.applyMixerChanges(previous, song)
    }
    this.voices.update(this.graph, song, this.samples)
    this.collectWarnings()

    // Notes already booked came from the old arrangement; re-book from now.
    if (this.playing) this.scheduledTo = this.cursorAt(this.context.currentTime)
  }

  setSamples(samples: Map<string, AudioBuffer>): void {
    this.samples = samples
    this.voices.update(this.graph, this.song, samples)
    this.collectWarnings()
  }

  private rebuild(): void {
    const fade = this.context.currentTime + 0.015
    this.graph.master.gain.gain.cancelScheduledValues(this.context.currentTime)
    this.graph.master.gain.gain.setValueAtTime(this.graph.master.gain.gain.value, this.context.currentTime)
    this.graph.master.gain.gain.linearRampToValueAtTime(0, fade)
    const old = this.graph
    setTimeout(() => old.dispose(), 60)
    this.graph = buildGraph(this.context, this.song, { meters: true })
  }

  private applyMixerChanges(previous: Song, next: Song): void {
    const soloed = anySoloed(next)
    const at = this.context.currentTime
    const smooth = (param: AudioParam, value: number): void => {
      if (Math.abs(param.value - value) < 1e-6) return
      param.cancelScheduledValues(at)
      param.setValueAtTime(param.value, at)
      param.linearRampToValueAtTime(value, at + 0.02)
    }

    for (const track of next.tracks) {
      const nodes = this.graph.tracks.get(track.id)
      if (!nodes) continue
      smooth(nodes.fader.gain, faderGain(track, soloed))
      smooth(nodes.panner.pan, clamp(track.pan, -1, 1))
      smooth(nodes.delaySend.gain, clamp(track.sends.delay, 0, 1))
      smooth(nodes.reverbSend.gain, clamp(track.sends.reverb, 0, 1))

      const before = previous.tracks.find((candidate) => candidate.id === track.id)
      track.effects.forEach((effect, index) => {
        const node = nodes.effects[index]
        if (!node) return
        const wasEffect = before?.effects[index]
        for (const [name, param] of Object.entries(node.params)) {
          const value = (effect as unknown as Record<string, unknown>)[name]
          const had = wasEffect ? (wasEffect as unknown as Record<string, unknown>)[name] : undefined
          if (typeof value === 'number' && value !== had) smooth(param, value)
        }
      })
    }
    smooth(this.graph.master.gain.gain, dbToGain(next.master.gain))
  }

  private collectWarnings(): void {
    const warnings: EngineWarning[] = []
    for (const track of this.song.tracks) {
      if (track.instrument.type !== 'sampler') continue
      if (track.instrument.sample === '') {
        warnings.push({ trackId: track.id, message: 'No sample chosen, so this track is silent.' })
      } else if (!this.samples.has(track.instrument.sample)) {
        warnings.push({
          trackId: track.id,
          message: `The sample "${track.instrument.sample}" is not loaded, so this track is silent.`,
        })
      }
    }
    this.warnings = warnings
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  get state(): PlayerState {
    return { playing: this.playing, beat: this.playing ? this.currentBeat() : this.pausedBeat }
  }

  private secondsPerBeat(): number {
    return 60 / this.song.tempo
  }

  private cursorAt(time: number): number {
    return this.startedAtCursor + (time - this.startedAtTime) / this.secondsPerBeat()
  }

  private timeAt(cursor: number): number {
    return this.startedAtTime + (cursor - this.startedAtCursor) * this.secondsPerBeat()
  }

  /**
   * The cursor advances for ever; the song position wraps. Keeping the two
   * apart is what makes looping a projection rather than a special case
   * threaded through the scheduler.
   */
  private cursorToBeat(cursor: number): number {
    const { enabled, startBeat, endBeat } = this.loop
    const length = endBeat - startBeat
    if (!enabled || length <= 0 || cursor < startBeat) return cursor
    return startBeat + ((cursor - startBeat) % length)
  }

  currentBeat(): number {
    if (!this.playing) return this.pausedBeat
    return this.cursorToBeat(this.cursorAt(this.context.currentTime))
  }

  play(fromBeat?: number): void {
    if (this.playing) return
    const start = fromBeat ?? this.pausedBeat
    this.startedAtTime = this.context.currentTime + 0.06
    this.startedAtCursor = start
    this.scheduledTo = start
    this.playing = true
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MILLISECONDS)
  }

  stop(): void {
    if (!this.playing) {
      this.pausedBeat = 0
      return
    }
    this.pausedBeat = this.currentBeat()
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.releaseAll()
  }

  seek(beat: number): void {
    const target = Math.max(0, beat)
    if (!this.playing) {
      this.pausedBeat = target
      return
    }
    this.releaseAll()
    this.startedAtTime = this.context.currentTime + 0.03
    this.startedAtCursor = target
    this.scheduledTo = target
    this.tick()
  }

  private releaseAll(): void {
    this.voices.releaseAll(this.context.currentTime)
  }

  dispose(): void {
    this.stop()
    this.graph.dispose()
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  private tick(): void {
    if (!this.playing) return
    const horizon = this.cursorAt(this.context.currentTime + LOOKAHEAD_SECONDS)
    if (horizon <= this.scheduledTo) return

    let cursor = this.scheduledTo
    let guard = 0
    while (cursor < horizon && guard++ < 512) {
      const songBeat = this.cursorToBeat(cursor)
      const { enabled, startBeat, endBeat } = this.loop
      const untilLoopEnd =
        enabled && endBeat > startBeat && cursor >= startBeat ? endBeat - songBeat : Number.POSITIVE_INFINITY
      const chunk = Math.min(horizon - cursor, untilLoopEnd)
      if (chunk <= 0) break

      this.scheduleRange(songBeat, songBeat + chunk, cursor)
      cursor += chunk
    }
    this.scheduledTo = cursor
    this.voices.prune(this.context.currentTime)
  }

  private scheduleRange(fromBeat: number, toBeat: number, cursorAtFrom: number): void {
    const notes = this.timeline.notes
    const timeFor = (beat: number): number => this.timeAt(cursorAtFrom + (beat - fromBeat))

    for (let index = lowerBound(notes, fromBeat); index < notes.length; index++) {
      const note = notes[index]!
      if (note.at >= toBeat) break
      this.startNote(note, timeFor(note.at))
    }

    this.scheduleAutomation(fromBeat, toBeat, timeFor)

    if (this.metronome) {
      const first = Math.ceil(fromBeat - 1e-9)
      for (let beat = first; beat < toBeat; beat++) {
        this.click(timeFor(beat), beat % this.timeline.beatsInBar === 0)
      }
    }
  }

  private scheduleAutomation(fromBeat: number, toBeat: number, timeFor: (beat: number) => number): void {
    for (const track of this.song.tracks) {
      const nodes = this.graph.tracks.get(track.id)
      if (!nodes) continue
      for (const lane of track.automation) {
        const resolved = resolveTarget(nodes, lane.target)
        if (!resolved || lane.points.length === 0) continue
        const convert = (value: number): number => (resolved.decibels ? dbToGain(value) : value)

        const startValue = automationValueAt(lane.points, fromBeat)
        if (startValue === null) continue
        const startTime = timeFor(fromBeat)
        resolved.param.cancelScheduledValues(startTime)
        resolved.param.setValueAtTime(convert(startValue), startTime)

        for (const point of lane.points) {
          if (point.at <= fromBeat) continue
          if (point.at >= toBeat) {
            // Ramp towards the next point even though it is past the window,
            // otherwise a long sweep would move in visible steps.
            const edge = automationValueAt(lane.points, toBeat)
            if (edge !== null) resolved.param.linearRampToValueAtTime(convert(edge), timeFor(toBeat))
            break
          }
          resolved.param.linearRampToValueAtTime(convert(point.value), timeFor(point.at))
        }
      }
    }
  }

  private startNote(note: ScheduledNote, when: number): void {
    this.voices.start(note, when, note.length * this.secondsPerBeat())
  }

  private click(when: number, accented: boolean): void {
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = accented ? 1600 : 1050
    gain.gain.setValueAtTime(accented ? 0.16 : 0.09, when)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035)
    oscillator.connect(gain)
    gain.connect(this.graph.master.input)
    oscillator.start(when)
    oscillator.stop(when + 0.06)
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect()
      gain.disconnect()
    })
  }

  // -------------------------------------------------------------------------
  // Auditioning
  // -------------------------------------------------------------------------

  /** Plays one note now, for a key press or a click in the piano roll. */
  preview(trackId: string, pitch: number, velocity = 0.85, laneId: string | null = null): (() => void) | null {
    return this.voices.preview(trackId, pitch, velocity, laneId)
  }

  meters(): { tracks: Map<string, number>; master: number } {
    const tracks = new Map<string, number>()
    for (const [id, nodes] of this.graph.tracks) tracks.set(id, readMeter(nodes.analyser, this.meterScratch))
    return { tracks, master: readMeter(this.graph.master.analyser, this.meterScratch) }
  }
}

/** Index of the first note at or after `beat`, by binary search. */
function lowerBound(notes: readonly ScheduledNote[], beat: number): number {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((notes[middle]?.at ?? 0) < beat) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * What forces a rebuild rather than a parameter change. Anything not in here
 * can be nudged on a live graph without a break in the sound.
 */
function structureSignature(song: Song): string {
  return JSON.stringify([
    song.tempo,
    song.master.limiter,
    song.master.delay.time,
    song.master.delay.pingPong,
    song.master.reverb.size,
    song.master.reverb.damping,
    song.tracks.map((track) => [
      track.id,
      track.instrument.type,
      track.effects.map((effect) => {
        switch (effect.type) {
          case 'drive':
            return [effect.type, effect.enabled, effect.amount]
          case 'reverb':
            return [effect.type, effect.enabled, effect.size, effect.damping]
          case 'crush':
            return [effect.type, effect.enabled, effect.bits]
          case 'filter':
            return [effect.type, effect.enabled, effect.mode]
          case 'delay':
            return [effect.type, effect.enabled, effect.pingPong]
          default:
            return [effect.type, effect.enabled]
        }
      }),
    ]),
  ])
}

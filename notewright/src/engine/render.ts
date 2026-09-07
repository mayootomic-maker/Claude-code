/**
 * Bouncing a song to a file.
 *
 * The render uses the same graph builder and the same note scheduler as live
 * playback, on an OfflineAudioContext. That is the whole design: there is no
 * second engine to keep in sync, so "it sounds different in the export" cannot
 * happen without also sounding different in the app.
 */
import { buildGraph, resolveTarget } from './graph'
import { NoteScheduler } from './schedule'
import { automationValueAt, beatToSeconds, buildTimeline } from './sequencer'
import { dbToGain } from './audio'
import type { Song } from '../format/types'

/**
 * Silence rendered before the music and thrown away afterwards.
 *
 * Stateful nodes — a compressor on a track, a convolver — need a moment to
 * reach their resting state, and Chromium's compressor in particular spends
 * about 300ms ramping out of heavy gain reduction at the start of a render.
 * Without this the first beat of an export is quiet in a way playback is not.
 */
const PRE_ROLL_SECONDS = 0.5

export interface RenderOptions {
  sampleRate?: number
  /** Render only part of the song, in beats. */
  fromBeat?: number
  toBeat?: number
  /** Extra seconds so reverb and delay tails are not cut off. */
  tailSeconds?: number
  onProgress?: (fraction: number) => void
  samples?: Map<string, AudioBuffer>
}

/** How long the reverb and delay keep ringing after the last note. */
function tailFor(song: Song): number {
  const reverbSeconds = 0.25 + Math.pow(song.master.reverb.size, 1.7) * 4.25
  const longestEffectTail = song.tracks.reduce((longest, track) => {
    for (const effect of track.effects) {
      if (!effect.enabled) continue
      if (effect.type === 'reverb') longest = Math.max(longest, 0.25 + Math.pow(effect.size, 1.7) * 4.25)
      if (effect.type === 'delay') longest = Math.max(longest, 2.5)
    }
    return longest
  }, 0)
  return Math.max(reverbSeconds, longestEffectTail, 1) + 0.4
}

export async function renderSong(song: Song, options: RenderOptions = {}): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100
  const timeline = buildTimeline(song)
  const fromBeat = Math.max(0, options.fromBeat ?? 0)
  const toBeat = options.toBeat ?? timeline.totalBeats

  if (toBeat <= fromBeat) {
    throw new Error('There is nothing between those two points to render.')
  }

  const notes = timeline.notes.filter((note) => note.at >= fromBeat && note.at < toBeat)
  const tail = options.tailSeconds ?? tailFor(song)
  const musicSeconds = beatToSeconds(toBeat - fromBeat, song.tempo)
  const keptFrames = Math.ceil((musicSeconds + tail) * sampleRate)
  const preRollFrames = Math.round(PRE_ROLL_SECONDS * sampleRate)

  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: keptFrames + preRollFrames,
    sampleRate,
  })
  const graph = buildGraph(context, song, { meters: false })
  const scheduler = new NoteScheduler(context, graph, song, options.samples ?? new Map())

  const secondsPerBeat = 60 / song.tempo
  const preRoll = preRollFrames / sampleRate
  const timeFor = (beat: number): number => preRoll + Math.max(0, (beat - fromBeat) * secondsPerBeat)

  for (const note of notes) {
    scheduler.start(note, timeFor(note.at), note.length * secondsPerBeat)
  }

  // Automation is scheduled in full rather than in windows: offline there is no
  // lookahead to respect, and the whole lane is known up front.
  for (const track of song.tracks) {
    const nodes = graph.tracks.get(track.id)
    if (!nodes) continue
    for (const lane of track.automation) {
      const resolved = resolveTarget(nodes, lane.target)
      if (!resolved || lane.points.length === 0) continue
      const convert = (value: number): number => (resolved.decibels ? dbToGain(value) : value)
      const first = automationValueAt(lane.points, fromBeat)
      if (first === null) continue
      resolved.param.cancelScheduledValues(0)
      resolved.param.setValueAtTime(convert(first), 0)
      for (const point of lane.points) {
        if (point.at <= fromBeat) continue
        if (point.at >= toBeat) {
          const edge = automationValueAt(lane.points, toBeat)
          if (edge !== null) resolved.param.linearRampToValueAtTime(convert(edge), timeFor(toBeat))
          break
        }
        resolved.param.linearRampToValueAtTime(convert(point.value), timeFor(point.at))
      }
    }
  }

  options.onProgress?.(0)
  const rendered = await context.startRendering()
  graph.dispose()

  const trimmed = new OfflineAudioContext({ numberOfChannels: 2, length: keptFrames, sampleRate }).createBuffer(
    rendered.numberOfChannels,
    keptFrames,
    sampleRate,
  )
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    trimmed.copyToChannel(rendered.getChannelData(channel).subarray(preRollFrames, preRollFrames + keptFrames), channel)
  }
  options.onProgress?.(1)
  return trimmed
}

/**
 * A RIFF/WAVE file. Sixteen bits at 44.1 kHz is what every other piece of
 * software on the machine will open without asking questions; 24 is there for
 * when the render is going back into another studio.
 */
export function encodeWav(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const channels = Math.min(buffer.numberOfChannels, 2)
  const frames = buffer.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = channels * bytesPerSample
  const dataBytes = frames * blockAlign
  const output = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(output)

  const writeText = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeText(36, 'data')
  view.setUint32(40, dataBytes, true)

  const data: Float32Array[] = []
  for (let channel = 0; channel < channels; channel++) data.push(buffer.getChannelData(channel))

  let offset = 44
  const peak = bitDepth === 16 ? 0x7fff : 0x7fffff
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      // Clamping rather than wrapping: a sample over full scale should be a
      // flat top you can hear, not a polarity flip you cannot explain.
      const sample = Math.max(-1, Math.min(1, data[channel]?.[frame] ?? 0))
      const value = Math.round(sample * peak)
      if (bitDepth === 16) {
        view.setInt16(offset, value, true)
        offset += 2
      } else {
        view.setUint8(offset, value & 0xff)
        view.setUint8(offset + 1, (value >> 8) & 0xff)
        view.setUint8(offset + 2, (value >> 16) & 0xff)
        offset += 3
      }
    }
  }

  return new Blob([output], { type: 'audio/wav' })
}

export interface RenderStats {
  peak: number
  rms: number
  clippedFrames: number
  seconds: number
}

/** What the export dialog reports back, so "did it work" is not a guess. */
export function analyseRender(buffer: AudioBuffer): RenderStats {
  let peak = 0
  let sum = 0
  let clipped = 0
  let counted = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index++) {
      const value = data[index] ?? 0
      const magnitude = Math.abs(value)
      if (magnitude > peak) peak = magnitude
      if (magnitude >= 0.999) clipped++
      sum += value * value
      counted++
    }
  }
  return {
    peak,
    rms: counted > 0 ? Math.sqrt(sum / counted) : 0,
    clippedFrames: clipped,
    seconds: buffer.duration,
  }
}

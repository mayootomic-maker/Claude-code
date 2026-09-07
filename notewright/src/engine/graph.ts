/**
 * The mixer.
 *
 * Built identically for live playback and for the offline render, from the same
 * song document — which is the only way "export" can be trusted to sound like
 * what you just heard.
 *
 *   voices → track effects → fader → pan ┬→ master
 *                                        ├→ delay send → delay bus  ┐
 *                                        └→ reverb send → reverb bus┴→ master
 *   master → master gain → limiter → out
 */
import { buildChain, createEffect, type EffectNode } from './effects'
import { clamp, dbToGain, limiterCurve } from './audio'
import type { Song, Track } from '../format/types'

export interface TrackNodes {
  id: string
  /** Where this track's voices connect. */
  input: GainNode
  fader: GainNode
  /**
   * Ducking sits on its own node rather than on the fader, so that a gain
   * automation lane and a kick-driven dip can both be active without
   * overwriting each other's scheduled ramps.
   */
  duck: GainNode
  panner: StereoPannerNode
  delaySend: GainNode
  reverbSend: GainNode
  analyser: AnalyserNode | null
  effects: (EffectNode | null)[]
  dispose(): void
}

export interface Graph {
  context: BaseAudioContext
  tracks: Map<string, TrackNodes>
  master: {
    input: GainNode
    gain: GainNode
    analyser: AnalyserNode | null
  }
  dispose(): void
}

export interface GraphOptions {
  /** Meters cost a little CPU and are pointless in an offline render. */
  meters: boolean
}

/** Mute and solo resolve to one number, so nothing else has to know about them. */
export function faderGain(track: Track, anySoloed: boolean): number {
  if (track.mute) return 0
  if (anySoloed && !track.solo) return 0
  return dbToGain(track.gain)
}

export function anySoloed(song: Song): boolean {
  return song.tracks.some((track) => track.solo)
}

function analyser(context: BaseAudioContext, enabled: boolean): AnalyserNode | null {
  if (!enabled) return null
  const node = context.createAnalyser()
  node.fftSize = 256
  node.smoothingTimeConstant = 0.4
  return node
}

export function buildGraph(context: BaseAudioContext, song: Song, options: GraphOptions): Graph {
  const masterInput = context.createGain()
  const masterGain = context.createGain()
  masterGain.gain.value = dbToGain(song.master.gain)

  const masterAnalyser = analyser(context, options.meters)

  // A stateless soft ceiling rather than a compressor pressed into service as
  // a limiter. See `limiterCurve` for the measurement that decided this.
  let masterTail: AudioNode = masterGain
  const limiter = song.master.limiter ? context.createWaveShaper() : null
  if (limiter) {
    limiter.curve = limiterCurve(context, 0.7)
    limiter.oversample = '4x'
    masterGain.connect(limiter)
    masterTail = limiter
  }

  masterInput.connect(masterGain)
  if (masterAnalyser) {
    masterTail.connect(masterAnalyser)
    masterAnalyser.connect(context.destination)
  } else {
    masterTail.connect(context.destination)
  }

  // The two send buses. They are ordinary effects with the mix pinned wet,
  // which is what a send is.
  const delayBus = createEffect(context, { type: 'delay', enabled: true, ...song.master.delay }, song.tempo)
  const reverbBus = createEffect(context, { type: 'reverb', enabled: true, ...song.master.reverb }, song.tempo)
  delayBus.output.connect(masterInput)
  reverbBus.output.connect(masterInput)

  const soloed = anySoloed(song)
  const tracks = new Map<string, TrackNodes>()

  for (const track of song.tracks) {
    const input = context.createGain()
    const chain = buildChain(context, track.effects, song.tempo)
    const fader = context.createGain()
    fader.gain.value = faderGain(track, soloed)
    const panner = context.createStereoPanner()
    panner.pan.value = clamp(track.pan, -1, 1)
    const duck = context.createGain()
    duck.gain.value = 1
    const trackAnalyser = analyser(context, options.meters)

    input.connect(chain.input)
    chain.output.connect(fader)
    fader.connect(duck)
    duck.connect(panner)

    const delaySend = context.createGain()
    delaySend.gain.value = clamp(track.sends.delay, 0, 1)
    const reverbSend = context.createGain()
    reverbSend.gain.value = clamp(track.sends.reverb, 0, 1)
    // Post-fader sends: pulling a track's fader down takes its reverb with it,
    // which is what everyone expects when they mute something.
    panner.connect(delaySend)
    panner.connect(reverbSend)
    delaySend.connect(delayBus.input)
    reverbSend.connect(reverbBus.input)

    if (trackAnalyser) {
      panner.connect(trackAnalyser)
      trackAnalyser.connect(masterInput)
    } else {
      panner.connect(masterInput)
    }

    tracks.set(track.id, {
      id: track.id,
      input,
      fader,
      duck,
      panner,
      delaySend,
      reverbSend,
      analyser: trackAnalyser,
      effects: chain.nodes,
      dispose: () => {
        chain.dispose()
        for (const node of [input, fader, duck, panner, delaySend, reverbSend, trackAnalyser]) node?.disconnect()
      },
    })
  }

  return {
    context,
    tracks,
    master: { input: masterInput, gain: masterGain, analyser: masterAnalyser },
    dispose() {
      for (const track of tracks.values()) track.dispose()
      delayBus.dispose()
      reverbBus.dispose()
      for (const node of [masterInput, masterGain, limiter, masterAnalyser]) node?.disconnect()
    },
  }
}

/**
 * Resolves an automation target to the parameter it drives.
 *
 * Targets name mixer and effect controls only. An instrument parameter cannot
 * be automated directly because a synth's filter belongs to each voice, not to
 * the track — the honest way to sweep a filter across a whole part is to put a
 * filter effect on the track and automate that, which this supports.
 */
export function resolveTarget(nodes: TrackNodes, target: string): { param: AudioParam; decibels: boolean } | null {
  if (target === 'gain') return { param: nodes.fader.gain, decibels: true }
  if (target === 'pan') return { param: nodes.panner.pan, decibels: false }
  if (target === 'sends.delay') return { param: nodes.delaySend.gain, decibels: false }
  if (target === 'sends.reverb') return { param: nodes.reverbSend.gain, decibels: false }

  const match = /^effects\.(\d+)\.(\w+)$/.exec(target)
  if (!match) return null
  const [, index = '0', name = ''] = match
  const effect = nodes.effects[Number(index)]
  if (!effect) return null
  const param = effect.params[name]
  return param ? { param, decibels: false } : null
}

export const AUTOMATION_TARGETS = ['gain', 'pan', 'sends.delay', 'sends.reverb'] as const

/** Peak level of a meter, 0-1, or 0 when meters are off. */
export function readMeter(node: AnalyserNode | null, scratch: Float32Array<ArrayBuffer>): number {
  if (!node) return 0
  node.getFloatTimeDomainData(scratch)
  let peak = 0
  for (let index = 0; index < scratch.length; index++) {
    const value = Math.abs(scratch[index] ?? 0)
    if (value > peak) peak = value
  }
  return Math.min(peak, 1)
}

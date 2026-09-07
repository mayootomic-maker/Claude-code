/**
 * Voices: one note becoming a short-lived graph of audio nodes.
 *
 * Every voice is built, scheduled and torn down for a single note. That sounds
 * wasteful and is not: Web Audio node allocation is cheap, whereas keeping a
 * pool of voices alive means holding filter and envelope state that has to be
 * reset perfectly or the second note of a patch sounds different from the
 * first. Nodes disconnect themselves when the sound has finished.
 */
import type { DrumLane, Envelope, FmInstrument, Instrument, SamplerInstrument, SynthInstrument } from '../format/types'
import { clamp, dbToGain, noiseBuffer, pulseWave, SILENCE } from './audio'
import { midiToFreq, noteToMidi } from './theory'

export interface VoiceHandle {
  /** Absolute context time the voice stops making sound. */
  readonly endsAt: number
  /** Start the release stage, for a key being let go or a choke group firing. */
  release(at: number): void
  /**
   * Unhooks the voice's nodes from the graph.
   *
   * Live, the `ended` event does this on its own. Offline it never fires until
   * rendering has finished, so every note a song contains would still be in the
   * graph at the last bar and each render quantum would walk all of them — a
   * cost that grows with the square of the song's length. The scheduler calls
   * this once a voice's time is past.
   */
  dispose(): void
}

export interface NoteRequest {
  pitch: number
  velocity: number
  /** Absolute context time. */
  when: number
  /** Seconds the note is held before its release stage. */
  hold: number
  /** For drum kits: which lane was struck. */
  lane?: DrumLane
  /** For samplers: the decoded audio, or null when the file is missing. */
  buffer?: AudioBuffer | null
}

const MIN_HOLD = 0.004

function envelopeEnd(envelope: Envelope, hold: number): number {
  return Math.max(hold, MIN_HOLD) + envelope.release
}

/**
 * The standard four-stage envelope, scheduled in one go.
 *
 * Attack is linear because a linear rise from silence is what an attack sounds
 * like; decay and release are exponential because that is what a decay sounds
 * like. Mixing the two is not an inconsistency, it is the point.
 */
function scheduleEnvelope(
  param: AudioParam,
  envelope: Envelope,
  when: number,
  peak: number,
  hold: number,
): number {
  const held = Math.max(hold, MIN_HOLD)
  const attack = Math.max(envelope.attack, 0.001)
  const sustainLevel = Math.max(peak * envelope.sustain, SILENCE)

  param.cancelScheduledValues(when)
  param.setValueAtTime(SILENCE, when)

  // A note shorter than its own attack should not be louder than one that got
  // to finish rising, so the peak is scaled down instead of the attack cut off.
  if (attack >= held) {
    const reached = Math.max(peak * (held / attack), SILENCE)
    param.linearRampToValueAtTime(reached, when + held)
  } else {
    param.linearRampToValueAtTime(peak, when + attack)
    const decayEnd = when + attack + Math.max(envelope.decay, 0.001)
    if (decayEnd < when + held) {
      param.exponentialRampToValueAtTime(sustainLevel, decayEnd)
      param.setValueAtTime(sustainLevel, when + held)
    } else {
      param.exponentialRampToValueAtTime(sustainLevel, decayEnd)
    }
  }

  const end = when + envelopeEnd(envelope, hold)
  param.exponentialRampToValueAtTime(SILENCE, end)
  param.setValueAtTime(0, end)
  return end
}

/** Re-aims an already-scheduled envelope at silence, for a key let go early. */
function releaseEnvelope(param: AudioParam, envelope: Envelope, at: number): number {
  const end = at + Math.max(envelope.release, 0.005)
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at)
  else {
    param.cancelScheduledValues(at)
    param.setValueAtTime(Math.max(param.value, SILENCE), at)
  }
  param.exponentialRampToValueAtTime(SILENCE, end)
  param.setValueAtTime(0, end)
  return end
}

function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const node of nodes) {
    try {
      node.disconnect()
    } catch {
      // Already gone; a voice torn down twice is not an error worth surfacing.
    }
  }
}

function disconnectWhenDone(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.addEventListener('ended', () => disconnectAll(nodes))
}

// ---------------------------------------------------------------------------
// Subtractive synth
// ---------------------------------------------------------------------------

function applyWave(oscillator: OscillatorNode, wave: string, context: BaseAudioContext): void {
  if (wave === 'pulse') oscillator.setPeriodicWave(pulseWave(context, 0.22))
  else if (wave === 'supersaw') oscillator.type = 'sawtooth'
  else oscillator.type = wave as OscillatorType
}

function synthVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: SynthInstrument,
  request: NoteRequest,
): VoiceHandle {
  const { when, hold } = request
  const frequency = midiToFreq(request.pitch)
  const owned: AudioNode[] = []

  const amplitude = context.createGain()
  amplitude.gain.value = 0
  owned.push(amplitude)

  const filter = context.createBiquadFilter()
  filter.type = instrument.filter.mode
  filter.Q.value = clamp(instrument.filter.resonance, 0.0001, 30)
  filter.connect(amplitude)
  owned.push(filter)

  // Key tracking lets a patch stay bright at the top of the keyboard without
  // being mud at the bottom.
  const tracked =
    instrument.filter.frequency * Math.pow(2, (instrument.filter.keyTracking * (request.pitch - 60)) / 12)
  const base = clamp(tracked, 20, 20000)
  const peakCutoff = clamp(base * Math.pow(2, instrument.filter.envelope / 12), 20, 20000)
  const sustainCutoff = clamp(
    base * Math.pow(2, (instrument.filter.envelope * instrument.filterEnvelope.sustain) / 12),
    20,
    20000,
  )
  const envelope = instrument.filterEnvelope
  filter.frequency.setValueAtTime(base, when)
  filter.frequency.linearRampToValueAtTime(peakCutoff, when + Math.max(envelope.attack, 0.001))
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(sustainCutoff, 20),
    when + Math.max(envelope.attack, 0.001) + Math.max(envelope.decay, 0.001),
  )

  const sources: AudioScheduledSourceNode[] = []
  const stopAt = when + envelopeEnd(instrument.amplitudeEnvelope, hold) + 0.02

  const unisonVoices = instrument.oscillators.some((oscillator) => oscillator.wave === 'supersaw')
    ? Math.max(instrument.unison.voices, 7)
    : instrument.unison.voices
  const spreadDetune = instrument.oscillators.some((oscillator) => oscillator.wave === 'supersaw')
    ? Math.max(instrument.unison.detune, 22)
    : instrument.unison.detune

  for (const spec of instrument.oscillators) {
    if (spec.level <= 0) continue
    for (let copy = 0; copy < unisonVoices; copy++) {
      const oscillator = context.createOscillator()
      applyWave(oscillator, spec.wave, context)
      oscillator.frequency.value = frequency * Math.pow(2, spec.octave)
      const offset = unisonVoices === 1 ? 0 : (copy / (unisonVoices - 1) - 0.5) * 2
      oscillator.detune.value = spec.detune + offset * spreadDetune
      if (instrument.glide > 0 && instrument.mono) {
        oscillator.frequency.setValueAtTime(oscillator.frequency.value, when)
      }

      const level = context.createGain()
      level.gain.value = (spec.level / Math.sqrt(unisonVoices)) * 0.5
      oscillator.connect(level)

      if (unisonVoices > 1 && instrument.unison.width > 0) {
        const panner = context.createStereoPanner()
        panner.pan.value = offset * instrument.unison.width
        level.connect(panner)
        panner.connect(filter)
        owned.push(panner)
      } else {
        level.connect(filter)
      }

      oscillator.start(when)
      oscillator.stop(stopAt)
      sources.push(oscillator)
      owned.push(oscillator, level)
    }
  }

  if (instrument.noise > 0) {
    const noise = context.createBufferSource()
    noise.buffer = noiseBuffer(context)
    noise.loop = true
    const level = context.createGain()
    level.gain.value = instrument.noise * 0.35
    noise.connect(level)
    level.connect(filter)
    noise.start(when)
    noise.stop(stopAt)
    sources.push(noise)
    owned.push(noise, level)
  }

  if (instrument.lfo.toPitch !== 0 || instrument.lfo.toFilter !== 0 || instrument.lfo.toAmplitude !== 0) {
    const lfo = context.createOscillator()
    lfo.type = instrument.lfo.wave
    lfo.frequency.value = clamp(instrument.lfo.rate, 0.01, 40)
    owned.push(lfo)

    if (instrument.lfo.toPitch !== 0) {
      const depth = context.createGain()
      depth.gain.value = instrument.lfo.toPitch * 100
      lfo.connect(depth)
      for (const source of sources) {
        if (source instanceof OscillatorNode) depth.connect(source.detune)
      }
      owned.push(depth)
    }
    if (instrument.lfo.toFilter !== 0) {
      const depth = context.createGain()
      // Semitones are multiplicative; an audio-rate connection is additive, so
      // the depth is the distance in hertz from the current cutoff.
      depth.gain.value = base * (Math.pow(2, instrument.lfo.toFilter / 12) - 1)
      lfo.connect(depth)
      depth.connect(filter.frequency)
      owned.push(depth)
    }
    if (instrument.lfo.toAmplitude > 0) {
      const depth = context.createGain()
      depth.gain.value = instrument.lfo.toAmplitude
      lfo.connect(depth)
      depth.connect(amplitude.gain)
      owned.push(depth)
    }
    lfo.start(when)
    lfo.stop(stopAt)
    sources.push(lfo)
  }

  const peak = request.velocity * dbToGain(instrument.gain) * 0.6
  const end = scheduleEnvelope(amplitude.gain, instrument.amplitudeEnvelope, when, peak, hold)
  amplitude.connect(destination)

  const first = sources[0]
  if (first) disconnectWhenDone(first, owned)

  return {
    endsAt: end,
    release(at: number) {
      const released = releaseEnvelope(amplitude.gain, instrument.amplitudeEnvelope, at)
      for (const source of sources) {
        try {
          source.stop(released + 0.02)
        } catch {
          // Stopping a source that already stopped is not a problem.
        }
      }
    },
    dispose: () => disconnectAll(owned),
  }
}

// ---------------------------------------------------------------------------
// Two-operator FM
// ---------------------------------------------------------------------------

function fmVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: FmInstrument,
  request: NoteRequest,
): VoiceHandle {
  const { when, hold } = request
  const frequency = midiToFreq(request.pitch)
  const owned: AudioNode[] = []

  const amplitude = context.createGain()
  amplitude.gain.value = 0
  amplitude.connect(destination)
  owned.push(amplitude)

  const carrier = context.createOscillator()
  carrier.type = instrument.carrier.wave
  carrier.frequency.value = frequency * instrument.carrier.ratio
  carrier.connect(amplitude)
  owned.push(carrier)

  const modulator = context.createOscillator()
  modulator.type = instrument.modulator.wave
  modulator.frequency.value = frequency * instrument.modulator.ratio
  owned.push(modulator)

  // The index is in multiples of the modulator frequency, the convention every
  // FM synth uses, so a patch keeps its character across the keyboard.
  const depth = context.createGain()
  depth.gain.value = 0
  modulator.connect(depth)
  depth.connect(carrier.frequency)
  owned.push(depth)

  const indexPeak = instrument.modulator.index * frequency * instrument.modulator.ratio
  scheduleEnvelope(depth.gain, instrument.modulator.envelope, when, Math.max(indexPeak, SILENCE), hold)

  const peak = request.velocity * dbToGain(instrument.gain) * 0.5
  const end = scheduleEnvelope(amplitude.gain, instrument.amplitudeEnvelope, when, peak, hold)
  const stopAt = end + 0.02

  carrier.start(when)
  carrier.stop(stopAt)
  modulator.start(when)
  modulator.stop(stopAt)
  disconnectWhenDone(carrier, owned)

  return {
    endsAt: end,
    release(at: number) {
      const released = releaseEnvelope(amplitude.gain, instrument.amplitudeEnvelope, at)
      try {
        carrier.stop(released + 0.02)
        modulator.stop(released + 0.02)
      } catch {
        // Already stopped.
      }
    },
    dispose: () => disconnectAll(owned),
  }
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

function noiseSource(context: BaseAudioContext, when: number, until: number): AudioBufferSourceNode {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  source.loop = true
  // Starting at a different point each hit stops a repeated hat sounding like
  // a loop of one identical sample.
  source.loopStart = 0
  source.loopEnd = source.buffer.duration
  source.start(when, (when * 7919) % source.buffer.duration)
  source.stop(until)
  return source
}

/**
 * Per-voice output trims, measured rather than guessed.
 *
 * Each drum voice is a different pile of oscillators and filters, so the same
 * `level` in the kit produced wildly different loudness — a clap nineteen
 * decibels under a kick, and a kick that peaked above full scale on its own.
 * These numbers make `level` mean the same thing on every lane, which is the
 * only way the kit's own balance is worth anything. Re-derive them with
 * `e2e/drum-balance.mjs` if a voice's synthesis changes.
 */
const VOICE_TRIM: Readonly<Record<DrumLane['voice'], number>> = {
  kick: 0.662,
  snare: 0.586,
  clap: 4.83,
  hat: 0.94,
  tom: 0.575,
  rim: 1.075,
  cymbal: 1.06,
  cowbell: 0.8,
}

function drumVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  lane: DrumLane,
  request: NoteRequest,
): VoiceHandle {
  const { when } = request
  const owned: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  const decay = Math.max(lane.decay, 0.005)
  const end = when + decay + 0.05

  const output = context.createGain()
  output.gain.value = request.velocity * dbToGain(lane.level) * (VOICE_TRIM[lane.voice] ?? 1)
  owned.push(output)

  if (lane.pan !== 0) {
    const panner = context.createStereoPanner()
    panner.pan.value = clamp(lane.pan, -1, 1)
    output.connect(panner)
    panner.connect(destination)
    owned.push(panner)
  } else {
    output.connect(destination)
  }

  const tone = (type: OscillatorType, from: number, to: number, sweep: number, level: number, length: number): void => {
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(from, 20), when)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 20), when + Math.max(sweep, 0.001))
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, when)
    gain.gain.exponentialRampToValueAtTime(SILENCE, when + length)
    oscillator.connect(gain)
    gain.connect(output)
    oscillator.start(when)
    oscillator.stop(when + length + 0.02)
    sources.push(oscillator)
    owned.push(oscillator, gain)
  }

  const noise = (
    filterType: BiquadFilterType,
    frequency: number,
    q: number,
    level: number,
    length: number,
    startAt = when,
  ): void => {
    const source = noiseSource(context, startAt, startAt + length + 0.02)
    const filter = context.createBiquadFilter()
    filter.type = filterType
    filter.frequency.value = clamp(frequency, 20, 20000)
    filter.Q.value = q
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, startAt)
    gain.gain.exponentialRampToValueAtTime(SILENCE, startAt + length)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    sources.push(source)
    owned.push(source, filter, gain)
  }

  switch (lane.voice) {
    case 'kick':
      tone('sine', lane.tune * 6, lane.tune, 0.035 + decay * 0.08, 1, decay)
      if (lane.snap > 0) noise('highpass', 1800, 0.7, lane.snap * 0.35, 0.012)
      break
    case 'snare':
      tone('triangle', lane.tune, lane.tune * 0.72, 0.06, 0.55 * (1 - lane.snap * 0.4), decay * 0.8)
      tone('triangle', lane.tune * 1.48, lane.tune * 1.1, 0.06, 0.3 * (1 - lane.snap * 0.4), decay * 0.6)
      noise('highpass', 1400 + lane.snap * 2200, 0.6, 0.5 + lane.snap * 0.4, decay)
      break
    case 'hat':
      // Six detuned squares through a high-pass is the 808 hi-hat recipe; the
      // ratios are what stop it sounding like plain filtered noise.
      for (const ratio of [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637]) {
        tone('square', lane.tune * ratio * 0.12, lane.tune * ratio * 0.12, 0.001, 0.055, decay)
      }
      noise('highpass', lane.tune * 0.75, 0.8, 0.28 + lane.snap * 0.3, decay)
      break
    case 'clap':
      for (const [index, offset] of [0, 0.011, 0.021].entries()) {
        noise('bandpass', lane.tune, 1, 0.5 - index * 0.08, 0.028, when + offset)
      }
      noise('bandpass', lane.tune * 0.9, 0.8, 0.42, decay, when + 0.031)
      break
    case 'tom':
      tone('sine', lane.tune * 2.1, lane.tune, 0.09, 0.9, decay)
      if (lane.snap > 0) noise('bandpass', lane.tune * 4, 1, lane.snap * 0.2, 0.05)
      break
    case 'rim':
      tone('square', lane.tune * 4.2, lane.tune * 4.2, 0.001, 0.3, decay * 0.5)
      tone('square', lane.tune * 6.7, lane.tune * 6.7, 0.001, 0.22, decay * 0.4)
      noise('bandpass', lane.tune * 5, 3, 0.35, decay)
      break
    case 'cymbal':
      for (const ratio of [1, 1.3419, 1.7211, 2.0113, 2.4783, 2.9142]) {
        tone('square', lane.tune * ratio * 0.1, lane.tune * ratio * 0.1, 0.001, 0.04, decay)
      }
      noise('highpass', lane.tune * 0.6, 0.5, 0.3, decay)
      noise('bandpass', lane.tune * 1.6, 1.2, 0.2, decay * 0.7)
      break
    case 'cowbell':
      tone('square', lane.tune, lane.tune, 0.001, 0.35, decay)
      tone('square', lane.tune * 1.5, lane.tune * 1.5, 0.001, 0.3, decay * 0.9)
      break
  }

  const first = sources[0]
  if (first) disconnectWhenDone(first, owned)

  return {
    endsAt: end,
    release(at: number) {
      // Drums are one-shots; a release is a choke, so cut it short quickly
      // rather than letting the tail finish.
      const cutoff = at + 0.012
      if (typeof output.gain.cancelAndHoldAtTime === 'function') output.gain.cancelAndHoldAtTime(at)
      else output.gain.cancelScheduledValues(at)
      output.gain.setValueAtTime(Math.max(output.gain.value, SILENCE), at)
      output.gain.exponentialRampToValueAtTime(SILENCE, cutoff)
      for (const source of sources) {
        try {
          source.stop(cutoff + 0.005)
        } catch {
          // Already stopped.
        }
      }
    },
    dispose: () => disconnectAll(owned),
  }
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

const reversedBuffers = new WeakMap<AudioBuffer, AudioBuffer>()

function reverseBuffer(context: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const cached = reversedBuffers.get(buffer)
  if (cached && cached.sampleRate === context.sampleRate) return cached
  const copy = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel)
    const target = copy.getChannelData(channel)
    for (let index = 0; index < source.length; index++) target[index] = source[source.length - 1 - index] ?? 0
  }
  reversedBuffers.set(buffer, copy)
  return copy
}

function samplerVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: SamplerInstrument,
  request: NoteRequest,
): VoiceHandle | null {
  const raw = request.buffer
  if (!raw) return null
  const buffer = instrument.reverse ? reverseBuffer(context, raw) : raw
  const { when, hold } = request

  const rate = instrument.fixedPitch ? 1 : Math.pow(2, (request.pitch - (noteToMidi(instrument.root) ?? 60)) / 12)

  const source = context.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = clamp(rate, 0.0625, 16)
  source.loop = instrument.loop

  const startOffset = clamp(instrument.start, 0, 0.999) * buffer.duration
  const endOffset = clamp(instrument.end, 0.001, 1) * buffer.duration
  if (instrument.loop) {
    source.loopStart = startOffset
    source.loopEnd = endOffset
  }

  const amplitude = context.createGain()
  amplitude.gain.value = 0
  source.connect(amplitude)
  amplitude.connect(destination)

  const peak = request.velocity * dbToGain(instrument.gain)
  const naturalLength = (endOffset - startOffset) / source.playbackRate.value
  const held = instrument.loop ? hold : Math.min(hold, naturalLength)
  const end = scheduleEnvelope(amplitude.gain, instrument.amplitudeEnvelope, when, peak, held)

  source.start(when, startOffset, instrument.loop ? undefined : Math.max(endOffset - startOffset, 0.001))
  source.stop(end + 0.02)
  disconnectWhenDone(source, [source, amplitude])

  return {
    endsAt: end,
    release(at: number) {
      const released = releaseEnvelope(amplitude.gain, instrument.amplitudeEnvelope, at)
      try {
        source.stop(released + 0.02)
      } catch {
        // Already stopped.
      }
    },
    dispose: () => disconnectAll([source, amplitude]),
  }
}

// ---------------------------------------------------------------------------

export function startVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  request: NoteRequest,
): VoiceHandle | null {
  switch (instrument.type) {
    case 'synth':
      return synthVoice(context, destination, instrument, request)
    case 'fm':
      return fmVoice(context, destination, instrument, request)
    case 'drums': {
      const lane = request.lane
      if (!lane) return null
      return drumVoice(context, destination, lane, request)
    }
    case 'sampler':
      return samplerVoice(context, destination, instrument, request)
  }
}

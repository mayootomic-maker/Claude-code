/**
 * Every field a song file may omit has a value here.
 *
 * These are not placeholders — they are a usable instrument. Adding a track and
 * playing a note must make a sound you would keep, otherwise the first minute
 * with the app is spent fixing defaults instead of writing music.
 */
import type {
  DrumLane,
  DrumsInstrument,
  Effect,
  EffectType,
  Envelope,
  FmInstrument,
  Instrument,
  InstrumentType,
  Master,
  SamplerInstrument,
  SynthInstrument,
  Track,
} from './types'

export const TRACK_COLOURS = [
  '#64d2ff', '#ff8fa3', '#7ee787', '#ffd479', '#c39bff', '#5ce0c8', '#ff9f68', '#8ab4ff',
] as const

export function envelope(attack: number, decay: number, sustain: number, release: number): Envelope {
  return { attack, decay, sustain, release }
}

export function defaultSynth(): SynthInstrument {
  return {
    type: 'synth',
    oscillators: [
      { wave: 'sawtooth', level: 0.7, octave: 0, detune: 0 },
      { wave: 'square', level: 0.25, octave: -1, detune: 7 },
    ],
    noise: 0,
    filter: { mode: 'lowpass', frequency: 2400, resonance: 4, envelope: 24, keyTracking: 0.35 },
    filterEnvelope: envelope(0.005, 0.28, 0.35, 0.2),
    amplitudeEnvelope: envelope(0.006, 0.15, 0.75, 0.22),
    lfo: { wave: 'sine', rate: 5, sync: null, toPitch: 0, toFilter: 0, toAmplitude: 0 },
    unison: { voices: 1, detune: 12, width: 0.5 },
    glide: 0,
    mono: false,
    gain: 0,
  }
}

export function defaultFm(): FmInstrument {
  return {
    type: 'fm',
    carrier: { wave: 'sine', ratio: 1 },
    modulator: { wave: 'sine', ratio: 2, index: 3, envelope: envelope(0.001, 0.4, 0.1, 0.2) },
    amplitudeEnvelope: envelope(0.002, 0.9, 0.15, 0.4),
    gain: 0,
  }
}

/** A general-purpose kit: the eight lanes most patterns actually use. */
export function defaultDrumKit(): DrumsInstrument {
  const lane = (
    id: string,
    name: string,
    voice: DrumLane['voice'],
    tune: number,
    decay: number,
    snap: number,
    level: number,
    pan = 0,
    choke = 0,
  ): DrumLane => ({ id, name, voice, tune, decay, snap, level, pan, choke })
  return {
    type: 'drums',
    lanes: [
      lane('kick', 'Kick', 'kick', 52, 0.36, 0.6, 0),
      lane('snare', 'Snare', 'snare', 190, 0.18, 0.5, -2),
      lane('clap', 'Clap', 'clap', 1100, 0.16, 0.4, -5, 0.12),
      lane('hat', 'Hi-hat', 'hat', 8200, 0.045, 0.7, -9, -0.15, 1),
      lane('open', 'Open hat', 'hat', 7400, 0.34, 0.5, -11, -0.15, 1),
      lane('rim', 'Rim', 'rim', 420, 0.05, 0.8, -10, 0.22),
      lane('tom', 'Tom', 'tom', 120, 0.3, 0.4, -6, 0.3),
      lane('ride', 'Cymbal', 'cymbal', 5200, 0.9, 0.3, -14, 0.2),
    ],
    gain: 0,
  }
}

export function defaultSampler(): SamplerInstrument {
  return {
    type: 'sampler',
    sample: '',
    root: 'C4',
    loop: false,
    start: 0,
    end: 1,
    fixedPitch: false,
    reverse: false,
    amplitudeEnvelope: envelope(0.002, 0.1, 1, 0.08),
    gain: 0,
  }
}

export function defaultInstrument(type: InstrumentType): Instrument {
  switch (type) {
    case 'synth':
      return defaultSynth()
    case 'fm':
      return defaultFm()
    case 'drums':
      return defaultDrumKit()
    case 'sampler':
      return defaultSampler()
  }
}

export function defaultEffect(type: EffectType): Effect {
  switch (type) {
    case 'filter':
      return { type, enabled: true, mode: 'lowpass', frequency: 6000, resonance: 1 }
    case 'drive':
      return { type, enabled: true, amount: 0.3, tone: 0.6, mix: 1 }
    case 'chorus':
      return { type, enabled: true, rate: 0.7, depth: 0.4, mix: 0.4 }
    case 'delay':
      return { type, enabled: true, time: '3/16', feedback: 0.35, mix: 0.25, pingPong: true }
    case 'reverb':
      return { type, enabled: true, size: 0.6, damping: 0.4, mix: 0.25 }
    case 'compressor':
      return { type, enabled: true, threshold: -18, ratio: 4, attack: 0.005, release: 0.12 }
    case 'eq':
      return { type, enabled: true, low: 0, mid: 0, middleFrequency: 1000, high: 0 }
    case 'crush':
      return { type, enabled: true, bits: 8, mix: 0.5 }
  }
}

export function defaultMaster(): Master {
  return {
    gain: -1,
    limiter: true,
    delay: { time: '3/16', feedback: 0.34, mix: 1, pingPong: true },
    reverb: { size: 0.72, damping: 0.35, mix: 1 },
  }
}

export function defaultTrack(id: string, name: string, instrument: Instrument, index: number): Track {
  return {
    id,
    name,
    colour: TRACK_COLOURS[index % TRACK_COLOURS.length] ?? '#64d2ff',
    instrument,
    effects: [],
    gain: -6,
    pan: 0,
    mute: false,
    solo: false,
    sends: { delay: 0, reverb: 0 },
    automation: [],
  }
}

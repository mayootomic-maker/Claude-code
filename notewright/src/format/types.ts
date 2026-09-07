/**
 * The song document.
 *
 * One rule governs every decision here: the file is the source of truth, and a
 * person has to be able to read it. So there is no preset indirection (a track
 * stores its whole instrument, not a name that means something elsewhere), no
 * binary blobs, and every field is in a unit a musician recognises — hertz,
 * decibels, beats, semitones.
 */
import type { Note } from './notation'

export const FORMAT = 'notewright/1'

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export interface Envelope {
  /** Seconds. */
  attack: number
  decay: number
  /** 0-1 of peak. */
  sustain: number
  release: number
}

export const WAVES = ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'supersaw'] as const
export type Wave = (typeof WAVES)[number]

export interface Oscillator {
  wave: Wave
  /** 0-1. */
  level: number
  /** Whole octaves. */
  octave: number
  /** Cents. */
  detune: number
}

export const FILTER_MODES = ['lowpass', 'highpass', 'bandpass', 'notch'] as const
export type FilterMode = (typeof FILTER_MODES)[number]

export interface SynthInstrument {
  type: 'synth'
  oscillators: [Oscillator, Oscillator]
  /** 0-1 white noise mixed in before the filter; the grit in a snare or a pad. */
  noise: number
  filter: {
    mode: FilterMode
    /** Hz. */
    frequency: number
    resonance: number
    /** Semitones the envelope opens the cutoff by. */
    envelope: number
    /** 0-1: how much the played pitch moves the cutoff with it. */
    keyTracking: number
  }
  filterEnvelope: Envelope
  amplitudeEnvelope: Envelope
  lfo: {
    wave: Exclude<Wave, 'pulse' | 'supersaw'>
    /** Hz, or a note division when `sync` names one. */
    rate: number
    sync: string | null
    /** Semitones. */
    toPitch: number
    /** Semitones of cutoff. */
    toFilter: number
    /** 0-1. */
    toAmplitude: number
  }
  unison: {
    voices: number
    /** Cents of spread between unison voices. */
    detune: number
    /** 0-1 stereo width. */
    width: number
  }
  /** Seconds to slide between pitches. Only audible when `mono`. */
  glide: number
  mono: boolean
  /** dB trim. */
  gain: number
}

export interface FmInstrument {
  type: 'fm'
  carrier: { wave: Exclude<Wave, 'pulse' | 'supersaw'>; ratio: number }
  modulator: {
    wave: Exclude<Wave, 'pulse' | 'supersaw'>
    ratio: number
    /** Modulation index — how far the modulator pushes the carrier. */
    index: number
    envelope: Envelope
  }
  amplitudeEnvelope: Envelope
  gain: number
}

export const DRUM_VOICES = ['kick', 'snare', 'hat', 'clap', 'tom', 'rim', 'cymbal', 'cowbell'] as const
export type DrumVoice = (typeof DRUM_VOICES)[number]

export interface DrumLane {
  /** Stable id used as the key in a pattern's `lanes` map. */
  id: string
  name: string
  voice: DrumVoice
  /** Hz for pitched voices, the noise centre for the rest. */
  tune: number
  /** Seconds. */
  decay: number
  /** Attack transient, 0-1: the click on a kick, the crack on a snare. */
  snap: number
  /** dB. */
  level: number
  /** -1 to 1. */
  pan: number
  /** Lanes in the same choke group cut each other off, as a hi-hat pedal does. */
  choke: number
}

export interface DrumsInstrument {
  type: 'drums'
  lanes: DrumLane[]
  gain: number
}

/**
 * The 808.
 *
 * Not a synth preset — its own instrument, because it is the centre of this
 * kind of music and because two of its defining behaviours cannot be expressed
 * as parameters on anything else. The pitch falls at the attack, which is what
 * makes the boom; and a note that begins while the last one is still sounding
 * does not retrigger, it *bends* — the slide. A slide implemented by starting a
 * second voice and cutting the first would click, because the waveform would
 * jump. Here it retunes the oscillator that is already running.
 */
export interface Eight808Instrument {
  type: '808'
  /** Semitones the pitch falls from at the attack. Zero is a plain sub. */
  drop: number
  /** Seconds the drop takes. */
  dropTime: number
  /** Seconds a slide takes to travel between two pitches. */
  glide: number
  /** 0-1 saturation. Harmonics are what make a 30Hz note audible on a phone. */
  drive: number
  /** Hz. Lowpass after the drive, so the harmonics stay warm rather than buzzy. */
  tone: number
  amplitudeEnvelope: Envelope
  gain: number
}

export interface SamplerInstrument {
  type: 'sampler'
  /** A path relative to the song, or `library:<name>` for a sample dropped into the app. */
  sample: string
  /** The pitch the sample plays back at unchanged. */
  root: string
  loop: boolean
  /** 0-1 of the sample's length. */
  start: number
  end: number
  /** Play the sample at its recorded speed regardless of the note. */
  fixedPitch: boolean
  reverse: boolean
  amplitudeEnvelope: Envelope
  gain: number
}

export type Instrument =
  | SynthInstrument
  | FmInstrument
  | DrumsInstrument
  | SamplerInstrument
  | Eight808Instrument
export type InstrumentType = Instrument['type']

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EffectBase {
  enabled: boolean
}

export type Effect =
  | (EffectBase & { type: 'filter'; mode: FilterMode; frequency: number; resonance: number })
  | (EffectBase & { type: 'drive'; amount: number; tone: number; mix: number })
  | (EffectBase & { type: 'chorus'; rate: number; depth: number; mix: number })
  | (EffectBase & { type: 'delay'; time: string; feedback: number; mix: number; pingPong: boolean })
  | (EffectBase & { type: 'reverb'; size: number; damping: number; mix: number })
  | (EffectBase & { type: 'compressor'; threshold: number; ratio: number; attack: number; release: number })
  | (EffectBase & { type: 'eq'; low: number; mid: number; middleFrequency: number; high: number })
  | (EffectBase & { type: 'crush'; bits: number; mix: number })

export type EffectType = Effect['type']

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export interface AutomationPoint {
  /** Beats from the start of the song. */
  at: number
  value: number
}

export interface Automation {
  /** `gain`, `pan`, `sends.reverb`, `instrument.filter.frequency`, `effects.2.mix`. */
  target: string
  points: AutomationPoint[]
}

// ---------------------------------------------------------------------------
// Tracks, patterns, arrangement
// ---------------------------------------------------------------------------

/**
 * Ducking, driven by the sequencer rather than by a sidechain.
 *
 * An 808 and a kick occupy the same two octaves and fight; every producer in
 * this genre ducks one under the other. Web Audio has no sidechain input on its
 * compressor, and a worklet would be a module that has to load before the first
 * note. But the sequencer already knows exactly when the kick lands, so the
 * dips can simply be scheduled — which is sample-accurate, renders identically
 * every time, and costs nothing.
 */
export interface Duck {
  /** The track whose hits trigger the dip. */
  from: string
  /** Restrict to one drum lane, usually the kick. Empty means any hit. */
  lane: string
  /** 0-1: how far the level drops. 0.7 is a deep, obvious pump. */
  amount: number
  /** Seconds to recover. */
  release: number
}

export interface Track {
  id: string
  name: string
  colour: string
  instrument: Instrument
  effects: Effect[]
  /** dB. */
  gain: number
  /** -1 to 1. */
  pan: number
  mute: boolean
  solo: boolean
  sends: { delay: number; reverb: number }
  automation: Automation[]
  duck: Duck | null
}

export interface Pattern {
  id: string
  /** The track this pattern plays on, which is what gives it an instrument. */
  track: string
  bars: number
  grid: string
  /** Melodic content. Drum tracks use `lanes` instead. */
  notes: Note[]
  /** Drum content, keyed by lane id. */
  lanes: Record<string, Note[]>
  /**
   * True when the file wrote this pattern as explicit note objects because the
   * notes did not fit the grid. Kept so a save does not silently re-grid them.
   */
  offGrid: boolean
}

export interface Clip {
  pattern: string
  /** Bars from the start of the section. */
  at: number
  /** How many times to repeat. `null` fills the rest of the section. */
  times: number | null
  /** Semitones. */
  transpose: number
}

export interface Section {
  id: string
  name: string
  bars: number
  clips: Clip[]
}

export interface Master {
  /** dB. */
  gain: number
  limiter: boolean
  delay: { time: string; feedback: number; mix: number; pingPong: boolean }
  reverb: { size: number; damping: number; mix: number }
}

export interface Song {
  format: string
  title: string
  artist: string
  tempo: number
  /** `4/4`, `6/8`, `7/8`. */
  timeSignature: string
  key: string
  /** 0-1 shuffle applied to off-beat sixteenths. */
  swing: number
  master: Master
  tracks: Track[]
  patterns: Pattern[]
  sections: Section[]
}

/** Beats per bar, from the time signature. A `6/8` bar is three quarter notes. */
export function beatsPerBar(timeSignature: string): number {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature.trim())
  if (!match) return 4
  const [, count = '4', unit = '4'] = match
  const beats = (Number(count) * 4) / Number(unit)
  return Number.isFinite(beats) && beats > 0 ? beats : 4
}

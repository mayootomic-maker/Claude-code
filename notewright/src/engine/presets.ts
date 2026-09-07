/**
 * Starting points.
 *
 * A preset is copied into the song the moment it is chosen — the file never
 * refers to one by name. That costs a few lines of JSON per track and buys
 * something worth much more: a song file that still sounds the same in a year,
 * on a machine that has never seen this preset list.
 */
import { default808, defaultDrumKit, defaultFm, defaultSampler, defaultSynth, envelope } from '../format/defaults'
import type { Instrument } from '../format/types'

export interface Preset {
  id: string
  name: string
  group: string
  instrument: Instrument
}

function synth(changes: (base: ReturnType<typeof defaultSynth>) => void): Instrument {
  const base = defaultSynth()
  changes(base)
  return base
}

function fm(changes: (base: ReturnType<typeof defaultFm>) => void): Instrument {
  const base = defaultFm()
  changes(base)
  return base
}

function kit(changes: (base: ReturnType<typeof defaultDrumKit>) => void): Instrument {
  const base = defaultDrumKit()
  changes(base)
  return base
}

function eight808(changes: (base: ReturnType<typeof default808>) => void): Instrument {
  const base = default808()
  changes(base)
  return base
}

/** Sets one lane of a kit by id, leaving the rest of the kit alone. */
function lane(
  base: ReturnType<typeof defaultDrumKit>,
  id: string,
  changes: Partial<ReturnType<typeof defaultDrumKit>['lanes'][number]>,
): void {
  const target = base.lanes.find((candidate) => candidate.id === id)
  if (target) Object.assign(target, changes)
}

export const PRESETS: readonly Preset[] = [
  // --- 808 ------------------------------------------------------------------
  {
    id: 'eight-oh-eight-deep',
    name: '808 — Deep',
    group: '808',
    instrument: eight808((base) => {
      base.drop = 12
      base.dropTime = 0.045
      base.glide = 0.07
      base.drive = 0.32
      base.tone = 2100
      base.amplitudeEnvelope = envelope(0.004, 1.8, 0.62, 0.16)
    }),
  },
  {
    id: 'eight-oh-eight-distorted',
    name: '808 — Distorted',
    group: '808',
    instrument: eight808((base) => {
      base.drop = 16
      base.dropTime = 0.03
      base.glide = 0.06
      base.drive = 0.82
      base.tone = 3600
      base.amplitudeEnvelope = envelope(0.003, 1.2, 0.5, 0.12)
    }),
  },
  {
    id: 'eight-oh-eight-punch',
    name: '808 — Short Punch',
    group: '808',
    instrument: eight808((base) => {
      base.drop = 22
      base.dropTime = 0.018
      base.glide = 0.04
      base.drive = 0.5
      base.tone = 2800
      base.amplitudeEnvelope = envelope(0.002, 0.45, 0.18, 0.08)
    }),
  },
  {
    id: 'eight-oh-eight-glide',
    name: '808 — Long Slide',
    group: '808',
    instrument: eight808((base) => {
      base.drop = 8
      base.dropTime = 0.05
      base.glide = 0.16
      base.drive = 0.4
      base.tone = 2400
      base.amplitudeEnvelope = envelope(0.005, 2.4, 0.75, 0.2)
    }),
  },

  // --- Bass -----------------------------------------------------------------
  {
    id: 'sub-bass',
    name: 'Sub Bass',
    group: 'Bass',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sine', level: 0.9, octave: 0, detune: 0 },
        { wave: 'triangle', level: 0.2, octave: 0, detune: 0 },
      ]
      base.filter = { mode: 'lowpass', frequency: 400, resonance: 0.7, envelope: 0, keyTracking: 0.4 }
      base.amplitudeEnvelope = envelope(0.008, 0.1, 0.9, 0.09)
      base.mono = true
      base.glide = 0.03
    }),
  },
  {
    id: 'acid-bass',
    name: 'Acid Bass',
    group: 'Bass',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.85, octave: 0, detune: 0 },
        { wave: 'square', level: 0, octave: 0, detune: 0 },
      ]
      base.filter = { mode: 'lowpass', frequency: 320, resonance: 12, envelope: 34, keyTracking: 0.3 }
      base.filterEnvelope = envelope(0.002, 0.18, 0.05, 0.1)
      base.amplitudeEnvelope = envelope(0.004, 0.2, 0.7, 0.08)
      base.mono = true
      base.glide = 0.05
    }),
  },
  {
    id: 'reese-bass',
    name: 'Reese Bass',
    group: 'Bass',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.6, octave: 0, detune: -14 },
        { wave: 'sawtooth', level: 0.6, octave: 0, detune: 16 },
      ]
      base.filter = { mode: 'lowpass', frequency: 700, resonance: 3, envelope: 6, keyTracking: 0.25 }
      base.amplitudeEnvelope = envelope(0.01, 0.3, 0.85, 0.15)
      base.unison = { voices: 3, detune: 9, width: 0.35 }
    }),
  },
  {
    id: 'fm-bass',
    name: 'FM Bass',
    group: 'Bass',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'sine', ratio: 1, index: 4.5, envelope: envelope(0.001, 0.12, 0, 0.05) }
      base.amplitudeEnvelope = envelope(0.003, 0.35, 0.55, 0.08)
      base.gain = 2
    }),
  },

  // --- Keys -----------------------------------------------------------------
  {
    id: 'electric-piano',
    name: 'Electric Piano',
    group: 'Keys',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'sine', ratio: 2, index: 2.6, envelope: envelope(0.001, 0.5, 0.04, 0.3) }
      base.amplitudeEnvelope = envelope(0.002, 1.6, 0.12, 0.5)
      base.gain = 2
    }),
  },
  {
    id: 'bell',
    name: 'Bell',
    group: 'Keys',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'sine', ratio: 3.51, index: 5, envelope: envelope(0.001, 1.2, 0.02, 0.8) }
      base.amplitudeEnvelope = envelope(0.001, 2.2, 0.05, 1.4)
    }),
  },
  {
    id: 'marimba',
    name: 'Marimba',
    group: 'Keys',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'sine', ratio: 4, index: 3.2, envelope: envelope(0.001, 0.07, 0, 0.05) }
      base.amplitudeEnvelope = envelope(0.001, 0.42, 0.02, 0.2)
      base.gain = 3
    }),
  },
  {
    id: 'organ',
    name: 'Organ',
    group: 'Keys',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'square', level: 0.5, octave: 0, detune: 0 },
        { wave: 'square', level: 0.35, octave: 1, detune: 3 },
      ]
      base.filter = { mode: 'lowpass', frequency: 5200, resonance: 0.7, envelope: 0, keyTracking: 0.5 }
      base.amplitudeEnvelope = envelope(0.006, 0.02, 1, 0.06)
    }),
  },

  // --- Pads and strings -----------------------------------------------------
  {
    id: 'warm-pad',
    name: 'Warm Pad',
    group: 'Pads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.45, octave: 0, detune: -8 },
        { wave: 'sawtooth', level: 0.45, octave: 0, detune: 9 },
      ]
      base.filter = { mode: 'lowpass', frequency: 1500, resonance: 1.4, envelope: 14, keyTracking: 0.4 }
      base.filterEnvelope = envelope(1.2, 2, 0.5, 1.4)
      base.amplitudeEnvelope = envelope(0.9, 1.5, 0.85, 1.6)
      base.unison = { voices: 3, detune: 14, width: 0.7 }
      base.gain = -2
    }),
  },
  {
    id: 'glass-pad',
    name: 'Glass Pad',
    group: 'Pads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'triangle', level: 0.6, octave: 0, detune: 0 },
        { wave: 'sine', level: 0.4, octave: 1, detune: 6 },
      ]
      base.filter = { mode: 'lowpass', frequency: 4200, resonance: 0.9, envelope: 10, keyTracking: 0.6 }
      base.filterEnvelope = envelope(1.6, 2.4, 0.6, 2 )
      base.amplitudeEnvelope = envelope(1.4, 2, 0.9, 2.2)
      base.lfo = { wave: 'sine', rate: 0.28, sync: null, toPitch: 0.06, toFilter: 4, toAmplitude: 0 }
      base.unison = { voices: 2, detune: 10, width: 0.8 }
    }),
  },
  {
    id: 'strings',
    name: 'Strings',
    group: 'Pads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.7, octave: 0, detune: 0 },
        { wave: 'sawtooth', level: 0.3, octave: -1, detune: -6 },
      ]
      base.filter = { mode: 'lowpass', frequency: 2600, resonance: 1.1, envelope: 8, keyTracking: 0.55 }
      base.filterEnvelope = envelope(0.4, 1.2, 0.6, 0.9)
      base.amplitudeEnvelope = envelope(0.32, 0.9, 0.9, 0.7)
      base.unison = { voices: 5, detune: 13, width: 0.85 }
      base.gain = -3
    }),
  },

  // --- Leads ----------------------------------------------------------------
  {
    id: 'supersaw-lead',
    name: 'Supersaw Lead',
    group: 'Leads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'supersaw', level: 0.8, octave: 0, detune: 0 },
        { wave: 'sawtooth', level: 0.2, octave: -1, detune: 0 },
      ]
      base.filter = { mode: 'lowpass', frequency: 3400, resonance: 2, envelope: 12, keyTracking: 0.5 }
      base.filterEnvelope = envelope(0.02, 0.5, 0.6, 0.35)
      base.amplitudeEnvelope = envelope(0.012, 0.4, 0.8, 0.3)
      base.unison = { voices: 7, detune: 26, width: 0.9 }
      base.gain = -4
    }),
  },
  {
    id: 'pluck',
    name: 'Pluck',
    group: 'Leads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.7, octave: 0, detune: -5 },
        { wave: 'square', level: 0.3, octave: 0, detune: 7 },
      ]
      base.filter = { mode: 'lowpass', frequency: 900, resonance: 6, envelope: 30, keyTracking: 0.6 }
      base.filterEnvelope = envelope(0.001, 0.16, 0.06, 0.12)
      base.amplitudeEnvelope = envelope(0.002, 0.34, 0.12, 0.22)
      base.unison = { voices: 2, detune: 8, width: 0.4 }
    }),
  },
  {
    id: 'square-lead',
    name: 'Square Lead',
    group: 'Leads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'pulse', level: 0.75, octave: 0, detune: 0 },
        { wave: 'pulse', level: 0.35, octave: 0, detune: 11 },
      ]
      base.filter = { mode: 'lowpass', frequency: 3000, resonance: 3, envelope: 10, keyTracking: 0.7 }
      base.amplitudeEnvelope = envelope(0.006, 0.2, 0.75, 0.12)
      base.lfo = { wave: 'sine', rate: 5.4, sync: null, toPitch: 0.12, toFilter: 0, toAmplitude: 0 }
      base.mono = true
      base.glide = 0.04
    }),
  },
  {
    id: 'brass',
    name: 'Brass',
    group: 'Leads',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.6, octave: 0, detune: -4 },
        { wave: 'sawtooth', level: 0.5, octave: 0, detune: 6 },
      ]
      base.filter = { mode: 'lowpass', frequency: 800, resonance: 2.5, envelope: 26, keyTracking: 0.5 }
      base.filterEnvelope = envelope(0.09, 0.5, 0.55, 0.3)
      base.amplitudeEnvelope = envelope(0.05, 0.3, 0.9, 0.25)
    }),
  },

  // --- Texture --------------------------------------------------------------
  {
    id: 'noise-sweep',
    name: 'Noise Sweep',
    group: 'Texture',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sine', level: 0, octave: 0, detune: 0 },
        { wave: 'sine', level: 0, octave: 0, detune: 0 },
      ]
      base.noise = 1
      base.filter = { mode: 'bandpass', frequency: 700, resonance: 2.6, envelope: 44, keyTracking: 0.2 }
      base.filterEnvelope = envelope(2.6, 0.4, 1, 0.6)
      base.amplitudeEnvelope = envelope(1.8, 0.5, 0.9, 0.7)
      base.gain = -3
    }),
  },
  {
    id: 'wobble',
    name: 'Wobble',
    group: 'Texture',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.7, octave: -1, detune: -7 },
        { wave: 'square', level: 0.4, octave: -1, detune: 8 },
      ]
      base.filter = { mode: 'lowpass', frequency: 320, resonance: 9, envelope: 8, keyTracking: 0.2 }
      base.lfo = { wave: 'triangle', rate: 3.9, sync: null, toPitch: 0, toFilter: 30, toAmplitude: 0 }
      base.amplitudeEnvelope = envelope(0.01, 0.2, 0.9, 0.14)
    }),
  },

  // --- Kits -----------------------------------------------------------------
  { id: 'studio-kit', name: 'Studio Kit', group: 'Drums', instrument: defaultDrumKit() },
  {
    id: 'trap-kit',
    name: 'Trap Kit',
    group: 'Drums',
    instrument: kit((base) => {
      // The kick is short and punchy on purpose: in this music the 808 carries
      // the weight below 80Hz, and a long kick underneath it turns the low end
      // into mud no amount of mixing recovers.
      lane(base, 'kick', { tune: 48, decay: 0.26, snap: 0.85, level: 0 })
      lane(base, 'snare', { tune: 208, decay: 0.13, snap: 0.75, level: -3 })
      lane(base, 'clap', { tune: 1150, decay: 0.2, snap: 0.5, level: -4 })
      lane(base, 'hat', { tune: 9800, decay: 0.024, snap: 0.9, level: -12 })
      lane(base, 'open', { tune: 8600, decay: 0.2, snap: 0.6, level: -15 })
      lane(base, 'rim', { tune: 520, decay: 0.032, snap: 0.95, level: -12 })
      lane(base, 'tom', { tune: 88, decay: 0.34, snap: 0.3, level: -9 })
      lane(base, 'ride', { tune: 6200, decay: 0.6, snap: 0.3, level: -20 })
    }),
  },
  {
    id: 'trap-kit-dark',
    name: 'Trap Kit — Dark',
    group: 'Drums',
    instrument: kit((base) => {
      lane(base, 'kick', { tune: 44, decay: 0.3, snap: 0.6, level: 0 })
      lane(base, 'snare', { tune: 180, decay: 0.11, snap: 0.55, level: -5 })
      lane(base, 'clap', { tune: 900, decay: 0.17, snap: 0.35, level: -5 })
      lane(base, 'hat', { tune: 7400, decay: 0.022, snap: 0.7, level: -14 })
      lane(base, 'open', { tune: 6800, decay: 0.18, snap: 0.45, level: -17 })
      lane(base, 'rim', { tune: 430, decay: 0.03, snap: 0.8, level: -13 })
      lane(base, 'tom', { tune: 76, decay: 0.4, snap: 0.2, level: -10 })
      lane(base, 'ride', { tune: 4800, decay: 0.7, snap: 0.2, level: -22 })
    }),
  },
  {
    id: 'eight-oh-eight',
    name: '808 Kit',
    group: 'Drums',
    instrument: kit((base) => {
      const set = (id: string, changes: Partial<(typeof base.lanes)[number]>): void => {
        const lane = base.lanes.find((candidate) => candidate.id === id)
        if (lane) Object.assign(lane, changes)
      }
      set('kick', { tune: 44, decay: 1.1, snap: 0.35, level: 0 })
      set('snare', { tune: 172, decay: 0.22, snap: 0.55, level: -4 })
      set('clap', { tune: 1000, decay: 0.24, snap: 0.4, level: -5 })
      set('hat', { tune: 9200, decay: 0.03, snap: 0.8, level: -10 })
      set('open', { tune: 8400, decay: 0.5, snap: 0.5, level: -13 })
      set('rim', { tune: 460, decay: 0.04, snap: 0.9, level: -9 })
      set('tom', { tune: 98, decay: 0.5, snap: 0.25, level: -7 })
      set('ride', { tune: 5600, decay: 1.3, snap: 0.25, level: -16 })
    }),
  },
  {
    id: 'nine-oh-nine',
    name: '909 Kit',
    group: 'Drums',
    instrument: kit((base) => {
      const set = (id: string, changes: Partial<(typeof base.lanes)[number]>): void => {
        const lane = base.lanes.find((candidate) => candidate.id === id)
        if (lane) Object.assign(lane, changes)
      }
      set('kick', { tune: 58, decay: 0.32, snap: 0.75, level: 0 })
      set('snare', { tune: 205, decay: 0.16, snap: 0.7, level: -2 })
      set('clap', { tune: 1250, decay: 0.14, snap: 0.5, level: -6 })
      set('hat', { tune: 8800, decay: 0.038, snap: 0.85, level: -8 })
      set('open', { tune: 7800, decay: 0.28, snap: 0.6, level: -11 })
      set('tom', { tune: 145, decay: 0.24, snap: 0.5, level: -7 })
      set('ride', { tune: 5400, decay: 0.75, snap: 0.35, level: -14 })
    }),
  },
  {
    id: 'lofi-kit',
    name: 'Lo-fi Kit',
    group: 'Drums',
    instrument: kit((base) => {
      const set = (id: string, changes: Partial<(typeof base.lanes)[number]>): void => {
        const lane = base.lanes.find((candidate) => candidate.id === id)
        if (lane) Object.assign(lane, changes)
      }
      set('kick', { tune: 62, decay: 0.26, snap: 0.3, level: -1 })
      set('snare', { tune: 168, decay: 0.13, snap: 0.3, level: -4 })
      set('hat', { tune: 6200, decay: 0.03, snap: 0.4, level: -13 })
      set('open', { tune: 5600, decay: 0.2, snap: 0.3, level: -15 })
      set('rim', { tune: 380, decay: 0.05, snap: 0.6, level: -11 })
      set('ride', { tune: 4200, decay: 0.6, snap: 0.2, level: -18 })
    }),
  },

  // --- Melody over 808s -----------------------------------------------------
  {
    id: 'trap-bell',
    name: 'Trap Bell',
    group: 'Melody',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'sine', ratio: 2.01, index: 4.2, envelope: envelope(0.001, 0.55, 0.05, 0.3) }
      base.amplitudeEnvelope = envelope(0.002, 1.5, 0.06, 0.7)
      base.gain = 1
    }),
  },
  {
    id: 'dark-pluck',
    name: 'Dark Pluck',
    group: 'Melody',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.62, octave: 0, detune: -9 },
        { wave: 'sawtooth', level: 0.38, octave: 0, detune: 11 },
      ]
      base.filter = { mode: 'lowpass', frequency: 620, resonance: 7, envelope: 26, keyTracking: 0.55 }
      base.filterEnvelope = envelope(0.001, 0.2, 0.04, 0.15)
      base.amplitudeEnvelope = envelope(0.002, 0.4, 0.1, 0.26)
      base.unison = { voices: 3, detune: 11, width: 0.55 }
      base.gain = -2
    }),
  },
  {
    id: 'choir-pad',
    name: 'Choir Pad',
    group: 'Melody',
    instrument: synth((base) => {
      base.oscillators = [
        { wave: 'sawtooth', level: 0.34, octave: 0, detune: -6 },
        { wave: 'triangle', level: 0.5, octave: 0, detune: 7 },
      ]
      base.noise = 0.06
      base.filter = { mode: 'lowpass', frequency: 1200, resonance: 1.2, envelope: 12, keyTracking: 0.45 }
      base.filterEnvelope = envelope(1.4, 2, 0.55, 1.6)
      base.amplitudeEnvelope = envelope(0.8, 1.6, 0.8, 1.5)
      base.lfo = { wave: 'sine', rate: 4.6, sync: null, toPitch: 0.09, toFilter: 3, toAmplitude: 0 }
      base.unison = { voices: 4, detune: 16, width: 0.8 }
      base.gain = -4
    }),
  },
  {
    id: 'soul-keys',
    name: 'Soul Keys',
    group: 'Melody',
    instrument: fm((base) => {
      base.carrier = { wave: 'sine', ratio: 1 }
      base.modulator = { wave: 'triangle', ratio: 1, index: 1.9, envelope: envelope(0.002, 0.7, 0.08, 0.4) }
      base.amplitudeEnvelope = envelope(0.004, 2.2, 0.14, 0.7)
      base.gain = 2
    }),
  },

  // --- Sampler --------------------------------------------------------------
  { id: 'sampler-one-shot', name: 'One-shot Sampler', group: 'Sampler', instrument: defaultSampler() },
  {
    id: 'sampler-loop',
    name: 'Looping Sampler',
    group: 'Sampler',
    instrument: { ...defaultSampler(), loop: true, amplitudeEnvelope: envelope(0.01, 0.1, 1, 0.12) },
  },
]

export const PRESET_GROUPS = [...new Set(PRESETS.map((preset) => preset.group))]

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** A fresh copy, so editing a track never reaches back into the preset list. */
export function instrumentFromPreset(id: string): Instrument | null {
  const preset = presetById(id)
  return preset ? (structuredClone(preset.instrument) as Instrument) : null
}

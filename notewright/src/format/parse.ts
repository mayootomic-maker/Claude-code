/**
 * Reading a song file.
 *
 * Nothing in here throws. A song file can arrive from a text editor, a paste, a
 * different version of the app, or an agent that got a field name slightly
 * wrong — and in every one of those cases the right answer is to load what is
 * readable and say precisely what was not. Losing a whole arrangement because
 * one number was a string is not an option.
 */
import { noteToMidi } from '../engine/theory'
import {
  parseLane,
  parseNoteStream,
  quantiseVelocity,
  type Issue,
  type Note,
  type ParseResult,
} from './notation'
import {
  default808,
  defaultDrumKit,
  defaultEffect,
  defaultFm,
  defaultMaster,
  defaultSampler,
  defaultSynth,
  defaultTrack,
  TRACK_COLOURS,
} from './defaults'
import {
  beatsPerBar,
  DRUM_VOICES,
  FILTER_MODES,
  FORMAT,
  WAVES,
  type Automation,
  type Clip,
  type DrumLane,
  type DrumsInstrument,
  type Duck,
  type Effect,
  type Eight808Instrument,
  type EffectType,
  type Envelope,
  type FmInstrument,
  type Instrument,
  type Master,
  type Pattern,
  type SamplerInstrument,
  type Section,
  type Song,
  type SynthInstrument,
  type Track,
} from './types'

type Unknown = Record<string, unknown>

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class Reader {
  readonly issues: Issue[] = []

  note(message: string, where: string, severity: Issue['severity'] = 'warning'): void {
    this.issues.push({ severity, message, where })
  }

  number(value: unknown, where: string, fallback: number, min = -Infinity, max = Infinity): number {
    if (value === undefined || value === null) return fallback
    const parsed = typeof value === 'string' ? Number(value) : value
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      this.note(`Expected a number, kept ${fallback}`, where)
      return fallback
    }
    if (parsed < min || parsed > max) {
      const clamped = Math.min(max, Math.max(min, parsed))
      this.note(`${parsed} is outside ${min}…${max}, clamped to ${clamped}`, where)
      return clamped
    }
    return parsed
  }

  boolean(value: unknown, where: string, fallback: boolean): boolean {
    if (value === undefined || value === null) return fallback
    if (typeof value === 'boolean') return value
    this.note(`Expected true or false, kept ${fallback}`, where)
    return fallback
  }

  string(value: unknown, where: string, fallback: string): string {
    if (value === undefined || value === null) return fallback
    if (typeof value === 'string') return value
    this.note(`Expected text, kept "${fallback}"`, where)
    return fallback
  }

  choice<T extends string>(value: unknown, where: string, allowed: readonly T[], fallback: T): T {
    if (value === undefined || value === null) return fallback
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    this.note(`"${String(value)}" is not one of ${allowed.join(', ')}, kept "${fallback}"`, where)
    return fallback
  }

  array(value: unknown, where: string): unknown[] {
    if (value === undefined || value === null) return []
    if (Array.isArray(value)) return value
    this.note('Expected a list, ignored', where)
    return []
  }

  object(value: unknown, where: string): Unknown {
    if (isObject(value)) return value
    if (value !== undefined && value !== null) this.note('Expected an object, ignored', where)
    return {}
  }

  /** Folds a nested parse's issues in, keeping their location prefixed. */
  absorb<T>(result: ParseResult<T>, where: string): T {
    for (const issue of result.issues) {
      this.issues.push({ ...issue, where: issue.where ? `${where} (${issue.where})` : where })
    }
    return result.value
  }
}

function envelope(reader: Reader, value: unknown, where: string, fallback: Envelope): Envelope {
  const raw = reader.object(value, where)
  return {
    attack: reader.number(raw['attack'], `${where}.attack`, fallback.attack, 0, 30),
    decay: reader.number(raw['decay'], `${where}.decay`, fallback.decay, 0, 30),
    sustain: reader.number(raw['sustain'], `${where}.sustain`, fallback.sustain, 0, 1),
    release: reader.number(raw['release'], `${where}.release`, fallback.release, 0, 30),
  }
}

function synth(reader: Reader, raw: Unknown, where: string): SynthInstrument {
  const base = defaultSynth()
  const oscillators = reader.array(raw['oscillators'], `${where}.oscillators`)
  const readOscillator = (index: 0 | 1): SynthInstrument['oscillators'][number] => {
    const fallback = base.oscillators[index]
    const source = reader.object(oscillators[index], `${where}.oscillators[${index}]`)
    return {
      wave: reader.choice(source['wave'], `${where}.oscillators[${index}].wave`, WAVES, fallback.wave),
      level: reader.number(source['level'], `${where}.oscillators[${index}].level`, fallback.level, 0, 1),
      octave: Math.round(reader.number(source['octave'], `${where}.oscillators[${index}].octave`, fallback.octave, -4, 4)),
      detune: reader.number(source['detune'], `${where}.oscillators[${index}].detune`, fallback.detune, -1200, 1200),
    }
  }
  const filter = reader.object(raw['filter'], `${where}.filter`)
  const lfo = reader.object(raw['lfo'], `${where}.lfo`)
  const unison = reader.object(raw['unison'], `${where}.unison`)
  return {
    type: 'synth',
    oscillators: [readOscillator(0), readOscillator(1)],
    noise: reader.number(raw['noise'], `${where}.noise`, base.noise, 0, 1),
    filter: {
      mode: reader.choice(filter['mode'], `${where}.filter.mode`, FILTER_MODES, base.filter.mode),
      frequency: reader.number(filter['frequency'], `${where}.filter.frequency`, base.filter.frequency, 20, 20000),
      resonance: reader.number(filter['resonance'], `${where}.filter.resonance`, base.filter.resonance, 0.0001, 30),
      envelope: reader.number(filter['envelope'], `${where}.filter.envelope`, base.filter.envelope, -96, 96),
      keyTracking: reader.number(filter['keyTracking'], `${where}.filter.keyTracking`, base.filter.keyTracking, 0, 1),
    },
    filterEnvelope: envelope(reader, raw['filterEnvelope'], `${where}.filterEnvelope`, base.filterEnvelope),
    amplitudeEnvelope: envelope(reader, raw['amplitudeEnvelope'], `${where}.amplitudeEnvelope`, base.amplitudeEnvelope),
    lfo: {
      wave: reader.choice(lfo['wave'], `${where}.lfo.wave`, ['sine', 'triangle', 'sawtooth', 'square'] as const, base.lfo.wave),
      rate: reader.number(lfo['rate'], `${where}.lfo.rate`, base.lfo.rate, 0.01, 40),
      sync: typeof lfo['sync'] === 'string' ? lfo['sync'] : null,
      toPitch: reader.number(lfo['toPitch'], `${where}.lfo.toPitch`, base.lfo.toPitch, -48, 48),
      toFilter: reader.number(lfo['toFilter'], `${where}.lfo.toFilter`, base.lfo.toFilter, -96, 96),
      toAmplitude: reader.number(lfo['toAmplitude'], `${where}.lfo.toAmplitude`, base.lfo.toAmplitude, 0, 1),
    },
    unison: {
      voices: Math.round(reader.number(unison['voices'], `${where}.unison.voices`, base.unison.voices, 1, 7)),
      detune: reader.number(unison['detune'], `${where}.unison.detune`, base.unison.detune, 0, 100),
      width: reader.number(unison['width'], `${where}.unison.width`, base.unison.width, 0, 1),
    },
    glide: reader.number(raw['glide'], `${where}.glide`, base.glide, 0, 4),
    mono: reader.boolean(raw['mono'], `${where}.mono`, base.mono),
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 24),
  }
}

const SIMPLE_WAVES = ['sine', 'triangle', 'sawtooth', 'square'] as const

function fm(reader: Reader, raw: Unknown, where: string): FmInstrument {
  const base = defaultFm()
  const carrier = reader.object(raw['carrier'], `${where}.carrier`)
  const modulator = reader.object(raw['modulator'], `${where}.modulator`)
  return {
    type: 'fm',
    carrier: {
      wave: reader.choice(carrier['wave'], `${where}.carrier.wave`, SIMPLE_WAVES, base.carrier.wave),
      ratio: reader.number(carrier['ratio'], `${where}.carrier.ratio`, base.carrier.ratio, 0.01, 32),
    },
    modulator: {
      wave: reader.choice(modulator['wave'], `${where}.modulator.wave`, SIMPLE_WAVES, base.modulator.wave),
      ratio: reader.number(modulator['ratio'], `${where}.modulator.ratio`, base.modulator.ratio, 0.01, 32),
      index: reader.number(modulator['index'], `${where}.modulator.index`, base.modulator.index, 0, 64),
      envelope: envelope(reader, modulator['envelope'], `${where}.modulator.envelope`, base.modulator.envelope),
    },
    amplitudeEnvelope: envelope(reader, raw['amplitudeEnvelope'], `${where}.amplitudeEnvelope`, base.amplitudeEnvelope),
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 24),
  }
}

function drums(reader: Reader, raw: Unknown, where: string): DrumsInstrument {
  const base = defaultDrumKit()
  const supplied = reader.array(raw['lanes'], `${where}.lanes`)
  const lanes: DrumLane[] = supplied.map((entry, index) => {
    const fallback = base.lanes[index] ?? base.lanes[0]!
    const source = reader.object(entry, `${where}.lanes[${index}]`)
    const id = reader.string(source['id'], `${where}.lanes[${index}].id`, fallback.id)
    return {
      id,
      name: reader.string(source['name'], `${where}.lanes[${index}].name`, fallback.name),
      voice: reader.choice(source['voice'], `${where}.lanes[${index}].voice`, DRUM_VOICES, fallback.voice),
      tune: reader.number(source['tune'], `${where}.lanes[${index}].tune`, fallback.tune, 20, 18000),
      decay: reader.number(source['decay'], `${where}.lanes[${index}].decay`, fallback.decay, 0.005, 8),
      snap: reader.number(source['snap'], `${where}.lanes[${index}].snap`, fallback.snap, 0, 1),
      level: reader.number(source['level'], `${where}.lanes[${index}].level`, fallback.level, -60, 12),
      pan: reader.number(source['pan'], `${where}.lanes[${index}].pan`, fallback.pan, -1, 1),
      choke: Math.round(reader.number(source['choke'], `${where}.lanes[${index}].choke`, fallback.choke, 0, 8)),
    }
  })
  const seen = new Set<string>()
  const unique = lanes.filter((lane) => {
    if (seen.has(lane.id)) {
      reader.note(`Two lanes share the id "${lane.id}"; the later one is ignored`, `${where}.lanes`, 'error')
      return false
    }
    seen.add(lane.id)
    return true
  })
  return {
    type: 'drums',
    lanes: unique.length > 0 ? unique : base.lanes,
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 24),
  }
}

function sampler(reader: Reader, raw: Unknown, where: string): SamplerInstrument {
  const base = defaultSampler()
  const start = reader.number(raw['start'], `${where}.start`, base.start, 0, 1)
  const end = reader.number(raw['end'], `${where}.end`, base.end, 0, 1)
  if (end <= start) reader.note('The sample end is not after its start; using the whole sample', `${where}.end`)
  return {
    type: 'sampler',
    sample: reader.string(raw['sample'], `${where}.sample`, base.sample),
    root: reader.string(raw['root'], `${where}.root`, base.root),
    loop: reader.boolean(raw['loop'], `${where}.loop`, base.loop),
    start: end > start ? start : 0,
    end: end > start ? end : 1,
    fixedPitch: reader.boolean(raw['fixedPitch'], `${where}.fixedPitch`, base.fixedPitch),
    reverse: reader.boolean(raw['reverse'], `${where}.reverse`, base.reverse),
    amplitudeEnvelope: envelope(reader, raw['amplitudeEnvelope'], `${where}.amplitudeEnvelope`, base.amplitudeEnvelope),
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 24),
  }
}

function eight808(reader: Reader, raw: Unknown, where: string): Eight808Instrument {
  const base = default808()
  return {
    type: '808',
    drop: reader.number(raw['drop'], `${where}.drop`, base.drop, 0, 48),
    dropTime: reader.number(raw['dropTime'], `${where}.dropTime`, base.dropTime, 0.001, 1),
    glide: reader.number(raw['glide'], `${where}.glide`, base.glide, 0, 2),
    drive: reader.number(raw['drive'], `${where}.drive`, base.drive, 0, 1),
    tone: reader.number(raw['tone'], `${where}.tone`, base.tone, 60, 20000),
    amplitudeEnvelope: envelope(reader, raw['amplitudeEnvelope'], `${where}.amplitudeEnvelope`, base.amplitudeEnvelope),
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 24),
  }
}

function instrument(reader: Reader, value: unknown, where: string): Instrument {
  const raw = reader.object(value, where)
  const type = reader.choice(raw['type'], `${where}.type`, ['synth', 'fm', 'drums', 'sampler', '808'] as const, 'synth')
  switch (type) {
    case 'synth':
      return synth(reader, raw, where)
    case 'fm':
      return fm(reader, raw, where)
    case 'drums':
      return drums(reader, raw, where)
    case 'sampler':
      return sampler(reader, raw, where)
    case '808':
      return eight808(reader, raw, where)
  }
}

function duck(reader: Reader, value: unknown, where: string, tracks: readonly Track[], self: string): Duck | null {
  if (value === undefined || value === null) return null
  const raw = reader.object(value, where)
  const from = reader.string(raw['from'], `${where}.from`, '')
  if (from === '') {
    reader.note('Ducking needs a track to listen to; ignored', where, 'error')
    return null
  }
  if (from === self) {
    reader.note('A track cannot duck itself; ignored', where, 'error')
    return null
  }
  if (!tracks.some((candidate) => candidate.id === from)) {
    reader.note(`No track called "${from}", so this ducking does nothing`, where, 'error')
  }
  return {
    from,
    lane: reader.string(raw['lane'], `${where}.lane`, ''),
    amount: reader.number(raw['amount'], `${where}.amount`, 0.6, 0, 1),
    release: reader.number(raw['release'], `${where}.release`, 0.14, 0.01, 2),
  }
}

const EFFECT_TYPES: readonly EffectType[] = [
  'filter', 'drive', 'chorus', 'delay', 'reverb', 'compressor', 'eq', 'crush',
]

function effect(reader: Reader, value: unknown, where: string): Effect {
  const raw = reader.object(value, where)
  const type = reader.choice(raw['type'], `${where}.type`, EFFECT_TYPES, 'filter')
  const base = defaultEffect(type)
  const enabled = reader.boolean(raw['enabled'], `${where}.enabled`, base.enabled)
  switch (base.type) {
    case 'filter':
      return {
        type: 'filter',
        enabled,
        mode: reader.choice(raw['mode'], `${where}.mode`, FILTER_MODES, base.mode),
        frequency: reader.number(raw['frequency'], `${where}.frequency`, base.frequency, 20, 20000),
        resonance: reader.number(raw['resonance'], `${where}.resonance`, base.resonance, 0.0001, 30),
      }
    case 'drive':
      return {
        type: 'drive',
        enabled,
        amount: reader.number(raw['amount'], `${where}.amount`, base.amount, 0, 1),
        tone: reader.number(raw['tone'], `${where}.tone`, base.tone, 0, 1),
        mix: reader.number(raw['mix'], `${where}.mix`, base.mix, 0, 1),
      }
    case 'chorus':
      return {
        type: 'chorus',
        enabled,
        rate: reader.number(raw['rate'], `${where}.rate`, base.rate, 0.01, 12),
        depth: reader.number(raw['depth'], `${where}.depth`, base.depth, 0, 1),
        mix: reader.number(raw['mix'], `${where}.mix`, base.mix, 0, 1),
      }
    case 'delay':
      return {
        type: 'delay',
        enabled,
        time: reader.string(raw['time'], `${where}.time`, base.time),
        feedback: reader.number(raw['feedback'], `${where}.feedback`, base.feedback, 0, 0.95),
        mix: reader.number(raw['mix'], `${where}.mix`, base.mix, 0, 1),
        pingPong: reader.boolean(raw['pingPong'], `${where}.pingPong`, base.pingPong),
      }
    case 'reverb':
      return {
        type: 'reverb',
        enabled,
        size: reader.number(raw['size'], `${where}.size`, base.size, 0, 1),
        damping: reader.number(raw['damping'], `${where}.damping`, base.damping, 0, 1),
        mix: reader.number(raw['mix'], `${where}.mix`, base.mix, 0, 1),
      }
    case 'compressor':
      return {
        type: 'compressor',
        enabled,
        threshold: reader.number(raw['threshold'], `${where}.threshold`, base.threshold, -100, 0),
        ratio: reader.number(raw['ratio'], `${where}.ratio`, base.ratio, 1, 20),
        attack: reader.number(raw['attack'], `${where}.attack`, base.attack, 0, 1),
        release: reader.number(raw['release'], `${where}.release`, base.release, 0, 1),
      }
    case 'eq':
      return {
        type: 'eq',
        enabled,
        low: reader.number(raw['low'], `${where}.low`, base.low, -24, 24),
        mid: reader.number(raw['mid'], `${where}.mid`, base.mid, -24, 24),
        middleFrequency: reader.number(raw['middleFrequency'], `${where}.middleFrequency`, base.middleFrequency, 100, 12000),
        high: reader.number(raw['high'], `${where}.high`, base.high, -24, 24),
      }
    case 'crush':
      return {
        type: 'crush',
        enabled,
        bits: reader.number(raw['bits'], `${where}.bits`, base.bits, 1, 16),
        mix: reader.number(raw['mix'], `${where}.mix`, base.mix, 0, 1),
      }
  }
}

/** `"0:200 16:8000"` or a list of `{at, value}`. */
function automation(reader: Reader, value: unknown, where: string): Automation | null {
  const raw = reader.object(value, where)
  const target = reader.string(raw['target'], `${where}.target`, '')
  if (target === '') {
    reader.note('An automation lane without a target does nothing; dropped', where, 'error')
    return null
  }
  const points: Automation['points'] = []
  const source = raw['points']
  if (typeof source === 'string') {
    for (const pair of source.split(/[\s,]+/).filter(Boolean)) {
      const [beat = '', level = ''] = pair.split(':')
      const at = Number(beat)
      const point = Number(level)
      if (!Number.isFinite(at) || !Number.isFinite(point)) {
        reader.note(`"${pair}" is not a beat:value pair`, `${where}.points`, 'error')
        continue
      }
      points.push({ at, value: point })
    }
  } else {
    for (const [index, entry] of reader.array(source, `${where}.points`).entries()) {
      const item = reader.object(entry, `${where}.points[${index}]`)
      points.push({
        at: reader.number(item['at'], `${where}.points[${index}].at`, 0, 0, 1e6),
        value: reader.number(item['value'], `${where}.points[${index}].value`, 0),
      })
    }
  }
  points.sort((a, b) => a.at - b.at)
  return { target, points }
}

function track(reader: Reader, value: unknown, where: string, index: number, earlier: readonly Track[]): Track {
  const raw = reader.object(value, where)
  const id = reader.string(raw['id'], `${where}.id`, `track-${index + 1}`)
  const base = defaultTrack(id, `Track ${index + 1}`, defaultSynth(), index)
  const sends = reader.object(raw['sends'], `${where}.sends`)
  return {
    id,
    name: reader.string(raw['name'], `${where}.name`, base.name),
    colour: reader.string(raw['colour'], `${where}.colour`, TRACK_COLOURS[index % TRACK_COLOURS.length] ?? base.colour),
    instrument: instrument(reader, raw['instrument'], `${where}.instrument`),
    effects: reader
      .array(raw['effects'], `${where}.effects`)
      .map((entry, position) => effect(reader, entry, `${where}.effects[${position}]`)),
    gain: reader.number(raw['gain'], `${where}.gain`, base.gain, -60, 12),
    pan: reader.number(raw['pan'], `${where}.pan`, base.pan, -1, 1),
    mute: reader.boolean(raw['mute'], `${where}.mute`, base.mute),
    solo: reader.boolean(raw['solo'], `${where}.solo`, base.solo),
    sends: {
      delay: reader.number(sends['delay'], `${where}.sends.delay`, 0, 0, 1),
      reverb: reader.number(sends['reverb'], `${where}.sends.reverb`, 0, 0, 1),
    },
    automation: reader
      .array(raw['automation'], `${where}.automation`)
      .map((entry, position) => automation(reader, entry, `${where}.automation[${position}]`))
      .filter((lane): lane is Automation => lane !== null),
    duck: duck(reader, raw['duck'], `${where}.duck`, earlier, id),
  }
}

function explicitNotes(reader: Reader, source: unknown[], where: string): Note[] {
  const notes: Note[] = []
  source.forEach((entry, index) => {
    const raw = reader.object(entry, `${where}[${index}]`)
    const pitchValue = raw['pitch']
    const pitch = typeof pitchValue === 'string' ? noteToMidi(pitchValue) : Math.round(reader.number(pitchValue, `${where}[${index}].pitch`, 60, 0, 127))
    if (pitch === null) {
      reader.note(`Not a pitch: "${String(pitchValue)}"`, `${where}[${index}].pitch`, 'error')
      return
    }
    notes.push({
      at: reader.number(raw['at'], `${where}[${index}].at`, 0, 0, 1e6),
      pitch,
      length: reader.number(raw['length'], `${where}[${index}].length`, 0.25, 0.0001, 1e4),
      velocity: quantiseVelocity(reader.number(raw['velocity'], `${where}[${index}].velocity`, 0.8, 0, 1)),
    })
  })
  notes.sort((a, b) => a.at - b.at || a.pitch - b.pitch)
  return notes
}

function pattern(reader: Reader, value: unknown, where: string, index: number, tracks: readonly Track[]): Pattern {
  const raw = reader.object(value, where)
  const id = reader.string(raw['id'], `${where}.id`, `pattern-${index + 1}`)
  const trackId = reader.string(raw['track'], `${where}.track`, tracks[0]?.id ?? '')
  const owner = tracks.find((candidate) => candidate.id === trackId)
  if (!owner) {
    reader.note(`No track called "${trackId}"; this pattern will not play`, `${where}.track`, 'error')
  }
  const bars = Math.max(1, Math.round(reader.number(raw['bars'], `${where}.bars`, 1, 1, 512)))
  const grid = reader.string(raw['grid'], `${where}.grid`, '1/16')

  let notes: Note[] = []
  let offGrid = false
  const rawNotes = raw['notes']
  if (typeof rawNotes === 'string') {
    notes = reader.absorb(parseNoteStream(rawNotes, grid), `${where}.notes`)
  } else if (Array.isArray(rawNotes)) {
    if (rawNotes.every((entry) => typeof entry === 'string')) {
      notes = reader.absorb(parseNoteStream(rawNotes as string[], grid), `${where}.notes`)
    } else {
      notes = explicitNotes(reader, rawNotes, `${where}.notes`)
      offGrid = true
    }
  } else if (rawNotes !== undefined && rawNotes !== null) {
    reader.note('Expected a step string or a list of notes', `${where}.notes`, 'error')
  }

  const lanes: Record<string, Note[]> = {}
  const rawLanes = reader.object(raw['lanes'], `${where}.lanes`)
  const kit = owner?.instrument.type === 'drums' ? owner.instrument : null
  for (const [laneId, laneSource] of Object.entries(rawLanes)) {
    if (kit && !kit.lanes.some((lane) => lane.id === laneId)) {
      reader.note(`The kit on "${trackId}" has no lane "${laneId}"; that lane is silent`, `${where}.lanes.${laneId}`, 'error')
    }
    if (typeof laneSource === 'string' || (Array.isArray(laneSource) && laneSource.every((entry) => typeof entry === 'string'))) {
      lanes[laneId] = reader.absorb(parseLane(laneSource as string | string[], grid), `${where}.lanes.${laneId}`)
    } else if (Array.isArray(laneSource)) {
      lanes[laneId] = explicitNotes(reader, laneSource, `${where}.lanes.${laneId}`)
      offGrid = true
    } else {
      reader.note('Expected a lane string or a list of hits', `${where}.lanes.${laneId}`, 'error')
    }
  }

  return { id, track: trackId, bars, grid, notes, lanes, offGrid }
}

function clip(reader: Reader, value: unknown, where: string, patterns: readonly Pattern[]): Clip | null {
  const raw = typeof value === 'string' ? { pattern: value } : reader.object(value, where)
  const patternId = reader.string(raw['pattern'], `${where}.pattern`, '')
  if (!patterns.some((candidate) => candidate.id === patternId)) {
    reader.note(`No pattern called "${patternId}"; this clip is dropped`, where, 'error')
    return null
  }
  const times = raw['times']
  return {
    pattern: patternId,
    at: reader.number(raw['at'], `${where}.at`, 0, 0, 4096),
    times: times === undefined || times === null ? null : Math.round(reader.number(times, `${where}.times`, 1, 1, 4096)),
    transpose: Math.round(reader.number(raw['transpose'], `${where}.transpose`, 0, -48, 48)),
  }
}

function section(reader: Reader, value: unknown, where: string, index: number, patterns: readonly Pattern[]): Section {
  const raw = reader.object(value, where)
  return {
    id: reader.string(raw['id'], `${where}.id`, `section-${index + 1}`),
    name: reader.string(raw['name'], `${where}.name`, `Section ${index + 1}`),
    bars: Math.max(1, Math.round(reader.number(raw['bars'], `${where}.bars`, 8, 1, 512))),
    clips: reader
      .array(raw['clips'], `${where}.clips`)
      .map((entry, position) => clip(reader, entry, `${where}.clips[${position}]`, patterns))
      .filter((entry): entry is Clip => entry !== null),
  }
}

function master(reader: Reader, value: unknown): Master {
  const raw = reader.object(value, 'master')
  const base = defaultMaster()
  const delay = reader.object(raw['delay'], 'master.delay')
  const reverb = reader.object(raw['reverb'], 'master.reverb')
  return {
    gain: reader.number(raw['gain'], 'master.gain', base.gain, -60, 12),
    limiter: reader.boolean(raw['limiter'], 'master.limiter', base.limiter),
    delay: {
      time: reader.string(delay['time'], 'master.delay.time', base.delay.time),
      feedback: reader.number(delay['feedback'], 'master.delay.feedback', base.delay.feedback, 0, 0.95),
      mix: reader.number(delay['mix'], 'master.delay.mix', base.delay.mix, 0, 1),
      pingPong: reader.boolean(delay['pingPong'], 'master.delay.pingPong', base.delay.pingPong),
    },
    reverb: {
      size: reader.number(reverb['size'], 'master.reverb.size', base.reverb.size, 0, 1),
      damping: reader.number(reverb['damping'], 'master.reverb.damping', base.reverb.damping, 0, 1),
      mix: reader.number(reverb['mix'], 'master.reverb.mix', base.reverb.mix, 0, 1),
    },
  }
}

export function parseSong(value: unknown): ParseResult<Song> {
  const reader = new Reader()
  const raw = reader.object(value, 'song')

  const declared = raw['format']
  if (typeof declared === 'string' && declared !== FORMAT) {
    reader.note(`This file says it is "${declared}"; reading it as ${FORMAT}`, 'format')
  }

  const timeSignature = reader.string(raw['timeSignature'], 'timeSignature', '4/4')
  if (!/^\d+\s*\/\s*\d+$/.test(timeSignature)) {
    reader.note(`"${timeSignature}" is not a time signature; using 4/4`, 'timeSignature', 'error')
  }

  // A track can duck one that appears after it in the list, so the roster of ids
  // is collected first. Only the ids — parsing every track twice would report
  // every warning twice.
  const rawTracks = reader.array(raw['tracks'], 'tracks')
  const roster = rawTracks.map((entry, index) => ({
    id: isObject(entry) && typeof entry['id'] === 'string' ? entry['id'] : `track-${index + 1}`,
  })) as Track[]
  const tracks = rawTracks.map((entry, index) => track(reader, entry, `tracks[${index}]`, index, roster))

  const seenTracks = new Set<string>()
  const uniqueTracks = tracks.filter((candidate) => {
    if (seenTracks.has(candidate.id)) {
      reader.note(`Two tracks share the id "${candidate.id}"; the later one is dropped`, 'tracks', 'error')
      return false
    }
    seenTracks.add(candidate.id)
    return true
  })

  const patterns = reader
    .array(raw['patterns'], 'patterns')
    .map((entry, index) => pattern(reader, entry, `patterns[${index}]`, index, uniqueTracks))

  const seenPatterns = new Set<string>()
  const uniquePatterns = patterns.filter((candidate) => {
    if (seenPatterns.has(candidate.id)) {
      reader.note(`Two patterns share the id "${candidate.id}"; the later one is dropped`, 'patterns', 'error')
      return false
    }
    seenPatterns.add(candidate.id)
    return true
  })

  const sections = reader
    .array(raw['sections'], 'sections')
    .map((entry, index) => section(reader, entry, `sections[${index}]`, index, uniquePatterns))

  const song: Song = {
    format: FORMAT,
    title: reader.string(raw['title'], 'title', 'Untitled'),
    artist: reader.string(raw['artist'], 'artist', ''),
    tempo: reader.number(raw['tempo'], 'tempo', 120, 20, 400),
    timeSignature: /^\d+\s*\/\s*\d+$/.test(timeSignature) ? timeSignature.replace(/\s+/g, '') : '4/4',
    key: reader.string(raw['key'], 'key', 'C major'),
    swing: reader.number(raw['swing'], 'swing', 0, 0, 1),
    master: master(reader, raw['master']),
    tracks: uniqueTracks,
    patterns: uniquePatterns,
    sections,
  }

  // A pattern longer than every section that uses it is almost always a typo,
  // and silently truncating it would hide the mistake.
  for (const item of song.patterns) {
    const beats = item.bars * beatsPerBar(song.timeSignature)
    const overrun = item.notes.filter((note) => note.at >= beats)
    if (overrun.length > 0) {
      reader.note(
        `${overrun.length} note${overrun.length === 1 ? '' : 's'} start after bar ${item.bars} and will not be heard`,
        `patterns.${item.id}`,
      )
    }
  }

  return { value: song, issues: reader.issues }
}

/** Reads a `.song.json` file. Malformed JSON is an issue, not an exception. */
export function parseSongText(text: string): ParseResult<Song> | { value: null; issues: Issue[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return {
      value: null,
      issues: [{ severity: 'error', message: `This is not valid JSON: ${(error as Error).message}`, where: 'file' }],
    }
  }
  return parseSong(data)
}

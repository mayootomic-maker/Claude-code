/**
 * The inspector: the selected track's sound.
 *
 * Laid out as a synthesiser is laid out — oscillators, then filter, then
 * envelopes — rather than as the data structure is laid out. The two happen to
 * be close here, which is a sign the format was designed from the instrument
 * rather than the other way round.
 */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Bank, Button, Knob, SelectField, TextField, Toggle } from './controls'
import { useAppState, useWorkbench } from './context'
import { removeTrack, updateTrack } from '../state/actions'
import { instrumentFromPreset, PRESETS } from '../engine/presets'
import { defaultEffect } from '../format/defaults'
import { AUTOMATION_TARGETS } from '../engine/graph'
import { DIVISIONS } from '../engine/audio'
import { decibels } from './format'
import {
  DRUM_VOICES,
  FILTER_MODES,
  WAVES,
  type DrumLane,
  type DrumsInstrument,
  type Effect,
  type EffectType,
  type Envelope,
  type FmInstrument,
  type SamplerInstrument,
  type SynthInstrument,
  type Track,
} from '../format/types'

const EFFECT_NAMES: Record<EffectType, string> = {
  filter: 'Filter',
  drive: 'Drive',
  chorus: 'Chorus',
  delay: 'Delay',
  reverb: 'Reverb',
  compressor: 'Compressor',
  eq: 'EQ',
  crush: 'Bit crush',
}

export function Inspector(): JSX.Element {
  const { store } = useWorkbench()
  const state = useAppState()
  const track = state.song.tracks.find((candidate) => candidate.id === state.selection.trackId)

  if (!track) {
    return (
      <aside class="inspector">
        <div class="panel-head">Track</div>
        <p class="hint" style="padding: 14px 12px">
          Select a track to see its instrument, its effects and its automation.
        </p>
      </aside>
    )
  }

  const change = (mutate: (draft: Track) => void, history = true): void =>
    updateTrack(store, track.id, mutate, history)

  return (
    <aside class="inspector">
      <div class="panel-head">
        <span class="swatch" style={{ background: track.colour }} />
        Track
        <span class="spacer" />
        <Button tone="danger" title={`Delete ${track.name} and its patterns`} onClick={() => removeTrack(store, track.id)}>
          Delete
        </Button>
      </div>

      <div class="panel-body">
        <TextField label="Name" value={track.name} onChange={(value) => change((draft) => { draft.name = value })} />
        <div class="row">
          <label class="field">
            <span>Colour</span>
            <input
              type="color"
              value={track.colour}
              onInput={(event) => change((draft) => { draft.colour = event.currentTarget.value }, false)}
              onChange={() => store.edit(() => {})}
            />
          </label>
          <span class="chip">{track.instrument.type}</span>
          <span class="chip tabular">{decibels(track.gain)} dB</span>
        </div>

        <label class="field">
          <span>Load a preset</span>
          <select
            value=""
            onChange={(event) => {
              const instrument = instrumentFromPreset(event.currentTarget.value)
              if (instrument) change((draft) => { draft.instrument = instrument })
              event.currentTarget.value = ''
            }}
          >
            <option value="">Choose…</option>
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.group} — {preset.name}
              </option>
            ))}
          </select>
        </label>
        <p class="hint">
          A preset is copied in, not linked. Changing it here never changes another song.
        </p>
      </div>

      {track.instrument.type === 'synth' && <SynthPanel track={track} instrument={track.instrument} />}
      {track.instrument.type === 'fm' && <FmPanel track={track} instrument={track.instrument} />}
      {track.instrument.type === 'drums' && <DrumPanel track={track} instrument={track.instrument} />}
      {track.instrument.type === 'sampler' && <SamplerPanel track={track} instrument={track.instrument} />}

      <EffectRack track={track} />
      <AutomationPanel track={track} />
    </aside>
  )
}

/** Knobs mutate live and only push an undo step when the gesture starts. */
function useInstrumentEditor<T>(track: Track): {
  live: (mutate: (instrument: T) => void) => void
  begin: () => void
} {
  const { store } = useWorkbench()
  return {
    begin: () => store.beginGesture(),
    live: (mutate) =>
      updateTrack(store, track.id, (draft) => mutate(draft.instrument as T), false),
  }
}

function EnvelopeBank(props: {
  title: string
  envelope: Envelope
  onChange: (mutate: (envelope: Envelope) => void) => void
  onBegin: () => void
}): JSX.Element {
  const { envelope } = props
  return (
    <Bank title={props.title}>
      <Knob
        label="Attack"
        value={envelope.attack}
        min={0.001}
        max={8}
        curve="log"
        unit="s"
        onBegin={props.onBegin}
        onChange={(value) => props.onChange((draft) => { draft.attack = value })}
      />
      <Knob
        label="Decay"
        value={envelope.decay}
        min={0.005}
        max={8}
        curve="log"
        unit="s"
        onBegin={props.onBegin}
        onChange={(value) => props.onChange((draft) => { draft.decay = value })}
      />
      <Knob
        label="Sustain"
        value={envelope.sustain}
        min={0}
        max={1}
        format={(value) => `${Math.round(value * 100)}%`}
        onBegin={props.onBegin}
        onChange={(value) => props.onChange((draft) => { draft.sustain = value })}
      />
      <Knob
        label="Release"
        value={envelope.release}
        min={0.005}
        max={8}
        curve="log"
        unit="s"
        onBegin={props.onBegin}
        onChange={(value) => props.onChange((draft) => { draft.release = value })}
      />
    </Bank>
  )
}

function SynthPanel(props: { track: Track; instrument: SynthInstrument }): JSX.Element {
  const { live, begin } = useInstrumentEditor<SynthInstrument>(props.track)
  const { instrument } = props
  const { store } = useWorkbench()

  return (
    <section class="panel">
      <div class="panel-head">Synth</div>
      <div class="panel-body">
        {([0, 1] as const).map((index) => {
          const oscillator = instrument.oscillators[index]
          return (
            <Bank key={index} title={`Oscillator ${index + 1}`}>
              <div style="width: 100%">
                <SelectField
                  label="Wave"
                  value={oscillator.wave}
                  options={WAVES}
                  onChange={(value) => {
                    store.beginGesture()
                    live((draft) => { draft.oscillators[index].wave = value })
                  }}
                />
              </div>
              <Knob
                label="Level"
                value={oscillator.level}
                min={0}
                max={1}
                format={(value) => `${Math.round(value * 100)}%`}
                onBegin={begin}
                onChange={(value) => live((draft) => { draft.oscillators[index].level = value })}
              />
              <Knob
                label="Octave"
                value={oscillator.octave}
                min={-4}
                max={4}
                step={1}
                format={(value) => (value > 0 ? `+${value}` : String(value))}
                onBegin={begin}
                onChange={(value) => live((draft) => { draft.oscillators[index].octave = Math.round(value) })}
              />
              <Knob
                label="Detune"
                value={oscillator.detune}
                min={-100}
                max={100}
                resetTo={0}
                format={(value) => `${value.toFixed(0)}c`}
                onBegin={begin}
                onChange={(value) => live((draft) => { draft.oscillators[index].detune = value })}
              />
            </Bank>
          )
        })}

        <Bank title="Filter">
          <div style="width: 100%">
            <SelectField
              label="Mode"
              value={instrument.filter.mode}
              options={FILTER_MODES}
              onChange={(value) => {
                store.beginGesture()
                live((draft) => { draft.filter.mode = value })
              }}
            />
          </div>
          <Knob
            label="Cutoff"
            value={instrument.filter.frequency}
            min={20}
            max={20000}
            curve="log"
            unit="Hz"
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.filter.frequency = value })}
          />
          <Knob
            label="Reso"
            value={instrument.filter.resonance}
            min={0.1}
            max={30}
            curve="log"
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.filter.resonance = value })}
          />
          <Knob
            label="Env"
            value={instrument.filter.envelope}
            min={-48}
            max={72}
            resetTo={0}
            format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)}st`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.filter.envelope = value })}
          />
          <Knob
            label="Key"
            value={instrument.filter.keyTracking}
            min={0}
            max={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.filter.keyTracking = value })}
          />
          <Knob
            label="Noise"
            value={instrument.noise}
            min={0}
            max={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.noise = value })}
          />
        </Bank>

        <EnvelopeBank
          title="Filter envelope"
          envelope={instrument.filterEnvelope}
          onBegin={begin}
          onChange={(mutate) => live((draft) => mutate(draft.filterEnvelope))}
        />
        <EnvelopeBank
          title="Amp envelope"
          envelope={instrument.amplitudeEnvelope}
          onBegin={begin}
          onChange={(mutate) => live((draft) => mutate(draft.amplitudeEnvelope))}
        />

        <Bank title="LFO">
          <div style="width: 100%">
            <SelectField
              label="Wave"
              value={instrument.lfo.wave}
              options={['sine', 'triangle', 'sawtooth', 'square'] as const}
              onChange={(value) => {
                store.beginGesture()
                live((draft) => { draft.lfo.wave = value })
              }}
            />
          </div>
          <Knob
            label="Rate"
            value={instrument.lfo.rate}
            min={0.05}
            max={30}
            curve="log"
            unit="Hz"
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.lfo.rate = value })}
          />
          <Knob
            label="To pitch"
            value={instrument.lfo.toPitch}
            min={0}
            max={12}
            resetTo={0}
            format={(value) => `${value.toFixed(2)}st`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.lfo.toPitch = value })}
          />
          <Knob
            label="To filter"
            value={instrument.lfo.toFilter}
            min={0}
            max={60}
            resetTo={0}
            format={(value) => `${value.toFixed(0)}st`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.lfo.toFilter = value })}
          />
          <Knob
            label="To amp"
            value={instrument.lfo.toAmplitude}
            min={0}
            max={1}
            resetTo={0}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.lfo.toAmplitude = value })}
          />
        </Bank>

        <Bank title="Voicing">
          <Knob
            label="Unison"
            value={instrument.unison.voices}
            min={1}
            max={7}
            step={1}
            format={(value) => `${Math.round(value)}`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.unison.voices = Math.round(value) })}
          />
          <Knob
            label="Spread"
            value={instrument.unison.detune}
            min={0}
            max={100}
            format={(value) => `${value.toFixed(0)}c`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.unison.detune = value })}
          />
          <Knob
            label="Width"
            value={instrument.unison.width}
            min={0}
            max={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.unison.width = value })}
          />
          <Knob
            label="Glide"
            value={instrument.glide}
            min={0}
            max={2}
            curve="log"
            unit="s"
            resetTo={0}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.glide = value })}
          />
          <Knob
            label="Level"
            value={instrument.gain}
            min={-24}
            max={12}
            resetTo={0}
            format={(value) => `${decibels(value)} dB`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.gain = value })}
          />
        </Bank>

        <Toggle
          label="Mono (one note at a time, so glide is audible)"
          checked={instrument.mono}
          onChange={(value) => {
            store.beginGesture()
            live((draft) => { draft.mono = value })
          }}
        />
      </div>
    </section>
  )
}

function FmPanel(props: { track: Track; instrument: FmInstrument }): JSX.Element {
  const { live, begin } = useInstrumentEditor<FmInstrument>(props.track)
  const { store } = useWorkbench()
  const { instrument } = props
  const simple = ['sine', 'triangle', 'sawtooth', 'square'] as const

  return (
    <section class="panel">
      <div class="panel-head">FM</div>
      <div class="panel-body">
        <p class="hint">
          One operator modulates the other. Whole-number ratios sound tuned; anything else sounds like metal.
        </p>
        <Bank title="Carrier">
          <div style="width: 100%">
            <SelectField
              label="Wave"
              value={instrument.carrier.wave}
              options={simple}
              onChange={(value) => {
                store.beginGesture()
                live((draft) => { draft.carrier.wave = value })
              }}
            />
          </div>
          <Knob
            label="Ratio"
            value={instrument.carrier.ratio}
            min={0.25}
            max={16}
            step={0.01}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.carrier.ratio = value })}
          />
        </Bank>
        <Bank title="Modulator">
          <div style="width: 100%">
            <SelectField
              label="Wave"
              value={instrument.modulator.wave}
              options={simple}
              onChange={(value) => {
                store.beginGesture()
                live((draft) => { draft.modulator.wave = value })
              }}
            />
          </div>
          <Knob
            label="Ratio"
            value={instrument.modulator.ratio}
            min={0.25}
            max={16}
            step={0.01}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.modulator.ratio = value })}
          />
          <Knob
            label="Index"
            value={instrument.modulator.index}
            min={0}
            max={24}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.modulator.index = value })}
          />
          <Knob
            label="Level"
            value={instrument.gain}
            min={-24}
            max={12}
            resetTo={0}
            format={(value) => `${decibels(value)} dB`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.gain = value })}
          />
        </Bank>
        <EnvelopeBank
          title="Modulator envelope"
          envelope={instrument.modulator.envelope}
          onBegin={begin}
          onChange={(mutate) => live((draft) => mutate(draft.modulator.envelope))}
        />
        <EnvelopeBank
          title="Amp envelope"
          envelope={instrument.amplitudeEnvelope}
          onBegin={begin}
          onChange={(mutate) => live((draft) => mutate(draft.amplitudeEnvelope))}
        />
      </div>
    </section>
  )
}

function DrumPanel(props: { track: Track; instrument: DrumsInstrument }): JSX.Element {
  const { live, begin } = useInstrumentEditor<DrumsInstrument>(props.track)
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const [selectedLane, setSelectedLane] = useState(props.instrument.lanes[0]?.id ?? '')
  const lane = props.instrument.lanes.find((candidate) => candidate.id === selectedLane) ?? props.instrument.lanes[0]
  if (!lane) return <section class="panel" />
  const index = props.instrument.lanes.indexOf(lane)

  const editLane = (mutate: (draft: DrumLane) => void): void =>
    live((draft) => {
      const target = draft.lanes[index]
      if (target) mutate(target)
    })

  return (
    <section class="panel">
      <div class="panel-head">Drum kit</div>
      <div class="panel-body">
        <div class="list">
          {props.instrument.lanes.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              class="list-row"
              data-selected={candidate.id === lane.id}
              onClick={() => {
                setSelectedLane(candidate.id)
                void audio.ensure(state.song).then((player) => player?.preview(props.track.id, 60, 0.9, candidate.id))
              }}
            >
              <span class="grow">{candidate.name}</span>
              <span class="chip">{candidate.voice}</span>
            </button>
          ))}
        </div>

        <TextField
          label="Lane name"
          value={lane.name}
          onChange={(value) => {
            store.beginGesture()
            editLane((draft) => { draft.name = value })
          }}
        />
        <SelectField
          label="Voice"
          value={lane.voice}
          options={DRUM_VOICES}
          onChange={(value) => {
            store.beginGesture()
            editLane((draft) => { draft.voice = value })
          }}
        />

        <Bank title={lane.name}>
          <Knob
            label="Tune"
            value={lane.tune}
            min={20}
            max={16000}
            curve="log"
            unit="Hz"
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.tune = value })}
          />
          <Knob
            label="Decay"
            value={lane.decay}
            min={0.005}
            max={4}
            curve="log"
            unit="s"
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.decay = value })}
          />
          <Knob
            label="Snap"
            value={lane.snap}
            min={0}
            max={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.snap = value })}
          />
          <Knob
            label="Level"
            value={lane.level}
            min={-40}
            max={12}
            resetTo={0}
            format={(value) => `${decibels(value)} dB`}
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.level = value })}
          />
          <Knob
            label="Pan"
            value={lane.pan}
            min={-1}
            max={1}
            resetTo={0}
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.pan = value })}
          />
          <Knob
            label="Choke"
            value={lane.choke}
            min={0}
            max={4}
            step={1}
            format={(value) => (value === 0 ? 'off' : `group ${value}`)}
            onBegin={begin}
            onChange={(value) => editLane((draft) => { draft.choke = Math.round(value) })}
          />
        </Bank>
        <p class="hint">
          Lanes sharing a choke group cut each other off, the way a hi-hat pedal closes an open hat.
        </p>
      </div>
    </section>
  )
}

function SamplerPanel(props: { track: Track; instrument: SamplerInstrument }): JSX.Element {
  const { live, begin } = useInstrumentEditor<SamplerInstrument>(props.track)
  const { store, audio } = useWorkbench()
  const [over, setOver] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const names = audio.sampleNames()
  const { instrument } = props
  const loaded = instrument.sample !== '' && names.includes(instrument.sample)

  const accept = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    const file = files[0]!
    const error = await audio.addSample(file.name, file)
    setProblem(error)
    if (!error) {
      store.beginGesture()
      live((draft) => { draft.sample = file.name })
    }
  }

  return (
    <section class="panel">
      <div class="panel-head">Sampler</div>
      <div class="panel-body">
        <div
          class="drop-target"
          data-over={over}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            void accept(event.dataTransfer?.files ?? null)
          }}
        >
          Drop an audio file here, or
          <label style="display:block; margin-top: 6px">
            <span class="button">Choose a file</span>
            <input
              type="file"
              accept="audio/*"
              class="visually-hidden"
              onChange={(event) => void accept(event.currentTarget.files)}
            />
          </label>
        </div>

        {problem && (
          <div class="issue" data-severity="error">
            {problem}
          </div>
        )}

        {!loaded && instrument.sample !== '' && (
          <div class="issue" data-severity="error">
            This track wants <code>{instrument.sample}</code>, which is not loaded in this browser, so it is
            silent. Samples live outside the song file — drop it in again to hear the track.
          </div>
        )}

        {names.length > 0 && (
          <SelectField
            label="Sample"
            value={instrument.sample}
            options={['', ...names].map((name) => ({ value: name, label: name === '' ? 'None' : name }))}
            onChange={(value) => {
              store.beginGesture()
              live((draft) => { draft.sample = value })
            }}
          />
        )}

        <div class="row">
          <TextField
            label="Root note"
            value={instrument.root}
            onChange={(value) => {
              store.beginGesture()
              live((draft) => { draft.root = value })
            }}
          />
          <Toggle
            label="Loop"
            checked={instrument.loop}
            onChange={(value) => {
              store.beginGesture()
              live((draft) => { draft.loop = value })
            }}
          />
          <Toggle
            label="Reverse"
            checked={instrument.reverse}
            onChange={(value) => {
              store.beginGesture()
              live((draft) => { draft.reverse = value })
            }}
          />
          <Toggle
            label="Fixed pitch"
            checked={instrument.fixedPitch}
            onChange={(value) => {
              store.beginGesture()
              live((draft) => { draft.fixedPitch = value })
            }}
          />
        </div>

        <Bank title="Playback">
          <Knob
            label="Start"
            value={instrument.start}
            min={0}
            max={0.99}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.start = Math.min(value, draft.end - 0.01) })}
          />
          <Knob
            label="End"
            value={instrument.end}
            min={0.01}
            max={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.end = Math.max(value, draft.start + 0.01) })}
          />
          <Knob
            label="Level"
            value={instrument.gain}
            min={-24}
            max={12}
            resetTo={0}
            format={(value) => `${decibels(value)} dB`}
            onBegin={begin}
            onChange={(value) => live((draft) => { draft.gain = value })}
          />
        </Bank>

        <EnvelopeBank
          title="Amp envelope"
          envelope={instrument.amplitudeEnvelope}
          onBegin={begin}
          onChange={(mutate) => live((draft) => mutate(draft.amplitudeEnvelope))}
        />
      </div>
    </section>
  )
}

function EffectRack(props: { track: Track }): JSX.Element {
  const { store } = useWorkbench()
  const { track } = props

  const change = (index: number, mutate: (effect: Effect) => void, history = false): void =>
    updateTrack(store, track.id, (draft) => {
      const effect = draft.effects[index]
      if (effect) mutate(effect)
    }, history)

  return (
    <section class="panel">
      <div class="panel-head">
        Effects
        <span class="spacer" />
        <label class="field">
          <select
            value=""
            aria-label="Add an effect"
            onChange={(event) => {
              const type = event.currentTarget.value as EffectType
              if (!type) return
              updateTrack(store, track.id, (draft) => {
                draft.effects.push(defaultEffect(type))
              })
              event.currentTarget.value = ''
            }}
          >
            <option value="">Add…</option>
            {(Object.keys(EFFECT_NAMES) as EffectType[]).map((type) => (
              <option key={type} value={type}>
                {EFFECT_NAMES[type]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="panel-body">
        {track.effects.length === 0 && (
          <p class="hint">
            Nothing in the chain. Effects run in order, top to bottom, before the fader.
          </p>
        )}
        {track.effects.map((effect, index) => (
          <div class="effect" key={`${effect.type}-${index}`}>
            <div class="effect-head">
              <span>{EFFECT_NAMES[effect.type]}</span>
              <span class="spacer" style="flex:1" />
              <button
                type="button"
                class="mini"
                title="Move earlier"
                disabled={index === 0}
                onClick={() =>
                  updateTrack(store, track.id, (draft) => {
                    const [moved] = draft.effects.splice(index, 1)
                    if (moved) draft.effects.splice(index - 1, 0, moved)
                  })
                }
              >
                {'↑'}
              </button>
              <button
                type="button"
                class="mini"
                title="Move later"
                disabled={index === track.effects.length - 1}
                onClick={() =>
                  updateTrack(store, track.id, (draft) => {
                    const [moved] = draft.effects.splice(index, 1)
                    if (moved) draft.effects.splice(index + 1, 0, moved)
                  })
                }
              >
                {'↓'}
              </button>
              <button
                type="button"
                class="mini"
                data-on={effect.enabled}
                aria-pressed={effect.enabled}
                title={effect.enabled ? 'Bypass' : 'Enable'}
                onClick={() => change(index, (draft) => { draft.enabled = !draft.enabled }, true)}
              >
                {effect.enabled ? 'on' : 'off'}
              </button>
              <button
                type="button"
                class="mini"
                title="Remove"
                onClick={() =>
                  updateTrack(store, track.id, (draft) => {
                    draft.effects.splice(index, 1)
                  })
                }
              >
                {'×'}
              </button>
            </div>
            <div class="effect-body">
              <EffectControls effect={effect} index={index} onChange={change} onBegin={() => store.beginGesture()} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function EffectControls(props: {
  effect: Effect
  index: number
  onChange: (index: number, mutate: (effect: Effect) => void, history?: boolean) => void
  onBegin: () => void
}): JSX.Element {
  const { effect, index, onChange, onBegin } = props
  const knob = (
    label: string,
    value: number,
    min: number,
    max: number,
    apply: (effect: Effect, value: number) => void,
    extra: Partial<Parameters<typeof Knob>[0]> = {},
  ): JSX.Element => (
    <Knob
      label={label}
      value={value}
      min={min}
      max={max}
      onBegin={onBegin}
      onChange={(next) => onChange(index, (draft) => apply(draft, next))}
      {...extra}
    />
  )
  const percent = (value: number): string => `${Math.round(value * 100)}%`

  switch (effect.type) {
    case 'filter':
      return (
        <div class="knob-row">
          <div style="width: 100%">
            <SelectField
              label="Mode"
              value={effect.mode}
              options={FILTER_MODES}
              onChange={(value) => onChange(index, (draft) => { if (draft.type === 'filter') draft.mode = value }, true)}
            />
          </div>
          {knob('Cutoff', effect.frequency, 20, 20000, (draft, value) => { if (draft.type === 'filter') draft.frequency = value }, { curve: 'log', unit: 'Hz' })}
          {knob('Reso', effect.resonance, 0.1, 30, (draft, value) => { if (draft.type === 'filter') draft.resonance = value }, { curve: 'log' })}
        </div>
      )
    case 'drive':
      return (
        <div class="knob-row">
          {knob('Amount', effect.amount, 0, 1, (draft, value) => { if (draft.type === 'drive') draft.amount = value }, { format: percent })}
          {knob('Tone', effect.tone, 0, 1, (draft, value) => { if (draft.type === 'drive') draft.tone = value }, { format: percent })}
          {knob('Mix', effect.mix, 0, 1, (draft, value) => { if (draft.type === 'drive') draft.mix = value }, { format: percent })}
        </div>
      )
    case 'chorus':
      return (
        <div class="knob-row">
          {knob('Rate', effect.rate, 0.05, 12, (draft, value) => { if (draft.type === 'chorus') draft.rate = value }, { curve: 'log', unit: 'Hz' })}
          {knob('Depth', effect.depth, 0, 1, (draft, value) => { if (draft.type === 'chorus') draft.depth = value }, { format: percent })}
          {knob('Mix', effect.mix, 0, 1, (draft, value) => { if (draft.type === 'chorus') draft.mix = value }, { format: percent })}
        </div>
      )
    case 'delay':
      return (
        <div class="knob-row">
          <div style="width: 100%">
            <SelectField
              label="Time"
              value={effect.time}
              options={DIVISIONS}
              onChange={(value) => onChange(index, (draft) => { if (draft.type === 'delay') draft.time = value }, true)}
            />
          </div>
          {knob('Feedback', effect.feedback, 0, 0.95, (draft, value) => { if (draft.type === 'delay') draft.feedback = value }, { format: percent })}
          {knob('Mix', effect.mix, 0, 1, (draft, value) => { if (draft.type === 'delay') draft.mix = value }, { format: percent })}
          <div style="width: 100%">
            <Toggle
              label="Ping pong"
              checked={effect.pingPong}
              onChange={(value) => onChange(index, (draft) => { if (draft.type === 'delay') draft.pingPong = value }, true)}
            />
          </div>
        </div>
      )
    case 'reverb':
      return (
        <div class="knob-row">
          {knob('Size', effect.size, 0, 1, (draft, value) => { if (draft.type === 'reverb') draft.size = value }, { format: percent })}
          {knob('Damping', effect.damping, 0, 1, (draft, value) => { if (draft.type === 'reverb') draft.damping = value }, { format: percent })}
          {knob('Mix', effect.mix, 0, 1, (draft, value) => { if (draft.type === 'reverb') draft.mix = value }, { format: percent })}
        </div>
      )
    case 'compressor':
      return (
        <div class="knob-row">
          {knob('Threshold', effect.threshold, -60, 0, (draft, value) => { if (draft.type === 'compressor') draft.threshold = value }, { format: (value) => `${value.toFixed(0)} dB` })}
          {knob('Ratio', effect.ratio, 1, 20, (draft, value) => { if (draft.type === 'compressor') draft.ratio = value }, { format: (value) => `${value.toFixed(1)}:1` })}
          {knob('Attack', effect.attack, 0.0005, 0.5, (draft, value) => { if (draft.type === 'compressor') draft.attack = value }, { curve: 'log', unit: 's' })}
          {knob('Release', effect.release, 0.01, 1, (draft, value) => { if (draft.type === 'compressor') draft.release = value }, { curve: 'log', unit: 's' })}
        </div>
      )
    case 'eq':
      return (
        <div class="knob-row">
          {knob('Low', effect.low, -18, 18, (draft, value) => { if (draft.type === 'eq') draft.low = value }, { resetTo: 0, format: (value) => `${decibels(value)} dB` })}
          {knob('Mid', effect.mid, -18, 18, (draft, value) => { if (draft.type === 'eq') draft.mid = value }, { resetTo: 0, format: (value) => `${decibels(value)} dB` })}
          {knob('Mid Hz', effect.middleFrequency, 100, 12000, (draft, value) => { if (draft.type === 'eq') draft.middleFrequency = value }, { curve: 'log', unit: 'Hz' })}
          {knob('High', effect.high, -18, 18, (draft, value) => { if (draft.type === 'eq') draft.high = value }, { resetTo: 0, format: (value) => `${decibels(value)} dB` })}
        </div>
      )
    case 'crush':
      return (
        <div class="knob-row">
          {knob('Bits', effect.bits, 1, 16, (draft, value) => { if (draft.type === 'crush') draft.bits = value }, { step: 1, format: (value) => value.toFixed(0) })}
          {knob('Mix', effect.mix, 0, 1, (draft, value) => { if (draft.type === 'crush') draft.mix = value }, { format: percent })}
        </div>
      )
  }
}

function AutomationPanel(props: { track: Track }): JSX.Element {
  const { store } = useWorkbench()
  const { track } = props
  const targets = [
    ...AUTOMATION_TARGETS,
    ...track.effects.flatMap((effect, index) =>
      effectParameters(effect).map((name) => `effects.${index}.${name}`),
    ),
  ]

  return (
    <section class="panel">
      <div class="panel-head">
        Automation
        <span class="spacer" />
        <Button
          onClick={() =>
            updateTrack(store, track.id, (draft) => {
              draft.automation.push({ target: 'gain', points: [{ at: 0, value: draft.gain }] })
            })
          }
        >
          Add lane
        </Button>
      </div>
      <div class="panel-body">
        <p class="hint">
          A lane is a list of <code>beat:value</code> pairs, ramped between. Mixer and effect controls can be
          automated; to sweep an instrument's filter, put a Filter effect on the track and automate that.
        </p>
        {track.automation.map((lane, index) => (
          <div class="effect" key={index}>
            <div class="effect-head">
              <select
                value={lane.target}
                aria-label="What this lane controls"
                onChange={(event) =>
                  updateTrack(store, track.id, (draft) => {
                    const target = draft.automation[index]
                    if (target) target.target = event.currentTarget.value
                  })
                }
              >
                {targets.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
                {!targets.includes(lane.target) && <option value={lane.target}>{lane.target} (unknown)</option>}
              </select>
              <span style="flex:1" />
              <button
                type="button"
                class="mini"
                title="Remove this lane"
                onClick={() =>
                  updateTrack(store, track.id, (draft) => {
                    draft.automation.splice(index, 1)
                  })
                }
              >
                {'×'}
              </button>
            </div>
            <div class="effect-body">
              <PointsField
                value={lane.points.map((point) => `${point.at}:${point.value}`).join(' ')}
                onChange={(text) =>
                  updateTrack(store, track.id, (draft) => {
                    const target = draft.automation[index]
                    if (!target) return
                    target.points = text
                      .split(/[\s,]+/)
                      .filter(Boolean)
                      .map((pair) => {
                        const [at = '', value = ''] = pair.split(':')
                        return { at: Number(at), value: Number(value) }
                      })
                      .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value))
                      .sort((left, right) => left.at - right.at)
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PointsField(props: { value: string; onChange: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? props.value
  const bad = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((pair) => {
      const [at = '', value = ''] = pair.split(':')
      return !Number.isFinite(Number(at)) || !Number.isFinite(Number(value)) || value === ''
    })

  return (
    <div>
      <label class="field" style="align-items: stretch; flex-direction: column; gap: 4px">
        <span>Points (beat:value)</span>
        <input
          type="text"
          value={text}
          placeholder="0:200 16:8000 32:200"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            if (draft !== null && bad.length === 0) props.onChange(draft)
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </label>
      {bad.length > 0 && (
        <p class="hint" style="color: var(--bad)">
          Not a beat:value pair: {bad.join(', ')}
        </p>
      )}
    </div>
  )
}

function effectParameters(effect: Effect): string[] {
  switch (effect.type) {
    case 'filter':
      return ['frequency', 'resonance']
    case 'drive':
      return ['mix', 'tone']
    case 'chorus':
      return ['mix', 'rate', 'depth']
    case 'delay':
      return ['mix', 'feedback', 'time']
    case 'reverb':
      return ['mix']
    case 'compressor':
      return ['threshold', 'ratio', 'attack', 'release']
    case 'eq':
      return ['low', 'mid', 'middleFrequency', 'high']
    case 'crush':
      return ['mix']
  }
}

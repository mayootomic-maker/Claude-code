/** Faders, panning and sends — the whole mix on one screen. */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, Fader, Knob, Meter, useAnimationFrame } from './controls'
import { useAppState, useWorkbench } from './context'
import { updateTrack } from '../state/actions'
import { decibels, panLabel } from './format'
import type { Track } from '../format/types'

export function Mixer(): JSX.Element {
  const state = useAppState()

  if (state.song.tracks.length === 0) {
    return (
      <div class="empty">
        <h2>Nothing to mix yet</h2>
        <p>Add a track and it appears here with a fader, a pan control and two sends.</p>
      </div>
    )
  }

  return (
    <div class="mixer">
      {state.song.tracks.map((track) => (
        <Strip key={track.id} track={track} selected={state.selection.trackId === track.id} />
      ))}
      <MasterStrip />
    </div>
  )
}

function Strip(props: { track: Track; selected: boolean }): JSX.Element {
  const { store, audio } = useWorkbench()
  const { track } = props
  const [level, setLevel] = useState(0)

  useAnimationFrame(true, () => {
    const next = audio.player?.meters().tracks.get(track.id) ?? 0
    if (Math.abs(next - level) > 0.006) setLevel(next)
  })

  const change = (mutate: (draft: Track) => void, history = false): void =>
    updateTrack(store, track.id, mutate, history)

  return (
    <div
      class="strip"
      data-selected={props.selected}
      style={{ borderTopColor: track.colour }}
      onClick={() => store.select({ trackId: track.id })}
    >
      <span class="strip-name" title={track.name}>
        {track.name}
      </span>

      <Knob
        label="Pan"
        value={track.pan}
        min={-1}
        max={1}
        resetTo={0}
        format={panLabel}
        onBegin={() => store.beginGesture()}
        onChange={(value) => change((draft) => { draft.pan = value })}
      />

      <div class="strip-sends">
        <Knob
          label="Delay"
          value={track.sends.delay}
          min={0}
          max={1}
          resetTo={0}
          format={(value) => (value < 0.005 ? 'off' : `${Math.round(value * 100)}%`)}
          onBegin={() => store.beginGesture()}
          onChange={(value) => change((draft) => { draft.sends.delay = value })}
        />
        <Knob
          label="Reverb"
          value={track.sends.reverb}
          min={0}
          max={1}
          resetTo={0}
          format={(value) => (value < 0.005 ? 'off' : `${Math.round(value * 100)}%`)}
          onBegin={() => store.beginGesture()}
          onChange={(value) => change((draft) => { draft.sends.reverb = value })}
        />
      </div>

      <div class="strip-fader">
        <Fader
          label={`${track.name} level`}
          value={track.gain}
          onBegin={() => store.beginGesture()}
          onChange={(value) => change((draft) => { draft.gain = value })}
        />
        <Meter tall level={level} label={`${track.name} level`} />
      </div>

      <span class="tabular" style="font-size: 11px; color: var(--text-dim)">
        {decibels(track.gain)} dB
      </span>

      <div class="mini-buttons">
        <button
          type="button"
          class="mini"
          data-kind="mute"
          data-on={track.mute}
          aria-pressed={track.mute}
          title={`Mute ${track.name}`}
          onClick={() => change((draft) => { draft.mute = !draft.mute }, true)}
        >
          M
        </button>
        <button
          type="button"
          class="mini"
          data-on={track.solo}
          aria-pressed={track.solo}
          title={`Solo ${track.name}`}
          onClick={() => change((draft) => { draft.solo = !draft.solo }, true)}
        >
          S
        </button>
      </div>
    </div>
  )
}

function MasterStrip(): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)

  useAnimationFrame(true, () => {
    const next = audio.player?.meters().master ?? 0
    if (Math.abs(next - level) > 0.006) setLevel(next)
    // A held peak is how you catch the one bar that clips.
    if (next > peak) setPeak(next)
  })

  const master = state.song.master

  return (
    <div class="strip master">
      <span class="strip-name">Master</span>

      <div class="knob-row" style="justify-content: center">
        <Knob
          label="Delay"
          value={master.delay.feedback}
          min={0}
          max={0.95}
          format={(value) => `${Math.round(value * 100)}%`}
          onBegin={() => store.beginGesture()}
          onChange={(value) => store.edit((song) => { song.master.delay.feedback = value }, { history: false })}
        />
        <Knob
          label="Room"
          value={master.reverb.size}
          min={0}
          max={1}
          format={(value) => `${Math.round(value * 100)}%`}
          onBegin={() => store.beginGesture()}
          onChange={(value) => store.edit((song) => { song.master.reverb.size = value }, { history: false })}
        />
      </div>

      <div class="strip-fader">
        <Fader
          label="Master level"
          value={master.gain}
          onBegin={() => store.beginGesture()}
          onChange={(value) => store.edit((song) => { song.master.gain = value }, { history: false })}
        />
        <Meter tall level={level} label="Master level" />
      </div>

      <span class="tabular" style="font-size: 11px; color: var(--text-dim)">
        {decibels(master.gain)} dB
      </span>

      <button
        type="button"
        class="chip"
        title="Highest level seen since this was last reset. Click to reset."
        onClick={() => setPeak(0)}
      >
        peak {peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)}` : '—'}
      </button>

      <Button
        active={master.limiter}
        title="A soft ceiling that stops the mix clipping"
        onClick={() => store.edit((song) => { song.master.limiter = !song.master.limiter })}
      >
        Limiter
      </Button>
    </div>
  )
}

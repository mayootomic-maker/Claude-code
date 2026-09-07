/** The track list: what the song is made of, and the fastest route to any of it. */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, Meter, useAnimationFrame } from './controls'
import { useAppState, useWorkbench } from './context'
import { addTrack, removeTrack, updateTrack } from '../state/actions'
import { PRESETS, PRESET_GROUPS } from '../engine/presets'
import type { Track } from '../format/types'

const INSTRUMENT_LABEL: Record<string, string> = {
  synth: 'Synth',
  fm: 'FM',
  drums: 'Drum kit',
  sampler: 'Sampler',
}

export function TrackRail(): JSX.Element {
  const { store } = useWorkbench()
  const state = useAppState()
  const [adding, setAdding] = useState(false)

  return (
    <nav class="rail" aria-label="Tracks">
      <div class="panel-head">
        Tracks
        <span class="spacer" />
        <Button icon title="Add a track" onClick={() => setAdding((open) => !open)} active={adding}>
          +
        </Button>
      </div>

      {adding && <PresetPicker onPick={(id, name) => { addTrack(store, id, name); setAdding(false) }} onCancel={() => setAdding(false)} />}

      {state.song.tracks.length === 0 && !adding && (
        <p class="hint" style="padding: 14px 12px">
          No tracks yet. Add one to start, or open a song from the Files tab.
        </p>
      )}

      {state.song.tracks.map((track) => (
        <TrackRow key={track.id} track={track} selected={state.selection.trackId === track.id} />
      ))}

      {state.song.tracks.length > 0 && (
        <div style="padding: 10px 12px">
          <Button onClick={() => setAdding(true)}>Add track</Button>
        </div>
      )}
    </nav>
  )
}

function TrackRow(props: { track: Track; selected: boolean }): JSX.Element {
  const { store, audio } = useWorkbench()
  const { track } = props
  const [level, setLevel] = useState(0)

  useAnimationFrame(true, () => {
    const next = audio.player?.meters().tracks.get(track.id) ?? 0
    if (Math.abs(next - level) > 0.006) setLevel(next)
  })

  const patternCount = store.get().song.patterns.filter((pattern) => pattern.track === track.id).length

  return (
    <div
      class="track-row"
      data-selected={props.selected}
      style={{ borderLeftColor: props.selected ? track.colour : 'transparent' }}
      onClick={() => store.select({ trackId: track.id })}
      onDblClick={() => store.setView('edit')}
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          store.select({ trackId: track.id })
        }
      }}
    >
      <Meter level={level} label={`${track.name} level`} />
      <span class="track-name">
        <strong style={{ color: props.selected ? track.colour : undefined }}>{track.name}</strong>
        <span>
          {INSTRUMENT_LABEL[track.instrument.type] ?? track.instrument.type} · {patternCount} pattern
          {patternCount === 1 ? '' : 's'}
        </span>
      </span>
      <span class="mini-buttons">
        <button
          type="button"
          class="mini"
          data-kind="mute"
          data-on={track.mute}
          title={track.mute ? `Unmute ${track.name}` : `Mute ${track.name}`}
          aria-pressed={track.mute}
          onClick={(event) => {
            event.stopPropagation()
            updateTrack(store, track.id, (draft) => { draft.mute = !draft.mute })
          }}
        >
          M
        </button>
        <button
          type="button"
          class="mini"
          data-on={track.solo}
          title={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
          aria-pressed={track.solo}
          onClick={(event) => {
            event.stopPropagation()
            updateTrack(store, track.id, (draft) => { draft.solo = !draft.solo })
          }}
        >
          S
        </button>
      </span>
    </div>
  )
}

function PresetPicker(props: { onPick: (presetId: string, name: string) => void; onCancel: () => void }): JSX.Element {
  return (
    <div class="panel-body" style="background: var(--surface-raised); border-bottom: 1px solid var(--line)">
      <div class="row">
        <strong style="font-size: 12px">Choose a sound</strong>
        <span class="spacer" />
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
      {PRESET_GROUPS.map((group) => (
        <div key={group}>
          <h4 class="subhead">{group}</h4>
          <div class="list">
            {PRESETS.filter((preset) => preset.group === group).map((preset) => (
              <button
                key={preset.id}
                type="button"
                class="list-row"
                onClick={() => props.onPick(preset.id, preset.name)}
              >
                <span class="grow">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function removeSelectedTrack(store: ReturnType<typeof useWorkbench>['store']): void {
  const id = store.get().selection.trackId
  if (id) removeTrack(store, id)
}

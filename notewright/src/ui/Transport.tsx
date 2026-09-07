/**
 * The transport bar.
 *
 * The playhead is local state here and nowhere else. Putting the beat position
 * in the application store would re-render the arrangement, the piano roll and
 * the mixer sixty times a second for a number only this bar and the grids need.
 */
import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, Meter, NumberField, Toggle, useAnimationFrame } from './controls'
import { useAppState, useAudioStatus, useWorkbench } from './context'
import { barsAndBeats, clock } from './format'
import { buildTimeline } from '../engine/sequencer'
import { SCALE_NAMES } from '../engine/theory'
import type { View } from '../state/store'

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'arrange', label: 'Arrange', hint: 'Sections and which patterns play in them' },
  { id: 'edit', label: 'Edit', hint: 'Notes and steps' },
  { id: 'mix', label: 'Mix', hint: 'Levels, panning and sends' },
  { id: 'files', label: 'Files', hint: 'Open, save, export' },
]

export function Transport(): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const { status } = useAudioStatus()
  const song = state.song
  const [beat, setBeat] = useState(0)
  const [playing, setPlaying] = useState(false)

  useAnimationFrame(true, () => {
    const player = audio.player
    if (!player) return
    const next = player.state
    if (next.playing !== playing) setPlaying(next.playing)
    // A sixteenth is the finest thing displayed, so there is no point
    // re-rendering for changes smaller than that.
    if (Math.abs(next.beat - beat) > 0.02) setBeat(next.beat)
  })

  useEffect(() => {
    audio.setSong(song)
  }, [audio, song])

  const play = async (): Promise<void> => {
    const player = await audio.ensure(song)
    if (!player) return
    if (player.state.playing) player.stop()
    else player.play()
    setPlaying(player.state.playing)
  }

  const rewind = (): void => {
    audio.player?.seek(0)
    setBeat(0)
  }

  const timeline = buildTimeline(song)
  const key = /^([A-Ga-g][#b]?)\s*(.*)$/.exec(song.key) ?? []

  return (
    <header class="transport">
      <div class="brand">
        <strong>Notewright</strong>
        <span>{state.name}.song.json{state.dirty ? ' •' : ''}</span>
      </div>

      <div class="tabs" role="tablist" aria-label="Workspace">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            role="tab"
            type="button"
            title={view.hint}
            aria-selected={state.view === view.id}
            onClick={() => store.setView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div class="transport-buttons">
        <Button icon title="Back to the start" onClick={rewind}>
          {'⏮'}
        </Button>
        <Button
          icon
          title={playing ? 'Stop (space)' : 'Play (space)'}
          active={playing}
          onClick={() => void play()}
        >
          {playing ? '⏹' : '▶'}
        </Button>
      </div>

      <div class="position" aria-live="off">
        <b class="tabular">{barsAndBeats(beat, song.timeSignature)}</b>
        <em class="tabular">{clock(beat, song.tempo)}</em>
        <em>of {timeline.totalBars} bars</em>
      </div>

      <div class="transport-fields">
        <NumberField
          label="Tempo"
          value={song.tempo}
          min={20}
          max={400}
          step={1}
          onChange={(value) => store.edit((draft) => { draft.tempo = Math.min(400, Math.max(20, value)) })}
        />
        <label class="field">
          <span>Signature</span>
          <select
            value={song.timeSignature}
            onChange={(event) =>
              store.edit((draft) => {
                draft.timeSignature = event.currentTarget.value
              })
            }
          >
            {['4/4', '3/4', '6/8', '5/4', '7/8', '12/8'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Key</span>
          <select
            value={key[1] ?? 'C'}
            onChange={(event) =>
              store.edit((draft) => {
                draft.key = `${event.currentTarget.value} ${key[2] || 'major'}`
              })
            }
          >
            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={key[2] || 'major'}
            onChange={(event) =>
              store.edit((draft) => {
                draft.key = `${key[1] ?? 'C'} ${event.currentTarget.value}`
              })
            }
          >
            {SCALE_NAMES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Swing"
          value={Math.round(song.swing * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(value) => store.edit((draft) => { draft.swing = Math.min(1, Math.max(0, value / 100)) })}
        />
        <Toggle
          label="Click"
          checked={Boolean(audio.player?.metronome)}
          onChange={(value) => {
            if (audio.player) audio.player.metronome = value
            else void audio.ensure(song).then((player) => { if (player) player.metronome = value })
          }}
        />
      </div>

      <span class="spacer" />

      <span class="field">
        <span>Out</span>
        <MasterMeter />
      </span>

      <span class="dot" data-state={status} title={`Audio: ${status}`} />
    </header>
  )
}

function MasterMeter(): JSX.Element {
  const { audio } = useWorkbench()
  const [level, setLevel] = useState(0)
  useAnimationFrame(true, () => {
    const player = audio.player
    if (!player) return
    const next = player.meters().master
    if (Math.abs(next - level) > 0.004) setLevel(next)
  })
  return <Meter wide level={level} label="Master output" />
}

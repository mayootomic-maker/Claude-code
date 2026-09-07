/** The Edit tab: pick a pattern, then edit it as notes or as steps. */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, NumberField, SelectField } from './controls'
import { useAppState, useWorkbench } from './context'
import { PianoRoll } from './PianoRoll'
import { StepGrid } from './StepGrid'
import {
  addPattern,
  duplicatePattern,
  removePattern,
  transposePattern,
  updatePattern,
} from '../state/actions'
import { GRIDS } from '../format/notation'

export function Editor(): JSX.Element {
  const { store } = useWorkbench()
  const state = useAppState()
  const song = state.song
  const [zoom, setZoom] = useState(1)

  const pattern = song.patterns.find((candidate) => candidate.id === state.selection.patternId)
  const track = song.tracks.find((candidate) => candidate.id === (pattern?.track ?? state.selection.trackId))

  if (!track) {
    return (
      <div class="empty">
        <h2>Pick a track</h2>
        <p>Choose a track on the left — or add one — and its patterns will appear here to edit.</p>
      </div>
    )
  }

  const patterns = song.patterns.filter((candidate) => candidate.track === track.id)

  return (
    <div class="editor">
      <div class="toolbar">
        <span class="swatch" style={{ background: track.colour }} />
        <strong style="font-size: 12.5px">{track.name}</strong>

        <div class="pattern-tabs" role="tablist" aria-label={`Patterns on ${track.name}`}>
          {patterns.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === pattern?.id}
              onClick={() => store.select({ patternId: candidate.id, notes: [] })}
            >
              {candidate.id}
            </button>
          ))}
          <button type="button" title="New pattern on this track" onClick={() => addPattern(store, track.id)}>
            +
          </button>
        </div>

        {pattern && (
          <>
            <NumberField
              label="Bars"
              value={pattern.bars}
              min={1}
              max={64}
              onChange={(value) =>
                updatePattern(store, pattern.id, (draft) => {
                  draft.bars = Math.max(1, Math.min(64, Math.round(value)))
                })
              }
            />
            <SelectField
              label="Grid"
              value={pattern.grid}
              options={GRIDS}
              onChange={(value) =>
                updatePattern(store, pattern.id, (draft) => {
                  draft.grid = value
                })
              }
            />
            {track.instrument.type !== 'drums' && (
              <>
                <label class="field">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min="0.4"
                    max="3"
                    step="0.1"
                    value={zoom}
                    aria-label="Horizontal zoom"
                    onInput={(event) => setZoom(Number(event.currentTarget.value))}
                  />
                </label>
                <Button title="Everything down a semitone" onClick={() => transposePattern(store, pattern.id, -1)}>
                  {'−1'}
                </Button>
                <Button title="Everything up a semitone" onClick={() => transposePattern(store, pattern.id, 1)}>
                  {'+1'}
                </Button>
                <Button title="Down an octave" onClick={() => transposePattern(store, pattern.id, -12)}>
                  {'−12'}
                </Button>
                <Button title="Up an octave" onClick={() => transposePattern(store, pattern.id, 12)}>
                  {'+12'}
                </Button>
              </>
            )}
            <span class="spacer" />
            <Button onClick={() => duplicatePattern(store, pattern.id)}>Duplicate</Button>
            <Button tone="danger" onClick={() => removePattern(store, pattern.id)}>
              Delete
            </Button>
          </>
        )}
      </div>

      {!pattern && (
        <div class="empty">
          <h2>{patterns.length === 0 ? 'No patterns on this track yet' : 'Pick a pattern'}</h2>
          <p>
            {patterns.length === 0
              ? 'A pattern is a bar or two of music you can place anywhere in the arrangement.'
              : 'Choose one of the patterns above to edit it.'}
          </p>
          <Button tone="primary" onClick={() => addPattern(store, track.id)}>
            New pattern
          </Button>
        </div>
      )}

      {pattern && pattern.offGrid && (
        <p class="hint" style="padding: 8px 12px 0">
          This pattern holds notes that do not line up with its grid, so it is stored as an explicit note list
          rather than as a step string. Editing it here is fine; it will simply stay in that form.
        </p>
      )}

      {pattern && track.instrument.type === 'drums' && <StepGrid pattern={pattern} track={track} />}
      {pattern && track.instrument.type !== 'drums' && <PianoRoll pattern={pattern} track={track} zoom={zoom} />}
    </div>
  )
}

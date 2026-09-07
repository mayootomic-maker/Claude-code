/**
 * The arrangement: which patterns play in which section.
 *
 * A grid of toggles rather than draggable blocks on a timeline. Dragging blocks
 * is what a DAW does when clips can start anywhere; here a pattern either plays
 * in a section or it does not, and a checkbox says that in one click without
 * anyone having to aim. The details that a timeline would express by position —
 * an offset, a repeat count, a transpose — are on the selected clip, where they
 * can be read as numbers rather than estimated by eye.
 */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, NumberField, useAnimationFrame } from './controls'
import { useAppState, useWorkbench } from './context'
import {
  addSection,
  duplicateSection,
  moveSection,
  removeSection,
  toggleClip,
  updateClip,
  updateSection,
} from '../state/actions'
import { buildTimeline } from '../engine/sequencer'
import { beatsPerBar, type Song } from '../format/types'

export function Arrangement(): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const song = state.song
  const timeline = buildTimeline(song)
  const [playingSection, setPlayingSection] = useState<string | null>(null)
  const [selectedClip, setSelectedClip] = useState<{ section: string; pattern: string } | null>(null)

  useAnimationFrame(true, () => {
    const player = audio.player
    if (!player || !player.state.playing) {
      if (playingSection !== null) setPlayingSection(null)
      return
    }
    const beat = player.state.beat
    const current = timeline.sections.find(
      (section) => beat >= section.startBeat && beat < section.startBeat + section.beats,
    )
    if ((current?.id ?? null) !== playingSection) setPlayingSection(current?.id ?? null)
  })

  if (song.sections.length === 0) {
    return (
      <div class="empty">
        <h2>No sections yet</h2>
        <p>
          A section is a stretch of bars — an intro, a verse, a chorus. Patterns are switched on and off
          per section, and the song plays them in order.
        </p>
        <Button tone="primary" onClick={() => addSection(store)}>
          Add the first section
        </Button>
      </div>
    )
  }

  if (song.tracks.length === 0) {
    return (
      <div class="empty">
        <h2>Nothing to arrange yet</h2>
        <p>Add a track on the left, then make a pattern for it in the Edit tab. Patterns appear here as rows.</p>
      </div>
    )
  }

  return (
    <div>
      <div class="toolbar">
        <Button onClick={() => addSection(store, state.selection.sectionId ?? undefined)}>Add section</Button>
        <Button
          disabled={!state.selection.sectionId}
          onClick={() => state.selection.sectionId && duplicateSection(store, state.selection.sectionId)}
        >
          Duplicate
        </Button>
        <Button
          disabled={!state.selection.sectionId}
          onClick={() => state.selection.sectionId && moveSection(store, state.selection.sectionId, -1)}
          title="Move the selected section earlier"
        >
          {'←'}
        </Button>
        <Button
          disabled={!state.selection.sectionId}
          onClick={() => state.selection.sectionId && moveSection(store, state.selection.sectionId, 1)}
          title="Move the selected section later"
        >
          {'→'}
        </Button>
        <Button
          tone="danger"
          disabled={!state.selection.sectionId}
          onClick={() => state.selection.sectionId && removeSection(store, state.selection.sectionId)}
        >
          Delete section
        </Button>
        <span class="spacer" />
        <span class="hint">
          {timeline.totalBars} bars · {timeline.notes.length} notes
        </span>
      </div>

      <div class="arrange-scroll">
        <table class="arrange">
          <thead>
            <tr>
              <th class="corner" scope="col">
                Pattern
              </th>
              {song.sections.map((section, index) => (
                <th
                  key={section.id}
                  scope="col"
                  data-selected={state.selection.sectionId === section.id}
                  data-playing={playingSection === section.id}
                  onClick={() => store.select({ sectionId: section.id })}
                >
                  <input
                    class="section-name"
                    value={section.name}
                    aria-label={`Name of section ${index + 1}`}
                    onInput={(event) =>
                      updateSection(store, section.id, (draft) => {
                        draft.name = event.currentTarget.value
                      }, false)
                    }
                    onBlur={() => store.edit(() => {})}
                  />
                  <input
                    class="section-bars"
                    type="number"
                    min={1}
                    max={512}
                    value={section.bars}
                    aria-label={`Bars in ${section.name}`}
                    onChange={(event) =>
                      updateSection(store, section.id, (draft) => {
                        draft.bars = Math.max(1, Math.round(Number(event.currentTarget.value) || 1))
                      })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {song.tracks.map((track) => {
              const patterns = song.patterns.filter((pattern) => pattern.track === track.id)
              return (
                <>
                  <tr key={`${track.id}-head`} class="track-group">
                    <th scope="rowgroup" colSpan={song.sections.length + 1}>
                      <span class="swatch" style={{ background: track.colour }} />
                      {track.name}
                      {patterns.length === 0 && <em> — no patterns yet</em>}
                    </th>
                  </tr>
                  {patterns.map((pattern) => (
                    <tr key={pattern.id}>
                      <th scope="row">
                        <button
                          type="button"
                          class="pattern-name"
                          data-selected={state.selection.patternId === pattern.id}
                          onClick={() => {
                            store.select({ patternId: pattern.id, trackId: track.id })
                            store.setView('edit')
                          }}
                          title={`Edit ${pattern.id}`}
                        >
                          {pattern.id}
                          <em>{pattern.bars} bar{pattern.bars === 1 ? '' : 's'}</em>
                        </button>
                      </th>
                      {song.sections.map((section) => {
                        const clip = section.clips.find((candidate) => candidate.pattern === pattern.id)
                        const isSelected =
                          selectedClip?.section === section.id && selectedClip.pattern === pattern.id
                        return (
                          <td key={section.id} data-playing={playingSection === section.id}>
                            <button
                              type="button"
                              class="cell"
                              data-on={Boolean(clip)}
                              data-selected={isSelected}
                              style={clip ? { background: track.colour } : undefined}
                              aria-pressed={Boolean(clip)}
                              aria-label={`${pattern.id} in ${section.name}`}
                              title={
                                clip
                                  ? `${pattern.id} plays in ${section.name}. Click to remove.`
                                  : `Click to play ${pattern.id} in ${section.name}.`
                              }
                              onClick={(event) => {
                                if (clip && (event.altKey || isSelected)) {
                                  setSelectedClip(isSelected ? null : { section: section.id, pattern: pattern.id })
                                  return
                                }
                                toggleClip(store, section.id, pattern.id)
                                store.select({ sectionId: section.id, patternId: pattern.id })
                                setSelectedClip(clip ? null : { section: section.id, pattern: pattern.id })
                              }}
                            >
                              {clip ? repeatLabel(clip.times, clip.transpose) : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedClip && <ClipDetails song={song} section={selectedClip.section} pattern={selectedClip.pattern} />}
    </div>
  )
}

function repeatLabel(times: number | null, transpose: number): string {
  const parts: string[] = []
  if (times !== null) parts.push(`${times}x`)
  if (transpose !== 0) parts.push(`${transpose > 0 ? '+' : ''}${transpose}`)
  return parts.join(' ')
}

function ClipDetails(props: { song: Song; section: string; pattern: string }): JSX.Element | null {
  const { store } = useWorkbench()
  const section = props.song.sections.find((candidate) => candidate.id === props.section)
  const clip = section?.clips.find((candidate) => candidate.pattern === props.pattern)
  const pattern = props.song.patterns.find((candidate) => candidate.id === props.pattern)
  if (!section || !clip || !pattern) return null

  const perBar = beatsPerBar(props.song.timeSignature)
  const fills = Math.max(1, Math.floor((section.bars - clip.at) / pattern.bars))

  return (
    <div class="toolbar" style="border-top: 1px solid var(--line); border-bottom: 0">
      <strong style="font-size: 12px">
        {pattern.id} in {section.name}
      </strong>
      <NumberField
        label="Starts at bar"
        value={clip.at + 1}
        min={1}
        max={section.bars}
        onChange={(value) =>
          updateClip(store, section.id, pattern.id, (draft) => {
            draft.at = Math.max(0, Math.min(section.bars - 1, Math.round(value) - 1))
          })
        }
      />
      <NumberField
        label="Repeats"
        value={clip.times ?? fills}
        min={1}
        max={512}
        onChange={(value) =>
          updateClip(store, section.id, pattern.id, (draft) => {
            draft.times = Math.max(1, Math.round(value))
          })
        }
      />
      {clip.times !== null && (
        <Button
          onClick={() =>
            updateClip(store, section.id, pattern.id, (draft) => {
              draft.times = null
            })
          }
          title="Repeat as many times as fit the section"
        >
          Fill section
        </Button>
      )}
      <NumberField
        label="Transpose"
        value={clip.transpose}
        min={-48}
        max={48}
        onChange={(value) =>
          updateClip(store, section.id, pattern.id, (draft) => {
            draft.transpose = Math.max(-48, Math.min(48, Math.round(value)))
          })
        }
      />
      <span class="hint">
        {clip.times === null ? `fills ${fills} time${fills === 1 ? '' : 's'}` : ''}
        {pattern.bars * (clip.times ?? fills) + clip.at > section.bars
          ? ` — runs past the end of a ${section.bars}-bar section, so the extra repeats are not heard`
          : ''}
        {' · '}
        {perBar} beats per bar
      </span>
    </div>
  )
}

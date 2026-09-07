/**
 * The step editor for drum kits.
 *
 * Plain buttons rather than a canvas. A step grid is at most a few hundred
 * cells, and being real buttons means every one of them is reachable by
 * keyboard and announced by a screen reader with its lane and step number —
 * which a canvas would have to reimplement badly.
 */
import { useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { useAppState, useWorkbench } from './context'
import { clearLane, setStepVelocity, toggleStep, updatePattern } from '../state/actions'
import { beatsPerStep, stepsPerBeat } from '../format/notation'
import { beatsPerBar, type DrumsInstrument, type Pattern, type Track } from '../format/types'
import { Button, useAnimationFrame } from './controls'

export function StepGrid(props: { pattern: Pattern; track: Track }): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const kit = props.track.instrument as DrumsInstrument
  const perBar = beatsPerBar(state.song.timeSignature)
  const perStep = beatsPerStep(props.pattern.grid)
  const stepsInBeat = Math.round(stepsPerBeat(props.pattern.grid))
  const totalSteps = Math.round((props.pattern.bars * perBar) / perStep)
  const painting = useRef<{ turningOn: boolean; velocity: number } | null>(null)
  const [playhead, setPlayhead] = useState(-1)

  useAnimationFrame(true, () => {
    const player = audio.player
    if (!player?.state.playing) {
      if (playhead !== -1) setPlayhead(-1)
      return
    }
    const beats = props.pattern.bars * perBar
    const step = Math.floor(((player.state.beat % beats) + beats) % beats / perStep)
    if (step !== playhead) setPlayhead(step)
  })

  const hitAt = (laneId: string, step: number): { velocity: number } | null => {
    const note = (props.pattern.lanes[laneId] ?? []).find(
      (candidate) => Math.abs(candidate.at - step * perStep) < 1e-6,
    )
    return note ? { velocity: note.velocity } : null
  }

  const velocityFor = (event: { shiftKey: boolean; altKey: boolean }): number =>
    event.shiftKey ? 1 : event.altKey ? 0.45 : 0.8

  return (
    <div class="steps">
      {kit.lanes.map((lane) => (
        <div class="step-lane" key={lane.id}>
          <div class="step-lane-head">
            <button
              type="button"
              class="lane-name"
              title={`Hear ${lane.name}`}
              onClick={() => {
                store.select({ laneId: lane.id })
                void audio.ensure(state.song).then((player) => player?.preview(props.track.id, 60, 0.9, lane.id))
              }}
            >
              {lane.name}
            </button>
            <button
              type="button"
              class="mini"
              title={`Clear the ${lane.name} lane`}
              onClick={() => clearLane(store, props.pattern.id, lane.id)}
            >
              {'×'}
            </button>
          </div>
          <div class="step-cells" role="group" aria-label={`${lane.name} steps`}>
            {Array.from({ length: totalSteps }, (_, step) => {
              const hit = hitAt(lane.id, step)
              const beatStart = step % stepsInBeat === 0
              const barStart = Math.abs((step * perStep) % perBar) < 1e-6
              return (
                <button
                  key={step}
                  type="button"
                  class="step"
                  data-on={Boolean(hit)}
                  data-beat={beatStart}
                  data-bar={barStart}
                  data-playing={playhead === step}
                  aria-pressed={Boolean(hit)}
                  aria-label={`${lane.name}, step ${step + 1}${hit ? `, on at velocity ${Math.round(hit.velocity * 100)}` : ''}`}
                  style={hit ? { background: props.track.colour, opacity: 0.35 + hit.velocity * 0.65 } : undefined}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    const velocity = velocityFor(event)
                    if (hit && Math.abs(hit.velocity - velocity) > 1e-6) {
                      setStepVelocity(store, props.pattern.id, lane.id, step, velocity)
                      painting.current = { turningOn: true, velocity }
                      return
                    }
                    painting.current = { turningOn: !hit, velocity }
                    toggleStep(store, props.pattern.id, lane.id, step, velocity)
                    if (!hit) {
                      void audio
                        .ensure(state.song)
                        .then((player) => player?.preview(props.track.id, 60, velocity, lane.id))
                    }
                  }}
                  onPointerEnter={(event) => {
                    const paint = painting.current
                    if (!paint || event.buttons === 0) return
                    const existing = hitAt(lane.id, step)
                    if (paint.turningOn && !existing) toggleStep(store, props.pattern.id, lane.id, step, paint.velocity)
                    else if (!paint.turningOn && existing) toggleStep(store, props.pattern.id, lane.id, step)
                  }}
                  onPointerUp={() => {
                    painting.current = null
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}

      <p class="hint" style="padding: 10px 12px 0">
        Click to place a hit, drag to paint a run. Hold shift for an accent, alt for a ghost note. Click a lane
        name to hear it.
      </p>
      <div class="row" style="padding: 8px 12px 16px">
        <Button
          onClick={() =>
            updatePattern(store, props.pattern.id, (pattern) => {
              pattern.lanes = {}
            })
          }
        >
          Clear all lanes
        </Button>
      </div>
    </div>
  )
}

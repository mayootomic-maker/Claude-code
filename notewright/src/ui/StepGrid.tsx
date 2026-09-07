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
import { clearLane, setStep, stepContents, updatePattern } from '../state/actions'
import { beatsPerStep, stepsPerBeat } from '../format/notation'
import { beatsPerBar, type DrumsInstrument, type Pattern, type Track } from '../format/types'
import { Button, SelectField, useAnimationFrame } from './controls'

export function StepGrid(props: { pattern: Pattern; track: Track }): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const kit = props.track.instrument as DrumsInstrument
  const perBar = beatsPerBar(state.song.timeSignature)
  const perStep = beatsPerStep(props.pattern.grid)
  const stepsInBeat = Math.round(stepsPerBeat(props.pattern.grid))
  const totalSteps = Math.round((props.pattern.bars * perBar) / perStep)
  const painting = useRef<{ placing: boolean; velocity: number; roll: number } | null>(null)
  const [playhead, setPlayhead] = useState(-1)
  const [roll, setRoll] = useState(1)

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

  const hitAt = (laneId: string, step: number) => stepContents(props.pattern, laneId, step)

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
                  aria-label={`${lane.name}, step ${step + 1}${
                    hit
                      ? hit.count > 1
                        ? `, roll of ${hit.count}`
                        : `, on at velocity ${Math.round(hit.velocity * 100)}`
                      : ''
                  }`}
                  style={hit ? { background: props.track.colour, opacity: 0.35 + hit.velocity * 0.65 } : undefined}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    const velocity = velocityFor(event)
                    // Clicking a cell that already holds exactly what you are
                    // about to place clears it; anything else replaces it, so
                    // changing a hit into a roll is one click, not two.
                    const same = hit && hit.count === roll && Math.abs(hit.velocity - velocity) < 0.06
                    const placing = !same
                    painting.current = { placing, velocity, roll }
                    setStep(store, props.pattern.id, lane.id, step, placing ? { velocity, roll } : { clear: true })
                    if (placing) {
                      void audio
                        .ensure(state.song)
                        .then((player) => player?.preview(props.track.id, 60, velocity, lane.id))
                    }
                  }}
                  onPointerEnter={(event) => {
                    const paint = painting.current
                    if (!paint || event.buttons === 0) return
                    const existing = hitAt(lane.id, step)
                    if (paint.placing && !existing) {
                      setStep(store, props.pattern.id, lane.id, step, { velocity: paint.velocity, roll: paint.roll })
                    } else if (!paint.placing && existing) {
                      setStep(store, props.pattern.id, lane.id, step, { clear: true })
                    }
                  }}
                  onPointerUp={() => {
                    painting.current = null
                  }}
                >
                  {hit && hit.count > 1 ? <span class="roll-count">{hit.count}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div class="row" style="padding: 10px 12px 0">
        <SelectField
          label="Roll"
          value={String(roll)}
          options={[
            { value: '1', label: 'Off — single hits' },
            { value: '2', label: '2 hits per step' },
            { value: '3', label: '3 — triplet' },
            { value: '4', label: '4' },
            { value: '6', label: '6' },
            { value: '8', label: '8' },
          ]}
          onChange={(value) => setRoll(Number(value))}
        />
        <span class="hint">
          Click to place, drag to paint a run. Shift for an accent, alt for a ghost. Rolls ramp up in velocity
          and stay one character in the file.
        </span>
      </div>
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

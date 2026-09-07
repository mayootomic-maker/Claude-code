/**
 * The piano roll.
 *
 * Two stacked canvases: one holds the grid and the notes and is redrawn only
 * when they change, the other holds the playhead and is cleared and redrawn
 * every frame. Drawing several thousand notes sixty times a second to move one
 * vertical line is the difference between a smooth playhead and a stuttering
 * one on a laptop that is also rendering audio.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { useAppState, useWorkbench } from './context'
import { addNotes, removeNotes, replaceNotes } from '../state/actions'
import { beatsPerStep } from '../format/notation'
import type { Note } from '../format/notation'
import { chordFromScale, isBlackKey, isInKey, midiToNote, parseKey, snapToKey } from '../engine/theory'
import { beatsPerBar, type Pattern, type Track } from '../format/types'
import { useAnimationFrame } from './controls'

const ROW = 15
const KEYBOARD_WIDTH = 56
const LOW = 12
const HIGH = 108
const ROWS = HIGH - LOW

interface Geometry {
  pixelsPerBeat: number
  totalBeats: number
  width: number
  height: number
}

type DragKind = 'move' | 'resize' | 'velocity'

interface Drag {
  kind: DragKind
  indices: number[]
  startBeat: number
  startPitch: number
  original: Note[]
  moved: boolean
}

export interface RollTools {
  /** 1 places single notes; 3 and 4 stamp chords built from the song's key. */
  chordTones: number
  /** Pull every note placed or dragged onto the nearest note of the key. */
  keepInKey: boolean
}

export function PianoRoll(props: { pattern: Pattern; track: Track; zoom: number; tools: RollTools }): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const song = state.song
  const gridRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const keysRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [lastLength, setLastLength] = useState<number | null>(null)
  const [hover, setHover] = useState<{ beat: number; pitch: number } | null>(null)

  const perBar = beatsPerBar(song.timeSignature)
  const step = beatsPerStep(props.pattern.grid)
  const geometry: Geometry = {
    pixelsPerBeat: 46 * props.zoom,
    totalBeats: props.pattern.bars * perBar,
    width: props.pattern.bars * perBar * 46 * props.zoom,
    height: ROWS * ROW,
  }
  const key = parseKey(song.key)
  const selected = state.selection.notes

  const noteAt = useCallback(
    (beat: number, pitch: number): number => {
      const notes = props.pattern.notes
      for (let index = notes.length - 1; index >= 0; index--) {
        const note = notes[index]!
        if (note.pitch === pitch && beat >= note.at && beat < note.at + note.length) return index
      }
      return -1
    },
    [props.pattern.notes],
  )

  const drawGrid = useCallback(() => {
    const canvas = gridRef.current
    if (!canvas) return
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(geometry.width * scale))
    canvas.height = Math.max(1, Math.round(geometry.height * scale))
    canvas.style.width = `${geometry.width}px`
    canvas.style.height = `${geometry.height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(scale, 0, 0, scale, 0, 0)

    context.fillStyle = '#0d1016'
    context.fillRect(0, 0, geometry.width, geometry.height)

    // Rows: black keys darker, and notes outside the song's key darker still,
    // so the scale is visible without having to remember it.
    for (let pitch = LOW; pitch < HIGH; pitch++) {
      const y = (HIGH - 1 - pitch) * ROW
      const inKey = isInKey(pitch, key)
      context.fillStyle = isBlackKey(pitch) ? (inKey ? '#12161d' : '#0f1218') : inKey ? '#171c25' : '#121620'
      context.fillRect(0, y, geometry.width, ROW)
      if (pitch % 12 === key.root) {
        context.fillStyle = 'rgba(92, 200, 255, 0.05)'
        context.fillRect(0, y, geometry.width, ROW)
      }
      context.strokeStyle = '#0a0d12'
      context.beginPath()
      context.moveTo(0, y + 0.5)
      context.lineTo(geometry.width, y + 0.5)
      context.stroke()
    }

    for (let beat = 0; beat <= geometry.totalBeats + 1e-9; beat += step) {
      const x = Math.round(beat * geometry.pixelsPerBeat) + 0.5
      const onBar = Math.abs(beat % perBar) < 1e-6
      const onBeat = Math.abs(beat % 1) < 1e-6
      context.strokeStyle = onBar ? '#3b4657' : onBeat ? '#262e3a' : '#191f28'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, geometry.height)
      context.stroke()
    }

    props.pattern.notes.forEach((note, index) => {
      const x = note.at * geometry.pixelsPerBeat
      const width = Math.max(3, note.length * geometry.pixelsPerBeat - 1)
      const y = (HIGH - 1 - note.pitch) * ROW
      if (note.pitch < LOW || note.pitch >= HIGH) return
      const isSelected = selected.includes(index)
      context.globalAlpha = 0.35 + note.velocity * 0.65
      context.fillStyle = props.track.colour
      context.fillRect(x, y + 1, width, ROW - 2)
      context.globalAlpha = 1
      if (isSelected) {
        context.strokeStyle = '#ffffff'
        context.lineWidth = 1.5
        context.strokeRect(x + 0.75, y + 1.75, width - 1.5, ROW - 3.5)
      }
      // A grab handle, so the resize edge is discoverable rather than guessed.
      if (width > 12) {
        context.fillStyle = 'rgba(0, 0, 0, 0.35)'
        context.fillRect(x + width - 3, y + 3, 2, ROW - 6)
      }
    })
  }, [geometry.height, geometry.pixelsPerBeat, geometry.totalBeats, geometry.width, key, perBar, props.pattern.notes, props.track.colour, selected, step])

  const drawKeys = useCallback(() => {
    const canvas = keysRef.current
    if (!canvas) return
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.round(KEYBOARD_WIDTH * scale)
    canvas.height = Math.round(geometry.height * scale)
    canvas.style.width = `${KEYBOARD_WIDTH}px`
    canvas.style.height = `${geometry.height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.font = '10px ui-monospace, monospace'
    context.textBaseline = 'middle'
    context.textAlign = 'right'
    context.fillStyle = '#0d1016'
    context.fillRect(0, 0, KEYBOARD_WIDTH, geometry.height)

    for (let pitch = LOW; pitch < HIGH; pitch++) {
      const y = (HIGH - 1 - pitch) * ROW
      const black = isBlackKey(pitch)
      // Black keys stop short of the grid, the way they stop short on a piano.
      // Equal rows make a piano roll usable; the inset is what still makes the
      // column read as a keyboard rather than as stripes.
      context.fillStyle = black ? '#1b212b' : '#dfe6ef'
      context.fillRect(0, y, black ? KEYBOARD_WIDTH - 18 : KEYBOARD_WIDTH, ROW - 1)
      if (pitch % 12 === 0) {
        context.fillStyle = '#4a5462'
        context.fillText(midiToNote(pitch), KEYBOARD_WIDTH - 5, y + ROW / 2)
      }
    }

    context.strokeStyle = '#232a36'
    context.beginPath()
    context.moveTo(KEYBOARD_WIDTH - 0.5, 0)
    context.lineTo(KEYBOARD_WIDTH - 0.5, geometry.height)
    context.stroke()
  }, [geometry.height])

  /** Clicking a key sounds it on this track, which is how you find a note by ear. */
  const playKey = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pitch = HIGH - 1 - Math.floor((event.clientY - bounds.top) / ROW)
    if (pitch < LOW || pitch >= HIGH) return
    void audio.ensure(song).then((player) => {
      const stop = player?.preview(props.track.id, pitch, 0.85)
      if (stop) setTimeout(stop, 700)
    })
  }

  useLayoutEffect(drawGrid, [drawGrid])
  useLayoutEffect(drawKeys, [drawKeys])

  // Start looking at the notes, not at the bottom of a piano nobody uses.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const pitches = props.pattern.notes.map((note) => note.pitch)
    const centre = pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 60
    scroller.scrollTop = Math.max(0, (HIGH - 1 - centre) * ROW - scroller.clientHeight / 2)
    // Only on a change of pattern: re-centring while someone is editing would
    // yank the view out from under them.
     
  }, [props.pattern.id])

  useAnimationFrame(true, () => {
    const canvas = overlayRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const scale = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(geometry.width * scale) || canvas.height !== Math.round(geometry.height * scale)) {
      canvas.width = Math.max(1, Math.round(geometry.width * scale))
      canvas.height = Math.max(1, Math.round(geometry.height * scale))
      canvas.style.width = `${geometry.width}px`
      canvas.style.height = `${geometry.height}px`
    }
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, geometry.width, geometry.height)

    const player = audio.player
    if (player?.state.playing) {
      // The playhead shows where in *this pattern* the song currently is, which
      // is only meaningful while a section containing it is playing.
      const beat = player.state.beat % geometry.totalBeats
      const x = beat * geometry.pixelsPerBeat
      context.strokeStyle = 'rgba(255,255,255,0.75)'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(x + 0.5, 0)
      context.lineTo(x + 0.5, geometry.height)
      context.stroke()
    }

    if (hover && !dragRef.current) {
      const x = hover.beat * geometry.pixelsPerBeat
      const y = (HIGH - 1 - hover.pitch) * ROW
      context.strokeStyle = 'rgba(255,255,255,0.25)'
      context.setLineDash([3, 3])
      context.strokeRect(x + 0.5, y + 1.5, Math.max(3, (lastLength ?? step) * geometry.pixelsPerBeat - 1), ROW - 3)
      context.setLineDash([])
    }
  })

  const positionOf = (event: PointerEvent | MouseEvent): { beat: number; pitch: number; raw: number } => {
    const canvas = gridRef.current!
    const bounds = canvas.getBoundingClientRect()
    const raw = (event.clientX - bounds.left) / geometry.pixelsPerBeat
    const pitch = HIGH - 1 - Math.floor((event.clientY - bounds.top) / ROW)
    return { beat: Math.max(0, Math.floor(raw / step) * step), pitch, raw: Math.max(0, raw) }
  }

  const onPointerDown = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    const { beat, pitch, raw } = positionOf(event)
    if (pitch < LOW || pitch >= HIGH) return
    const index = noteAt(raw, pitch)
    const canvas = event.currentTarget
    canvas.setPointerCapture(event.pointerId)

    if (index < 0) {
      if (event.button === 2) return
      const length = lastLength ?? step
      const root = props.tools.keepInKey ? snapToKey(pitch, key) : pitch
      const pitches =
        props.tools.chordTones > 1 ? chordFromScale(key, root, props.tools.chordTones) : [root]
      addNotes(
        store,
        props.pattern.id,
        pitches.map((member) => ({ at: beat, pitch: member, length, velocity: 0.8 })),
      )
      // Notes are kept sorted, so a new one is not simply the last: find them
      // by where they landed, or the selection highlights somebody else's note.
      const written = store.get().song.patterns.find((candidate) => candidate.id === props.pattern.id)
      const placed = pitches
        .map((member) =>
          written?.notes.findIndex(
            (candidate) => Math.abs(candidate.at - beat) < 1e-9 && candidate.pitch === member,
          ) ?? -1,
        )
        .filter((position) => position >= 0)
      store.select({ notes: placed })
      void audio.ensure(song).then((player) => {
        for (const member of pitches) player?.preview(props.track.id, member, 0.8)
      })
      return
    }

    if (event.button === 2 || event.altKey) {
      removeNotes(store, props.pattern.id, selected.includes(index) ? selected : [index])
      store.select({ notes: [] })
      return
    }

    const note = props.pattern.notes[index]!
    const indices = event.shiftKey
      ? selected.includes(index)
        ? selected
        : [...selected, index]
      : selected.includes(index)
        ? selected
        : [index]
    store.select({ notes: indices })

    const nearEnd = raw > note.at + note.length - Math.min(0.25, note.length * 0.35)
    store.beginGesture()
    dragRef.current = {
      kind: nearEnd ? 'resize' : 'move',
      indices,
      startBeat: raw,
      startPitch: pitch,
      original: props.pattern.notes.map((candidate) => ({ ...candidate })),
      moved: false,
    }
    void audio.ensure(song).then((player) => player?.preview(props.track.id, note.pitch, note.velocity))
  }

  const onPointerMove = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>): void => {
    const { beat, pitch, raw } = positionOf(event)
    const drag = dragRef.current
    if (!drag) {
      if (!hover || hover.beat !== beat || hover.pitch !== pitch) setHover({ beat, pitch })
      return
    }

    const deltaBeats = Math.round((raw - drag.startBeat) / step) * step
    const deltaPitch = pitch - drag.startPitch
    if (deltaBeats === 0 && deltaPitch === 0 && !drag.moved) return
    drag.moved = true

    const next = drag.original.map((note, index) => {
      if (!drag.indices.includes(index)) return { ...note }
      if (drag.kind === 'resize') {
        return { ...note, length: Math.max(step, Math.round((note.length + deltaBeats) / step) * step) }
      }
      const moved = Math.max(0, Math.min(127, note.pitch + deltaPitch))
      return {
        ...note,
        at: Math.max(0, note.at + deltaBeats),
        pitch: props.tools.keepInKey ? snapToKey(moved, key) : moved,
      }
    })
    replaceNotes(store, props.pattern.id, next, false)
  }

  const endDrag = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag?.kind === 'resize' && drag.moved) {
      const first = drag.indices[0]
      const note = first === undefined ? undefined : store.get().song.patterns.find((p) => p.id === props.pattern.id)?.notes[first]
      if (note) setLastLength(note.length)
    }
  }

  return (
    <div class="roll-scroll" ref={scrollRef}>
      <div class="roll-body" style={{ height: `${geometry.height}px` }}>
        <canvas
          ref={keysRef}
          class="roll-keys"
          role="button"
          aria-label={`Keyboard for ${props.track.name}. Click a key to hear it.`}
          onPointerDown={playKey}
        />
        <div class="roll-grid" style={{ width: `${geometry.width}px`, height: `${geometry.height}px` }}>
          <canvas
            ref={gridRef}
            tabIndex={0}
            role="application"
            aria-label={`Notes in ${props.pattern.id}. Click to add, drag to move, alt-click to delete.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(event) => event.preventDefault()}
          />
          <canvas ref={overlayRef} class="roll-overlay" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

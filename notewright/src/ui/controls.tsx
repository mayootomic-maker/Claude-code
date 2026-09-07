/**
 * The controls a studio interface is made of.
 *
 * Every one of them is operable three ways — drag, type, and keyboard — because
 * a knob you can only drag is unusable for anyone who needs precision or cannot
 * use a mouse, and a number field alone makes sweeping a filter miserable.
 *
 * Note the lowercase `tabindex` on the SVG controls. Preact applies tabIndex
 * with setAttribute rather than as a property, and unlike HTML, SVG attribute
 * names are case-sensitive — so the camelCase spelling silently produces an
 * attribute the browser ignores, and every knob in the application becomes
 * unreachable by keyboard. The browser test presses arrow keys on one to make
 * sure this stays fixed.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'

export interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  /** `log` spaces the travel by ratio, which is how frequency should feel. */
  curve?: 'linear' | 'log'
  step?: number
  unit?: string
  /** The value a double-click returns to. */
  resetTo?: number
  format?: (value: number) => string
  onChange: (value: number) => void
  onCommit?: () => void
  onBegin?: () => void
}

function toFraction(value: number, min: number, max: number, curve: 'linear' | 'log'): number {
  if (curve === 'log') {
    const low = Math.log(Math.max(min, 1e-6))
    const high = Math.log(Math.max(max, 1e-6))
    return (Math.log(Math.max(value, 1e-6)) - low) / (high - low)
  }
  return (value - min) / (max - min)
}

function fromFraction(fraction: number, min: number, max: number, curve: 'linear' | 'log'): number {
  const clamped = Math.min(1, Math.max(0, fraction))
  if (curve === 'log') {
    const low = Math.log(Math.max(min, 1e-6))
    const high = Math.log(Math.max(max, 1e-6))
    return Math.exp(low + clamped * (high - low))
  }
  return min + clamped * (max - min)
}

function defaultFormat(value: number, unit: string): string {
  const magnitude = Math.abs(value)
  if (unit === 'Hz' && magnitude >= 1000) return `${(value / 1000).toFixed(magnitude >= 10000 ? 1 : 2)}k`
  if (magnitude >= 100) return value.toFixed(0)
  if (magnitude >= 10) return value.toFixed(1)
  if (magnitude >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

/** Travel in pixels for the full range. Long enough to be precise, short enough to be quick. */
const KNOB_TRAVEL = 190
const ARC_START = 135
const ARC_SWEEP = 270

export function Knob(props: KnobProps): JSX.Element {
  const { label, value, min, max, curve = 'linear', unit = '', onChange } = props
  const dragging = useRef<{ startY: number; startFraction: number } | null>(null)
  const fraction = Math.min(1, Math.max(0, toFraction(value, min, max, curve)))

  const quantise = useCallback(
    (raw: number): number => {
      const bounded = Math.min(max, Math.max(min, raw))
      if (!props.step) return bounded
      return Math.round(bounded / props.step) * props.step
    },
    [max, min, props.step],
  )

  const onPointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = { startY: event.clientY, startFraction: fraction }
    props.onBegin?.()
  }

  const onPointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const drag = dragging.current
    if (!drag) return
    // Shift slows the knob down rather than speeding it up: fine adjustment is
    // the thing people reach for a modifier to get.
    const scale = event.shiftKey ? 0.22 : 1
    const moved = (drag.startY - event.clientY) / KNOB_TRAVEL
    onChange(quantise(fromFraction(drag.startFraction + moved * scale, min, max, curve)))
  }

  const endDrag = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    props.onCommit?.()
  }

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<SVGSVGElement>): void => {
    const coarse = event.shiftKey ? 0.001 : event.altKey ? 0.1 : 0.02
    let next: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = fraction + coarse
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = fraction - coarse
    else if (event.key === 'PageUp') next = fraction + 0.1
    else if (event.key === 'PageDown') next = fraction - 0.1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === null) return
    event.preventDefault()
    onChange(quantise(fromFraction(next, min, max, curve)))
    props.onCommit?.()
  }

  const angle = ARC_START + fraction * ARC_SWEEP
  const point = (degrees: number, radius: number): string => {
    const radians = (degrees * Math.PI) / 180
    return `${19 + Math.cos(radians) * radius} ${19 + Math.sin(radians) * radius}`
  }
  const arc = (from: number, to: number, radius: number): string =>
    `M ${point(from, radius)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, radius)}`

  const shown = props.format ? props.format(value) : `${defaultFormat(value, unit)}${unit ? ` ${unit}` : ''}`

  return (
    <div class="knob">
      <svg
        class="knob-dial"
        viewBox="0 0 38 38"
        role="slider"
        tabindex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={shown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDblClick={() => {
          if (props.resetTo === undefined) return
          onChange(props.resetTo)
          props.onCommit?.()
        }}
      >
        <path d={arc(ARC_START, ARC_START + ARC_SWEEP, 14)} fill="none" stroke="#2b3340" stroke-width="4" stroke-linecap="round" />
        <path
          d={arc(ARC_START, Math.max(ARC_START + 0.01, angle), 14)}
          fill="none"
          stroke="var(--accent)"
          stroke-width="4"
          stroke-linecap="round"
        />
        <line
          x1={point(angle, 4).split(' ')[0]}
          y1={point(angle, 4).split(' ')[1]}
          x2={point(angle, 11).split(' ')[0]}
          y2={point(angle, 11).split(' ')[1]}
          stroke="var(--text)"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span class="knob-label">{label}</span>
      <span class="knob-value">{shown}</span>
    </div>
  )
}

export interface FaderProps {
  label: string
  /** Decibels. */
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  onBegin?: () => void
  onCommit?: () => void
}

export function Fader(props: FaderProps): JSX.Element {
  const { value, min = -60, max = 6, onChange } = props
  const dragging = useRef<{ startY: number; startValue: number } | null>(null)
  const fraction = (value - min) / (max - min)

  const onPointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = { startY: event.clientY, startValue: value }
    props.onBegin?.()
  }
  const onPointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const drag = dragging.current
    if (!drag) return
    const scale = event.shiftKey ? 0.25 : 1
    const moved = ((drag.startY - event.clientY) / 120) * (max - min) * scale
    onChange(Math.max(min, Math.min(max, drag.startValue + moved)))
  }
  const endDrag = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    props.onCommit?.()
  }
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<SVGSVGElement>): void => {
    const amount = event.shiftKey ? 0.1 : 1
    let next: number | null = null
    if (event.key === 'ArrowUp') next = value + amount
    else if (event.key === 'ArrowDown') next = value - amount
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = min
    if (next === null) return
    event.preventDefault()
    onChange(Math.max(min, Math.min(max, next)))
    props.onCommit?.()
  }

  const height = 132
  const knobY = 8 + (1 - fraction) * (height - 16)

  return (
    <svg
      class="fader"
      viewBox={`0 0 26 ${height}`}
      role="slider"
      tabindex={0}
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(1))}
      aria-valuetext={`${value.toFixed(1)} decibels`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDblClick={() => {
        onChange(0)
        props.onCommit?.()
      }}
    >
      <rect x="11" y="6" width="4" height={height - 12} rx="2" fill="#0a0e14" stroke="#252b36" />
      {/* Unity is marked, because "back to zero" is the most common move on a fader. */}
      <line x1="6" x2="20" y1={8 + (1 - (0 - min) / (max - min)) * (height - 16)} y2={8 + (1 - (0 - min) / (max - min)) * (height - 16)} stroke="#39424f" stroke-width="1" />
      <rect x="4" y={knobY - 5} width="18" height="10" rx="3" fill="#2b3542" stroke="#4b5666" />
      <line x1="7" x2="19" y1={knobY} y2={knobY} stroke="var(--accent)" stroke-width="1.5" />
    </svg>
  )
}

export function Meter(props: { level: number; wide?: boolean; tall?: boolean; label: string }): JSX.Element {
  // Decibels, not amplitude: a linear meter spends nine tenths of its travel on
  // the top ten decibels and shows nothing useful.
  const db = 20 * Math.log10(Math.max(props.level, 1e-5))
  const fraction = Math.max(0, Math.min(1, (db + 54) / 54))
  return (
    <div
      class={`meter${props.wide ? ' meter-wide' : ''}${props.tall ? ' meter-tall' : ''}`}
      title={`${props.label}: ${db > -54 ? `${db.toFixed(1)} dB` : 'silent'}`}
    >
      <i style={props.wide ? { width: `${fraction * 100}%` } : { height: `${fraction * 100}%` }} />
    </div>
  )
}

/**
 * A caption beside a control.
 *
 * The controls below set `aria-label` on the input itself rather than relying
 * on this wrapper. A `<label>` wrapped around a `<select>` takes its accessible
 * name from all the text inside it — which includes every option — so a screen
 * reader announced one of these as "Roll, Off single hits, 2 hits per step, 3
 * triplet…". The explicit label is the whole name and nothing else.
 */
export function Field(props: {
  label: string
  children: JSX.Element | JSX.Element[]
}): JSX.Element {
  return (
    <label class="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

export function NumberField(props: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Field label={props.label}>
      <input
        type="number"
        aria-label={props.label}
        value={draft ?? String(props.value)}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => {
          setDraft(null)
          const parsed = Number(event.currentTarget.value)
          if (Number.isFinite(parsed)) props.onChange(parsed)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
    </Field>
  )
}

export function TextField(props: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <Field label={props.label}>
      <input
        type="text"
        aria-label={props.label}
        value={props.value}
        placeholder={props.placeholder}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

export function SelectField<T extends string>(props: {
  label: string
  value: T
  options: readonly T[] | readonly { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  const options = props.options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )
  return (
    <Field label={props.label}>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <label class="switch">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

export function Button(props: {
  children: JSX.Element | string | (JSX.Element | string)[]
  onClick: () => void
  title?: string
  active?: boolean
  disabled?: boolean
  tone?: 'primary' | 'danger'
  icon?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      class={props.icon ? 'button icon' : 'button'}
      data-active={props.active ? 'true' : undefined}
      data-tone={props.tone}
      title={props.title}
      aria-label={props.icon ? props.title : undefined}
      aria-pressed={props.active === undefined ? undefined : props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** A group of knobs with a heading, which is how a synth panel reads. */
export function Bank(props: { title: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h4 class="subhead" id={id}>
        {props.title}
      </h4>
      <div class="knob-row">{props.children}</div>
    </section>
  )
}

/** Runs a callback on every animation frame while `active`. Used by the meters. */
export function useAnimationFrame(active: boolean, callback: () => void): void {
  const latest = useRef(callback)
  latest.current = callback
  useEffect(() => {
    if (!active) return undefined
    let handle = 0
    const tick = (): void => {
      latest.current()
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [active])
}

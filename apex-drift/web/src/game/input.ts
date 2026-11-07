import { clamp, lerp, smoothstep } from '../core/math'
import type { Input } from '../sim/car'
import type { Settings } from './save'

type Ctl = 'left' | 'right' | 'gas' | 'brake' | 'hand'

/**
 * Merges touch buttons, tilt, keyboard and gamepad into one smoothed input.
 * Digital steering ramps rather than snapping, so a tap is a small correction
 * and a hold is a full turn. The ramp is quick at town speeds and gentler on
 * a fast road, where the same press asks far more of the tyres; letting go or
 * switching sides returns through the centre at once, so a correction never
 * waits for the last one to unwind.
 */
export class Controls {
  private held = new Set<Ctl>()
  private keys = new Set<string>()
  private tilt = 0
  private steer = 0
  /** Gamepad buttons held last frame, so a press fires its action once. */
  private padPrev: boolean[] = []
  /** Edge-triggered actions for the HUD buttons and keyboard shortcuts. */
  onAction: ((a: 'pause' | 'reset' | 'camera' | 'rewind') => void) | null = null
  private readonly cleanup: (() => void)[] = []

  constructor(private settings: () => Settings) {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'Escape' || e.code === 'KeyP') this.onAction?.('pause')
      if (e.code === 'KeyR') this.onAction?.('reset')
      if (e.code === 'KeyQ' || e.code === 'Backspace') this.onAction?.('rewind')
      if (e.code === 'KeyC') this.onAction?.('camera')
    }
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code)
    const blur = () => {
      this.keys.clear()
      this.held.clear()
    }
    const orient = (e: DeviceOrientationEvent) => {
      // Landscape: the steering axis is beta (front/back) rotated by screen angle.
      const angle = screen.orientation?.angle ?? 0
      const raw = (angle === 90 ? e.beta : angle === 270 || angle === -90 ? -(e.beta ?? 0) : e.gamma) ?? 0
      this.tilt = clamp(raw / 28, -1, 1) * (this.settings().tiltInvert ? -1 : 1)
    }
    addEventListener('keydown', kd)
    addEventListener('keyup', ku)
    addEventListener('blur', blur)
    addEventListener('deviceorientation', orient)
    this.cleanup.push(() => {
      removeEventListener('keydown', kd)
      removeEventListener('keyup', ku)
      removeEventListener('blur', blur)
      removeEventListener('deviceorientation', orient)
    })
  }

  /** Wires the on-screen buttons. Pointer capture means sliding a finger off a button still releases it. */
  bindTouch(root: HTMLElement): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-ctl]')) {
      const ctl = el.dataset.ctl as Ctl
      const down = (e: PointerEvent) => {
        e.preventDefault()
        el.setPointerCapture?.(e.pointerId)
        this.held.add(ctl)
        el.classList.add('on')
      }
      const up = () => {
        this.held.delete(ctl)
        el.classList.remove('on')
      }
      el.addEventListener('pointerdown', down)
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, up)
    }
  }

  release(): void {
    this.held.clear()
    this.keys.clear()
    this.steer = 0
  }

  /** `speed` (m/s) sets how fast a held steering key ramps in. */
  read(dt: number, speed = 0): Input {
    const s = this.settings()
    const k = this.keys
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null
    if (pad) {
      const edge = (i: number) => !!pad.buttons[i]?.pressed && !this.padPrev[i]
      if (edge(9)) this.onAction?.('pause')
      if (edge(2)) this.onAction?.('rewind')
      if (edge(3)) this.onAction?.('camera')
      if (edge(8)) this.onAction?.('reset')
      this.padPrev = pad.buttons.map((b) => b.pressed)
    }
    let target = 0
    const left = this.held.has('left') || k.has('ArrowLeft') || k.has('KeyA')
    const right = this.held.has('right') || k.has('ArrowRight') || k.has('KeyD')
    if (left !== right) target = left ? -1 : 1
    let analog: number | null = null
    if (s.steering === 'tilt') analog = this.tilt
    if (pad && Math.abs(pad.axes[0] ?? 0) > 0.08) analog = pad.axes[0]
    if (analog !== null && target === 0) {
      // Analog steering: a gentle curve near the centre for fine control.
      this.steer = Math.sign(analog) * Math.pow(Math.abs(analog), 1.4) * s.sensitivity
    } else {
      const reversing = target !== 0 && this.steer * target < 0
      // Full lock in about 0.12 s around hairpins, 0.25 s at 150 km/h.
      const build = lerp(8.5, 4, smoothstep(12, 40, speed))
      const rate = (target === 0 ? 11 : reversing ? 16 : build) * s.sensitivity
      // A fresh press starts from a small bite rather than from nothing, so a tap always does something.
      if (target !== 0 && Math.abs(this.steer) < 0.15) this.steer = target * 0.15
      this.steer += clamp(target - this.steer, -rate * dt, rate * dt)
    }
    const brake = this.held.has('brake') || k.has('ArrowDown') || k.has('KeyS') || (pad?.buttons[6]?.value ?? 0) > 0.2
    const hand = this.held.has('hand') || k.has('Space') || !!pad?.buttons[0]?.pressed
    const gasHeld = this.held.has('gas') || k.has('ArrowUp') || k.has('KeyW') || (pad?.buttons[7]?.value ?? 0) > 0.2
    const gas = gasHeld || (s.autoGas && !brake && !hand)
    return {
      steer: clamp(this.steer, -1, 1),
      throttle: gas ? (pad?.buttons[7]?.value && !this.held.has('gas') ? pad.buttons[7].value : 1) : 0,
      brake: brake ? (pad?.buttons[6]?.value || 1) : 0,
      handbrake: hand,
    }
  }

  dispose(): void {
    for (const c of this.cleanup) c()
  }
}

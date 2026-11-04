import { clamp } from '../core/math'
import type { Input } from '../sim/car'
import type { Settings } from './save'

type Ctl = 'left' | 'right' | 'gas' | 'brake' | 'hand'

/**
 * Merges touch buttons, tilt, keyboard and gamepad into one smoothed input.
 * Digital steering ramps rather than snapping, so a tap is a small correction
 * and a hold is a full turn.
 */
export class Controls {
  private held = new Set<Ctl>()
  private keys = new Set<string>()
  private tilt = 0
  private steer = 0
  /** Edge-triggered actions for the HUD buttons and keyboard shortcuts. */
  onAction: ((a: 'pause' | 'reset' | 'camera') => void) | null = null
  private readonly cleanup: (() => void)[] = []

  constructor(private settings: () => Settings) {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'Escape' || e.code === 'KeyP') this.onAction?.('pause')
      if (e.code === 'KeyR') this.onAction?.('reset')
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

  read(dt: number): Input {
    const s = this.settings()
    const k = this.keys
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null
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
      const rate = (target === 0 ? 7 : 3.2) * s.sensitivity
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

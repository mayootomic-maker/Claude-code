/**
 * Humanised aiming.
 *
 * `bot.look(yaw, pitch)` snaps the head to an exact angle in one tick. Nothing
 * a person does looks like that, and no amount of care elsewhere survives it —
 * instant perfect aim is the single most visible tell a bot has.
 *
 * What people actually do when pointing at something is well studied, and this
 * implements it:
 *
 *  - **Fitts's law** sets the duration. Time scales with the log of distance
 *    over target size, so far-and-small takes longer than near-and-large.
 *  - **Minimum-jerk** sets the shape. Human reaching follows a smooth
 *    S-shaped velocity profile, not a straight ramp — slow, fast, slow.
 *  - **Overshoot and correction.** The first ballistic movement lands near but
 *    not on the target; one or two smaller submovements close the gap. This is
 *    why real aim wobbles into place instead of arriving.
 *  - **Tremor.** An Ornstein-Uhlenbeck process adds drift that wanders and
 *    pulls back, which is what a resting hand does. White noise would read as a
 *    vibration; a random walk would drift off the target and never return.
 */

import { OrnsteinUhlenbeck, Rng } from '../util/random.js'
import { personaRng, type Persona } from './profile.js'

export interface Orientation {
  /** Radians. */
  readonly yaw: number
  /** Radians. */
  readonly pitch: number
}

interface Submovement {
  readonly from: Orientation
  readonly to: Orientation
  readonly duration: number
}

/** Shortest signed angular difference, so aiming never takes the long way round. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function angularDistance(a: Orientation, b: Orientation): number {
  const dy = angleDelta(a.yaw, b.yaw)
  const dp = b.pitch - a.pitch
  return Math.hypot(dy, dp)
}

/**
 * The minimum-jerk position profile.
 *
 * The unique trajectory that minimises the integral of squared jerk between two
 * points, and the standard model of human reaching. Zero velocity and
 * acceleration at both ends, which is what makes it look unforced.
 */
export function minimumJerk(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t
  return u * u * u * (10 - 15 * u + 6 * u * u)
}

export class Aim {
  private current: Orientation = { yaw: 0, pitch: 0 }
  private queue: Submovement[] = []
  private elapsed = 0
  private readonly rng: Rng
  private readonly tremorYaw: OrnsteinUhlenbeck
  private readonly tremorPitch: OrnsteinUhlenbeck

  constructor(
    private readonly persona: Persona,
    /** Multiplier on every duration, from the fatigue model. */
    private readonly fatigue: () => number = () => 1,
  ) {
    this.rng = personaRng(persona, 'aim')
    const theta = 3.2
    const sigma = (persona.tremor * Math.PI) / 180
    this.tremorYaw = new OrnsteinUhlenbeck(this.rng, theta, sigma)
    this.tremorPitch = new OrnsteinUhlenbeck(this.rng, theta, sigma * 0.7)
  }

  get orientation(): Orientation {
    return this.current
  }

  get busy(): boolean {
    return this.queue.length > 0
  }

  /** Snap without animating. For teleports and respawns, not for aiming. */
  reset(orientation: Orientation): void {
    this.current = orientation
    this.queue = []
    this.elapsed = 0
  }

  /**
   * Plan a movement to a new orientation.
   *
   * `targetWidth` is the angular size of the thing being aimed at, in radians;
   * a nearby block is a wide target and a distant mob's head is a narrow one.
   * Wider targets are acquired faster and less precisely, which is correct: you
   * do not carefully centre the crosshair on a wall you are about to mine.
   */
  moveTo(target: Orientation, targetWidth = 0.12): void {
    const distance = angularDistance(this.current, target)
    if (distance < 1e-4) {
      this.current = target
      this.queue = []
      return
    }

    const total = this.duration(distance, targetWidth)
    const moves: Submovement[] = []
    let from = this.current

    // Ballistic phase: fast, and deliberately not accurate. It lands short
    // more often than long, but it does go long — an approach that only ever
    // creeps up on the target from one side never reverses direction, and that
    // monotonic settle is itself a machine signature.
    const overshoots = this.rng.chance(0.35)
    const spread = 1 - this.persona.aimPrecision
    const precision = overshoots
      ? 1 + this.rng.range(0.15, 1.1) * spread
      : 1 - this.rng.range(0.2, 1.2) * spread
    const ballistic = this.interpolate(from, target, precision)
    moves.push({ from, to: ballistic, duration: total * 0.72 })
    from = ballistic

    // Corrective phase: one or two smaller movements that close the remaining
    // gap. Two when the first one landed badly, which is also what people do.
    const corrections = this.rng.chance(0.35) ? 2 : 1
    for (let i = 0; i < corrections; i++) {
      const last = i === corrections - 1
      const to = last ? target : this.interpolate(from, target, 0.7)
      moves.push({ from, to, duration: (total * 0.28) / corrections })
      from = to
    }

    this.queue = moves
    this.elapsed = 0
  }

  /**
   * Advance by `dt` seconds and return where the head is now.
   *
   * Tremor is applied on top of the planned path, so it is present whether the
   * bot is mid-movement or standing still.
   */
  step(dt: number): Orientation {
    let remaining = dt
    while (remaining > 0 && this.queue.length > 0) {
      const move = this.queue[0]!
      const left = move.duration - this.elapsed
      if (remaining < left) {
        this.elapsed += remaining
        remaining = 0
      } else {
        remaining -= left
        this.current = move.to
        this.queue.shift()
        this.elapsed = 0
        continue
      }
      const progress = minimumJerk(this.elapsed / move.duration)
      this.current = this.interpolate(move.from, move.to, progress)
    }

    const jitterYaw = this.tremorYaw.step(dt)
    const jitterPitch = this.tremorPitch.step(dt)
    return {
      yaw: this.current.yaw + jitterYaw,
      pitch: clampPitch(this.current.pitch + jitterPitch),
    }
  }

  /** Fitts's law: time grows with the log of distance over target width. */
  private duration(distance: number, targetWidth: number): number {
    const width = Math.max(targetWidth, 0.02)
    const difficulty = Math.log2((2 * distance) / width + 1)
    const base = this.persona.aimIntercept + this.persona.aimSlope * difficulty
    return Math.max(0.04, base * this.fatigue() * this.rng.range(0.85, 1.2))
  }

  private interpolate(from: Orientation, to: Orientation, t: number): Orientation {
    return {
      yaw: from.yaw + angleDelta(from.yaw, to.yaw) * t,
      pitch: clampPitch(from.pitch + (to.pitch - from.pitch) * t),
    }
  }
}

/** Minecraft cannot look further than straight up or straight down. */
export function clampPitch(pitch: number): number {
  const limit = Math.PI / 2
  return pitch < -limit ? -limit : pitch > limit ? limit : pitch
}

/** Yaw and pitch that point from one position to another, Minecraft's way. */
export function lookAt(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): Orientation {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const ground = Math.hypot(dx, dz)
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, ground),
  }
}

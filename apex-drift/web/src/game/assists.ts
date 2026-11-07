import { clamp, lerp, smoothstep } from '../core/math'
import { ASSIST_LEVELS, ASSISTS, type AssistLevel, type Assists } from '../sim/car'

/**
 * The player's driving aids as the Options screen shows them: a preset
 * ladder, and each aid on its own. Picking a preset sets every toggle;
 * changing a toggle afterwards leaves the preset's strengths in place for the
 * aids that stay on (see `toSim`).
 */
export interface AssistSettings {
  preset: AssistLevel
  /** Steering assist: pulls toward the road and countersteers slides. */
  steer: boolean
  /** Brakes for corners you arrive at too fast. */
  brake: boolean
  traction: boolean
  abs: boolean
  stability: boolean
  /** Racing line drawn on the road ahead, green to red by how hard to brake. */
  line: boolean
  /** Verges and grass keep most of the road's grip. */
  forgive: boolean
  /** 0..1: how much the steering calms down at speed. */
  speedSteer: number
}

type Toggles = Omit<AssistSettings, 'preset'>

export const PRESETS: Record<AssistLevel, Toggles> = {
  full: { steer: true, brake: true, traction: true, abs: true, stability: true, line: true, forgive: true, speedSteer: 1 },
  strong: { steer: true, brake: true, traction: true, abs: true, stability: true, line: true, forgive: true, speedSteer: 0.75 },
  medium: { steer: true, brake: false, traction: true, abs: true, stability: true, line: false, forgive: false, speedSteer: 0.5 },
  light: { steer: false, brake: false, traction: true, abs: true, stability: true, line: false, forgive: false, speedSteer: 0.25 },
  off: { steer: false, brake: false, traction: false, abs: false, stability: false, line: false, forgive: false, speedSteer: 0 },
}

export const TOGGLES = ['steer', 'brake', 'traction', 'abs', 'stability', 'line', 'forgive'] as const
export type AssistToggle = (typeof TOGGLES)[number]

export function assistPreset(level: AssistLevel): AssistSettings {
  return { preset: level, ...PRESETS[level] }
}

/** True when the toggles no longer match the preset they started from. */
export function isCustom(a: AssistSettings): boolean {
  const p = PRESETS[a.preset]
  return TOGGLES.some((k) => a[k] !== p[k]) || Math.abs(a.speedSteer - p.speedSteer) > 0.01
}

/**
 * What the car's physics gets. An aid switched on keeps its preset's
 * strength, or a moderate one if the preset had it off; stability never goes
 * below the chassis's own small share.
 */
export function toSim(a: AssistSettings): Assists {
  const p = ASSISTS[a.preset]
  return {
    steer: a.steer ? Math.max(p.steer, ASSISTS.medium.steer) : 0,
    traction: a.traction,
    abs: a.abs,
    stability: a.stability ? Math.max(p.stability, ASSISTS.light.stability) : ASSISTS.off.stability,
    autoBrake: a.brake,
    forgive: a.forgive ? Math.max(p.forgive, ASSISTS.strong.forgive) : 0,
  }
}

/**
 * Speed-sensitive steering: the share of the player's steering that reaches
 * the wheels. Untouched in town; at fast-road speeds a strong setting halves
 * a full press, so a keyboard tap can't throw the car off a fast straight.
 */
export function steerScale(speed: number, strength: number): number {
  return 1 - clamp(strength, 0, 1) * 0.5 * smoothstep(12, 42, speed)
}

/** How quickly digital steering ramps in at this speed (1/s); strength slows it on fast roads. */
export function steerRamp(speed: number, strength: number): number {
  return lerp(8.5, lerp(5.5, 3.2, clamp(strength, 0, 1)), smoothstep(12, 40, speed))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates a saved assist block; anything that doesn't check out comes from `fallback`. */
export function sanitizeAssists(raw: unknown, fallback: AssistSettings): AssistSettings {
  if (!isObj(raw)) return { ...fallback }
  const preset = ASSIST_LEVELS.includes(raw.preset as AssistLevel) ? (raw.preset as AssistLevel) : fallback.preset
  const out: AssistSettings = { ...fallback, preset }
  for (const k of TOGGLES) out[k] = typeof raw[k] === 'boolean' ? (raw[k] as boolean) : fallback[k]
  out.speedSteer = typeof raw.speedSteer === 'number' && Number.isFinite(raw.speedSteer) ? clamp(raw.speedSteer, 0, 1) : fallback.speedSteer
  return out
}

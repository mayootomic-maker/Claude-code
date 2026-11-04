import content from './content.json'

export type Surface = 'asphalt' | 'gravel' | 'wetgravel' | 'snow' | 'rough'
export type Look = 'morning' | 'noon' | 'golden' | 'sunset' | 'dusk' | 'night' | 'overcast' | 'mist'
export type Weather = 'clear' | 'rain' | 'snow' | 'fog'
export type Biome =
  | 'alpine' | 'nordic_snow' | 'nordic' | 'wales' | 'med' | 'savannah' | 'japan' | 'iberia' | 'andes'

export interface StageDef {
  name: string
  km: number
  seed: number
  look: Look
  weather: Weather
  /** The closing "power stage" of a rally: bonus points for the fastest three. */
  power?: boolean
}

export interface RallyDef {
  id: string
  name: string
  nation: string
  flag: string[]
  code: string
  blurb: string
  surface: Surface
  half: number
  biome: Biome
  style: {
    straight: [number, number]
    radius: [number, number]
    fast: number
    hairpin: number
    switchbacks: number
    angle: [number, number]
    esses: number
  }
  relief: {
    amp: number; scale: number; detail: number; grade: number; trend: number
    smooth: number; crest: number; jump: number; bumps: number; side: number
  }
  edge: { up: string; down: string; shoulder: number; soft?: boolean }
  patches?: { kind: string; every: number; len: [number, number]; p: number }
  snowLine?: number
  palette: Record<'grassA' | 'grassB' | 'dry' | 'forest' | 'rock' | 'rock2' | 'verge' | 'soil' | 'snow', number>
  gravel?: number[]
  trees: { mix: Record<string, number>; density: number; near: number }
  houses: string
  spectators: number
  rocks: number
  bushes: number
  grass: number
  water: { splash: number; bridge: number; lakes: number }
  stages: StageDef[]
}

export interface CarPhys {
  mass: number; iz: number; a: number; b: number; h: number; halfW: number; halfL: number
  /** Peak engine power in watts. The torque curve is scaled so torque × rpm peaks exactly here. */
  power: number; maxDriveForce: number; frontDrive: number; brakeForce: number; brakeFront: number
  handbrakeForce: number; handbrakeMu: number; dragCd: number; steerMax: number; steerSpeed: number
  grip: number; driftMax: number
  idle: number; redline: number
  /** Relative torque at evenly spaced rpm from idle to redline (full boost for a turbo). */
  torqueCurve: readonly number[]
  turbo: boolean
  /** Share of full-boost torque a turbo engine makes with no boost at all. */
  offBoost: number
  /** Rpm where the turbo starts to spool, and the seconds it takes to reach full boost from there. */
  boostRpm: number; boostLag: number
  gears: readonly number[]; finalDrive: number
  /** Seconds of torque cut per gear change: an H-pattern 60s box is slower than a sequential one. */
  shiftTime: number
  wheelRadius: number
  /** Engine plus flywheel rotational inertia, kg·m². A light flywheel revs and spins the wheels more readily. */
  engineInertia: number
  abs: boolean
  /** Share of the lateral load transfer the front axle carries (roll-stiffness distribution). More at the front means more understeer. */
  rollFront: number
  cylinders: 4 | 5 | 6
  layout: 'inline' | 'flat' | 'v'
}

export interface CarDef {
  id: string
  name: string
  era: string
  tag: string
  level: number
  phys: Partial<CarPhys> & Record<string, number | undefined>
}

export interface LiveryDef {
  id: string
  name: string
  base: number
  stripe: number
  accent: number
  rim: number
  pattern: 'stripes' | 'band' | 'chevron' | 'split' | 'tricolor' | 'dots'
  num: string
  sponsor: string
  bonnet?: string
  unlock: { type: 'none' } | { type: 'shop'; price: number } | { type: 'level'; n: number } | { type: 'secret'; key: string } | { type: 'code'; key: string }
}

export interface RivalDef {
  id: string
  name: string
  nat: string
  pace: number
  likes: Surface[]
}

const data = content as unknown as {
  rallies: RallyDef[]
  cars: CarDef[]
  liveries: LiveryDef[]
  rivals: RivalDef[]
}

export const RALLIES: readonly RallyDef[] = data.rallies
export const CARS: readonly CarDef[] = data.cars
export const LIVERIES: readonly LiveryDef[] = data.liveries
export const RIVALS: readonly RivalDef[] = data.rivals

const BOX5_60S = [3.3, 2.05, 1.4, 1.05, 0.84]
const BOX5_70S = [3.2, 2.1, 1.55, 1.2, 0.97]
const BOX5_B = [2.9, 2.0, 1.52, 1.21, 1.0]
const BOX6 = [3.0, 2.15, 1.68, 1.37, 1.15, 0.97]
const TURBO_CURVE = [0.5, 0.72, 0.93, 1, 1, 0.97, 0.9, 0.78]

/** Reference car: every car in content.json is a set of overrides on top of this. */
const BASE: CarPhys = {
  mass: 1150, iz: 1750, a: 1.22, b: 1.32, h: 0.48, halfW: 0.88, halfL: 2.15,
  power: 112e3, maxDriveForce: 7600, frontDrive: 0.35, brakeForce: 12500, brakeFront: 0.62,
  handbrakeForce: 3800, handbrakeMu: 0.48, dragCd: 0.4, steerMax: 0.52, steerSpeed: 17,
  grip: 1, driftMax: 0.62,
  idle: 900, redline: 7600,
  torqueCurve: [0.56, 0.7, 0.84, 0.95, 1, 0.98, 0.91, 0.8],
  turbo: false, offBoost: 1, boostRpm: 3000, boostLag: 0.45,
  gears: BOX5_70S, finalDrive: 4.6, shiftTime: 0.18,
  wheelRadius: 0.31, engineInertia: 0.14, abs: false, rollFront: 0.56,
  cylinders: 4, layout: 'inline',
}

/**
 * Engines and drivetrains. content.json predates the gearbox and quotes power
 * figures that only made sense with a flat force cap; these are what the cars
 * actually make, chosen so each era lands at believable 0-100 and top speeds.
 * Gearing is set so redline in top sits just past the drag-limited top speed.
 */
const DRIVETRAIN: Record<string, Partial<CarPhys>> = {
  piccola: { power: 47e3, idle: 850, redline: 7000, torqueCurve: [0.66, 0.82, 0.94, 1, 0.98, 0.92, 0.83, 0.72], gears: BOX5_60S, finalDrive: 4.1, wheelRadius: 0.27, shiftTime: 0.2, engineInertia: 0.1, dragCd: 0.29, rollFront: 0.6 },
  ventura: { power: 62e3, idle: 850, redline: 6800, torqueCurve: [0.66, 0.82, 0.94, 1, 0.98, 0.92, 0.83, 0.72], gears: BOX5_60S, finalDrive: 4.3, shiftTime: 0.2, engineInertia: 0.13, dragCd: 0.34, rollFront: 0.52 },
  kestrel: {},
  ruska: { power: 88e3, idle: 850, redline: 7000, torqueCurve: [0.64, 0.8, 0.93, 1, 0.97, 0.9, 0.81, 0.7], finalDrive: 4.3, engineInertia: 0.15, rollFront: 0.52 },
  saetta: { power: 142e3, idle: 950, redline: 7800, torqueCurve: [0.6, 0.77, 0.9, 0.98, 1, 0.97, 0.9, 0.8], finalDrive: 4.1, cylinders: 6, layout: 'v', rollFront: 0.5 },
  bison: { power: 118e3, idle: 800, redline: 6200, torqueCurve: [0.74, 0.88, 0.97, 1, 0.97, 0.91, 0.83, 0.73], finalDrive: 4.0, engineInertia: 0.2, cylinders: 6, layout: 'inline', rollFront: 0.55, dragCd: 0.46, brakeForce: 15000 },
  falco: { power: 205e3, idle: 1000, redline: 8200, torqueCurve: [0.58, 0.75, 0.89, 0.97, 1, 0.98, 0.92, 0.82], gears: BOX5_B, finalDrive: 4.5, shiftTime: 0.16, engineInertia: 0.12, cylinders: 6, layout: 'v', rollFront: 0.52, dragCd: 0.45 },
  boxer: { power: 255e3, idle: 950, redline: 7500, torqueCurve: TURBO_CURVE, turbo: true, offBoost: 0.45, boostRpm: 3200, boostLag: 0.6, gears: BOX5_B, finalDrive: 4.1, shiftTime: 0.16, engineInertia: 0.16, cylinders: 5, layout: 'inline', rollFront: 0.56, dragCd: 0.45 },
  vulcan: { power: 262e3, idle: 1000, redline: 8000, torqueCurve: TURBO_CURVE, turbo: true, offBoost: 0.45, boostRpm: 3400, boostLag: 0.55, gears: BOX5_B, finalDrive: 4.4, shiftTime: 0.16, engineInertia: 0.12, rollFront: 0.53, dragCd: 0.45 },
  corsaire: { power: 222e3, idle: 900, redline: 7600, torqueCurve: TURBO_CURVE, turbo: true, offBoost: 0.55, boostRpm: 3000, boostLag: 0.4, gears: BOX6, finalDrive: 4.6, shiftTime: 0.14, abs: true, cylinders: 4, layout: 'flat', rollFront: 0.55 },
  strada: { power: 218e3, idle: 900, redline: 7800, torqueCurve: TURBO_CURVE, turbo: true, offBoost: 0.55, boostRpm: 3000, boostLag: 0.38, gears: BOX6, finalDrive: 4.7, shiftTime: 0.14, abs: true, rollFront: 0.55 },
  apex: { power: 232e3, idle: 1000, redline: 8500, torqueCurve: [0.6, 0.82, 0.96, 1, 1, 0.97, 0.9, 0.8], turbo: true, offBoost: 0.65, boostRpm: 2800, boostLag: 0.3, gears: BOX6, finalDrive: 5.0, shiftTime: 0.12, engineInertia: 0.11, abs: true, rollFront: 0.55 },
}

export function carPhys(id: string): CarPhys {
  const def = CARS.find((c) => c.id === id) ?? CARS.find((c) => c.id === 'kestrel')
  const out: CarPhys = { ...BASE }
  if (!def) return out
  for (const key of Object.keys(BASE) as (keyof CarPhys)[]) {
    const v = def.phys[key]
    if (typeof v === 'number') (out as unknown as Record<string, number>)[key] = v
  }
  return { ...out, ...DRIVETRAIN[def.id] }
}

export function rally(id: string): RallyDef {
  const r = RALLIES.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown rally ${id}`)
  return r
}

/**
 * The driving school: Finnish gravel with a layout chosen so the lessons
 * arrive in order (gentle corners first, one hairpin at 1.1 km, easy run-in
 * to the finish). Seed found by searching; see the tutorial test.
 */
export const SCHOOL: RallyDef = (() => {
  const fin = RALLIES.find((r) => r.id === 'finland') ?? RALLIES[0]
  return {
    ...fin,
    id: 'school',
    style: { ...fin.style, hairpin: 0.18, switchbacks: 0, fast: 0.1, esses: 0.1 },
    relief: { ...fin.relief, jump: 0, crest: 0 },
    spectators: 0.4,
    stages: [{ name: 'Driving school', km: 1.9, seed: 9628, look: 'morning', weather: 'clear' }],
  }
})()

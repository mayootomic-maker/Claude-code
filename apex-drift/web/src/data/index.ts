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
  power: number; maxDriveForce: number; frontDrive: number; brakeForce: number; brakeFront: number
  handbrakeForce: number; handbrakeMu: number; dragCd: number; steerMax: number; steerSpeed: number
  grip: number; driftMax: number
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

/** Reference car: every car in content.json is a set of overrides on top of this. */
const BASE: CarPhys = {
  mass: 1150, iz: 1750, a: 1.22, b: 1.32, h: 0.48, halfW: 0.88, halfL: 2.15,
  power: 165e3, maxDriveForce: 7600, frontDrive: 0.35, brakeForce: 12500, brakeFront: 0.62,
  handbrakeForce: 3800, handbrakeMu: 0.48, dragCd: 0.4, steerMax: 0.52, steerSpeed: 17,
  grip: 1, driftMax: 0.62,
}

export function carPhys(id: string): CarPhys {
  const def = CARS.find((c) => c.id === id) ?? CARS.find((c) => c.id === 'kestrel')
  const out: CarPhys = { ...BASE }
  if (!def) return out
  for (const key of Object.keys(BASE) as (keyof CarPhys)[]) {
    const v = def.phys[key]
    if (typeof v === 'number') out[key] = v
  }
  return out
}

export function rally(id: string): RallyDef {
  const r = RALLIES.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown rally ${id}`)
  return r
}

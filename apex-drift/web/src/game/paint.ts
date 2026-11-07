import { DECAL_KEYS, FINISHES, LIVERIES, NUM_FONTS, PATTERNS, type Decals, type Finish, type LiveryDef, type NumFont, type Pattern } from '../data'
import { rng } from '../core/math'
import type { Save } from './save'

/**
 * The player's own paint jobs and their driver's look: the data, its
 * validation (both live in the save, which is user-controlled), and how a
 * saved choice turns into the LiveryDef the renderer paints.
 */

export const HAIR = ['mullet', 'curls', 'quiff', 'mop', 'buzz', 'bald'] as const
export const MOUSTACHE = ['handlebar', 'walrus', 'pencil', 'chevron', 'none'] as const
export const BROWS = ['bushy', 'arched', 'mono', 'thin'] as const
export const GLASSES = ['none', 'aviator', 'round', 'shutter'] as const
export const PRINTS = ['flowers', 'palms', 'flames', 'pineapples', 'stripes', 'checks', 'plain'] as const
export const HELMET_PATTERNS = ['stripe', 'flames', 'stars', 'split', 'checker', 'halo', 'bolt', 'tricolor'] as const
export const VISORS = ['iridium', 'gold', 'smoke', 'rainbow', 'clear'] as const

export type Hair = (typeof HAIR)[number]
export type Moustache = (typeof MOUSTACHE)[number]
export type Brows = (typeof BROWS)[number]
export type Glasses = (typeof GLASSES)[number]
export type Print = (typeof PRINTS)[number]
export type HelmetPattern = (typeof HELMET_PATTERNS)[number]
export type Visor = (typeof VISORS)[number]

export interface HelmetLook { pattern: HelmetPattern; base: number; secondary: number; accent: number; finish: Finish; visor: Visor }

export interface DriverLook {
  skin: number
  hair: Hair
  hairColor: number
  moustache: Moustache
  brows: Brows
  glasses: Glasses
  shirt: number
  print: Print
  printColor: number
  shorts: number
  helmet: HelmetLook
}

export interface CustomLivery {
  id: string
  car: string
  name: string
  pattern: Pattern
  base: number
  stripe: number
  accent: number
  rim: number
  finish: Finish
  num: string
  font: NumFont
  sponsor: string
  decals: Decals
  window: string
}

/** Most custom paint jobs a single car keeps, and in all. */
export const PER_CAR = 8
const MAX_CUSTOM = 96

/** Made-up sponsors: the paint shop only offers these, never a real brand. */
export const SPONSORS = ['NORDLICHT', 'KARST', 'FERRO OIL', 'VELA TYRES', 'ORBITAL', 'MERIDIAN', 'ALPENGLAS', 'LIMEN', 'HALCYON', 'BRISA', 'KOMET', 'TUNDRA', 'OKTAN', 'SOLSTICE', 'PIKKU', 'GRANIT'] as const

/** A curated palette of rally colours: every pair here sits well together. */
export const PALETTE = [
  0xf4f2ec, 0xd9dcdf, 0x8b9096, 0x2b2e33, 0x111214,
  0xd8231c, 0x9e1b32, 0xff5a1f, 0xf2b705, 0xe8d8a8,
  0x0b3d91, 0x1f6fd1, 0x2ec4e6, 0x0e7c66, 0x6fbf3a,
  0x1d3b2a, 0x5b2a86, 0xff4f9a, 0xc9a24a, 0x7a4b2a,
]
export const SKIN_TONES = [0xf6d2b8, 0xe9b48c, 0xd99a6c, 0xb87648, 0x8d5530, 0x5e3a22]
export const HAIR_COLOURS = [0x16110c, 0x4a2812, 0x8a5a2b, 0xd8b26a, 0xb84a1e, 0xd9d4cc]

const DEFAULT_DECALS: Decals = { panel: true, sponsors: true, pinstripe: true, roof: true, bonnet: true }

export function defaultLook(): DriverLook {
  return {
    skin: 0xe9b48c, hair: 'mullet', hairColor: 0x4a2812, moustache: 'handlebar', brows: 'bushy', glasses: 'none',
    shirt: 0x12a3a0, print: 'flowers', printColor: 0xff4f7a, shorts: 0xc9b07a,
    helmet: { pattern: 'stripe', base: 0xf4f2ec, secondary: 0xd8231c, accent: 0x0b3d91, finish: 'gloss', visor: 'iridium' },
  }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d)
const colour = (v: unknown, d: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d)
/** Printable text only: no control characters or markup, trimmed to `max`. */
export const cleanText = (v: unknown, max: number, d = ''): string => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .'&!?#-]/gu, '').slice(0, max) : d)
export const cleanNum = (v: unknown, d = '1'): string => {
  const s = typeof v === 'string' ? v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 3) : ''
  return s || d
}

export function sanitizeLook(raw: unknown): DriverLook {
  const d = defaultLook()
  if (!isObj(raw)) return d
  const h = isObj(raw.helmet) ? raw.helmet : {}
  return {
    skin: colour(raw.skin, d.skin),
    hair: pick(raw.hair, HAIR, d.hair),
    hairColor: colour(raw.hairColor, d.hairColor),
    moustache: pick(raw.moustache, MOUSTACHE, d.moustache),
    brows: pick(raw.brows, BROWS, d.brows),
    glasses: pick(raw.glasses, GLASSES, d.glasses),
    shirt: colour(raw.shirt, d.shirt),
    print: pick(raw.print, PRINTS, d.print),
    printColor: colour(raw.printColor, d.printColor),
    shorts: colour(raw.shorts, d.shorts),
    helmet: {
      pattern: pick(h.pattern, HELMET_PATTERNS, d.helmet.pattern),
      base: colour(h.base, d.helmet.base),
      secondary: colour(h.secondary, d.helmet.secondary),
      accent: colour(h.accent, d.helmet.accent),
      finish: pick(h.finish, FINISHES, d.helmet.finish),
      visor: pick(h.visor, VISORS, d.helmet.visor),
    },
  }
}

const ID = /^u[0-9a-z]{1,12}$/

/** One saved paint job, or null when it can't be trusted (bad id or car). */
export function sanitizeCustom(raw: unknown, cars: readonly string[]): CustomLivery | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || typeof raw.car !== 'string' || !cars.includes(raw.car)) return null
  const dc = isObj(raw.decals) ? raw.decals : {}
  const decals = { ...DEFAULT_DECALS }
  for (const k of DECAL_KEYS) if (typeof dc[k] === 'boolean') decals[k] = dc[k] as boolean
  return {
    id: raw.id,
    car: raw.car,
    name: cleanText(raw.name, 20).trim() || 'My livery',
    pattern: pick(raw.pattern, PATTERNS, 'swoosh'),
    base: colour(raw.base, 0xf4f2ec),
    stripe: colour(raw.stripe, 0x0b3d91),
    accent: colour(raw.accent, 0xd8231c),
    rim: colour(raw.rim, 0x2b2e33),
    finish: pick(raw.finish, FINISHES, 'gloss'),
    num: cleanNum(raw.num),
    font: pick(raw.font, NUM_FONTS, 'block'),
    sponsor: pick(raw.sponsor, SPONSORS, 'NORDLICHT'),
    decals,
    window: cleanText(raw.window, 16).trim(),
  }
}

/** The saved list: valid entries only, unique ids, at most PER_CAR per car. */
export function sanitizeCustoms(raw: unknown, cars: readonly string[]): CustomLivery[] {
  if (!Array.isArray(raw)) return []
  const out: CustomLivery[] = []
  const seen = new Set<string>()
  const perCar = new Map<string, number>()
  for (const r of raw.slice(0, MAX_CUSTOM * 2)) {
    const c = sanitizeCustom(r, cars)
    if (!c || seen.has(c.id)) continue
    const n = perCar.get(c.car) ?? 0
    if (n >= PER_CAR) continue
    seen.add(c.id)
    perCar.set(c.car, n + 1)
    out.push(c)
    if (out.length >= MAX_CUSTOM) break
  }
  return out
}

/** Per-car choice of a custom paint job: kept only where that job exists for that car. */
export function sanitizeCarLivery(raw: unknown, customs: readonly CustomLivery[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isObj(raw)) return out
  for (const [car, id] of Object.entries(raw)) if (typeof id === 'string' && customs.some((c) => c.id === id && c.car === car)) out[car] = id
  return out
}

export function newCustomId(taken: readonly CustomLivery[]): string {
  let n = Date.now()
  let id = ''
  do id = 'u' + (n++ % 36 ** 9).toString(36)
  while (taken.some((c) => c.id === id))
  return id
}

/** A fresh paint job for the editor, seeded from a livery (a preset or the car's current one). */
export function customFrom(lv: LiveryDef, car: string, id: string, name: string): CustomLivery {
  return sanitizeCustom({
    id, car, name, pattern: lv.pattern, base: lv.base, stripe: lv.stripe, accent: lv.accent, rim: lv.rim,
    finish: lv.finish ?? 'gloss', num: lv.num, font: lv.font ?? 'block',
    sponsor: (SPONSORS as readonly string[]).includes(lv.sponsor) ? lv.sponsor : 'NORDLICHT',
    decals: { ...DEFAULT_DECALS, ...lv.decals }, window: lv.window ?? '',
  }, [car]) as CustomLivery
}

export function toLivery(c: CustomLivery): LiveryDef {
  return {
    id: c.id, name: c.name, base: c.base, stripe: c.stripe, accent: c.accent, rim: c.rim, pattern: c.pattern,
    num: c.num, sponsor: c.sponsor, bonnet: c.sponsor.split(' ')[0], finish: c.finish, font: c.font,
    decals: c.decals, window: c.window, unlock: { type: 'none' },
  }
}

/** A livery by id: one of the player's own (by its id) or a preset. */
export function findLivery(s: Save, id: string): LiveryDef {
  const c = s.customLiveries.find((x) => x.id === id)
  if (c) return toLivery(c)
  return LIVERIES.find((l) => l.id === id) ?? LIVERIES[0]
}

/** What the player's car wears: the custom job chosen for this car, else the preset, with the driver's name on the glass. */
export function playerLivery(s: Save, car: string): LiveryDef {
  const cid = s.carLivery[car]
  const c = cid ? s.customLiveries.find((x) => x.id === cid && x.car === car) : undefined
  if (c) return toLivery(c)
  const p = LIVERIES.find((l) => l.id === s.livery) ?? LIVERIES[0]
  return { ...p, window: p.window ?? s.name }
}

/** The id to store with a ghost or a race grid: the custom id when one is on the car. */
export function playerLiveryId(s: Save, car: string): string {
  return playerLivery(s, car).id
}

/** A rival's driver: deterministic per seed, always a complete, valid look. */
export function rivalLook(seed: number): DriverLook {
  const r = rng(seed * 977 + 31)
  const of = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  const hp = PALETTE.filter((c) => c !== 0x111214)
  return {
    skin: of(SKIN_TONES), hair: of(HAIR), hairColor: of(HAIR_COLOURS), moustache: of(MOUSTACHE), brows: of(BROWS),
    glasses: r() < 0.7 ? 'none' : of(GLASSES),
    shirt: of(hp), print: of(PRINTS), printColor: of(hp), shorts: of([0xc9b07a, 0x2b2e33, 0x0b3d91, 0x8b9096, 0xe8d8a8]),
    helmet: { pattern: of(HELMET_PATTERNS), base: of(hp), secondary: of(hp), accent: of(hp), finish: of(['gloss', 'gloss', 'matte', 'metallic', 'pearl'] as const), visor: of(VISORS) },
  }
}

export type { Decals, Finish, NumFont, Pattern }

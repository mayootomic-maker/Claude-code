import type { Difficulty } from '../sim/stage'
import { OWNER } from './owner'
import { CARS } from '../data'
import { defaultLook, sanitizeCarLivery, sanitizeCustoms, sanitizeLook, type CustomLivery, type DriverLook } from './paint'

/**
 * The owner's build keeps its own save: every file:// page shares one
 * storage, and its unlocks must not leak into a normal copy of the game.
 */
export const SAVE_KEY = OWNER ? 'apexdrift.owner.v4' : 'apexdrift.save.v4'
/** The 2.0 release stored its save here; we read it once to carry progress over. */
const LEGACY_KEYS = OWNER ? [] : ['apexdrift.save.v3', 'apexdrift.save.v2']

export type Steering = 'buttons' | 'tilt' | 'wheel'
export type Lang = 'en' | 'de'
export type Notes = 'full' | 'corners' | 'off'

export interface Settings {
  difficulty: Difficulty
  steering: Steering
  autoGas: boolean
  sensitivity: number
  tiltInvert: boolean
  camera: 'chase' | 'near' | 'bonnet' | 'cockpit'
  quality: 'auto' | 'low' | 'medium' | 'high'
  master: number
  music: number
  sfx: number
  engine: number
  voice: number
  notes: Notes
  voiceLang: Lang
  lang: Lang
  haptics: boolean
  units: 'kmh' | 'mph'
  shake: boolean
  subtitles: boolean
  textSize: 1 | 1.15 | 1.3
}

export interface StageResult {
  time: number
  medal: 'gold' | 'silver' | 'bronze' | null
}

export interface Save {
  version: 4
  name: string
  car: string
  livery: string
  xp: number
  credits: number
  owned: { cars: string[]; liveries: string[] }
  /** The player's own paint jobs from the paint shop, each made for one car. */
  customLiveries: CustomLivery[]
  /** Car id → the custom paint job it wears; a car not listed wears the preset in `livery`. */
  carLivery: Record<string, string>
  /** The driver's face, hair, shirt and helmet. */
  driver: DriverLook
  tutorialDone: boolean
  /** Rally ids finished at least once: each unlocks the next. */
  finished: string[]
  /** Best result per `${rally}:${stage}:${difficulty}`. */
  best: Record<string, StageResult>
  /** The rally in progress: stage times so far. */
  event: { rally: string; times: number[]; difficulty: Difficulty } | null
  postcards: string[]
  /** Daily stages: days finished (YYYY-MM-DD) and the best time on each, last 60 kept. */
  daily: { days: string[]; best: Record<string, number> }
  settings: Settings
  stats: { stages: number; metres: number; resets: number; seconds: number }
  /** Detected quality tier, so the benchmark runs only once. */
  tier: 'low' | 'medium' | 'high' | null
}

export function defaults(): Save {
  return {
    version: 4,
    name: 'Driver',
    car: 'kestrel',
    livery: 'works',
    xp: 0,
    credits: 2500,
    owned: { cars: ['kestrel', 'piccola'], liveries: [] },
    customLiveries: [],
    carLivery: {},
    driver: defaultLook(),
    tutorialDone: false,
    finished: [],
    best: {},
    event: null,
    postcards: [],
    daily: { days: [], best: {} },
    settings: {
      difficulty: 'rookie', steering: 'buttons', autoGas: true, sensitivity: 1, tiltInvert: false,
      camera: 'chase', quality: 'auto', master: 0.9, music: 0.5, sfx: 0.9, engine: 0.8, voice: 1,
      notes: 'full', voiceLang: 'en', lang: navigator.language?.startsWith('de') ? 'de' : 'en',
      haptics: true, units: 'kmh', shake: true, subtitles: true, textSize: 1,
    },
    stats: { stages: 0, metres: 0, resets: 0, seconds: 0 },
    tier: null,
  }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.length < 64 ? v : d)
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const strs = (v: unknown, d: string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : d)

/**
 * Validates every field: a save is user-controlled data on the device. Any
 * field that doesn't check out falls back to its default instead of crashing
 * the game.
 */
export function sanitize(raw: unknown): Save {
  const d = defaults()
  if (!isObj(raw)) return d
  const s = isObj(raw.settings) ? raw.settings : {}
  const ds = d.settings
  const pick = <T extends string>(v: unknown, opts: readonly T[], def: T): T => (opts.includes(v as T) ? (v as T) : def)
  const owned = isObj(raw.owned) ? raw.owned : {}
  const stats = isObj(raw.stats) ? raw.stats : {}
  const best: Record<string, StageResult> = {}
  if (isObj(raw.best))
    for (const [k, v] of Object.entries(raw.best))
      if (isObj(v) && typeof v.time === 'number' && v.time > 0) best[k] = { time: v.time, medal: v.medal === 'gold' || v.medal === 'silver' || v.medal === 'bronze' ? v.medal : null }
  const ev = isObj(raw.event) && typeof raw.event.rally === 'string' && Array.isArray(raw.event.times)
    ? { rally: raw.event.rally, times: raw.event.times.filter((t): t is number => typeof t === 'number' && t > 0).slice(0, 4), difficulty: pick(raw.event.difficulty, ['rookie', 'driver', 'pro'] as const, 'rookie') }
    : null
  const customs = sanitizeCustoms(raw.customLiveries, CARS.map((c) => c.id))
  return {
    version: 4,
    name: str(raw.name, d.name).slice(0, 20),
    car: str(raw.car, d.car),
    livery: str(raw.livery, d.livery),
    xp: num(raw.xp, 0, 0),
    credits: num(raw.credits, d.credits, 0, 1e7),
    owned: { cars: strs(owned.cars, d.owned.cars), liveries: strs(owned.liveries, []) },
    customLiveries: customs,
    carLivery: sanitizeCarLivery(raw.carLivery, customs),
    driver: sanitizeLook(raw.driver),
    tutorialDone: raw.tutorialDone === true,
    finished: strs(raw.finished, []),
    best,
    event: ev,
    postcards: strs(raw.postcards, []),
    daily: (() => {
      const dv = isObj(raw.daily) ? raw.daily : {}
      const best: Record<string, number> = {}
      if (isObj(dv.best)) for (const [k, v] of Object.entries(dv.best)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v > 0) best[k] = v
      return { days: strs(dv.days, []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-60), best }
    })(),
    settings: {
      difficulty: pick(s.difficulty, ['rookie', 'driver', 'pro'] as const, ds.difficulty),
      steering: pick(s.steering, ['buttons', 'tilt', 'wheel'] as const, ds.steering),
      autoGas: typeof s.autoGas === 'boolean' ? s.autoGas : ds.autoGas,
      sensitivity: num(s.sensitivity, ds.sensitivity, 0.5, 2),
      tiltInvert: s.tiltInvert === true,
      camera: pick(s.camera, ['chase', 'near', 'bonnet', 'cockpit'] as const, ds.camera),
      quality: pick(s.quality, ['auto', 'low', 'medium', 'high'] as const, ds.quality),
      master: num(s.master, ds.master, 0, 1),
      music: num(s.music, ds.music, 0, 1),
      sfx: num(s.sfx, ds.sfx, 0, 1),
      engine: num(s.engine, ds.engine, 0, 1),
      voice: num(s.voice, ds.voice, 0, 1),
      notes: pick(s.notes, ['full', 'corners', 'off'] as const, ds.notes),
      voiceLang: pick(s.voiceLang, ['en', 'de'] as const, ds.voiceLang),
      lang: pick(s.lang, ['en', 'de'] as const, ds.lang),
      haptics: typeof s.haptics === 'boolean' ? s.haptics : ds.haptics,
      units: pick(s.units, ['kmh', 'mph'] as const, ds.units),
      shake: typeof s.shake === 'boolean' ? s.shake : ds.shake,
      subtitles: typeof s.subtitles === 'boolean' ? s.subtitles : ds.subtitles,
      textSize: s.textSize === 1.15 || s.textSize === 1.3 ? s.textSize : 1,
    },
    stats: { stages: num(stats.stages, 0, 0), metres: num(stats.metres, 0, 0), resets: num(stats.resets, 0, 0), seconds: num(stats.seconds, 0, 0) },
    tier: raw.tier === 'low' || raw.tier === 'medium' || raw.tier === 'high' ? raw.tier : null,
  }
}

/**
 * Carries a 2.0 save forward. Its stages were different roads, so best times
 * and championship progress can't transfer; the driver keeps their name,
 * credits, level, cars and liveries, and the settings that still mean the same.
 */
export function migrate(legacy: unknown): Save {
  const d = defaults()
  if (!isObj(legacy)) return d
  const s = isObj(legacy.settings) ? legacy.settings : {}
  const owned = isObj(legacy.owned) ? legacy.owned : {}
  const out = sanitize({
    name: legacy.name,
    car: legacy.car,
    livery: legacy.livery,
    xp: legacy.xp,
    credits: legacy.credits,
    owned: { cars: owned.cars, liveries: owned.liveries },
    tutorialDone: false,
    settings: {
      steering: s.steering, autoGas: s.autoGas, sensitivity: s.sensitivity, tiltInvert: s.tiltInvert,
      quality: s.quality, master: s.master, music: s.music, sfx: s.sfx, voice: s.voice,
      haptics: s.haptics, units: s.units, voiceLang: s.codriver,
      notes: s.pacenotes === false ? 'off' : 'full',
      // Everyone starts 3.0 on the new, fairer Rookie setting; it can be changed in Options.
    },
  })
  return out
}

export interface Store {
  readonly save: Save
  write(): void
  /** True when storage failed and progress won't survive a restart. */
  readonly volatile: boolean
  /** Set when an unreadable save was found and set aside. */
  readonly recovered: boolean
  reset(): void
}

export function openStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): Store {
  let volatile = storage === null
  let recovered = false
  let save = defaults()
  if (storage) {
    try {
      const raw = storage.getItem(SAVE_KEY)
      if (raw) {
        try {
          save = sanitize(JSON.parse(raw))
        } catch {
          // Keep the unreadable save beside the new one rather than destroying it.
          storage.setItem(SAVE_KEY + '.corrupt', raw)
          recovered = true
        }
      } else {
        for (const k of LEGACY_KEYS) {
          const old = storage.getItem(k)
          if (!old) continue
          try {
            save = migrate(JSON.parse(old))
          } catch {
            recovered = true
          }
          break
        }
      }
    } catch {
      volatile = true
    }
  }
  const store: Store = {
    get save() {
      return save
    },
    get volatile() {
      return volatile
    },
    get recovered() {
      return recovered
    },
    write() {
      if (!storage) return
      try {
        storage.setItem(SAVE_KEY, JSON.stringify(save))
        volatile = false
      } catch {
        volatile = true
      }
    },
    reset() {
      save = defaults()
      store.write()
    },
  }
  return store
}

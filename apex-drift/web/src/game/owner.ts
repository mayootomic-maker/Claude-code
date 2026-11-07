import { CARS, LIVERIES, RALLIES } from '../data'
import { level } from './career'
import type { Save } from './save'

/**
 * The owner's own copy of the game, built with `npm run single:owner`. It
 * starts with everything unlocked and has a cheat-code box in Options. In
 * every other build this is the constant false, so the minifier drops the
 * cheats and the unlocks from the public files entirely.
 */
declare const __OWNER__: boolean
export const OWNER: boolean = __OWNER__

/** The level the owner's driver is held at: one past the dearest car. */
const TOP_LEVEL = Math.max(...CARS.map((c) => c.level)) + 4

const xpFor = (lv: number): number => {
  let xp = 0
  while (level(xp).level < lv) xp += level(xp).need - level(xp).into
  return xp
}

/** Every rally open, every car and livery owned, top level, deep pockets. Safe to run on every launch. */
export function unlockAll(s: Save): void {
  for (const r of RALLIES) if (!s.finished.includes(r.id)) s.finished.push(r.id)
  for (const c of CARS) if (!s.owned.cars.includes(c.id)) s.owned.cars.push(c.id)
  for (const l of LIVERIES) if (!s.owned.liveries.includes(l.id)) s.owned.liveries.push(l.id)
  s.xp = Math.max(s.xp, xpFor(TOP_LEVEL))
  s.credits = Math.max(s.credits, 1_000_000)
  s.tutorialDone = true
}

export interface Cheat {
  code: string
  /** What the code did, for the toast. Mutates the save; the caller writes it. */
  run(s: Save, state: CheatState): string
}

/** Cheats that change how the car drives, kept for the session only. */
export interface CheatState {
  turbo: boolean
}

const livery = (id: string) => (s: Save): string => {
  const l = LIVERIES.find((x) => x.id === id)
  if (!l) return 'Unknown livery'
  if (!s.owned.liveries.includes(id)) s.owned.liveries.push(id)
  s.livery = id
  // A custom paint job chosen for this car would hide the preset.
  delete s.carLivery[s.car]
  return `${l.name} livery on the car`
}

export const CHEATS: readonly Cheat[] = [
  { code: 'MONEYBAGS', run: (s) => ((s.credits = Math.min(1e7, s.credits + 1_000_000)), '+1,000,000 credits') },
  { code: 'LEVELUP', run: (s) => ((s.xp = xpFor(level(s.xp).level + 1)), `Level ${level(s.xp).level}`) },
  { code: 'TURBO', run: (_, st) => ((st.turbo = !st.turbo), st.turbo ? 'Turbo on: double power from the next stage' : 'Turbo off') },
  { code: 'QUACK', run: livery('duck') },
  { code: 'TRUSTNO1', run: livery('visitor') },
  { code: 'TOMIC', run: livery('studio') },
  { code: '1986', run: livery('retro') },
  { code: 'DONUTS', run: livery('carnival') },
  { code: 'IZUM', run: livery('izum') },
  { code: 'UNLOCKALL', run: (s) => (unlockAll(s), 'Everything unlocked') },
]

/** Case, spaces and dashes don't matter. */
export function findCheat(input: string): Cheat | undefined {
  const k = input.toUpperCase().replace(/[\s-]+/g, '')
  return CHEATS.find((c) => c.code === k)
}

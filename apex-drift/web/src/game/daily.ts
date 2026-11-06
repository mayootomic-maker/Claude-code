import { rng } from '../core/math'
import { CARS, RALLIES, type Look, type RallyDef, type Weather } from '../data'

/**
 * One new stage every day, the same for everyone on that date: a fresh road
 * (its own seed), a country, a time of day, weather and a loan car, all
 * picked from the date. Local date, so it rolls over at the player's midnight.
 */
export interface Daily {
  key: string
  rally: RallyDef
  car: string
  /** The country it borrows from, for its artwork. */
  base: string
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const LOOKS: Look[] = ['morning', 'noon', 'golden', 'sunset', 'dusk', 'night', 'overcast', 'mist']
const WEATHER: Weather[] = ['clear', 'clear', 'clear', 'rain', 'fog']

export function dailyChallenge(d: Date): Daily {
  const key = dayKey(d)
  const seed = Number(key.replace(/-/g, ''))
  const r = rng(seed * 2654435761)
  const base = RALLIES[Math.floor(r() * RALLIES.length)]
  const look = LOOKS[Math.floor(r() * LOOKS.length)]
  let weather = WEATHER[Math.floor(r() * WEATHER.length)]
  // Snow rallies get snowfall, not rain.
  if (base.surface === 'snow' && weather === 'rain') weather = 'snow'
  const km = Math.round((4 + r() * 4) * 10) / 10
  const car = CARS[Math.floor(r() * CARS.length)].id
  return {
    key,
    car,
    base: base.id,
    rally: {
      ...base,
      id: `daily-${key}`,
      stages: [{ name: base.stages[0].name, km, seed: 50000 + (seed % 100000), look, weather }],
    },
  }
}

/** Consecutive days with a finished daily stage, ending today or yesterday. */
export function streak(days: string[], today: Date): number {
  const set = new Set(days)
  const d = new Date(today)
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (set.has(dayKey(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

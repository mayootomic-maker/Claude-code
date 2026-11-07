import { rng } from '../core/math'
import { RALLIES, RIVALS, type RallyDef } from '../data'
import { RUNGS } from '../sim/levels'
import { DIFFICULTY_SCALE, idealTime, medals, StageSim, type Difficulty } from '../sim/stage'
import type { Save } from './save'

const idealCache = new Map<string, number>()

/** The calibrated ideal time for a stage (seconds). Building the road costs a few ms, so it's cached. */
export function stageIdeal(rally: RallyDef, stageIdx: number): number {
  const key = `${rally.id}:${stageIdx}`
  const hit = idealCache.get(key)
  if (hit) return hit
  const sim = new StageSim({ rally, stage: rally.stages[stageIdx], car: 'kestrel', difficulty: 'pro' })
  const t = idealTime(sim)
  idealCache.set(key, t)
  return t
}

export function stageMedals(rally: RallyDef, stageIdx: number, d: Difficulty) {
  return medals(stageIdeal(rally, stageIdx), d)
}

export type Medal = 'gold' | 'silver' | 'bronze' | null

export function medalFor(time: number, rally: RallyDef, stageIdx: number, d: Difficulty): Medal {
  const m = stageMedals(rally, stageIdx, d)
  return time <= m.gold ? 'gold' : time <= m.silver ? 'silver' : time <= m.bronze ? 'bronze' : null
}


/**
 * A rival's time on a stage. Their pace is relative to the difficulty's gold
 * time, a little faster on surfaces they like, with a small seeded spread so
 * the order changes from stage to stage but is the same every time you play it.
 */
export function rivalTime(rivalIdx: number, rally: RallyDef, stageIdx: number, d: Difficulty): number {
  const r = RIVALS[rivalIdx]
  const base = stageIdeal(rally, stageIdx) * DIFFICULTY_SCALE[d]
  const spread = rng(rally.stages[stageIdx].seed * 31 + rivalIdx * 977)() - 0.5
  const likes = r.likes.includes(rally.surface) ? 0.99 : 1.0
  // The field is centred a little slower than gold on Rookie, so a gold-medal
  // run is a podium; on Pro the leaders run at gold pace and gold only just wins.
  return base * r.pace * likes * (RUNGS[d].field + spread * 0.025)
}

export interface Standing {
  id: string
  name: string
  nat: string
  total: number
  you: boolean
}

export function standings(rally: RallyDef, times: number[], name: string, d: Difficulty): Standing[] {
  const rows: Standing[] = RIVALS.map((r, i) => ({
    id: r.id, name: r.name, nat: r.nat, you: false,
    total: times.reduce((sum, _, s) => sum + rivalTime(i, rally, s, d), 0),
  }))
  rows.push({ id: 'you', name, nat: '', you: true, total: times.reduce((a, b) => a + b, 0) })
  return rows.sort((a, b) => a.total - b.total)
}

export const XP_PER_LEVEL = 1000

export function level(xp: number): { level: number; into: number; need: number } {
  // Each level needs a little more than the last, but never feels like a wall.
  let lv = 1, need = XP_PER_LEVEL, left = xp
  while (left >= need) {
    left -= need
    lv++
    need = Math.round(need * 1.12)
  }
  return { level: lv, into: left, need }
}

export interface Reward {
  credits: number
  xp: number
}

export function stageReward(medal: Medal, clean: boolean): Reward {
  const bonus = medal === 'gold' ? 500 : medal === 'silver' ? 300 : medal === 'bronze' ? 150 : 0
  return { credits: 250 + bonus + (clean ? 100 : 0), xp: 300 + bonus + (clean ? 100 : 0) }
}

export function rallyReward(position: number): Reward {
  const c = [3000, 2000, 1400, 1000, 800][position - 1] ?? 500
  return { credits: c, xp: Math.round(c * 0.8) }
}

/** Prize for a finishing position in a head-to-head race; a win against better rivals is worth more. */
export function raceReward(position: number, d: Difficulty): Reward {
  const base = [900, 550, 350, 250][position - 1] ?? 250
  const k = RUNGS[d].reward
  return { credits: Math.round(base * k), xp: Math.round(base * k * 0.9) }
}

/** A rally is open once the one before it in the career has been finished. */
export function unlocked(save: Save, rallyIdx: number): boolean {
  return rallyIdx === 0 || save.finished.includes(RALLIES[rallyIdx - 1].id)
}

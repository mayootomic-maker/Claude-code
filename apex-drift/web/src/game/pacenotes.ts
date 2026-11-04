import { STEP, type Route } from '../sim/route'

export type NoteKind = 'corner' | 'jump' | 'crest' | 'splash' | 'bridge' | 'patch' | 'finish'

export interface Note {
  kind: NoteKind
  /** Where the feature starts, metres along the route. */
  s: number
  /** 1 (slowest) … 6 (nearly flat); 0 = hairpin. */
  grade: number
  dir: 'left' | 'right' | null
  long: boolean
  tightens: boolean
  opens: boolean
  surface?: string
  /** Distance to the next note, rounded to a callable value, or 0 for "into". */
  link: number
}

/** Minimum radius (m) for each grade; anything gentler than 6 is not called. */
const GRADE_R = [13, 22, 34, 52, 78, 115, 170]

const cache = new WeakMap<Route, Note[]>()

/**
 * Reads the stage like a co-driver's notebook: corners graded by tightest
 * radius, with direction, length, and whether they tighten or open. Derived
 * from the same curvature the physics drives on, so the notes never lie.
 */
export function paceNotes(route: Route, start: number, finish: number): Note[] {
  const hit = cache.get(route)
  if (hit) return hit
  const notes: Note[] = []
  const n = route.n
  // Smooth curvature over ~10 m so kinks from sampling don't become corners.
  const k = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      sum += route.curv[j]
      c++
    }
    k[i] = sum / c
  }
  const threshold = 1 / GRADE_R[6]
  let i = Math.ceil(start / STEP)
  const last = Math.floor(finish / STEP)
  while (i < last) {
    if (Math.abs(k[i]) < threshold) {
      i++
      continue
    }
    const sign = Math.sign(k[i])
    let j = i
    let peak = 0, peakAt = i
    while (j < last && Math.sign(k[j]) === sign && Math.abs(k[j]) >= threshold * 0.7) {
      if (Math.abs(k[j]) > peak) {
        peak = Math.abs(k[j])
        peakAt = j
      }
      j++
    }
    const len = (j - i) * STEP
    if (len >= 6) {
      const radius = 1 / peak
      let angle = 0
      for (let q = i; q < j; q++) angle += Math.abs(k[q]) * STEP
      let grade = GRADE_R.findIndex((r) => radius < r)
      if (grade < 0) grade = 6
      // A tight corner that turns back on itself is a hairpin.
      if (grade <= 1 && angle > 2.3) grade = 0
      const rel = (peakAt - i) / Math.max(1, j - i)
      notes.push({
        kind: 'corner', s: i * STEP, grade: Math.max(0, Math.min(6, grade)),
        // Positive curvature turns left (heading increases toward +x, the car's left).
        dir: sign > 0 ? 'left' : 'right',
        long: len > 70 && grade > 0,
        tightens: rel > 0.7 && len > 30,
        opens: rel < 0.25 && len > 30,
        link: 0,
      })
    }
    i = j
  }
  for (const f of route.features) {
    if (f.s0 < start || f.s0 > finish) continue
    const kind: NoteKind = f.kind === 'patch' ? 'patch' : f.kind
    notes.push({ kind, s: f.s0, grade: 0, dir: null, long: false, tightens: false, opens: false, surface: f.surface, link: 0 })
  }
  notes.push({ kind: 'finish', s: finish, grade: 0, dir: null, long: false, tightens: false, opens: false, link: 0 })
  notes.sort((a, b) => a.s - b.s)
  for (let q = 0; q < notes.length - 1; q++) notes[q].link = callable(notes[q + 1].s - notes[q].s)
  cache.set(route, notes)
  return notes
}

const DISTANCES = [30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 250, 300]

/** Under 20 m the next call follows straight on ("into"); otherwise the nearest callable distance below. */
export function callable(d: number): number {
  if (d < 25) return 0
  let best = DISTANCES[0]
  for (const v of DISTANCES) if (v <= d) best = v
  return best
}

/** The words, in order, that the co-driver says for a note. Keys match the voice clips. */
export function words(n: Note): string[] {
  const w: string[] = []
  switch (n.kind) {
    case 'corner':
      if (n.grade === 0) w.push(n.dir ?? 'left', 'hairpin')
      else w.push(n.dir ?? 'left', String(n.grade))
      if (n.long) w.push('long')
      if (n.tightens) w.push('tightens')
      else if (n.opens) w.push('opens')
      break
    case 'jump':
      w.push('jump')
      break
    case 'crest':
      w.push('crest')
      break
    case 'splash':
      w.push('watersplash')
      break
    case 'bridge':
      w.push('bridge')
      break
    case 'patch':
      w.push('caution', n.surface === 'ice' ? 'ice' : n.surface === 'mud' ? 'mud' : n.surface === 'sand' ? 'sand' : 'rough')
      break
    case 'finish':
      w.push('flyingfinish')
      break
  }
  if (n.kind !== 'finish') {
    if (n.link === 0) w.push('into')
    else w.push(String(n.link))
  }
  return w
}

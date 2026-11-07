import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RALLIES, SCHOOL } from '../data'
import { autopilot, StageSim } from '../sim/stage'
import { CoDriver } from './codriver'
import { BREAK, callable, paceNotes, words, type Note } from './pacenotes'

const clips = (lang: string): Record<string, [number, number]> =>
  JSON.parse(readFileSync(new URL(`../../public/voice/voice-${lang}.json`, import.meta.url), 'utf8')).clips

describe('pace notes', () => {
  it('every word the co-driver can say has a clip in both languages, and no clip is over-long', () => {
    for (const lang of ['en', 'de']) {
      const c = clips(lang)
      for (const r of RALLIES)
        for (const st of r.stages) {
          const sim = new StageSim({ rally: r, stage: st, car: 'kestrel', difficulty: 'driver' })
          for (const n of paceNotes(sim.route, sim.start, sim.finish)) for (const w of words(n)) expect(c[w], `${lang}:${w}`).toBeDefined()
        }
      for (const w of ['go', 'goodluck', 'wellDone']) expect(c[w]).toBeDefined()
      // 2.0 shipped 'sand' at 2.7 s and 'and' at 3.4 s. Words are slowed to 0.82x
      // for clarity now, which still keeps every single word near a second.
      for (const [k, [, dur]] of Object.entries(c)) if (!['start', 'wellDone', 'bigjump', 'flyingfinish', 'watersplash', 'overcrest', 'goodluck', 'dontcut'].includes(k)) expect(dur, `${lang}:${k}`).toBeLessThan(1.2)
    }
  })

  it('directions match the road: a left note is followed by the road turning left', () => {
    const r = RALLIES[0]
    const sim = new StageSim({ rally: r, stage: r.stages[0], car: 'kestrel', difficulty: 'driver' })
    for (const n of paceNotes(sim.route, sim.start, sim.finish).filter((x) => x.kind === 'corner')) {
      const a = sim.route.at(n.s - 5).heading, b = sim.route.at(n.s + 25).heading
      let d = b - a
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      expect(n.dir === 'left' ? d > 0 : d < 0, `${n.dir} at ${n.s}`).toBe(true)
    }
  })

  it('distances round down to callable values', () => {
    expect(callable(10)).toBe(0)
    expect(callable(64)).toBe(60)
    expect(callable(170)).toBe(150)
    expect(callable(900)).toBe(300)
  })

  it('calls come earlier at speed and every note is called once', () => {
    const r = RALLIES[0]
    const sim = new StageSim({ rally: r, stage: r.stages[3], car: 'kestrel', difficulty: 'driver' })
    const notes = paceNotes(sim.route, sim.start, sim.finish)
    const cd = new CoDriver(notes, 'full')
    let calls = 0
    let steps = 0
    while (sim.phase !== 'finished' && steps++ < 60 * 400) {
      sim.step(autopilot(sim, 0.85))
      if (sim.phase === 'running' && cd.update(sim.car.s, sim.car.speed, sim.time)) calls++
    }
    expect(calls).toBeGreaterThan(5)
    expect(calls).toBeLessThanOrEqual(notes.length)
  })
})

/** Drive a stage on autopilot and record every call with when and where it was made. */
function drive(stage: number, mode: 'full' | 'corners') {
  const r = RALLIES[0]
  const sim = new StageSim({ rally: r, stage: r.stages[stage], car: 'kestrel', difficulty: 'driver' })
  const notes = paceNotes(sim.route, sim.start, sim.finish)
  const cd = new CoDriver(notes, mode)
  const calls: { t: number; s: number; v: number; at: number; words: string[] }[] = []
  let steps = 0
  while (sim.phase !== 'finished' && steps++ < 60 * 400) {
    sim.step(autopilot(sim, 0.85))
    if (sim.phase !== 'running') continue
    const c = cd.update(sim.car.s, sim.car.speed, sim.time)
    if (c) calls.push({ t: sim.time, s: sim.car.s, v: sim.car.speed, at: c.at, words: c.words })
  }
  return { calls, notes }
}

describe('co-driver', () => {
  it('says far less: no "into", no short distances, no minor modifiers', () => {
    let before = 0, now = 0
    for (const st of [0, 3]) {
      const { calls, notes } = drive(st, 'full')
      const said = calls.flatMap((c) => c.words)
      expect(said).not.toContain('into')
      expect(said).not.toContain('long')
      expect(said).not.toContain('opens')
      expect(said).not.toContain('bridge')
      for (const w of said) if (/^\d{2,}$/.test(w)) expect(Number(w)).toBeGreaterThanOrEqual(100)
      // Every word of the old reading, against what is said now.
      before += notes.flatMap((n) => words(n)).length
      now += said.filter((w) => w !== BREAK).length
      for (const c of calls) expect(c.words.filter((w) => w !== BREAK).length).toBeLessThanOrEqual(7)
    }
    expect(now).toBeLessThan(before * 0.6)
  })

  it('spaces calls out unless a corner is about to arrive, and never calls a note already passed', () => {
    for (const st of [0, 3]) {
      const { calls } = drive(st, 'full')
      for (let i = 1; i < calls.length; i++) {
        const c = calls[i]
        const imminent = c.at - c.s <= Math.max(25, Math.max(c.v, 5) * 1.3)
        if (!imminent) expect(c.t - calls[i - 1].t, `call at ${c.s.toFixed(0)} m`).toBeGreaterThanOrEqual(1.6 - 1e-6)
      }
      for (const c of calls) expect(c.at).toBeGreaterThan(c.s)
    }
  })

  it('reads a note that follows close behind in the same breath, with a pause between them', () => {
    const at = (s: number, dir: 'left' | 'right', grade: number): Note => ({ kind: 'corner', s, grade, dir, long: false, tightens: false, opens: false, link: 0 })
    const cd = new CoDriver([at(200, 'left', 3), at(215, 'right', 4), at(600, 'left', 2)], 'full')
    expect(cd.update(0, 20, 0)).toBeNull()
    const c = cd.update(150, 20, 1)
    expect(c?.words).toEqual(['left', '3', BREAK, 'right', '4', '300'])
    expect(c?.at).toBe(200)
    // The next corner waits for spacing until it is close.
    expect(cd.update(560, 20, 1.5)).toBeNull()
    expect(cd.update(580, 20, 1.6)?.words).toEqual(['left', '2'])
  })

  it('in corners-only mode says only corners, hairpins and jumps', () => {
    const { calls } = drive(3, 'corners')
    expect(calls.length).toBeGreaterThan(3)
    for (const w of calls.flatMap((c) => c.words)) expect(['left', 'right', 'hairpin', 'jump', BREAK, '1', '2', '3', '4', '5']).toContain(w)
  })

  it('has a clip for everything it can say', () => {
    const c = clips('en')
    for (const st of [0, 1, 2, 3]) for (const call of drive(st, 'full').calls) for (const w of call.words) if (w !== BREAK) expect(c[w], w).toBeDefined()
  })
})

describe('driving school', () => {
  it('teaches in order: gentle corners first, then one hairpin, and it can be finished', () => {
    const sim = new StageSim({ rally: SCHOOL, stage: SCHOOL.stages[0], car: 'kestrel', difficulty: 'rookie' })
    const corners = paceNotes(sim.route, sim.start, sim.finish).filter((n) => n.kind === 'corner')
    const hp = corners.findIndex((n) => n.grade === 0)
    expect(hp).toBeGreaterThan(2)
    expect(corners[hp].s).toBeGreaterThan(700)
    let steps = 0
    while (sim.phase !== 'finished' && steps++ < 60 * 300) sim.step(autopilot(sim, 0.8))
    expect(sim.phase).toBe('finished')
    expect(sim.resets).toBe(0)
  })
})

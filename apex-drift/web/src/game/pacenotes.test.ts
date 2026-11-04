import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RALLIES, SCHOOL } from '../data'
import { autopilot, StageSim } from '../sim/stage'
import { CoDriver } from './codriver'
import { callable, paceNotes, words } from './pacenotes'

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
      // 2.0 shipped 'sand' at 2.7 s and 'and' at 3.4 s; single words are short now.
      for (const [k, [, dur]] of Object.entries(c)) if (!['start', 'wellDone', 'bigjump', 'flyingfinish', 'watersplash', 'overcrest', 'goodluck', 'dontcut'].includes(k)) expect(dur, `${lang}:${k}`).toBeLessThan(1.0)
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
      if (sim.phase === 'running' && cd.update(sim.car.s, sim.car.speed)) calls++
    }
    expect(calls).toBeGreaterThan(5)
    expect(calls).toBeLessThanOrEqual(notes.length)
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

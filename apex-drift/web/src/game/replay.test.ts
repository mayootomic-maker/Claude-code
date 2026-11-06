import { describe, expect, it } from 'vitest'
import { RALLIES } from '../data'
import { autopilot, StageSim } from '../sim/stage'
import { BODY } from '../sim/terrain'
import type { Pose } from '../sim/car'
import { GhostRecorder } from './ghost'
import { Director, emptyFrame, REPLAY_HZ, ReplayRecorder, type ShotKind } from './replay'

const pose = (x: number, heading: number): Pose => ({ x, y: 0, z: 0, heading, pitch: 0, roll: 0, steer: 0, spin: 0 })

describe('replay recording', () => {
  it('samples at its own rate and interpolates between samples', () => {
    const rec = new ReplayRecorder()
    for (let i = 0; i <= 120; i++) rec.record(i / 60, i, pose(i, 0), 20, 5000, 1, 3, 0)
    const r = rec.done()
    expect(r.frames).toBe(61)
    expect(r.duration).toBeCloseTo(2, 5)
    const f = r.at(1 + 0.5 / REPLAY_HZ, emptyFrame())
    expect(f.x).toBeGreaterThan(60)
    expect(f.x).toBeLessThan(62)
  })

  it('ghost and replay keep exact time over a long run (no skipped samples)', () => {
    const ghost = new GhostRecorder()
    const rec = new ReplayRecorder()
    for (let i = 0; i <= 60 * 180; i++) {
      ghost.record(i / 60, 0, 0, 0, 0)
      rec.record(i / 60, 0, pose(0, 0), 0, 0, 0, 1, 0)
    }
    expect(ghost.frames().length / 4).toBe(180 * 10 + 1)
    expect(rec.done().duration).toBeCloseTo(180, 3)
  })

  it('turns the short way round across ±π', () => {
    const rec = new ReplayRecorder()
    rec.record(0, 0, pose(0, Math.PI - 0.1), 0, 0, 0, 1, 0)
    rec.record(1, 1, pose(1, -Math.PI + 0.1), 0, 0, 0, 1, 0)
    const h = rec.done().at(0.5 / REPLAY_HZ, emptyFrame()).heading
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.11)
  })

  it('clamps outside the recording instead of returning garbage', () => {
    const rec = new ReplayRecorder()
    rec.record(0, 0, pose(5, 0), 0, 0, 0, 1, 0)
    const r = rec.done()
    expect(r.at(-3, emptyFrame()).x).toBe(5)
    expect(r.at(99, emptyFrame()).x).toBe(5)
  })
})

describe('TV director', () => {
  it('cuts through every kind of shot and keeps cameras above ground and off the scenery', () => {
    const rally = RALLIES[0]
    const sim = new StageSim({ rally, stage: rally.stages[0], car: 'kestrel', difficulty: 'driver' })
    const rec = new ReplayRecorder()
    const tmp = pose(0, 0)
    let steps = 0
    while (sim.phase !== 'finished' && steps < 60 * 60 * 8) {
      sim.step(autopilot(sim, 0.8))
      steps++
      if (sim.phase === 'running') rec.record(sim.time, sim.car.s, sim.car.pose(1, tmp), sim.car.speed, sim.car.rpm, 1, sim.car.gear, 0)
    }
    const replay = rec.done()
    const g = sim.ground
    const dir = new Director(sim.route, (x, z) => g.height(x, z), (s) => g.limitAt(s) + BODY + 0.8, sim.finish)
    const seen = new Set<ShotKind>()
    const frame = emptyFrame()
    for (let t = 0; t < replay.duration; t += 1 / 30) {
      const f = replay.at(t, frame)
      const shot = dir.shot(t, f)
      seen.add(shot.kind)
      expect(shot.pos.y).toBeGreaterThanOrEqual(g.height(shot.pos.x, shot.pos.z) + 0.2)
      expect(Number.isFinite(shot.fov) && shot.fov > 10 && shot.fov < 80).toBe(true)
      if (shot.kind === 'trackside') {
        // Inside the strip that scenery placement keeps free of solids.
        const c = sim.route.closest(shot.pos.x, shot.pos.z, 600)
        if (c) expect(c.dist).toBeLessThan(g.limitAt(c.s) + BODY + 1.2)
      }
    }
    expect([...seen].sort()).toEqual(['chase', 'front', 'heli', 'trackside', 'wheel'])
  })
})

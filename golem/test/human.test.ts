import { describe, expect, it } from 'vitest'
import { Aim, angleDelta, lookAt, minimumJerk } from '../src/human/aim.js'
import { makePersona } from '../src/human/profile.js'
import { Rhythm } from '../src/human/rhythm.js'
import { Typist } from '../src/human/typing.js'
import { OrnsteinUhlenbeck, Rng } from '../src/util/random.js'

const persona = makePersona('testbot')

describe('seeded randomness', () => {
  it('is uniform enough to build distributions on', () => {
    const rng = new Rng('uniformity')
    const buckets = new Array(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]!++
    for (const count of buckets) expect(Math.abs(count - n / 10) / (n / 10)).toBeLessThan(0.05)
  })

  it('gives unrelated streams to adjacent seeds', () => {
    // "bot1" and "bot2" must not end up as near-identical players.
    const a = new Rng('bot1')
    const b = new Rng('bot2')
    let agreements = 0
    for (let i = 0; i < 1000; i++) if (Math.abs(a.next() - b.next()) < 0.01) agreements++
    expect(agreements).toBeLessThan(60)
  })

  it('is reproducible from a seed', () => {
    const draw = () => {
      const rng = new Rng('repeat')
      return [rng.next(), rng.normal(), rng.logNormal(1, 0.3)]
    }
    expect(draw()).toEqual(draw())
  })

  it('produces right-skewed latencies, never impossibly fast ones', () => {
    const rng = new Rng('latency')
    const samples = Array.from({ length: 20_000 }, () => rng.logNormal(0.25, 0.35))
    const mean = samples.reduce((a, b) => a + b) / samples.length
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    // The defining property of a right-skewed distribution.
    expect(mean).toBeGreaterThan(median)
    expect(Math.min(...samples)).toBeGreaterThan(0.05)
  })

  it('keeps tremor bounded and centred, unlike a random walk', () => {
    const ou = new OrnsteinUhlenbeck(new Rng('tremor'), 3, 0.5)
    let peak = 0
    let sum = 0
    const steps = 20_000
    for (let i = 0; i < steps; i++) {
      const v = ou.step(1 / 60)
      peak = Math.max(peak, Math.abs(v))
      sum += v
    }
    expect(peak).toBeLessThan(1)
    expect(Math.abs(sum / steps)).toBeLessThan(0.05)
  })
})

describe('personas', () => {
  it('is the same player every time from the same seed', () => {
    expect(makePersona('Tom')).toEqual(makePersona('Tom'))
  })

  it('is a different player from a different seed', () => {
    expect(makePersona('Tom').reaction).not.toBe(makePersona('Sam').reaction)
  })

  it('stays inside plausible human ranges for any seed', () => {
    for (let i = 0; i < 500; i++) {
      const p = makePersona(`seed-${i}`)
      expect(p.reaction).toBeGreaterThan(0.15)
      expect(p.reaction).toBeLessThan(0.4)
      expect(p.wpm).toBeGreaterThan(20)
      expect(p.wpm).toBeLessThan(100)
    }
  })

  it('accepts overrides for deliberately configured bots', () => {
    expect(makePersona('Tom', { wpm: 200 }).wpm).toBe(200)
  })
})

describe('aiming', () => {
  const at = (yaw: number, pitch: number) => ({ yaw, pitch })

  it('takes the short way round the compass', () => {
    // 350 degrees to 10 degrees is a 20 degree turn, not a 340 degree one.
    expect(angleDelta((350 * Math.PI) / 180, (10 * Math.PI) / 180)).toBeCloseTo((20 * Math.PI) / 180, 5)
  })

  it('never snaps: reaching a target takes many frames', () => {
    const aim = new Aim(persona)
    aim.reset(at(0, 0))
    aim.moveTo(at(Math.PI / 2, 0.3))
    let frames = 0
    while (aim.busy && frames < 1000) {
      aim.step(1 / 20)
      frames++
    }
    expect(frames).toBeGreaterThan(2)
    expect(aim.busy).toBe(false)
  })

  it('obeys Fitts\'s law: further and smaller takes longer', () => {
    const time = (distance: number, width: number) => {
      const aim = new Aim(persona)
      aim.reset(at(0, 0))
      aim.moveTo(at(distance, 0), width)
      let t = 0
      while (aim.busy && t < 60) {
        aim.step(1 / 100)
        t += 1 / 100
      }
      return t
    }
    expect(time(2.0, 0.1)).toBeGreaterThan(time(0.2, 0.1))
    expect(time(1.0, 0.03)).toBeGreaterThan(time(1.0, 0.5))
  })

  it('sometimes overshoots and corrects back, rather than always creeping in', () => {
    // A settle that only ever approaches from one side is a machine signature.
    // Real pointing overshoots a decent minority of the time — but not always,
    // which is why this is a statistical claim over many movements.
    const aim = new Aim(persona)
    let overshot = 0
    const attempts = 200
    for (let i = 0; i < attempts; i++) {
      aim.reset(at(0, 0))
      const target = 1.0
      aim.moveTo(at(target, 0), 0.05)
      let peak = 0
      while (aim.busy) peak = Math.max(peak, aim.step(1 / 60).yaw)
      if (peak > target + 0.01) overshot++
      expect(Math.abs(aim.orientation.yaw - target)).toBeLessThan(0.05)
    }
    expect(overshot).toBeGreaterThan(attempts * 0.1)
    expect(overshot).toBeLessThan(attempts * 0.9)
  })

  it('follows a smooth acceleration profile, not a constant rate', () => {
    expect(minimumJerk(0)).toBe(0)
    expect(minimumJerk(1)).toBe(1)
    expect(minimumJerk(0.5)).toBeCloseTo(0.5, 6)
    // Slow at the ends, fast in the middle — the shape a constant rate lacks.
    expect(minimumJerk(0.1)).toBeLessThan(0.1)
    expect(minimumJerk(0.9)).toBeGreaterThan(0.9)
  })

  it('never stops moving entirely, even at rest', () => {
    const aim = new Aim(persona)
    aim.reset(at(0, 0))
    const samples = Array.from({ length: 200 }, () => aim.step(1 / 20).yaw)
    expect(new Set(samples).size).toBeGreaterThan(100)
  })

  it('cannot look further than straight up or down', () => {
    const aim = new Aim(persona)
    aim.reset(at(0, 0))
    aim.moveTo(at(0, 10))
    for (let i = 0; i < 500; i++) {
      const { pitch } = aim.step(1 / 20)
      expect(Math.abs(pitch)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
    }
  })

  it('points where it is told', () => {
    const o = lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 })
    expect(o.yaw).toBeCloseTo(0, 5)
    expect(o.pitch).toBeCloseTo(0, 5)
    expect(lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }).pitch).toBeCloseTo(Math.PI / 2, 5)
  })
})

describe('rhythm', () => {
  const clockAt = (seconds: { value: number }) => ({ now: () => seconds.value })

  it('reacts with a delay that varies', () => {
    const t = { value: 0 }
    const rhythm = new Rhythm(persona, clockAt(t))
    const samples = Array.from({ length: 500 }, () => rhythm.reaction())
    expect(new Set(samples.map((s) => s.toFixed(3))).size).toBeGreaterThan(100)
    expect(Math.min(...samples)).toBeGreaterThan(0.05)
    expect(Math.max(...samples)).toBeLessThan(6.01)
  })

  it('takes longer over decisions than over reflexes', () => {
    const t = { value: 0 }
    const rhythm = new Rhythm(persona, clockAt(t))
    const mean = (kind: 'reflex' | 'considered') =>
      Array.from({ length: 400 }, () => rhythm.reaction(kind)).reduce((a, b) => a + b) / 400
    expect(mean('considered')).toBeGreaterThan(mean('reflex'))
  })

  it('slows down over a long session but does not seize up', () => {
    const t = { value: 0 }
    const rhythm = new Rhythm(persona, clockAt(t))
    expect(rhythm.fatigue()).toBe(1)
    t.value = persona.staminaSeconds * 6
    const tired = rhythm.fatigue()
    expect(tired).toBeGreaterThan(1)
    expect(tired).toBeLessThan(1 + persona.fatigueFactor + 0.001)
  })

  it('stops for a moment now and then', () => {
    const t = { value: 0 }
    const rhythm = new Rhythm(persona, clockAt(t))
    let breaks = 0
    for (let minute = 0; minute < 600; minute++) {
      t.value = minute * 60
      if (rhythm.breakCheck().pause) breaks++
    }
    expect(breaks).toBeGreaterThan(0)
  })
})

describe('typing', () => {
  const typist = new Typist(persona)

  it('takes longer over longer messages', () => {
    expect(typist.duration('this is a much longer sentence to type out')).toBeGreaterThan(
      typist.duration('ok'),
    )
  })

  it('types at a plausible speed', () => {
    const text = 'heading down to mine some iron, back in a bit'
    const seconds = typist.duration(text)
    const wpm = text.length / 5 / (seconds / 60)
    expect(wpm).toBeGreaterThan(15)
    expect(wpm).toBeLessThan(140)
  })

  it('never replies instantly', () => {
    for (let i = 0; i < 200; i++) {
      expect(typist.compose('ok')[0]!.delay).toBeGreaterThan(0.15)
    }
  })

  it('makes keyboard-adjacent slips, not random corruption', () => {
    const loose = new Typist(makePersona('sloppy', { typoRate: 0.5, correctionRate: 0 }))
    const source = 'the quick brown fox jumps over the lazy dog'
    const typed = loose.compose(source)[0]!.text
    expect(typed).not.toBe(source)
    expect(typed.length).toBe(source.length)
  })

  it('sometimes sends the *correction line everyone sends', () => {
    const loose = new Typist(makePersona('fixer', { typoRate: 0.3, correctionRate: 1 }))
    const lines = loose.compose('heading to the mineshaft now')
    expect(lines.length).toBe(2)
    expect(lines[1]!.text.startsWith('*')).toBe(true)
  })

  it('leaves a clean message alone', () => {
    const careful = new Typist(makePersona('careful', { typoRate: 0 }))
    expect(careful.compose('all good')[0]!.text).toBe('all good')
  })
})

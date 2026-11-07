import { describe, expect, it } from 'vitest'
import { EngineDSP, defaultInputs } from './engine-dsp'
import { engineProfileFor, type EngineProfile } from './engines'
import { soundInputs, type CarSoundState } from './engine'

const SR = 48000
const CARS = ['piccola', 'ventura', 'kestrel', 'ruska', 'saetta', 'bison', 'falco', 'boxer', 'vulcan', 'corsaire', 'strada', 'apex']

function render(profile: EngineProfile, secs: number, drive: (t: number, d: EngineDSP) => void) {
  const d = new EngineDSP(profile, SR)
  const n = Math.floor((secs * SR) / 128) * 128
  const eng = new Float32Array(n), sfx = new Float32Array(n)
  for (let i = 0; i < n; i += 128) {
    drive(i / SR, d)
    d.render(eng.subarray(i, i + 128), sfx.subarray(i, i + 128), 128)
  }
  return { eng, sfx }
}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
/** Second difference: near zero for anything smooth, large for a click. */
const d2 = (x: Float32Array) => {
  const o = new Float32Array(x.length)
  for (let i = 2; i < x.length; i++) o[i] = x[i] - 2 * x[i - 1] + x[i - 2]
  return o
}
/**
 * Largest third difference at the 128-frame block edges, and everywhere else.
 * On a smooth tone it is tiny; a gain or filter that steps when a new block
 * arrives puts its whole step into it, right at the edge.
 */
function jumps(x: Float32Array): { edge: number; inside: number } {
  let edge = 0, inside = 0
  for (let i = 3; i < x.length; i++) {
    const j = Math.abs(x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3])
    if (i % 128 < 3) edge = Math.max(edge, j)
    else inside = Math.max(inside, j)
  }
  return { edge, inside }
}

describe('engine profiles', () => {
  it('covers every car with a sane rev range', () => {
    for (const id of CARS) {
      const p = engineProfileFor(id)
      expect(p.redline).toBeGreaterThan(p.idle * 5)
    }
    expect(engineProfileFor('boxer')).toMatchObject({ cylinders: 5, turbo: true })
    expect(engineProfileFor('corsaire').layout).toBe('flat')
    expect(engineProfileFor('nope')).toEqual(engineProfileFor('piccola'))
  })
})

describe('engine DSP', () => {
  it('stays finite and under the ceiling for every car, idle to limiter', () => {
    for (const id of CARS) {
      const p = engineProfileFor(id)
      const { eng, sfx } = render(p, 1.5, (t, d) => {
        Object.assign(d.in, { rpm: p.idle + (p.redline - p.idle) * Math.min(1, t), throttle: 1, load: 1, boost: 1, gear: 3, speed: 30, crunch: 0.4, grain: 260, stones: 20, stoneGain: 0.5 })
      })
      expect(eng.every(Number.isFinite) && sfx.every(Number.isFinite)).toBe(true)
      expect(peak(eng)).toBeLessThan(0.9)
      expect(peak(sfx)).toBeLessThan(0.9)
      expect(rms(eng)).toBeGreaterThan(0.05)
    }
  })

  it('is louder on load than on overrun, and pops after a lift', () => {
    const p = engineProfileFor('kestrel')
    const { eng } = render(p, 3, (t, d) => {
      const on = t < 1.5
      Object.assign(d.in, { rpm: 7000, throttle: on ? 1 : 0, load: on ? 1 : -0.7, gear: 3, speed: 30 })
    })
    const on = eng.subarray(0.5 * SR, 1.4 * SR), off = eng.subarray(1.6 * SR, 3 * SR)
    expect(rms(on)).toBeGreaterThan(rms(off) * 2)
    // Pops are transients well above the overrun bed.
    expect(peak(off)).toBeGreaterThan(rms(off) * 3)
  })

  it('has no steps at block edges through rpm sweeps, gear changes and a camera switch', () => {
    // Exhaust and intake off leaves the gearbox whine, a pure tone: any parameter
    // that steps when a new block arrives shows up as a jump at the block edge.
    const p = engineProfileFor('kestrel')
    const { eng } = render(p, 3, (t, d) => {
      const bonnet = t > 1.5
      Object.assign(d.in, {
        rpm: 2500 + 4000 * (t % 1), throttle: t % 1 < 0.7 ? 1 : 0, load: t % 1 < 0.7 ? 1 : -0.6, gear: 1 + Math.floor(t / 0.4), speed: 12 + 8 * t,
        exhaust: 0, intake: 0, whine: 1, cabin: bonnet ? 0.6 : 0, muffle: bonnet ? 1400 : 20000,
      })
    })
    // The old per-block gains put 3x the inside maximum at the edges.
    const { edge, inside } = jumps(eng.subarray(0.6 * SR))
    expect(edge).toBeLessThan(inside * 1.25)
    for (const id of CARS) {
      const q = engineProfileFor(id)
      const full = render(q, 2, (t, d) => {
        Object.assign(d.in, { rpm: q.idle + (q.redline - q.idle) * (t % 1), throttle: t % 1 < 0.75 ? 1 : 0, load: t % 1 < 0.75 ? 1 : -0.7, boost: t % 1 < 0.75 ? 1 : 0, gear: 2 + Math.floor(t * 3), speed: 25 })
      }).eng
      const j = jumps(full)
      expect(j.edge, id).toBeLessThanOrEqual(j.inside)
    }
  })

  it('makes overrun bangs and gravel crisp rather than clicky', () => {
    // Click energy, measured as second difference against level. Instant-attack
    // bursts of raw white noise (2.x) scored 0.41 on the overrun and 0.34 on gravel.
    const p = engineProfileFor('kestrel')
    const { eng } = render(p, 3, (t, d) => {
      const on = t < 1.5
      Object.assign(d.in, { rpm: on ? 3000 + 3000 * t : 7000 - (t - 1.5) * 2000, throttle: on ? 1 : 0, load: on ? 1 : -0.7, gear: 3, speed: 30 })
    })
    const off = eng.subarray(1.6 * SR)
    expect(rms(d2(off)) / rms(off)).toBeLessThan(0.2)
    const { sfx } = render(p, 2, (_t, d) => {
      Object.assign(d.in, { rpm: 3000, throttle: 0.5, load: 0.5, gear: 3, speed: 20, crunch: 0.4, crunchFreq: 1100, grain: 260, stones: 40, stoneGain: 0.5, clunk: 2, rumble: 0.1 })
    })
    expect(rms(d2(sfx)) / rms(sfx)).toBeLessThan(0.2)
  })

  it('blows off and flutters on a lift in a turbo car, not in an atmospheric one', () => {
    const lift = (id: string) => {
      const p = engineProfileFor(id)
      const { eng } = render(p, 2.6, (t, d) => {
        const on = t < 1.8
        Object.assign(d.in, { rpm: on ? 3500 + 1800 * t : 6500, throttle: on ? 1 : 0, load: on ? 1 : -0.6, boost: on && p.turbo ? Math.min(1, t) : 0, gear: 3, speed: 30, exhaust: 0, intake: 0, whine: 0 })
      })
      return rms(eng.subarray(1.82 * SR, 2.2 * SR))
    }
    expect(lift('apex')).toBeGreaterThan(0.02)
    expect(lift('kestrel')).toBeLessThan(0.002)
  })

  it('survives garbage input', () => {
    const { eng } = render(engineProfileFor('apex'), 0.3, (_t, d) => {
      Object.assign(d.in, { rpm: NaN, throttle: Infinity, load: -5, boost: NaN, gear: -1, speed: NaN })
    })
    expect(eng.every(Number.isFinite)).toBe(true)
  })
})

describe('sound inputs', () => {
  const s: CarSoundState = { rpm: 5000, throttle: 1, load: 1, gear: 3, shifting: false, boost: 0, speed: 25, surface: 'gravel', slip: 0, wheelSpin: 0, onGround: true, impact: 0, landed: 0, camera: 'chase' }
  it('puts stones under a car on gravel and silences the ground in the air', () => {
    expect(soundInputs(s).stones).toBeGreaterThan(5)
    const air = soundInputs({ ...s, onGround: false })
    expect(air.stones + air.crunch + air.rumble).toBe(0)
  })
  it('only squeals on tarmac', () => {
    expect(soundInputs({ ...s, slip: 0.6 }).squeal).toBe(0)
    expect(soundInputs({ ...s, surface: 'asphalt', slip: 0.6 }).squeal).toBeGreaterThan(0)
  })
  it('muffles the exhaust from the bonnet camera', () => {
    expect(soundInputs({ ...s, camera: 'bonnet' }).muffle).toBeLessThan(defaultInputs().muffle)
  })
})

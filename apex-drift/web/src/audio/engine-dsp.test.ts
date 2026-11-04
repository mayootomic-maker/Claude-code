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

import { describe, expect, it } from 'vitest'
import { rng } from '../core/math'
import { CARS, carPhys } from '../data'
import { ASSISTS, Car, DT, type Assists, type Input } from './car'
import type { Route } from './route'
import type { Ground } from './terrain'

/**
 * An endless flat plain of one surface with a straight centreline along +z
 * and no edge to leave: a test track for the car on its own.
 */
function flat(): Ground {
  const route = {
    closest: (x: number, z: number) => ({ s: z, d: x, dist: Math.abs(x) }),
    at: (s: number) => ({ x: 0, z: s, y: 0, heading: 0, curv: 0, i: 0 }),
    featureAt: () => undefined,
    half: 1e9,
    length: 1e9,
  }
  return { height: () => 0, natural: () => 0, edge: 1e9, limitAt: () => 1e9, route: route as unknown as Route }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const KMH = 1 / 3.6
/** Test drivers steer for themselves; the steering assist would chase the test track's centreline. */
const hands = (d: keyof typeof ASSISTS): Assists => ({ ...ASSISTS[d], steer: 0, autoBrake: false })

/** A car already rolling at `v` m/s in `gear`, wheels turning at road speed. */
function rolling(id: string, surface: string, v: number, gear: number): Car {
  const c = new Car(carPhys(id), flat(), surface, false)
  c.place(0)
  const wheels = c as unknown as { wf: number; wr: number }
  c.vx = wheels.wf = wheels.wr = v
  c.gear = gear
  return c
}

function standing(id: string, surface = 'asphalt'): Car {
  const c = new Car(carPhys(id), flat(), surface, false)
  c.place(0)
  return c
}

const FLAT_OUT: Input = { steer: 0, throttle: 1, brake: 0, handbrake: false }

/** Seconds from rest to 100 km/h, and the speed it settles at, flat out in a straight line. */
function sprint(id: string, surface = 'asphalt') {
  const c = standing(id, surface)
  let t100 = Infinity, top = 0
  for (let i = 0; i < 60 * 80; i++) {
    c.step(FLAT_OUT, hands('driver'))
    if (t100 === Infinity && c.vx >= 100 * KMH) t100 = (i + 1) * DT
    top = Math.max(top, c.vx)
  }
  return { t100, top: top / KMH }
}

/**
 * Highest steady lateral acceleration on a 40 m circle: hold the radius with
 * the steering, raise the speed in steps until the car can't.
 */
function skidpad(surface: string): number {
  const R = 40
  let best = 0
  for (let v = 6; v < 40; v += 0.5) {
    const c = rolling('kestrel', surface, v, 3)
    let st = 0, sum = 0, n = 0
    for (let i = 0; i < 60 * 12; i++) {
      st = clamp(st - (c.speed / R - c.r) * 0.08, -1, 1)
      c.step({ steer: st, throttle: clamp((v - c.speed) * 0.6 + 0.25, 0, 1), brake: 0, handbrake: false }, hands('pro'))
      if (i > 60 * 8) {
        sum += Math.abs(c.speed * c.r)
        n++
      }
    }
    const held = Math.abs((c.r * R) / c.speed - 1) < 0.05 && Math.abs(c.speed - v) < 1
    if (!held) break
    best = Math.max(best, sum / n / 9.81)
  }
  return best
}

describe('car: grip', () => {
  const g: Record<string, [number, number]> = { asphalt: [0.95, 1.1], gravel: [0.75, 0.85], snow: [0.55, 0.65], ice: [0.27, 0.34] }
  for (const [surface, [lo, hi]] of Object.entries(g)) {
    it(`holds ${lo}-${hi} g on a ${surface} skidpad`, () => {
      const lat = skidpad(surface)
      expect(lat).toBeGreaterThan(lo)
      expect(lat).toBeLessThan(hi)
    })
  }

  it('stops from 100 km/h on tarmac in 35-45 m with ABS, and further on locked wheels', () => {
    const stop = (id: string, d: 'driver' | 'pro') => {
      const c = rolling(id, 'asphalt', 100 * KMH, 4)
      for (let i = 0; i < 600 && c.vx > 0.05; i++) c.step({ steer: 0, throttle: 0, brake: 1, handbrake: false }, hands(d))
      expect(Math.abs(c.x), `${id} ${d} stays straight`).toBeLessThan(0.5)
      return c.z
    }
    for (const { id } of CARS) {
      const abs = stop(id, 'driver')
      expect(abs, id).toBeGreaterThan(35)
      expect(abs, id).toBeLessThan(45)
      // Pro has no ABS assist; cars without their own lock up and slide further.
      const pro = stop(id, 'pro')
      expect(pro, id).toBeGreaterThan(abs - 1)
      expect(pro, id).toBeLessThan(55)
    }
  })

  it('locks the fronts under hard braking without ABS, not with it', () => {
    const peak = (id: string, d: 'driver' | 'pro') => {
      const c = rolling(id, 'gravel', 20, 3)
      let slip = 0
      for (let i = 0; i < 30; i++) {
        c.step({ steer: 0, throttle: 0, brake: 1, handbrake: false }, hands(d))
        slip = Math.max(slip, c.slipF)
      }
      return slip
    }
    expect(peak('kestrel', 'pro')).toBeGreaterThan(0.4)
    expect(peak('kestrel', 'driver')).toBeLessThan(0.15)
    // A 90s car has ABS of its own.
    expect(peak('apex', 'pro')).toBeLessThan(0.15)
  })
})

describe('car: engine and gearbox', () => {
  const t100: Record<string, [number, number]> = {
    piccola: [12, 16], ventura: [10.5, 14], kestrel: [8, 10], ruska: [8.5, 11], saetta: [5.5, 7.5], bison: [8, 11],
    falco: [3.8, 5.5], boxer: [3.5, 5], vulcan: [3.3, 5], corsaire: [4, 6], strada: [4, 6], apex: [4, 6],
  }
  for (const { id } of CARS) {
    it(`${id}: 0-100 km/h and top speed are believable for its era`, () => {
      const r = sprint(id)
      const [lo, hi] = t100[id]
      expect(r.t100).toBeGreaterThan(lo)
      expect(r.t100).toBeLessThan(hi)
      expect(r.top).toBeGreaterThan(135)
      expect(r.top).toBeLessThan(215)
    })
  }

  it('older cars are slower than newer ones', () => {
    expect(sprint('piccola').t100).toBeGreaterThan(sprint('kestrel').t100)
    expect(sprint('kestrel').t100).toBeGreaterThan(sprint('apex').t100)
    expect(sprint('piccola').top).toBeLessThan(sprint('apex').top)
  })

  it('shifts up through every gear without hunting, revs staying between idle and redline', () => {
    for (const { id } of CARS) {
      const c = standing(id)
      let gear = c.gear, downs = 0, minRpm = Infinity, maxRpm = 0, cut = 0
      for (let i = 0; i < 60 * 70; i++) {
        c.step(FLAT_OUT, hands('driver'))
        if (c.gear < gear) downs++
        gear = c.gear
        if (c.shifting) cut++
        minRpm = Math.min(minRpm, c.rpm)
        maxRpm = Math.max(maxRpm, c.rpm)
      }
      expect(downs, id).toBe(0)
      expect(gear, id).toBeGreaterThanOrEqual(c.p.gears.length - 1)
      expect(minRpm, id).toBeGreaterThanOrEqual(c.idle)
      expect(maxRpm, id).toBeLessThanOrEqual(c.redline * 1.01)
      expect(maxRpm, id).toBeGreaterThan(c.redline * 0.9)
      // Every change cuts torque for 0.1-0.2 s.
      expect(cut * DT / (gear - 1), id).toBeGreaterThan(0.09)
      expect(cut * DT / (gear - 1), id).toBeLessThan(0.22)
    }
  })

  it('shifts down when braking and brakes on the engine when lifting', () => {
    const c = rolling('kestrel', 'asphalt', 30, 4)
    for (let i = 0; i < 30; i++) c.step({ steer: 0, throttle: 0, brake: 0, handbrake: false }, hands('driver'))
    expect(c.engineLoad).toBeLessThan(0)
    expect(c.throttleOut).toBe(0)
    for (let i = 0; i < 150; i++) c.step({ steer: 0, throttle: 0, brake: 0.8, handbrake: false }, hands('driver'))
    expect(c.gear).toBeLessThanOrEqual(2)
    expect(c.rpm).toBeGreaterThanOrEqual(c.idle)
  })

  it('builds boost with lag on a turbo engine, none on the others', () => {
    const c = rolling('boxer', 'asphalt', 15, 2)
    const boost: number[] = []
    for (let i = 0; i < 90; i++) {
      c.step(FLAT_OUT, hands('driver'))
      boost.push(c.boost)
    }
    expect(boost[8]).toBeLessThan(0.4)
    expect(Math.max(...boost.slice(50))).toBeGreaterThan(0.9)
    const n = rolling('kestrel', 'asphalt', 15, 2)
    for (let i = 0; i < 90; i++) n.step(FLAT_OUT, hands('driver'))
    expect(n.boost).toBe(0)
    expect(n.turbo).toBe(false)
  })

  it('describes each engine for the sound', () => {
    for (const { id } of CARS) {
      const c = standing(id)
      expect([4, 5, 6]).toContain(c.cylinders)
      expect(['inline', 'flat', 'v']).toContain(c.layout)
      expect(c.idle).toBeGreaterThan(700)
      expect(c.redline).toBeGreaterThanOrEqual(6000)
      expect(c.redline).toBeLessThanOrEqual(8500)
    }
    expect(standing('corsaire').layout).toBe('flat')
    expect(standing('boxer').cylinders).toBe(5)
    expect(standing('saetta').layout).toBe('v')
  })

  it('reverses when the brake is held at a standstill and drives off again on throttle', () => {
    const c = standing('kestrel', 'gravel')
    for (let i = 0; i < 120; i++) c.step({ steer: 0, throttle: 0, brake: 1, handbrake: true }, hands('rookie'))
    expect(Math.abs(c.vx)).toBeLessThan(0.01)
    for (let i = 0; i < 240; i++) c.step({ steer: 0, throttle: 0, brake: 1, handbrake: false }, hands('rookie'))
    expect(c.gear).toBe(-1)
    expect(c.vx).toBeLessThan(-3)
    for (let i = 0; i < 180; i++) c.step(FLAT_OUT, hands('rookie'))
    expect(c.gear).toBeGreaterThan(0)
    expect(c.vx).toBeGreaterThan(3)
  })
})

describe('car: handling', () => {
  it('spins the driven wheels on gravel when floored without traction control, rear drive most', () => {
    const spin = (id: string, d: 'driver' | 'pro') => {
      const c = standing(id, 'gravel')
      let m = 0
      for (let i = 0; i < 60; i++) {
        c.step(FLAT_OUT, hands(d))
        m = Math.max(m, c.wheelSpin)
      }
      return m
    }
    expect(spin('ruska', 'pro')).toBeGreaterThan(0.8)
    expect(spin('ruska', 'driver')).toBeLessThan(0.15)
    expect(spin('ruska', 'pro')).toBeGreaterThan(spin('kestrel', 'pro'))
  })

  it('turns harder with the handbrake in a hairpin, on every difficulty', () => {
    for (const d of ['rookie', 'driver', 'pro'] as const)
      for (const surface of ['gravel', 'asphalt', 'snow']) {
        const turn = (hb: boolean) => {
          const c = rolling('kestrel', surface, 14, 2)
          for (let i = 0; i < 60; i++) c.step({ steer: -1, throttle: 0, brake: 0, handbrake: hb && i < 36 }, hands(d))
          return c.heading
        }
        expect(turn(true), `${d} ${surface}`).toBeGreaterThan(turn(false) * 1.3)
      }
  })

  it('oversteers on power in a rear-driven car on Pro, and the assists keep it tidy on Rookie', () => {
    const slide = (d: 'rookie' | 'pro') => {
      const c = rolling('ruska', 'gravel', 12, 2)
      let m = 0
      for (let i = 0; i < 120; i++) {
        c.step({ steer: -0.6, throttle: 1, brake: 0, handbrake: false }, hands(d))
        m = Math.max(m, Math.abs(Math.atan2(c.vy, c.vx)))
      }
      return m
    }
    expect(slide('pro')).toBeGreaterThan(0.35)
    expect(slide('rookie')).toBeLessThan(0.2)
  })

  it('holds a throttle drift on gravel on Pro without spinning', () => {
    const c = rolling('ruska', 'gravel', 16, 2)
    const target = 0.4
    const beta: number[] = []
    for (let i = 0; i < 60 * 6; i++) {
      const b = Math.atan2(c.vy, Math.max(1, c.vx))
      const e = b - target
      const inp = i < 30 ? { steer: 1, throttle: 0.5, brake: 0, handbrake: i > 10 && i < 24 } : { steer: clamp(-0.15 - 3 * e, -1, 1), throttle: clamp(0.6 - 3 * e, 0, 1), brake: 0, handbrake: false }
      c.step(inp, hands('pro'))
      if (i > 60 * 2) beta.push(b)
    }
    expect(Math.min(...beta)).toBeGreaterThan(0.15)
    expect(Math.max(...beta)).toBeLessThan(0.7)
    expect(c.speed).toBeGreaterThan(4)
  })

  it('lands from a jump with a nose dip and without a spin', () => {
    for (const d of ['rookie', 'pro'] as const) {
      const c = rolling('apex', 'gravel', 30, 4)
      c.y = 3
      c.vyUp = 3
      c.airborne = true
      c.r = 0.25
      let landed = false, dip = 0, yaw = 0
      for (let i = 0; i < 180; i++) {
        c.step(FLAT_OUT, hands(d))
        landed ||= c.events.landed > 0
        if (landed) {
          dip = Math.max(dip, c.pitch)
          yaw = Math.max(yaw, Math.abs(c.r))
        }
      }
      expect(landed).toBe(true)
      expect(dip).toBeGreaterThan(0.02)
      expect(yaw).toBeLessThan(0.1)
    }
  })

  it('dives under braking, squats on throttle and rolls out of a turn', () => {
    const brake = rolling('kestrel', 'asphalt', 25, 3)
    for (let i = 0; i < 30; i++) brake.step({ steer: 0, throttle: 0, brake: 1, handbrake: false }, hands('driver'))
    expect(brake.pitch).toBeGreaterThan(0.02)
    const gas = standing('kestrel')
    for (let i = 0; i < 30; i++) gas.step(FLAT_OUT, hands('driver'))
    expect(gas.pitch).toBeLessThan(-0.01)
    const turn = rolling('kestrel', 'asphalt', 18, 3)
    for (let i = 0; i < 60; i++) turn.step({ steer: -0.6, throttle: 0.3, brake: 0, handbrake: false }, hands('driver'))
    // Turning left (ay > 0) leans the body to the outside.
    expect(turn.ay).toBeGreaterThan(2)
    expect(turn.roll).toBeGreaterThan(0.02)
  })

  it('stays finite under 10 000 steps of random inputs on every surface and difficulty', () => {
    const r = rng(7)
    const surfaces = ['asphalt', 'gravel', 'snow', 'ice', 'mud', 'grass', 'water', 'wet']
    for (const id of ['piccola', 'ruska', 'kestrel', 'apex']) {
      for (const d of ['rookie', 'driver', 'pro'] as const) {
        const c = standing(id, surfaces[Math.floor(r() * surfaces.length)])
        let inp: Input = FLAT_OUT
        for (let i = 0; i < 10000; i++) {
          if (i % 20 === 0) inp = { steer: r() * 2 - 1, throttle: r() < 0.6 ? r() : 0, brake: r() < 0.3 ? r() : 0, handbrake: r() < 0.15 }
          c.step(inp, ASSISTS[d])
          const all = c.x + c.z + c.vx + c.vy + c.r + c.rpm + c.pitch + c.roll + c.boost + c.wheelSpin + c.engineLoad + c.throttleOut
          if (!Number.isFinite(all)) throw new Error(`${id} ${d}: not finite at step ${i}`)
          if (c.speed > 80 || c.rpm < c.idle || c.rpm > c.redline * 1.05) throw new Error(`${id} ${d}: ${c.speed.toFixed(1)} m/s at ${c.rpm.toFixed(0)} rpm, step ${i}`)
        }
      }
    }
  })
})

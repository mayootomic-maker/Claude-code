import { describe, expect, it } from 'vitest'
import { CameraShake, type ShakeInput } from './shake'

const base: ShakeInput = { dt: 1 / 60, speed: 25, surface: 'gravel', offRoad: false, airborne: false, vyUp: 0, rpm: 5000, idle: 900, redline: 7600, throttle: 0.8, gear: 3, impact: 0, landed: 0, ax: 0, ay: 0 }
const run = (s: CameraShake, n: number, over: Partial<ShakeInput> = {}) => {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(s.update({ ...base, ...over }, 1).y)
  return out
}

describe('camera shake', () => {
  it('is deterministic and silent when turned off', () => {
    expect(run(new CameraShake(), 120)).toEqual(run(new CameraShake(), 120))
    const s = new CameraShake()
    const o = s.update(base, 0)
    expect([o.x, o.y, o.z, o.pitch, o.yaw, o.roll]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('shakes harder on rough gravel than on tarmac, and is smooth frame to frame', () => {
    const amp = (xs: number[]) => Math.max(...xs.map(Math.abs))
    const rough = run(new CameraShake(), 300, { surface: 'rough' })
    const tarmac = run(new CameraShake(), 300, { surface: 'asphalt' })
    expect(amp(rough)).toBeGreaterThan(amp(tarmac) * 3)
    // No white-noise flicker: consecutive frames stay close relative to the range.
    const jumps = rough.slice(1).map((v, i) => Math.abs(v - rough[i]))
    expect(Math.max(...jumps)).toBeLessThan(amp(rough) * 0.9)
  })

  it('kicks on a landing and the kick dies away', () => {
    const s = new CameraShake()
    run(s, 30, { surface: 'asphalt', speed: 0, throttle: 0 })
    run(s, 20, { airborne: true, vyUp: -6, surface: 'asphalt', speed: 0, throttle: 0 })
    const after = run(s, 240, { surface: 'asphalt', speed: 0, throttle: 0 })
    const peak = Math.max(...after.slice(0, 30).map(Math.abs))
    expect(peak).toBeGreaterThan(0.015)
    expect(Math.max(...after.slice(-30).map(Math.abs))).toBeLessThan(peak * 0.1)
  })
})

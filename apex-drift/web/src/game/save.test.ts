import { describe, expect, it } from 'vitest'
import { defaults, openStore, sanitize, SAVE_KEY } from './save'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

describe('save', () => {
  it('carries a 2.0 save forward: name, credits, cars, liveries and settings survive', () => {
    const legacy = { version: 3, name: 'Tomi', car: 'saetta', livery: 'rosso', xp: 4200, credits: 18000, owned: { cars: ['kestrel', 'piccola', 'saetta'], liveries: ['rosso'] }, admin: true, settings: { steering: 'tilt', codriver: 'de', pacenotes: true, master: 0.5 }, best: { 100: { seconds: 300 } } }
    const s = mem({ 'apexdrift.save.v3': JSON.stringify(legacy) })
    const st = openStore(s)
    expect(st.save.name).toBe('Tomi')
    expect(st.save.credits).toBe(18000)
    expect(st.save.owned.cars).toContain('saetta')
    expect(st.save.settings.steering).toBe('tilt')
    expect(st.save.settings.voiceLang).toBe('de')
    expect(st.save.settings.difficulty).toBe('rookie')
    expect(st.save.best).toEqual({})
    expect(JSON.stringify(st.save)).not.toContain('admin')
  })

  it('never crashes on a corrupt save, and keeps the broken copy', () => {
    const s = mem({ [SAVE_KEY]: '{not json' })
    const st = openStore(s)
    expect(st.recovered).toBe(true)
    expect(st.save).toEqual(defaults())
    expect(s.m.get(SAVE_KEY + '.corrupt')).toBe('{not json')
  })

  it('rejects out-of-range and wrong-typed fields', () => {
    const s = sanitize({ credits: -50, xp: 'lots', settings: { master: 7, difficulty: 'godlike', textSize: 3 }, best: { a: { time: -1 }, b: { time: 30, medal: 'platinum' } } })
    expect(s.credits).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.settings.master).toBe(1)
    expect(s.settings.difficulty).toBe('rookie')
    expect(s.settings.textSize).toBe(1)
    expect(s.best).toEqual({ b: { time: 30, medal: null } })
  })

  it('reports when storage is unavailable instead of pretending to save', () => {
    const st = openStore({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => undefined })
    expect(st.volatile).toBe(true)
    st.write()
    expect(st.volatile).toBe(true)
  })
})

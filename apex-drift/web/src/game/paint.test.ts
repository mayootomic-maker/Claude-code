import { describe, expect, it } from 'vitest'
import { LIVERIES, RALLIES, RIVALS } from '../data'
import { raceGrid } from '../sim/race'
import { defaults, sanitize } from './save'
import { PER_CAR, customFrom, defaultLook, findLivery, playerLivery, rivalLook, sanitizeLook, toLivery } from './paint'
import { CHEATS } from './owner'

const good = (id: string, car = 'kestrel') => ({
  id, car, name: 'Blue Thunder', pattern: 'shards', base: 0x0b3d91, stripe: 0xf4f2ec, accent: 0xd8231c, rim: 0x111214,
  finish: 'metallic', num: '42', font: 'italic', sponsor: 'KOMET', decals: { panel: true, sponsors: false, pinstripe: true, roof: false, bonnet: true }, window: 'Toni',
})

describe('custom liveries in the save', () => {
  it('keeps a valid paint job exactly, and the car it is chosen for', () => {
    const s = sanitize({ customLiveries: [good('uabc')], carLivery: { kestrel: 'uabc' } })
    expect(s.customLiveries).toEqual([good('uabc')])
    expect(s.carLivery).toEqual({ kestrel: 'uabc' })
    const lv = playerLivery(s, 'kestrel')
    expect(lv.id).toBe('uabc')
    expect(lv.pattern).toBe('shards')
    expect(lv.finish).toBe('metallic')
    expect(lv.window).toBe('Toni')
  })

  it('drops entries with bad ids, unknown cars or junk, and repairs bad fields', () => {
    const s = sanitize({
      customLiveries: [
        good('uok'),
        { ...good('NOPE') },
        { ...good('ucar'), car: 'batmobile' },
        'string',
        null,
        { ...good('uok') },
        { ...good('ufix'), pattern: 'zebra', base: -5, stripe: 0x1000000, accent: 1.5, finish: 'velvet', num: '<script>', font: 'comic', sponsor: 'REAL BRAND', decals: { panel: 'yes' }, name: '<b>x</b>'.repeat(10), window: 42 },
      ],
    })
    expect(s.customLiveries.map((c) => c.id)).toEqual(['uok', 'ufix'])
    const f = s.customLiveries[1]
    expect(f.pattern).toBe('swoosh')
    expect(f.base).toBe(0xf4f2ec)
    expect(f.stripe).toBe(0x0b3d91)
    expect(f.accent).toBe(0xd8231c)
    expect(f.finish).toBe('gloss')
    expect(f.num).toBe('SCR')
    expect(f.font).toBe('block')
    expect(f.sponsor).toBe('NORDLICHT')
    expect(f.decals.panel).toBe(true)
    expect(f.name).not.toMatch(/[<>]/)
    expect(f.name.length).toBeLessThanOrEqual(20)
    expect(f.window).toBe('')
  })

  it('keeps at most PER_CAR jobs per car', () => {
    const list = Array.from({ length: PER_CAR + 3 }, (_, i) => good('u' + i))
    expect(sanitize({ customLiveries: list }).customLiveries).toHaveLength(PER_CAR)
  })

  it('forgets a car choice that points at a missing or other car\'s job', () => {
    const s = sanitize({ customLiveries: [good('ua')], carLivery: { kestrel: 'ugone', piccola: 'ua', saetta: 7 } })
    expect(s.carLivery).toEqual({})
    expect(playerLivery(s, 'kestrel').id).toBe(s.livery)
  })

  it('round-trips through JSON', () => {
    const s = defaults()
    s.customLiveries.push(customFrom(LIVERIES[1], 'kestrel', 'uxyz', 'Mine'))
    s.carLivery.kestrel = 'uxyz'
    expect(sanitize(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('finds ghosts\' liveries by id, custom or preset', () => {
    const s = sanitize({ customLiveries: [good('ug')] })
    expect(findLivery(s, 'ug').name).toBe('Blue Thunder')
    expect(findLivery(s, 'fjord').id).toBe('fjord')
    expect(findLivery(s, 'deleted').id).toBe(LIVERIES[0].id)
  })

  it('a livery cheat beats a custom job on the current car', () => {
    const s = sanitize({ customLiveries: [good('uc')], carLivery: { kestrel: 'uc' } })
    CHEATS.find((c) => c.code === 'QUACK')?.run(s, { turbo: false })
    expect(playerLivery(s, 'kestrel').id).toBe('duck')
  })

  it('preset liveries all use known designs and finishes', () => {
    for (const l of LIVERIES) {
      const c = customFrom(l, 'kestrel', 'ut', 'x')
      expect(toLivery(c).pattern).toBe(l.pattern)
      expect(c.finish).toBe(l.finish ?? 'gloss')
    }
  })
})

describe('driver look in the save', () => {
  it('defaults to the original chap and survives a round trip', () => {
    expect(defaults().driver).toEqual(defaultLook())
    const s = defaults()
    s.driver = rivalLook(5)
    expect(sanitize(JSON.parse(JSON.stringify(s))).driver).toEqual(s.driver)
  })

  it('repairs every bad field', () => {
    const l = sanitizeLook({ skin: 'pink', hair: 'beehive', hairColor: 0x123456, moustache: 'pencil', brows: 9, glasses: 'monocle', shirt: 0xffffff, print: 'tartan', helmet: { pattern: 'skulls', base: 0x111111, visor: 'mirror', finish: 'chrome' } })
    const d = defaultLook()
    expect(l.skin).toBe(d.skin)
    expect(l.hair).toBe(d.hair)
    expect(l.hairColor).toBe(0x123456)
    expect(l.moustache).toBe('pencil')
    expect(l.brows).toBe(d.brows)
    expect(l.glasses).toBe('none')
    expect(l.print).toBe(d.print)
    expect(l.helmet.pattern).toBe(d.helmet.pattern)
    expect(l.helmet.base).toBe(0x111111)
    expect(l.helmet.visor).toBe(d.helmet.visor)
    expect(l.helmet.finish).toBe('chrome')
    expect(sanitize({ driver: 'nope' }).driver).toEqual(d)
  })

  it('rival looks are deterministic and always valid', () => {
    for (let i = 0; i < 20; i++) {
      expect(rivalLook(i)).toEqual(rivalLook(i))
      expect(sanitizeLook(rivalLook(i))).toEqual(rivalLook(i))
    }
  })
})

describe('named rivals', () => {
  it('each has a signature livery of their own and a valid signature helmet', () => {
    const seen = new Set<string>()
    for (const r of RIVALS) {
      expect(LIVERIES.some((l) => l.id === r.livery)).toBe(true)
      expect(seen.has(r.livery ?? '')).toBe(false)
      seen.add(r.livery ?? '')
      const look = rivalLook(3, r.helmet)
      expect(look.helmet).toEqual({ ...look.helmet, ...r.helmet })
      expect(sanitizeLook(look)).toEqual(look)
    }
  })

  it('race in their own colours, unless the player wears them', () => {
    const g = raceGrid(RALLIES[0], 0, 'driver', 'kestrel', 'works')
    for (const slot of g) expect(slot.livery).toBe(RIVALS[slot.rival].livery)
    const taken = g[0].livery
    const g2 = raceGrid(RALLIES[0], 0, 'driver', 'kestrel', taken)
    expect(g2.every((x) => x.livery !== taken)).toBe(true)
  })
})

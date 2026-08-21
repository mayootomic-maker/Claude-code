/**
 * Migration and import hardening.
 *
 * `migrate` parses two very different things: what we wrote to IndexedDB, and
 * a user-supplied file that may be hand-edited, truncated, or from a future
 * build. The round-trip through a real browser is covered in e2e/drive.mjs;
 * this covers the shapes that would otherwise crash or silently lose data.
 */

import { describe, expect, it } from 'vitest'
import { migrate, DATA_VERSION, ACTIVE_TRIP_WINDOW_MS, activeTrip, currentTrip, markIntendedTrip } from './store'
import { DEFAULT_SETTINGS } from './types'

const validRoute = {
  id: 'r1',
  label: 'Aarau – Zürich HB',
  origin: { id: '8502113', name: 'Aarau', coord: null },
  destination: { id: '8503000', name: 'Zürich HB', coord: null },
  walkSeconds: 480,
  note: 'Wagen 3',
}

describe('migrate', () => {
  it('returns a usable empty state for junk input', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      const result = migrate(junk)
      expect(result.version).toBe(DATA_VERSION)
      expect(result.routes).toEqual([])
      expect(result.settings).toEqual(DEFAULT_SETTINGS)
      expect(result.log.rides).toEqual([])
    }
  })

  it('round-trips a complete payload', () => {
    const source = {
      version: 1,
      routes: [validRoute],
      settings: { language: 'en', theme: 'dark', delayAlertMinutes: 5 },
      log: {
        rides: [{ id: 'a', ts: 1_700_000_000_000, tripKey: 'k', routeId: 'r1', direction: 'outbound' }],
        inspections: [
          { id: 'b', ts: 1_700_000_000_000, tripKey: 'k', routeId: 'r1', direction: 'outbound', segment: null, note: '' },
        ],
      },
      lastBackupAt: 1_700_000_000_000,
    }

    const result = migrate(JSON.parse(JSON.stringify(source)) as unknown)

    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]?.note).toBe('Wagen 3')
    expect(result.settings.language).toBe('en')
    expect(result.settings.theme).toBe('dark')
    expect(result.log.rides).toHaveLength(1)
    expect(result.log.inspections).toHaveLength(1)
    expect(result.lastBackupAt).toBe(1_700_000_000_000)
  })

  it('drops a malformed route rather than failing the whole import', () => {
    // Losing one bad route beats refusing a file that holds months of log data.
    const result = migrate({
      routes: [validRoute, { id: 'broken' }, null, { ...validRoute, walkSeconds: 'eight' }],
    })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]?.id).toBe('r1')
  })

  it('fills in settings that a older or partial file omits', () => {
    const result = migrate({ routes: [], settings: { language: 'en' } })
    expect(result.settings.language).toBe('en')
    expect(result.settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(result.settings.delayAlertMinutes).toBe(DEFAULT_SETTINGS.delayAlertMinutes)
  })

  it('accepts a file with no log at all, as Phase 1 exports had', () => {
    const result = migrate({ version: 1, routes: [validRoute], settings: DEFAULT_SETTINGS })
    expect(result.routes).toHaveLength(1)
    expect(result.log.rides).toEqual([])
    expect(result.lastBackupAt).toBeNull()
  })

  it('rejects a non-numeric lastBackupAt instead of poisoning the reminder', () => {
    expect(migrate({ lastBackupAt: 'yesterday' }).lastBackupAt).toBeNull()
    expect(migrate({ lastBackupAt: Number.NaN }).lastBackupAt).toBeNull()
  })

  it('keeps the good half of a partially corrupt log', () => {
    const result = migrate({
      log: {
        rides: [
          { id: 'a', ts: 1, tripKey: 'k', routeId: 'r1', direction: 'outbound' },
          { id: 'b', ts: null, tripKey: 'k' },
        ],
        inspections: 'not an array',
      },
    })
    expect(result.log.rides).toHaveLength(1)
    expect(result.log.inspections).toEqual([])
  })
})


describe('currentTrip', () => {
  const departedAt = Date.parse('2026-08-21T07:42:00Z')
  const trip = {
    tripKey: 'r1|outbound|IC1|282',
    routeId: 'r1',
    direction: 'outbound' as const,
    line: 'IC 1',
    destination: 'Zürich HB',
    departedAt,
    segment: ['8502113', '8503000'] as [string, string],
  }

  it('is null before the train has left', () => {
    activeTrip.value = trip
    expect(currentTrip(departedAt - 60_000)).toBeNull()
  })

  it('is the trip while the journey is under way', () => {
    activeTrip.value = trip
    // This is the case that matters: mid-journey the board shows the *next*
    // train, so an inspection must bind to this one instead.
    expect(currentTrip(departedAt + 15 * 60_000)?.tripKey).toBe(trip.tripKey)
  })

  it('expires so yesterday\'s trip never lingers', () => {
    activeTrip.value = trip
    expect(currentTrip(departedAt + ACTIVE_TRIP_WINDOW_MS + 1)).toBeNull()
  })

  it('is null when nothing was ever boarded', () => {
    activeTrip.value = null
    expect(currentTrip(departedAt + 60_000)).toBeNull()
  })
})

describe('migrate — active trip', () => {
  it('survives a round trip', () => {
    const result = migrate({
      activeTrip: {
        tripKey: 'k',
        routeId: 'r1',
        direction: 'inbound',
        line: 'S 29',
        destination: 'Turgi',
        departedAt: 1_700_000_000_000,
        segment: ['a', 'b'],
      },
    })
    expect(result.activeTrip?.tripKey).toBe('k')
    expect(result.activeTrip?.direction).toBe('inbound')
  })

  it('rejects an entry with no usable departure time', () => {
    expect(migrate({ activeTrip: { tripKey: 'k', routeId: 'r' } }).activeTrip).toBeNull()
    expect(migrate({ activeTrip: 'nope' }).activeTrip).toBeNull()
  })
})


describe('markIntendedTrip', () => {
  const departedAt = Date.parse('2026-08-21T07:42:00Z')
  const boarded = {
    tripKey: 'boarded',
    routeId: 'r1',
    direction: 'outbound' as const,
    line: 'S 29',
    destination: 'Turgi',
    departedAt,
    segment: ['a', 'b'] as [string, string],
  }
  const next = { ...boarded, tripKey: 'next', departedAt: departedAt + 30 * 60_000 }

  // Read through peek() so the compiler does not narrow the signal to the
  // value we just assigned and conclude the assertion is unreachable.
  const stored = () => activeTrip.peek()?.tripKey ?? null

  it('does not overwrite a journey already under way', async () => {
    // Opening the app mid-journey is exactly when the boarded trip matters;
    // re-pointing the marker at the next train would lose it.
    activeTrip.value = boarded
    await markIntendedTrip(next, departedAt + 8 * 60_000)
    expect(stored()).toBe('boarded')
  })

  it('tracks the next departure once the journey window has passed', async () => {
    activeTrip.value = boarded
    await markIntendedTrip(next, departedAt + ACTIVE_TRIP_WINDOW_MS + 1)
    expect(stored()).toBe('next')
  })

  it('tracks a departure when nothing is under way', async () => {
    activeTrip.value = null
    await markIntendedTrip(next, departedAt)
    expect(stored()).toBe('next')
  })
})

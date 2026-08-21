import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOG,
  MIN_RIDES_FOR_ESTIMATE,
  knownTripKeys,
  migrateLog,
  predict,
  recordInspection,
  recordRide,
  resolveTripKey,
  tripKey,
  type InspectionLog,
} from './inspections'

const at = (iso: string) => Date.parse(iso)
const DAY = 86_400_000

const key = (scheduled: string) =>
  tripKey({ line: 'IC 1', routeId: 'r1', direction: 'outbound', scheduled: at(scheduled) })

/** Builds a log of `rides` consecutive weekdays, `checked` of them inspected. */
function buildLog(options: {
  rides: number
  checked: number
  tripKeyValue: string
  endingAt: number
  segment?: [string, string]
}): InspectionLog {
  let log: InspectionLog = EMPTY_LOG
  for (let i = 0; i < options.rides; i++) {
    const ts = options.endingAt - i * DAY
    log = recordRide(log, {
      ts,
      tripKey: options.tripKeyValue,
      routeId: 'r1',
      direction: 'outbound',
    })
    if (i < options.checked) {
      log = recordInspection(log, {
        ts,
        tripKey: options.tripKeyValue,
        routeId: 'r1',
        direction: 'outbound',
        segment: options.segment ?? null,
        note: '',
      })
    }
  }
  return log
}

describe('tripKey', () => {
  it('gives a distinct key per exact departure time', () => {
    // Tolerance lives in resolveTripKey, not here. Rounding into buckets would
    // only move the splitting problem to the bucket edges.
    expect(key('2026-08-21T05:42:00Z')).not.toBe(key('2026-08-21T05:45:00Z'))
  })

  it('separates trains that are genuinely different departures', () => {
    expect(key('2026-08-21T05:42:00Z')).not.toBe(key('2026-08-21T06:42:00Z'))
  })

  it('separates the outbound and inbound trip', () => {
    const out = tripKey({ line: 'IC 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T05:42:00Z') })
    const back = tripKey({ line: 'IC 1', routeId: 'r1', direction: 'inbound', scheduled: at('2026-08-21T05:42:00Z') })
    expect(out).not.toBe(back)
  })

  it('is stable across days, which is the whole point', () => {
    expect(key('2026-08-21T05:42:00Z')).toBe(key('2026-09-15T05:42:00Z'))
  })

  it('ignores whitespace and case differences in the line label', () => {
    const a = tripKey({ line: 'IC 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T05:42:00Z') })
    const b = tripKey({ line: 'ic1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T05:42:00Z') })
    expect(a).toBe(b)
  })

  it('keeps a late-night train adjacent to the evening it belongs to', () => {
    // 23:50 and 00:00 are ten minutes apart, not a day.
    const late = tripKey({ line: 'S 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T21:50:00Z') })
    const later = tripKey({ line: 'S 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T22:00:00Z') })
    expect(resolveTripKey([late], later)).toBe(late)
  })
})

describe('resolveTripKey', () => {
  const existing = key('2026-08-21T05:42:00Z')

  it('absorbs a small timetable shift onto the existing history', () => {
    // The December change moves a train by a few minutes; months of logged
    // rides must not be orphaned by it.
    const shifted = key('2026-08-21T05:45:00Z')
    expect(resolveTripKey([existing], shifted)).toBe(existing)
  })

  it('has no bucket edge — a two-minute shift always matches', () => {
    // This is the bug that bucketing hides: 07:44 and 07:46 sit either side of
    // a 10-minute boundary and would otherwise split into separate histories.
    for (const minute of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) {
      const candidate = key(`2026-08-21T05:${String(minute).padStart(2, '0')}:00Z`)
      expect(resolveTripKey([existing], candidate)).toBe(existing)
    }
  })

  it('does not merge genuinely different departures', () => {
    const anHourLater = key('2026-08-21T06:42:00Z')
    expect(resolveTripKey([existing], anHourLater)).toBe(anHourLater)
  })

  it('does not merge across midnight by arithmetic accident', () => {
    const late = tripKey({ line: 'IC 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T21:55:00Z') })
    const earlyNextDay = tripKey({ line: 'IC 1', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T22:05:00Z') })
    // Ten minutes apart in wall-clock terms, so they should merge.
    expect(resolveTripKey([late], earlyNextDay)).toBe(late)
  })

  it('picks the closest of several nearby keys', () => {
    const near = key('2026-08-21T05:45:00Z')
    const nearer = key('2026-08-21T05:43:00Z')
    expect(resolveTripKey([near, nearer], existing)).toBe(nearer)
  })

  it('keeps different lines and directions apart', () => {
    const otherLine = tripKey({ line: 'S 29', routeId: 'r1', direction: 'outbound', scheduled: at('2026-08-21T05:42:00Z') })
    expect(resolveTripKey([existing], otherLine)).toBe(otherLine)
  })

  it('collects every key present in a log', () => {
    const log = buildLog({ rides: 3, checked: 1, tripKeyValue: existing, endingAt: at('2026-08-21T12:00:00Z') })
    expect(knownTripKeys(log)).toEqual(new Set([existing]))
  })
})

describe('predict', () => {
  const now = at('2026-08-21T12:00:00Z')
  const trip = key('2026-08-21T05:42:00Z')

  it('refuses to give a number below the confidence threshold', () => {
    // One check in three rides is not "33%". Inventing that number is exactly
    // the failure this guard exists to prevent.
    const log = buildLog({ rides: 3, checked: 1, tripKeyValue: trip, endingAt: now })
    const result = predict(log, trip, now)

    expect(result.kind).toBe('insufficient')
    if (result.kind !== 'insufficient') throw new Error('unreachable')
    expect(result.rides).toBe(3)
    expect(result.ridesNeeded).toBe(MIN_RIDES_FOR_ESTIMATE)
  })

  it('gives an estimate once there is enough history', () => {
    const log = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now })
    const result = predict(log, trip, now)

    expect(result.kind).toBe('estimate')
    if (result.kind !== 'estimate') throw new Error('unreachable')
    expect(result.rides).toBe(20)
    expect(result.inspections).toBe(5)
    // Recent inspections are weighted up, so the rate exceeds the raw 25%.
    expect(result.probability).toBeGreaterThan(0.2)
    expect(result.oneIn).toBeGreaterThanOrEqual(1)
  })

  it('reports a never-inspected trip as zero, not as insufficient', () => {
    const log = buildLog({ rides: 30, checked: 0, tripKeyValue: trip, endingAt: now })
    const result = predict(log, trip, now)

    if (result.kind !== 'estimate') throw new Error('expected an estimate')
    expect(result.probability).toBe(0)
    expect(result.oneIn).toBe(0)
  })

  it('weights recent inspections above old ones', () => {
    const recent = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now })

    // The same five inspections, but a year in the past.
    const old: InspectionLog = {
      rides: recent.rides,
      inspections: recent.inspections.map((i) => ({ ...i, ts: i.ts - 365 * DAY })),
    }

    const recentResult = predict(recent, trip, now)
    const oldResult = predict(old, trip, now)
    if (recentResult.kind !== 'estimate' || oldResult.kind !== 'estimate') {
      throw new Error('expected estimates')
    }
    expect(recentResult.probability).toBeGreaterThan(oldResult.probability)
  })

  it('never reports a probability above 1, even from a corrupt import', () => {
    const log: InspectionLog = {
      rides: buildLog({ rides: 10, checked: 0, tripKeyValue: trip, endingAt: now }).rides,
      // Hand-edited file with more inspections than rides.
      inspections: Array.from({ length: 50 }, (_, i) => ({
        id: `x${i}`,
        ts: now - i * 60_000,
        tripKey: trip,
        routeId: 'r1',
        direction: 'outbound' as const,
        segment: null,
        note: '',
      })),
    }

    const result = predict(log, trip, now)
    if (result.kind !== 'estimate') throw new Error('expected an estimate')
    expect(result.probability).toBeLessThanOrEqual(1)
  })

  it('reads history through the tolerance, so a shifted timetable still predicts', () => {
    const log = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now })
    // Next December the same train leaves three minutes later.
    const shifted = key('2026-08-21T05:45:00Z')
    expect(predict(log, shifted, now).kind).toBe('estimate')
  })

  it('ignores history from a different trip', () => {
    const other = key('2026-08-21T08:42:00Z')
    const log = buildLog({ rides: 30, checked: 20, tripKeyValue: other, endingAt: now })
    expect(predict(log, trip, now).kind).toBe('insufficient')
  })

  it('names a segment only when checks actually cluster there', () => {
    const clustered = buildLog({
      rides: 20,
      checked: 6,
      tripKeyValue: trip,
      endingAt: now,
      segment: ['8502113', '8502119'],
    })
    const result = predict(clustered, trip, now)
    if (result.kind !== 'estimate') throw new Error('expected an estimate')
    expect(result.hotSegment).toEqual({ from: '8502113', to: '8502119', count: 6 })
  })

  it('does not name a segment on the strength of a single check', () => {
    const once = buildLog({
      rides: 20,
      checked: 1,
      tripKeyValue: trip,
      endingAt: now,
      segment: ['8502113', '8502119'],
    })
    const result = predict(once, trip, now)
    if (result.kind !== 'estimate') throw new Error('expected an estimate')
    expect(result.hotSegment).toBeNull()
  })
})

describe('recordRide', () => {
  const now = at('2026-08-21T12:00:00Z')
  const trip = key('2026-08-21T05:42:00Z')

  it('counts one ride per trip per day, however often the app is opened', () => {
    // Rides log automatically while the app is open; without this the
    // denominator would count polls and drive every probability to zero.
    let log = EMPTY_LOG
    for (let i = 0; i < 20; i++) {
      log = recordRide(log, { ts: now + i * 60_000, tripKey: trip, routeId: 'r1', direction: 'outbound' })
    }
    expect(log.rides).toHaveLength(1)
  })

  it('counts the same trip again on the following day', () => {
    let log = recordRide(EMPTY_LOG, { ts: now, tripKey: trip, routeId: 'r1', direction: 'outbound' })
    log = recordRide(log, { ts: now + DAY, tripKey: trip, routeId: 'r1', direction: 'outbound' })
    expect(log.rides).toHaveLength(2)
  })
})

describe('recordInspection', () => {
  const now = at('2026-08-21T12:00:00Z')
  const trip = key('2026-08-21T05:42:00Z')
  const entry = { tripKey: trip, routeId: 'r1', direction: 'outbound' as const, segment: null, note: '' }

  it('ignores a double-tap on a moving train', () => {
    let log = recordInspection(EMPTY_LOG, { ...entry, ts: now })
    log = recordInspection(log, { ...entry, ts: now + 30_000 })
    expect(log.inspections).toHaveLength(1)
  })

  it('records a genuinely separate check later in the journey', () => {
    let log = recordInspection(EMPTY_LOG, { ...entry, ts: now })
    log = recordInspection(log, { ...entry, ts: now + 20 * 60_000 })
    expect(log.inspections).toHaveLength(2)
  })
})

describe('migrateLog', () => {
  it('returns an empty log for junk input', () => {
    expect(migrateLog(null)).toEqual(EMPTY_LOG)
    expect(migrateLog('nope')).toEqual(EMPTY_LOG)
    expect(migrateLog({})).toEqual(EMPTY_LOG)
  })

  it('drops malformed entries but keeps the good ones', () => {
    const result = migrateLog({
      rides: [
        { id: 'a', ts: 1, tripKey: 'k' },
        { id: 'b', ts: 'not a number', tripKey: 'k' },
        null,
      ],
      inspections: [{ id: 'c', ts: 1, tripKey: 'k', direction: 'outbound' }],
    })

    expect(result.rides).toHaveLength(1)
    expect(result.inspections).toHaveLength(1)
  })
})

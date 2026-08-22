import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOG,
  knownTripKeys,
  migrateLog,
  predict,
  recordInspection,
  recordRide,
  resolveTripKey,
  summarise,
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
  category?: string
}): InspectionLog {
  let log: InspectionLog = EMPTY_LOG
  for (let i = 0; i < options.rides; i++) {
    const ts = options.endingAt - i * DAY
    log = recordRide(log, {
      ts,
      tripKey: options.tripKeyValue,
      routeId: 'r1',
      direction: 'outbound',
      ...(options.category === undefined ? {} : { category: options.category }),
    })
    if (i < options.checked) {
      log = recordInspection(log, {
        ts,
        tripKey: options.tripKeyValue,
        routeId: 'r1',
        direction: 'outbound',
        segment: options.segment ?? null,
        note: '',
        ...(options.category === undefined ? {} : { category: options.category }),
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

describe('predict — pooled model', () => {
  const now = at('2026-08-21T12:00:00Z')
  const trip = key('2026-08-21T05:42:00Z')
  const target = { tripKey: trip, category: 'IR' }

  it('gives a usable answer from the very first ride', () => {
    // The old model refused to say anything below eight rides on that exact
    // train, which meant knowing nothing for weeks. Shrinkage toward a prior
    // means there is always a defensible number.
    const log = buildLog({ rides: 1, checked: 0, tripKeyValue: trip, endingAt: now, category: 'IR' })
    const result = predict(log, target, now, { prior: 0.2 })

    expect(result.probability).toBeGreaterThan(0)
    expect(result.probability).toBeLessThan(1)
    expect(result.basis).toBe('prior')
  })

  it('says the estimate rests on the prior while data is thin', () => {
    const log = buildLog({ rides: 2, checked: 0, tripKeyValue: trip, endingAt: now, category: 'IR' })
    expect(predict(log, target, now, { prior: 0.2 }).basis).toBe('prior')
  })

  it('shifts to the trip once its own history is substantial', () => {
    const log = buildLog({ rides: 30, checked: 8, tripKeyValue: trip, endingAt: now, category: 'IR' })
    expect(predict(log, target, now, { prior: 0.2 }).basis).toBe('trip')
  })

  it('learns about a train never ridden, from others of the same category', () => {
    // This is the whole point of pooling. Heavy inspections on one IR should
    // inform a different IR with no history of its own.
    const other = key('2026-08-21T08:42:00Z')
    const log = buildLog({ rides: 30, checked: 20, tripKeyValue: other, endingAt: now, category: 'IR' })

    const unridden = predict(log, { tripKey: trip, category: 'IR' }, now, { prior: 0.05 })

    // Far above the 0.05 prior, because IR services demonstrably get checked.
    expect(unridden.probability).toBeGreaterThan(0.3)
    expect(unridden.tripRides).toBe(0)
    expect(unridden.basis).toBe('category')
  })

  it('keeps categories apart — S-Bahn history does not colour an IR estimate', () => {
    const sbahn = key('2026-08-21T08:42:00Z')
    const log = buildLog({ rides: 30, checked: 25, tripKeyValue: sbahn, endingAt: now, category: 'S' })

    const forS = predict(log, { tripKey: sbahn, category: 'S' }, now, { prior: 0.05 })
    const forIR = predict(log, { tripKey: trip, category: 'IR' }, now, { prior: 0.05 })

    expect(forS.probability).toBeGreaterThan(forIR.probability)
  })

  it('lets a heavily-checked trip exceed its category', () => {
    let log = buildLog({ rides: 40, checked: 2, tripKeyValue: key('2026-08-21T08:42:00Z'), endingAt: now, category: 'IR' })
    const busy = buildLog({ rides: 40, checked: 30, tripKeyValue: trip, endingAt: now, category: 'IR' })
    log = { rides: [...log.rides, ...busy.rides], inspections: [...log.inspections, ...busy.inspections] }

    const result = predict(log, target, now, { prior: 0.1 })
    expect(result.probability).toBeGreaterThan(0.4)
    expect(result.basis).toBe('trip')
  })

  it('converges on a never-inspected trip toward zero, not to zero outright', () => {
    // Thirty clean rides is strong evidence, but not proof it never happens.
    const log = buildLog({ rides: 30, checked: 0, tripKeyValue: trip, endingAt: now, category: 'IR' })
    const result = predict(log, target, now, { prior: 0.2 })

    expect(result.probability).toBeLessThan(0.05)
    expect(result.probability).toBeGreaterThan(0)
  })

  it('weights recent inspections above old ones', () => {
    const recent = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now, category: 'IR' })
    const old: InspectionLog = {
      rides: recent.rides,
      inspections: recent.inspections.map((i) => ({ ...i, ts: i.ts - 365 * DAY })),
    }

    expect(predict(recent, target, now).probability).toBeGreaterThan(
      predict(old, target, now).probability,
    )
  })

  it('never reports a probability above 1, even from a corrupt import', () => {
    const log: InspectionLog = {
      rides: buildLog({ rides: 10, checked: 0, tripKeyValue: trip, endingAt: now, category: 'IR' }).rides,
      // Hand-edited file with more inspections than rides.
      inspections: Array.from({ length: 50 }, (_, i) => ({
        id: `x${i}`,
        ts: now - i * 60_000,
        tripKey: trip,
        routeId: 'r1',
        direction: 'outbound' as const,
        segment: null,
        note: '',
        category: 'IR',
      })),
    }
    expect(predict(log, target, now).probability).toBeLessThanOrEqual(1)
  })

  it('still works for entries logged before features existed', () => {
    // Older logs carry no category. They must still count globally rather
    // than being silently ignored.
    const log = buildLog({ rides: 20, checked: 10, tripKeyValue: trip, endingAt: now })
    const result = predict(log, { tripKey: trip }, now, { prior: 0.05 })

    expect(result.probability).toBeGreaterThan(0.2)
    expect(result.totalRides).toBe(20)
  })

  it('reads history through the tolerance, so a shifted timetable still predicts', () => {
    const log = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now, category: 'IR' })
    const shifted = key('2026-08-21T05:45:00Z')
    expect(predict(log, { tripKey: shifted, category: 'IR' }, now).tripRides).toBe(20)
  })

  it('names a segment only when checks actually cluster there', () => {
    const clustered = buildLog({
      rides: 20, checked: 6, tripKeyValue: trip, endingAt: now, category: 'IR',
      segment: ['8502113', '8502119'],
    })
    expect(predict(clustered, target, now).hotSegment).toEqual({
      from: '8502113', to: '8502119', count: 6,
    })
  })

  it('does not name a segment on the strength of a single check', () => {
    const once = buildLog({
      rides: 20, checked: 1, tripKeyValue: trip, endingAt: now, category: 'IR',
      segment: ['8502113', '8502119'],
    })
    expect(predict(once, target, now).hotSegment).toBeNull()
  })

  it('respects the seeded prior when there is no data at all', () => {
    const high = predict(EMPTY_LOG, target, now, { prior: 0.5 })
    const low = predict(EMPTY_LOG, target, now, { prior: 0.02 })

    expect(high.probability).toBeGreaterThan(low.probability)
    expect(high.basis).toBe('prior')
    expect(high.oneIn).toBe(2)
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

describe('summarise', () => {
  const now = at('2026-08-21T12:00:00Z') // a Friday
  const trip = key('2026-08-21T05:42:00Z')

  it('reports an empty log without inventing structure', () => {
    const stats = summarise(EMPTY_LOG)
    expect(stats.totalRides).toBe(0)
    expect(stats.totalInspections).toBe(0)
    expect(stats.trips).toBe(0)
    expect(stats.since).toBeNull()
    // Every weekday is present so the chart has a stable shape.
    expect(stats.byWeekday).toHaveLength(7)
    // Hours are only included where there is data, so the chart is not mostly empty.
    expect(stats.byHour).toEqual([])
  })

  it('counts rides and inspections without recency weighting', () => {
    // Prediction discounts old rides because it forecasts. A history view must
    // not, or the chart would disagree with the totals beside it.
    const log = buildLog({ rides: 20, checked: 5, tripKeyValue: trip, endingAt: now, category: 'IR' })
    const stats = summarise(log)

    expect(stats.totalRides).toBe(20)
    expect(stats.totalInspections).toBe(5)
    expect(stats.trips).toBe(1)
  })

  it('groups by service weekday, so a post-midnight ride counts as the evening', () => {
    // 00:30 local on Saturday belongs to Friday's service.
    const lateFriday = at('2026-08-21T22:30:00Z')
    const log = recordRide(EMPTY_LOG, {
      ts: lateFriday,
      tripKey: trip,
      routeId: 'r1',
      direction: 'outbound',
    })

    const friday = summarise(log).byWeekday[5]
    const saturday = summarise(log).byWeekday[6]
    expect(friday?.rides).toBe(1)
    expect(saturday?.rides).toBe(0)
  })

  it('breaks down by hour only where the hour was recorded', () => {
    let log = recordRide(EMPTY_LOG, {
      ts: now, tripKey: trip, routeId: 'r1', direction: 'outbound', hour: 7,
    })
    log = recordRide(log, {
      ts: now + DAY, tripKey: trip, routeId: 'r1', direction: 'outbound', hour: 7,
    })
    // An older entry with no hour still counts toward the totals.
    log = recordRide(log, {
      ts: now + 2 * DAY, tripKey: trip, routeId: 'r1', direction: 'outbound',
    })

    const stats = summarise(log)
    expect(stats.totalRides).toBe(3)
    expect(stats.byHour).toEqual([{ hour: 7, rides: 2, inspections: 0 }])
  })

  it('reports the oldest entry as the start of the record', () => {
    const log = buildLog({ rides: 5, checked: 1, tripKeyValue: trip, endingAt: now })
    expect(summarise(log).since).toBe(now - 4 * DAY)
  })

  it('counts distinct trips, tolerating a shifted timetable', () => {
    let log = buildLog({ rides: 3, checked: 0, tripKeyValue: trip, endingAt: now })
    // The same train three minutes later must not read as a second service.
    log = recordRide(log, {
      ts: now + 10 * DAY,
      tripKey: key('2026-08-21T05:45:00Z'),
      routeId: 'r1',
      direction: 'outbound',
    })
    expect(summarise(log).trips).toBe(1)
  })
})

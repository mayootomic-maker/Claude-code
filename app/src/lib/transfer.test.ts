import { describe, expect, it } from 'vitest'
import {
  assessJourney,
  assessTransfer,
  firstViableJourney,
  minimumTransferSeconds,
  worstTransfer,
} from './transfer'
import { buildTiming } from './time'
import type { Journey, Leg, StopRef } from './types'

const at = (iso: string) => Date.parse(iso)

const stop = (id: string, name: string): StopRef => ({ id, name, coord: null })

function leg(input: {
  fromId?: string
  toId: string
  toName: string
  arrive: string
  arriveDelay?: number | null
  depart: string
  departDelay?: number | null
  departCancelled?: boolean
}): Leg {
  return {
    from: stop(input.fromId ?? '8502113', 'Aarau'),
    to: stop(input.toId, input.toName),
    line: 'IC 1',
    category: 'IC',
    departure: buildTiming({
      scheduled: at(input.depart),
      ...(input.departDelay === undefined ? {} : { reportedDelay: input.departDelay }),
      cancelled: input.departCancelled ?? false,
    }),
    arrival: buildTiming({
      scheduled: at(input.arrive),
      ...(input.arriveDelay === undefined ? {} : { reportedDelay: input.arriveDelay }),
    }),
    departurePlatform: null,
    arrivalPlatform: null,
  }
}

describe('minimumTransferSeconds', () => {
  it('allows longer for a large interchange than a small stop', () => {
    expect(minimumTransferSeconds('8503000')).toBeGreaterThan(minimumTransferSeconds('8502119'))
  })
})

describe('assessTransfer', () => {
  const base = { stopId: '8502119', stopName: 'Lenzburg' }

  it('calls a wide, on-time change comfortable', () => {
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:50:00Z'), reportedDelay: 0 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 0 }),
    })
    expect(risk.verdict).toBe('comfortable')
    expect(risk.availableSeconds).toBe(600)
  })

  it('calls it tight when a delay eats the buffer', () => {
    // 10 minutes published, 7 minutes late: 3 minutes left against a 2 minute
    // minimum. Makeable, but you should be told.
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:50:00Z'), reportedDelay: 7 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 0 }),
    })
    expect(risk.verdict).toBe('tight')
    expect(risk.availableSeconds).toBe(180)
    expect(risk.arrivalDelayMinutes).toBe(7)
  })

  it('calls it broken when the delay consumes the window entirely', () => {
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:50:00Z'), reportedDelay: 12 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 0 }),
    })
    expect(risk.verdict).toBe('broken')
    expect(risk.availableSeconds).toBeLessThan(0)
  })

  it('credits a delay on the onward leg — it waits for you', () => {
    // Arrival 7 late, but the onward train is 6 late too, so the change holds.
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:50:00Z'), reportedDelay: 7 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 6 }),
    })
    expect(risk.verdict).toBe('comfortable')
    expect(risk.availableSeconds).toBe(540)
  })

  it('treats the same gap as tight at a large station', () => {
    // Four minutes is comfortable at a rural stop and not at Zürich HB.
    const timings = {
      arrival: buildTiming({ scheduled: at('2026-08-21T07:56:00Z'), reportedDelay: 0 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 0 }),
    }
    expect(assessTransfer({ ...timings, stopId: '8502119', stopName: 'Lenzburg' }).verdict).toBe('comfortable')
    expect(assessTransfer({ ...timings, stopId: '8503000', stopName: 'Zürich HB' }).verdict).toBe('tight')
  })

  it('reports unknown rather than comfortable when there is no realtime data', () => {
    // Claiming a connection is safe on timetable data that may already be
    // stale is the false reassurance this feature exists to prevent.
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:50:00Z') }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z') }),
    })
    expect(risk.verdict).toBe('unknown')
  })

  it('is broken when the onward leg is cancelled, however wide the gap', () => {
    const risk = assessTransfer({
      ...base,
      arrival: buildTiming({ scheduled: at('2026-08-21T07:00:00Z'), reportedDelay: 0 }),
      departure: buildTiming({ scheduled: at('2026-08-21T08:00:00Z'), reportedDelay: 0, cancelled: true }),
    })
    expect(risk.verdict).toBe('broken')
  })
})

describe('assessJourney', () => {
  it('yields no risks for a direct journey', () => {
    const journey: Journey = {
      key: 'a',
      transfers: 0,
      durationSeconds: 3600,
      legs: [leg({ toId: '8503000', toName: 'Zürich HB', depart: '2026-08-21T07:00:00Z', arrive: '2026-08-21T08:00:00Z' })],
    }
    expect(assessJourney(journey)).toHaveLength(0)
  })

  it('assesses each change in a two-change journey', () => {
    const journey: Journey = {
      key: 'b',
      transfers: 2,
      durationSeconds: 5400,
      legs: [
        leg({ toId: '8502119', toName: 'Lenzburg', depart: '2026-08-21T07:00:00Z', arrive: '2026-08-21T07:20:00Z', arriveDelay: 0 }),
        leg({ toId: '8503000', toName: 'Zürich HB', depart: '2026-08-21T07:30:00Z', departDelay: 0, arrive: '2026-08-21T08:00:00Z', arriveDelay: 9 }),
        leg({ toId: '8506302', toName: 'Winterthur', depart: '2026-08-21T08:05:00Z', departDelay: 0, arrive: '2026-08-21T08:30:00Z' }),
      ],
    }

    const risks = assessJourney(journey)
    expect(risks).toHaveLength(2)
    expect(risks[0]?.stopName).toBe('Lenzburg')
    expect(risks[0]?.verdict).toBe('comfortable')
    // Second change: 5 min published at Zürich HB, arriving 9 late -> missed.
    expect(risks[1]?.stopName).toBe('Zürich HB')
    expect(risks[1]?.verdict).toBe('broken')
  })
})

describe('worstTransfer', () => {
  it('surfaces the broken change, not the comfortable one', () => {
    const risks = [
      { verdict: 'comfortable' as const, stopName: 'A', availableSeconds: 600, requiredSeconds: 120, arrivalDelayMinutes: 0 },
      { verdict: 'broken' as const, stopName: 'B', availableSeconds: -60, requiredSeconds: 120, arrivalDelayMinutes: 12 },
      { verdict: 'tight' as const, stopName: 'C', availableSeconds: 150, requiredSeconds: 120, arrivalDelayMinutes: 5 },
    ]
    expect(worstTransfer(risks)?.stopName).toBe('B')
  })

  it('ranks unknown above comfortable, since it is not reassurance', () => {
    const risks = [
      { verdict: 'comfortable' as const, stopName: 'A', availableSeconds: 600, requiredSeconds: 120, arrivalDelayMinutes: 0 },
      { verdict: 'unknown' as const, stopName: 'B', availableSeconds: 300, requiredSeconds: 120, arrivalDelayMinutes: null },
    ]
    expect(worstTransfer(risks)?.stopName).toBe('B')
  })

  it('returns null for a direct journey', () => {
    expect(worstTransfer([])).toBeNull()
  })
})

describe('firstViableJourney', () => {
  const now = at('2026-08-21T06:00:00Z')

  const broken: Journey = {
    key: 'broken',
    transfers: 1,
    durationSeconds: 3600,
    legs: [
      leg({ toId: '8503000', toName: 'Zürich HB', depart: '2026-08-21T07:00:00Z', departDelay: 0, arrive: '2026-08-21T07:50:00Z', arriveDelay: 12 }),
      leg({ toId: '8506302', toName: 'Winterthur', depart: '2026-08-21T07:55:00Z', departDelay: 0, arrive: '2026-08-21T08:20:00Z' }),
    ],
  }

  const good: Journey = {
    key: 'good',
    transfers: 1,
    durationSeconds: 3600,
    legs: [
      leg({ toId: '8503000', toName: 'Zürich HB', depart: '2026-08-21T07:30:00Z', departDelay: 0, arrive: '2026-08-21T08:20:00Z', arriveDelay: 0 }),
      leg({ toId: '8506302', toName: 'Winterthur', depart: '2026-08-21T08:35:00Z', departDelay: 0, arrive: '2026-08-21T09:00:00Z' }),
    ],
  }

  it('skips a journey whose change is already missed', () => {
    expect(firstViableJourney([broken, good], now)?.key).toBe('good')
  })

  it('skips journeys that have already departed', () => {
    expect(firstViableJourney([good], at('2026-08-21T09:00:00Z'))).toBeNull()
  })

  it('returns null rather than offering a connection we know is missed', () => {
    expect(firstViableJourney([broken], now)).toBeNull()
  })
})

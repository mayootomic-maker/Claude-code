import { describe, expect, it } from 'vitest'
import {
  buildTiming,
  countdown,
  createClock,
  formatClock,
  hasRealtime,
  leaveBy,
  localParts,
  minutesFromSeconds,
  parseApiTime,
  pickDeparture,
  serviceDay,
  serviceDayOfWeek,
} from './time'

/** Helper: a fixed instant, expressed unambiguously in UTC. */
const at = (iso: string): number => Date.parse(iso)

describe('createClock', () => {
  it('corrects a device clock that runs fast', () => {
    // Device believes it is 12:00:30; the server says 12:00:00.
    let device = at('2026-08-21T12:00:30Z')
    const clock = createClock(() => device)

    clock.sync('Fri, 21 Aug 2026 12:00:00 GMT', at('2026-08-21T12:00:30Z'), at('2026-08-21T12:00:30Z'))

    expect(clock.driftMs()).toBe(30_000)
    expect(clock.now()).toBe(at('2026-08-21T12:00:00Z'))

    // The correction persists as the device clock advances.
    device += 60_000
    expect(clock.now()).toBe(at('2026-08-21T12:01:00Z'))
  })

  it('accounts for network flight time using the round-trip midpoint', () => {
    const sent = at('2026-08-21T12:00:00Z')
    const received = sent + 400
    const clock = createClock(() => received)

    clock.sync('Fri, 21 Aug 2026 12:00:00 GMT', sent, received)

    // Server stamped at the midpoint (+200ms), so the device is 200ms ahead.
    expect(clock.driftMs()).toBe(200)
  })

  it('ignores an absurd round trip rather than poisoning the correction', () => {
    const sent = at('2026-08-21T12:00:00Z')
    const received = sent + 120_000 // tab was suspended mid-request
    const clock = createClock(() => received)

    clock.sync('Fri, 21 Aug 2026 12:00:00 GMT', sent, received)

    expect(clock.driftMs()).toBe(0)
  })

  it('ignores a missing or unparseable Date header', () => {
    const clock = createClock(() => at('2026-08-21T12:00:00Z'))
    clock.sync(null, 0, 0)
    clock.sync('not a date', at('2026-08-21T12:00:00Z'), at('2026-08-21T12:00:00Z'))
    expect(clock.driftMs()).toBe(0)
  })
})

describe('parseApiTime', () => {
  it('prefers the unambiguous epoch field', () => {
    expect(parseApiTime('2026-08-21T23:32:00+0200', 1787347920)).toBe(1787347920_000)
  })

  it('handles the basic-format offset the API actually returns', () => {
    // +0200 without a colon — normalised before parsing.
    expect(parseApiTime('2026-08-21T23:32:00+0200')).toBe(at('2026-08-21T21:32:00Z'))
  })

  it('returns null for missing input rather than defaulting to now', () => {
    expect(parseApiTime(null)).toBeNull()
    expect(parseApiTime('')).toBeNull()
    expect(parseApiTime('garbage')).toBeNull()
  })
})

describe('buildTiming', () => {
  const scheduled = at('2026-08-21T07:42:00Z')

  it('treats a missing delay as unknown, not as on-time', () => {
    const timing = buildTiming({ scheduled })
    expect(timing.delayMinutes).toBeNull()
    expect(hasRealtime(timing)).toBe(false)
    // Actual falls back to scheduled so arithmetic still works...
    expect(timing.actual).toBe(scheduled)
    // ...but the UI can tell that it is a guess.
  })

  it('distinguishes a real zero delay from unknown', () => {
    const timing = buildTiming({ scheduled, reportedDelay: 0 })
    expect(timing.delayMinutes).toBe(0)
    expect(hasRealtime(timing)).toBe(true)
  })

  it('derives delay from a prognosis timestamp', () => {
    const timing = buildTiming({ scheduled, prognosis: scheduled + 6 * 60_000 })
    expect(timing.delayMinutes).toBe(6)
    expect(timing.actual).toBe(scheduled + 6 * 60_000)
  })

  it('prefers the prognosis over a reported delay when both exist', () => {
    const timing = buildTiming({
      scheduled,
      prognosis: scheduled + 3 * 60_000,
      reportedDelay: 99,
    })
    expect(timing.delayMinutes).toBe(3)
  })
})

describe('countdown', () => {
  const scheduled = at('2026-08-21T07:42:00Z')
  const walk = 8 * 60 // eight minutes on foot

  it('counts down to when you must leave, not to departure', () => {
    const now = at('2026-08-21T07:22:00Z') // 20 min before departure
    const state = countdown(buildTiming({ scheduled }), walk, now)

    expect(state.kind).toBe('counting')
    if (state.kind !== 'counting') throw new Error('unreachable')
    expect(state.secondsUntilLeave).toBe(12 * 60) // 20 - 8
    expect(state.secondsUntilDeparture).toBe(20 * 60)
  })

  it('pushes leave-by later when the train is delayed', () => {
    const now = at('2026-08-21T07:22:00Z')
    const delayed = buildTiming({ scheduled, reportedDelay: 6 })
    const state = countdown(delayed, walk, now)

    if (state.kind !== 'counting') throw new Error('expected counting')
    expect(state.secondsUntilLeave).toBe(18 * 60) // six extra minutes at home
  })

  it('never renders a negative number — switches to go-now instead', () => {
    const now = at('2026-08-21T07:37:00Z') // 5 min out, needs 8 to walk
    const state = countdown(buildTiming({ scheduled }), walk, now)

    expect(state.kind).toBe('go-now')
    if (state.kind !== 'go-now') throw new Error('unreachable')
    expect(state.secondsUntilDeparture).toBe(5 * 60)
  })

  it('reports departed once the train has actually gone', () => {
    const now = at('2026-08-21T07:42:01Z')
    expect(countdown(buildTiming({ scheduled }), walk, now).kind).toBe('departed')
  })

  it('never counts down a cancelled service', () => {
    const now = at('2026-08-21T07:22:00Z')
    const state = countdown(buildTiming({ scheduled, cancelled: true }), walk, now)
    expect(state.kind).toBe('cancelled')
  })

  it('treats the exact departure instant as departed, not as catchable', () => {
    const state = countdown(buildTiming({ scheduled }), walk, scheduled)
    expect(state.kind).toBe('departed')
  })
})

describe('pickDeparture', () => {
  const mk = (iso: string, opts: { cancelled?: boolean } = {}) => ({
    timing: buildTiming({ scheduled: at(iso), cancelled: opts.cancelled ?? false }),
  })

  it('skips cancelled services entirely', () => {
    const now = at('2026-08-21T07:00:00Z')
    const list = [mk('2026-08-21T07:12:00Z', { cancelled: true }), mk('2026-08-21T07:42:00Z')]

    const picked = pickDeparture(list, now)
    expect(picked?.index).toBe(1)
  })

  it('skips departures already gone', () => {
    const now = at('2026-08-21T07:30:00Z')
    const list = [mk('2026-08-21T07:12:00Z'), mk('2026-08-21T07:42:00Z')]

    expect(pickDeparture(list, now)?.index).toBe(1)
  })

  it('returns null when nothing is catchable, rather than a stale departure', () => {
    const now = at('2026-08-21T09:00:00Z')
    expect(pickDeparture([mk('2026-08-21T07:42:00Z')], now)).toBeNull()
  })
})

describe('Swiss local time across DST', () => {
  it('renders summer time (CEST, UTC+2)', () => {
    expect(formatClock(at('2026-08-21T05:42:00Z'))).toBe('07:42')
  })

  it('renders winter time (CET, UTC+1)', () => {
    expect(formatClock(at('2026-12-21T06:42:00Z'))).toBe('07:42')
  })

  it('handles the spring-forward transition', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST.
    expect(formatClock(at('2026-03-29T00:59:00Z'))).toBe('01:59')
    expect(formatClock(at('2026-03-29T01:00:00Z'))).toBe('03:00')
  })

  it('handles the autumn fall-back transition, where 02:xx happens twice', () => {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET.
    expect(formatClock(at('2026-10-25T00:30:00Z'))).toBe('02:30') // CEST
    expect(formatClock(at('2026-10-25T01:30:00Z'))).toBe('02:30') // CET, same wall clock
  })

  it('reads midnight as 00, never 24', () => {
    expect(localParts(at('2026-08-21T22:00:00Z')).hour).toBe(0)
    expect(formatClock(at('2026-08-21T22:00:00Z'))).toBe('00:00')
  })
})

describe('serviceDay', () => {
  it('keeps a late-night train on the previous service day', () => {
    // 00:30 Zurich on the 22nd is still the 21st's service.
    expect(serviceDay(at('2026-08-21T22:30:00Z'))).toBe('2026-08-21')
  })

  it('starts a new service day at 03:00 local', () => {
    expect(serviceDay(at('2026-08-22T00:59:00Z'))).toBe('2026-08-21') // 02:59 local
    expect(serviceDay(at('2026-08-22T01:00:00Z'))).toBe('2026-08-22') // 03:00 local
  })

  it('rolls back across a month boundary', () => {
    // 00:30 local on 1 September belongs to 31 August.
    expect(serviceDay(at('2026-08-31T22:30:00Z'))).toBe('2026-08-31')
    expect(serviceDay(at('2026-09-01T00:30:00Z'))).toBe('2026-08-31')
  })

  it('rolls back across a year boundary', () => {
    expect(serviceDay(at('2027-01-01T00:30:00Z'))).toBe('2026-12-31')
  })

  it('rolls back correctly on the fall-back night, when the day is 25h long', () => {
    expect(serviceDay(at('2026-10-25T01:30:00Z'))).toBe('2026-10-24')
  })

  it('gives the weekday of the service day, not the calendar day', () => {
    // 2026-08-21 is a Friday; a 00:30 train after it is still "Friday's" service.
    expect(serviceDayOfWeek(at('2026-08-21T22:30:00Z'))).toBe(5)
  })
})

describe('minutesFromSeconds', () => {
  it('rounds down so we never overstate the time you have', () => {
    expect(minutesFromSeconds(89)).toBe(1)
    expect(minutesFromSeconds(119)).toBe(1)
    expect(minutesFromSeconds(120)).toBe(2)
  })

  it('clamps negatives to zero', () => {
    expect(minutesFromSeconds(-30)).toBe(0)
  })
})

describe('leaveBy', () => {
  it('subtracts walking time from the realtime departure', () => {
    const scheduled = at('2026-08-21T07:42:00Z')
    const timing = buildTiming({ scheduled, reportedDelay: 4 })
    expect(leaveBy(timing, 600)).toBe(at('2026-08-21T07:36:00Z'))
  })
})

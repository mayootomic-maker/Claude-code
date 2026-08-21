/**
 * The correctness core.
 *
 * Every number this app shows is derived here. Two rules govern the whole file:
 *
 *  1. Never read `Date.now()` outside `createClock`. A phone clock that is three
 *     minutes fast makes every countdown three minutes wrong, silently, and the
 *     user has no way to notice. All time flows from a clock corrected against
 *     the server.
 *  2. Unknown is not zero. A missing delay means "we have no realtime data",
 *     which is a different thing from "the train is on time", and the UI has to
 *     be able to tell them apart.
 */

const ZURICH = 'Europe/Zurich'

/** Transit convention: times before 03:00 belong to the previous service day. */
const SERVICE_DAY_START_HOUR = 3

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export type Clock = {
  /** Current time in epoch ms, corrected for device clock drift. */
  now: () => number
  /** How far the device clock is from the server, in ms. Positive = device ahead. */
  driftMs: () => number
  /** Feed a server `Date` header to re-derive the correction. */
  sync: (serverDate: string | null, requestSentAt: number, responseAt: number) => void
}

/**
 * A clock that corrects for device drift using the server's `Date` header.
 *
 * The header has one-second resolution and the response spent time in flight,
 * so we account for both: we assume the server stamped the header at the
 * midpoint of the round trip. That leaves sub-second error, which is far below
 * anything this app displays.
 */
export function createClock(readDeviceTime: () => number = Date.now): Clock {
  let drift = 0

  return {
    now: () => readDeviceTime() - drift,
    driftMs: () => drift,
    sync(serverDate, requestSentAt, responseAt) {
      if (serverDate === null) return
      const serverMs = Date.parse(serverDate)
      if (!Number.isFinite(serverMs)) return

      const roundTrip = responseAt - requestSentAt
      // Ignore absurd round trips; a suspended tab can produce minute-long ones
      // that would poison the correction.
      if (roundTrip < 0 || roundTrip > 10_000) return

      const deviceAtServerStamp = requestSentAt + roundTrip / 2
      drift = deviceAtServerStamp - serverMs
    },
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a timestamp from the transport API.
 *
 * The API supplies both an ISO string (`2026-08-21T23:32:00+0200`) and an epoch
 * seconds field. We prefer the epoch value: it is unambiguous and immune to the
 * offset-format quirk below.
 *
 * The ISO strings use the basic-format offset `+0200` rather than `+02:00`.
 * V8 happens to accept it, but that is not guaranteed across engines, so we
 * normalise before parsing rather than relying on it.
 */
export function parseApiTime(iso: string | null, epochSeconds?: number | null): number | null {
  if (typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)) {
    return epochSeconds * 1000
  }
  if (iso === null || iso === '') return null

  const normalised = iso.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3')
  const ms = Date.parse(normalised)
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------------------
// Departure timing
// ---------------------------------------------------------------------------

export type DepartureTiming = {
  /** Timetabled departure, epoch ms. */
  scheduled: number
  /** Realtime-adjusted departure, epoch ms. Equals `scheduled` when unknown. */
  actual: number
  /** Minutes late. `null` means no realtime data — NOT on time. */
  delayMinutes: number | null
  cancelled: boolean
}

export function buildTiming(input: {
  scheduled: number
  /** Realtime prognosis, if the operator published one. */
  prognosis?: number | null
  /** Delay in minutes, if the API reported one directly. */
  reportedDelay?: number | null
  cancelled?: boolean
}): DepartureTiming {
  const cancelled = input.cancelled ?? false

  // Prefer an explicit prognosis timestamp; fall back to a reported delay.
  let actual = input.scheduled
  let delayMinutes: number | null = null

  if (typeof input.prognosis === 'number' && Number.isFinite(input.prognosis)) {
    actual = input.prognosis
    delayMinutes = Math.round((input.prognosis - input.scheduled) / 60_000)
  } else if (typeof input.reportedDelay === 'number' && Number.isFinite(input.reportedDelay)) {
    delayMinutes = input.reportedDelay
    actual = input.scheduled + input.reportedDelay * 60_000
  }

  return { scheduled: input.scheduled, actual, delayMinutes, cancelled }
}

/** Whether we have any realtime signal at all for this departure. */
export function hasRealtime(timing: DepartureTiming): boolean {
  return timing.delayMinutes !== null
}

// ---------------------------------------------------------------------------
// Leave-by — the app's single most important number
// ---------------------------------------------------------------------------

/** The moment you must start walking to catch a departure. */
export function leaveBy(timing: DepartureTiming, walkSeconds: number): number {
  return timing.actual - walkSeconds * 1000
}

export type CountdownState =
  /** Still time to spare — show minutes until you must leave. */
  | { kind: 'counting'; secondsUntilLeave: number; secondsUntilDeparture: number }
  /** Walk time has run out but the train has not left — go immediately. */
  | { kind: 'go-now'; secondsUntilDeparture: number }
  /** The train is gone; the caller should advance to the next one. */
  | { kind: 'departed' }
  /** Cancelled services never produce a countdown. */
  | { kind: 'cancelled' }

/**
 * Never returns a negative number to display.
 *
 * When walk time has elapsed we switch to `go-now` rather than rendering a
 * negative countdown, and once the train has actually left we report `departed`
 * so the caller advances. Those are genuinely different situations — "run and
 * you'll make it" versus "pick a different train" — and collapsing them into a
 * negative number would hide that.
 */
export function countdown(
  timing: DepartureTiming,
  walkSeconds: number,
  now: number,
): CountdownState {
  if (timing.cancelled) return { kind: 'cancelled' }

  const secondsUntilDeparture = Math.round((timing.actual - now) / 1000)
  if (secondsUntilDeparture <= 0) return { kind: 'departed' }

  const secondsUntilLeave = Math.round((leaveBy(timing, walkSeconds) - now) / 1000)
  if (secondsUntilLeave <= 0) return { kind: 'go-now', secondsUntilDeparture }

  return { kind: 'counting', secondsUntilLeave, secondsUntilDeparture }
}

/**
 * Pick the departure the Now screen should lead with.
 *
 * Skips cancelled services and anything already gone. Returns the index so the
 * caller can render the ones after it as the follow-up list.
 */
export function pickDeparture<T extends { timing: DepartureTiming }>(
  departures: readonly T[],
  now: number,
): { departure: T; index: number } | null {
  for (let i = 0; i < departures.length; i++) {
    const candidate = departures[i]
    if (candidate === undefined) continue
    if (candidate.timing.cancelled) continue
    if (candidate.timing.actual - now <= 0) continue
    return { departure: candidate, index: i }
  }
  return null
}

// ---------------------------------------------------------------------------
// Formatting and service days
// ---------------------------------------------------------------------------

const partsFormatter = new Intl.DateTimeFormat('de-CH', {
  timeZone: ZURICH,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number }

/** Wall-clock parts in Europe/Zurich, correct across both DST transitions. */
export function localParts(epochMs: number): LocalParts {
  const parts = partsFormatter.formatToParts(new Date(epochMs))
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    return found === undefined ? 0 : Number.parseInt(found.value, 10)
  }
  // `hour12: false` can render midnight as 24 in some ICU versions.
  const hour = read('hour') % 24
  return { year: read('year'), month: read('month'), day: read('day'), hour, minute: read('minute') }
}

/** `HH:MM` in Swiss local time. */
export function formatClock(epochMs: number): string {
  const { hour, minute } = localParts(epochMs)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * The service day a moment belongs to, as `YYYY-MM-DD`.
 *
 * A 00:30 night train is part of the previous evening's service, not a new day.
 * Getting this wrong makes "today's commute" vanish just after midnight and
 * mis-buckets late-night rides in the inspection log.
 */
export function serviceDay(epochMs: number): string {
  const { year, month, day, hour } = localParts(epochMs)
  if (hour >= SERVICE_DAY_START_HOUR) {
    return `${year}-${pad(month)}-${pad(day)}`
  }
  // Step back a calendar day by going through UTC noon, which avoids any DST
  // edge at the boundary.
  const previous = new Date(Date.UTC(year, month - 1, day, 12) - 86_400_000)
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`
}

/** Day of week for a service day, 0 = Sunday. Used by inspection prediction. */
export function serviceDayOfWeek(epochMs: number): number {
  const iso = serviceDay(epochMs)
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10))
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// Human-readable durations
// ---------------------------------------------------------------------------

/**
 * Rounds toward the pessimistic side: 89 seconds reads as "1 min", not "2 min".
 * Overstating the time you have left is the one error that makes you miss a train.
 */
export function minutesFromSeconds(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60)
}

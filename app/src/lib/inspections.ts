/**
 * Personal inspection intelligence.
 *
 * The purpose is being ready: ticket out before the inspector reaches you.
 *
 * Pendlo's version of this works because thousands of commuters report. With
 * one user there is nobody to report to you, so a crowdsourced feed would
 * render an empty screen forever. Instead this learns from your own rides:
 * you log an inspection with one tap, rides log themselves, and after a few
 * weeks it can tell you how often your specific train gets checked.
 *
 * The honest limitation, which the UI states rather than hides: it knows
 * nothing in week one and becomes useful around week five or six. It is a
 * personal statistic, not a live radar.
 */

import { serviceDay, serviceDayOfWeek } from './time'
import type { Direction } from './types'

export type Inspection = {
  id: string
  ts: number
  tripKey: string
  routeId: string
  /** Where on the line it happened, if known. */
  segment: [fromStopId: string, toStopId: string] | null
  direction: Direction
  note: string
}

export type Ride = {
  id: string
  ts: number
  tripKey: string
  routeId: string
  direction: Direction
}

export type InspectionLog = {
  inspections: Inspection[]
  rides: Ride[]
}

export const EMPTY_LOG: InspectionLog = { inspections: [], rides: [] }

// ---------------------------------------------------------------------------
// Trip identity
// ---------------------------------------------------------------------------

/**
 * How far apart two departures can be and still count as "the same train".
 *
 * The Swiss timetable changes every December, and smaller adjustments land on
 * Mondays and Thursdays. Keying history on an exact departure time would
 * silently orphan months of data at each change — the failure mode being "the
 * app just stopped predicting" with no visible cause.
 */
export const MATCH_TOLERANCE_MINUTES = 10

/**
 * A precise identity for one departure.
 *
 * Note this is *not* rounded into buckets. Bucketing looks like it absorbs
 * timetable drift, but it only moves the problem to the bucket edges: with
 * 10-minute buckets, 07:44 and 07:46 land either side of a boundary and the
 * history splits anyway — the exact failure this is meant to prevent, now
 * harder to spot because it only bites near the edges.
 *
 * Tolerance is applied at lookup instead, by `resolveTripKey`, which compares
 * against keys that actually exist. Excludes the date, because accumulating
 * across days is the entire point; includes direction, because the 07:42 out
 * and the 17:42 back are different trains with different patterns.
 */
export function tripKey(input: {
  line: string
  routeId: string
  direction: Direction
  scheduled: number
}): string {
  const normalisedLine = input.line.replace(/\s+/g, '').toUpperCase()
  return `${input.routeId}|${input.direction}|${normalisedLine}|${minutesIntoServiceDay(input.scheduled)}`
}

type ParsedKey = { prefix: string; minutes: number }

function parseTripKey(key: string): ParsedKey | null {
  const cut = key.lastIndexOf('|')
  if (cut === -1) return null
  const minutes = Number.parseInt(key.slice(cut + 1), 10)
  if (!Number.isFinite(minutes)) return null
  return { prefix: key.slice(0, cut), minutes }
}

/** Circular distance in minutes, so 23:55 and 00:05 are ten minutes apart. */
function minuteDistance(a: number, b: number): number {
  const raw = Math.abs(a - b)
  return Math.min(raw, 1440 - raw)
}

/**
 * Maps a freshly computed key onto an existing one for the same train.
 *
 * Returns the closest known key within tolerance, so a timetable shift of a
 * few minutes keeps accumulating onto the same history instead of starting a
 * new one. Falls back to the candidate when nothing matches, which is how a
 * genuinely new trip gets its first entry.
 */
export function resolveTripKey(knownKeys: Iterable<string>, candidate: string): string {
  const parsedCandidate = parseTripKey(candidate)
  if (parsedCandidate === null) return candidate

  let best: { key: string; distance: number } | null = null

  for (const known of knownKeys) {
    const parsed = parseTripKey(known)
    if (parsed === null || parsed.prefix !== parsedCandidate.prefix) continue

    const distance = minuteDistance(parsed.minutes, parsedCandidate.minutes)
    if (distance > MATCH_TOLERANCE_MINUTES) continue
    if (best === null || distance < best.distance) best = { key: known, distance }
  }

  return best === null ? candidate : best.key
}

/** Every trip key already present in a log. */
export function knownTripKeys(log: InspectionLog): Set<string> {
  const keys = new Set<string>()
  for (const ride of log.rides) keys.add(ride.tripKey)
  for (const inspection of log.inspections) keys.add(inspection.tripKey)
  return keys
}

/**
 * Minutes since the start of the service day.
 *
 * Using the service day rather than the calendar day keeps a 00:30 train
 * adjacent to the 23:50 before it instead of a whole day away.
 */
function minutesIntoServiceDay(epochMs: number): number {
  const day = serviceDay(epochMs)
  const [y, m, d] = day.split('-').map((n) => Number.parseInt(n, 10))
  // Service day starts at 03:00 local; compare in UTC against that anchor.
  const anchor = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 3)
  const minutes = Math.round((epochMs - anchor) / 60_000)
  // Guard against DST shifting the anchor by an hour either way.
  return ((minutes % 1440) + 1440) % 1440
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

/**
 * Rides needed before a rate is shown at all.
 *
 * Below this the estimate swings wildly — one inspection in two rides is not
 * "50%". Showing a number derived from three data points would be inventing
 * confidence the data does not support.
 */
export const MIN_RIDES_FOR_ESTIMATE = 8

/** Recency weighting: inspection patterns drift as rosters and routes change. */
const HALF_LIFE_DAYS = 56

export type Prediction =
  | {
      kind: 'insufficient'
      rides: number
      ridesNeeded: number
    }
  | {
      kind: 'estimate'
      /** Recency-weighted probability, 0..1. */
      probability: number
      /** Plain-language odds, e.g. 4 meaning "about 1 in 4". */
      oneIn: number
      rides: number
      inspections: number
      /** Most frequent segment, when one stands out. */
      hotSegment: { from: string; to: string; count: number } | null
      /** Higher on this weekday than overall, when the sample supports it. */
      weekdayNote: 'higher' | 'lower' | null
    }

function weightFor(ts: number, now: number): number {
  const ageDays = Math.max(0, (now - ts) / 86_400_000)
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
}

/**
 * Estimates the chance of an inspection on a given trip.
 *
 * Weighted: a check last week counts for more than one six months ago. The
 * denominator is weighted the same way, so the result stays a probability
 * rather than drifting as history accumulates.
 */
export function predict(
  log: InspectionLog,
  tripKeyValue: string,
  now: number,
  forWeekday?: number,
): Prediction {
  // Resolve first: a timetable shift must not read as "no history".
  const resolved = resolveTripKey(knownTripKeys(log), tripKeyValue)
  const rides = log.rides.filter((r) => r.tripKey === resolved)
  const inspections = log.inspections.filter((i) => i.tripKey === resolved)

  if (rides.length < MIN_RIDES_FOR_ESTIMATE) {
    return { kind: 'insufficient', rides: rides.length, ridesNeeded: MIN_RIDES_FOR_ESTIMATE }
  }

  const rideWeight = rides.reduce((sum, r) => sum + weightFor(r.ts, now), 0)
  const inspectionWeight = inspections.reduce((sum, i) => sum + weightFor(i.ts, now), 0)

  // Rides always outnumber inspections in reality, but a clamp keeps a corrupt
  // or hand-edited import from producing a probability above 1.
  const probability = rideWeight === 0 ? 0 : Math.min(1, inspectionWeight / rideWeight)

  return {
    kind: 'estimate',
    probability,
    oneIn: probability <= 0 ? 0 : Math.max(1, Math.round(1 / probability)),
    rides: rides.length,
    inspections: inspections.length,
    hotSegment: findHotSegment(inspections),
    weekdayNote: weekdayNote(rides, inspections, probability, forWeekday),
  }
}

/**
 * The segment where checks cluster, if one clearly dominates.
 *
 * Requires both a plurality and at least two occurrences: naming a stretch of
 * line on the strength of a single check would be noise dressed as insight.
 */
function findHotSegment(inspections: readonly Inspection[]): { from: string; to: string; count: number } | null {
  const counts = new Map<string, { from: string; to: string; count: number }>()

  for (const inspection of inspections) {
    if (inspection.segment === null) continue
    const [from, to] = inspection.segment
    const key = `${from}>${to}`
    const existing = counts.get(key)
    if (existing === undefined) counts.set(key, { from, to, count: 1 })
    else existing.count++
  }

  let best: { from: string; to: string; count: number } | null = null
  for (const entry of counts.values()) {
    if (best === null || entry.count > best.count) best = entry
  }

  return best !== null && best.count >= 2 ? best : null
}

/** Minimum rides on a given weekday before we say anything about that weekday. */
const MIN_RIDES_FOR_WEEKDAY = 5

function weekdayNote(
  rides: readonly Ride[],
  inspections: readonly Inspection[],
  overall: number,
  forWeekday?: number,
): 'higher' | 'lower' | null {
  if (forWeekday === undefined) return null

  const dayRides = rides.filter((r) => serviceDayOfWeek(r.ts) === forWeekday)
  if (dayRides.length < MIN_RIDES_FOR_WEEKDAY) return null

  const dayInspections = inspections.filter((i) => serviceDayOfWeek(i.ts) === forWeekday)
  const dayRate = dayInspections.length / dayRides.length

  // Only remark on a clear difference; small wobbles are not signal.
  if (dayRate >= overall * 1.5 && dayRate - overall >= 0.1) return 'higher'
  if (dayRate <= overall * 0.5 && overall - dayRate >= 0.1) return 'lower'
  return null
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Records a ride at most once per trip per service day.
 *
 * Rides are logged automatically whenever the app is open during a trip
 * window, so without this the denominator would count every poll and drive
 * every probability toward zero.
 */
export function recordRide(log: InspectionLog, ride: Omit<Ride, 'id'>): InspectionLog {
  const tripKeyValue = resolveTripKey(knownTripKeys(log), ride.tripKey)
  const day = serviceDay(ride.ts)
  const already = log.rides.some(
    (r) => r.tripKey === tripKeyValue && serviceDay(r.ts) === day,
  )
  if (already) return log

  return { ...log, rides: [...log.rides, { ...ride, tripKey: tripKeyValue, id: newId() }] }
}

/**
 * Records an inspection, ignoring an accidental double-tap.
 *
 * Two taps a minute apart on the same trip are one inspection, not two; the
 * button is large and gets pressed on a moving train.
 */
const DOUBLE_TAP_WINDOW_MS = 5 * 60_000

export function recordInspection(
  log: InspectionLog,
  inspection: Omit<Inspection, 'id'>,
): InspectionLog {
  const tripKeyValue = resolveTripKey(knownTripKeys(log), inspection.tripKey)
  const duplicate = log.inspections.some(
    (i) => i.tripKey === tripKeyValue && Math.abs(i.ts - inspection.ts) < DOUBLE_TAP_WINDOW_MS,
  )
  if (duplicate) return log

  return {
    ...log,
    inspections: [...log.inspections, { ...inspection, tripKey: tripKeyValue, id: newId() }],
  }
}

function newId(): string {
  // randomUUID is unavailable on insecure origins; the fallback only needs to
  // be unique within one device's log.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Normalises a stored or imported log, dropping anything malformed. */
export function migrateLog(raw: unknown): InspectionLog {
  if (typeof raw !== 'object' || raw === null) return EMPTY_LOG
  const record = raw as Partial<InspectionLog>

  const rides = Array.isArray(record.rides) ? record.rides : []
  const inspections = Array.isArray(record.inspections) ? record.inspections : []

  const validRide = (r: unknown): r is Ride =>
    typeof r === 'object' &&
    r !== null &&
    typeof (r as Ride).id === 'string' &&
    typeof (r as Ride).ts === 'number' &&
    Number.isFinite((r as Ride).ts) &&
    typeof (r as Ride).tripKey === 'string'

  const validInspection = (i: unknown): i is Inspection =>
    validRide(i as unknown) && typeof (i as Inspection).direction === 'string'

  return {
    rides: rides.filter(validRide),
    inspections: inspections.filter(validInspection),
  }
}

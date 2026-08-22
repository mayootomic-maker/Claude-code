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

/**
 * What a ride was like, beyond which train it was.
 *
 * These are what let the model pool across trips: an inspection on the 07:42
 * IR says something about IR services generally, not only about that one
 * departure. All of it comes free from the departure already on screen — the
 * user is never asked for it.
 *
 * Every field is optional because entries logged before this existed have none
 * of it, and an import may be older still. Missing features simply do not
 * contribute to their level.
 */
export type RideFeatures = {
  /** Product category: IR, IC, S, RE. From OJP or opendata.ch. */
  category?: string
  /** Local hour of departure, 0-23. */
  hour?: number
}

export type Inspection = {
  id: string
  ts: number
  tripKey: string
  routeId: string
  /** Where on the line it happened, if known. */
  segment: [fromStopId: string, toStopId: string] | null
  direction: Direction
  note: string
} & RideFeatures

export type Ride = {
  id: string
  ts: number
  tripKey: string
  routeId: string
  direction: Direction
} & RideFeatures

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

/** Recency weighting: inspection patterns drift as rosters and routes change. */
const HALF_LIFE_DAYS = 56

/**
 * How strongly each level pulls its child toward it.
 *
 * Read as "worth this many observations". At 6, a trip with 6 logged rides is
 * weighted half its own data and half the category it belongs to; by 30 rides
 * its own history dominates. Low enough that real per-trip differences surface,
 * high enough that three rides cannot produce a wild number.
 */
const SHRINKAGE = 6

/**
 * How much the seeded prior counts for.
 *
 * Deliberately weak — about four rides' worth. It exists to give a sane answer
 * in week one, not to survive contact with real data.
 */
const PRIOR_STRENGTH = 4

/** What an estimate mostly rests on, so the UI can be honest about it. */
export type Basis = 'prior' | 'category' | 'trip'

export type Prediction = {
  /** Recency-weighted probability, 0..1. */
  probability: number
  /** Plain-language odds: 4 means "about 1 in 4". Zero when probability is 0. */
  oneIn: number
  /** What the number mainly comes from. */
  basis: Basis
  /** Logged rides on this exact trip. */
  tripRides: number
  /** Logged inspections on this exact trip. */
  tripInspections: number
  /** Logged rides on this category of service. */
  categoryRides: number
  /** Every ride logged, across all trips. */
  totalRides: number
  /** Most frequent segment, when one stands out. */
  hotSegment: { from: string; to: string; count: number } | null
  /** Higher on this weekday than overall, when the sample supports it. */
  weekdayNote: 'higher' | 'lower' | null
}

function weightFor(ts: number, now: number): number {
  const ageDays = Math.max(0, (now - ts) / 86_400_000)
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
}

type Tally = { rides: number; inspections: number; rideCount: number; inspectionCount: number }

function tally(
  log: InspectionLog,
  now: number,
  matches: (entry: { tripKey: string; category?: string }) => boolean,
): Tally {
  let rides = 0
  let inspections = 0
  let rideCount = 0
  let inspectionCount = 0

  for (const ride of log.rides) {
    if (!matches(ride)) continue
    rides += weightFor(ride.ts, now)
    rideCount++
  }
  for (const inspection of log.inspections) {
    if (!matches(inspection)) continue
    inspections += weightFor(inspection.ts, now)
    inspectionCount++
  }
  return { rides, inspections, rideCount, inspectionCount }
}

/**
 * Shrinks an observed rate toward a parent rate.
 *
 * Standard empirical-Bayes: treat the parent as `strength` pseudo-observations
 * already seen. With no data of its own the result *is* the parent; as real
 * observations accumulate they take over. This is what makes an estimate
 * available from the first ride without it being nonsense.
 */
function shrink(observed: Tally, parent: number, strength: number): number {
  return (observed.inspections + parent * strength) / (observed.rides + strength)
}

/**
 * Estimates the chance of an inspection.
 *
 * Pools across three levels — everything you have logged, then this category of
 * service, then this specific train — each shrunk toward the one above it.
 *
 * The point is that every ride teaches the model something about every trip.
 * Counting only exact-trip matches meant needing eight rides on the 07:42
 * before saying anything, and knowing nothing at all about a train you had
 * never taken. Here, an inspection on any IR informs every IR.
 */
export function predict(
  log: InspectionLog,
  target: { tripKey: string; category?: string },
  now: number,
  options: { prior?: number; forWeekday?: number } = {},
): Prediction {
  // Resolve first: a timetable shift must not read as "no history".
  const resolvedKey = resolveTripKey(knownTripKeys(log), target.tripKey)

  const global = tally(log, now, () => true)
  const category =
    target.category === undefined
      ? { rides: 0, inspections: 0, rideCount: 0, inspectionCount: 0 }
      : tally(log, now, (e) => e.category === target.category)
  const trip = tally(log, now, (e) => e.tripKey === resolvedKey)

  // A prior the user gave us, or an uninformative default. Never presented as
  // fact — `basis` tells the UI when this is doing the work.
  const prior = clampProbability(options.prior ?? 0.1)

  const globalRate = shrink(global, prior, PRIOR_STRENGTH)
  const categoryRate = shrink(category, globalRate, SHRINKAGE)
  const tripRate = shrink(trip, categoryRate, SHRINKAGE)

  const probability = clampProbability(tripRate)

  return {
    probability,
    oneIn: probability <= 0 ? 0 : Math.max(1, Math.round(1 / probability)),
    basis: basisFor(trip, category, global),
    tripRides: trip.rideCount,
    tripInspections: trip.inspectionCount,
    categoryRides: category.rideCount,
    totalRides: global.rideCount,
    hotSegment: findHotSegment(log.inspections.filter((i) => i.tripKey === resolvedKey)),
    weekdayNote: weekdayNote(log, globalRate, options.forWeekday),
  }
}

/**
 * Rides on this exact trip before its own history outweighs the category it
 * was shrunk toward.
 */
const TRIP_DOMINATES_AT = SHRINKAGE

function basisFor(trip: Tally, category: Tally, global: Tally): Basis {
  if (trip.rideCount >= TRIP_DOMINATES_AT) return 'trip'
  if (category.rideCount >= TRIP_DOMINATES_AT || global.rideCount >= TRIP_DOMINATES_AT) {
    return 'category'
  }
  return 'prior'
}

/** Guards against a corrupt or hand-edited import producing an impossible rate. */
function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * The segment where checks cluster, if one clearly dominates.
 *
 * Requires at least two occurrences: naming a stretch of line on the strength
 * of a single check would be noise dressed as insight.
 */
function findHotSegment(
  inspections: readonly Inspection[],
): { from: string; to: string; count: number } | null {
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
  log: InspectionLog,
  overall: number,
  forWeekday?: number,
): 'higher' | 'lower' | null {
  if (forWeekday === undefined) return null

  const dayRides = log.rides.filter((r) => serviceDayOfWeek(r.ts) === forWeekday)
  if (dayRides.length < MIN_RIDES_FOR_WEEKDAY) return null

  const dayInspections = log.inspections.filter((i) => serviceDayOfWeek(i.ts) === forWeekday)
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

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export type WeekdayStat = { weekday: number; rides: number; inspections: number }
export type HourStat = { hour: number; rides: number; inspections: number }

export type LogStats = {
  totalRides: number
  totalInspections: number
  /** Sunday-first, matching Date.getUTCDay, so the UI can label them directly. */
  byWeekday: WeekdayStat[]
  /** Only hours with at least one ride, so the chart is not mostly empty. */
  byHour: HourStat[]
  /** Distinct trips with any history. */
  trips: number
  /** Oldest entry, epoch ms, or null for an empty log. */
  since: number | null
}

/**
 * Aggregates the log for display.
 *
 * Raw counts, deliberately unweighted: the prediction applies recency decay
 * because it is forecasting, but a history view showing "you have ridden this
 * 34 times" must not quietly discount older rides — that would be a chart that
 * disagrees with itself.
 */
export function summarise(log: InspectionLog): LogStats {
  const byWeekday: WeekdayStat[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    rides: 0,
    inspections: 0,
  }))
  const hourMap = new Map<number, HourStat>()

  let since: number | null = null

  for (const ride of log.rides) {
    const day = byWeekday[serviceDayOfWeek(ride.ts)]
    if (day !== undefined) day.rides++

    if (ride.hour !== undefined) {
      const entry = hourMap.get(ride.hour) ?? { hour: ride.hour, rides: 0, inspections: 0 }
      entry.rides++
      hourMap.set(ride.hour, entry)
    }
    if (since === null || ride.ts < since) since = ride.ts
  }

  for (const inspection of log.inspections) {
    const day = byWeekday[serviceDayOfWeek(inspection.ts)]
    if (day !== undefined) day.inspections++

    if (inspection.hour !== undefined) {
      const entry = hourMap.get(inspection.hour) ?? { hour: inspection.hour, rides: 0, inspections: 0 }
      entry.inspections++
      hourMap.set(inspection.hour, entry)
    }
    if (since === null || inspection.ts < since) since = inspection.ts
  }

  return {
    totalRides: log.rides.length,
    totalInspections: log.inspections.length,
    byWeekday,
    byHour: [...hourMap.values()].sort((a, b) => a.hour - b.hour),
    trips: knownTripKeys(log).size,
    since,
  }
}

/**
 * Adapter for transport.opendata.ch.
 *
 * Free, no key, CORS-enabled — which is why it is the primary source. Two
 * things about it drive this file:
 *
 *  - Responses carry a full `passList` for every departure, which makes an
 *    untrimmed stationboard ~35 KB. The `fields[]` parameter cuts that to
 *    ~1.7 KB for the same six departures, a 95% saving on every poll. We always
 *    trim.
 *  - It is volunteer-run, rate-limited to 3 req/s, and has no SLA. Failures are
 *    expected, not exceptional; the caller handles them via the failover policy.
 */

import type { Departure, DepartureBoard, Journey, JourneyPlan, Leg, StopRef } from '../types'
import { buildTiming, parseApiTime } from '../time'
import {
  ParseError,
  asArray,
  asRecord,
  asString,
  dig,
  mapValid,
  optNumber,
  optString,
} from '../parse'

/**
 * Overridable so the e2e harness can point at a local fixture server, and so
 * Phase 3 can route through the Worker without touching this adapter.
 */
const BASE = import.meta.env.VITE_TRANSPORT_BASE ?? 'https://transport.opendata.ch/v1'

/** Only the fields we render. Everything else — notably passList — is dropped. */
const STATIONBOARD_FIELDS = [
  'station/id',
  'station/name',
  'stationboard/stop/departure',
  'stationboard/stop/departureTimestamp',
  'stationboard/stop/delay',
  'stationboard/stop/platform',
  'stationboard/stop/prognosis/departure',
  'stationboard/category',
  'stationboard/number',
  'stationboard/to',
]

const CONNECTION_FIELDS = [
  'connections/from/station/id',
  'connections/from/station/name',
  'connections/from/departure',
  'connections/from/departureTimestamp',
  'connections/from/delay',
  'connections/from/platform',
  'connections/from/prognosis/departure',
  'connections/to/station/id',
  'connections/to/station/name',
  'connections/to/arrival',
  'connections/to/arrivalTimestamp',
  'connections/to/delay',
  'connections/to/platform',
  'connections/to/prognosis/arrival',
  'connections/duration',
  'connections/transfers',
  'connections/sections',
]

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type OpendataDeps = {
  fetch: FetchLike
  /** Called with the server `Date` header so the clock can correct drift. */
  onResponseMeta?: (meta: { serverDate: string | null; sentAt: number; receivedAt: number }) => void
  now: () => number
}

function buildUrl(path: string, params: Record<string, string | number | undefined>, fields: string[]): string {
  const url = new URL(`${BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  for (const field of fields) url.searchParams.append('fields[]', field)
  return url.toString()
}

async function getJson(deps: OpendataDeps, url: string, signal?: AbortSignal): Promise<unknown> {
  const sentAt = deps.now()
  const response = await deps.fetch(url, {
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  })
  const receivedAt = deps.now()

  deps.onResponseMeta?.({
    serverDate: response.headers.get('date'),
    sentAt,
    receivedAt,
  })

  if (!response.ok) {
    throw new ParseError(`upstream returned HTTP ${response.status}`, url)
  }

  // A rate-limited or erroring opendata.ch sometimes serves HTML, which would
  // otherwise blow up as a confusing JSON syntax error.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new ParseError(`expected JSON, got "${contentType}"`, url)
  }

  return (await response.json()) as unknown
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseStop(value: unknown, path: string): StopRef {
  const record = asRecord(value, path)
  const lat = optNumber(dig(record, 'coordinate', 'x'))
  const lon = optNumber(dig(record, 'coordinate', 'y'))
  return {
    // Address results from the /locations endpoint have a null id and are not
    // boardable, so they are rejected here rather than rendered as stops.
    id: asString(record['id'], `${path}.id`),
    name: asString(record['name'], `${path}.name`),
    coord: lat !== null && lon !== null ? { lat, lon } : null,
  }
}

/**
 * Builds timing from the three time signals opendata.ch exposes.
 *
 * `prognosis.departure` and `delay` can disagree — I observed a departure with
 * `delay: 0` and a prognosis 34 seconds later. The prognosis is the operator's
 * own forecast, so it wins; `delay` is the fallback.
 */
function parseTiming(
  stop: Record<string, unknown>,
  path: string,
  kind: 'departure' | 'arrival',
  cancelled = false,
) {
  const scheduled = parseApiTime(
    optString(stop[kind]),
    optNumber(stop[`${kind}Timestamp`]),
  )
  if (scheduled === null) throw new ParseError(`missing ${kind} time`, path)

  return buildTiming({
    scheduled,
    prognosis: parseApiTime(optString(dig(stop, 'prognosis', kind))),
    reportedDelay: optNumber(stop['delay']),
    cancelled,
  })
}

function parseDeparture(value: unknown, path: string): Departure {
  const record = asRecord(value, path)
  const stop = asRecord(record['stop'], `${path}.stop`)

  const category = optString(record['category']) ?? ''
  const number = optString(record['number']) ?? ''

  // opendata.ch does not publish cancellations today, but OJP does and the
  // Worker will pass one through under this name. Reading it here means the
  // cancelled path is live rather than waiting on Phase 3.
  const cancelled = record['cancelled'] === true

  const timing = parseTiming(stop, path, 'departure', cancelled)

  return {
    key: `${category}${number}@${timing.scheduled}`,
    line: `${category} ${number}`.trim(),
    category,
    destination: optString(record['to']) ?? '',
    platform: optString(stop['platform']),
    timing,
    // opendata.ch supplies neither; empty means "this source cannot say".
    occupancy: [],
    attributes: [],
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchDepartureBoard(
  deps: OpendataDeps,
  args: { stopId: string; limit?: number; signal?: AbortSignal },
): Promise<DepartureBoard & { dropped: number }> {
  const url = buildUrl(
    '/stationboard',
    { id: args.stopId, limit: args.limit ?? 8, type: 'departure' },
    STATIONBOARD_FIELDS,
  )
  const body = asRecord(await getJson(deps, url, args.signal), 'response')

  const stationRecord = asRecord(body['station'], 'station')
  const stop: StopRef = {
    id: optString(stationRecord['id']) ?? args.stopId,
    name: asString(stationRecord['name'], 'station.name'),
    coord: null,
  }

  const { items, dropped } = mapValid(
    asArray(body['stationboard'], 'stationboard'),
    'stationboard',
    parseDeparture,
  )

  return { stop, departures: items, situations: [], source: 'opendata', fetchedAt: deps.now(), dropped }
}

export async function searchStops(
  deps: OpendataDeps,
  args: { query: string; signal?: AbortSignal },
): Promise<StopRef[]> {
  const url = buildUrl('/locations', { query: args.query, type: 'station' }, [])
  const body = asRecord(await getJson(deps, url, args.signal), 'response')
  const { items } = mapValid(asArray(body['stations'], 'stations'), 'stations', parseStop)
  return items
}

export async function stopsNear(
  deps: OpendataDeps,
  args: { lat: number; lon: number; signal?: AbortSignal },
): Promise<StopRef[]> {
  // The API names these x/y, but x is latitude and y is longitude.
  const url = buildUrl('/locations', { x: args.lat, y: args.lon }, [])
  const body = asRecord(await getJson(deps, url, args.signal), 'response')
  const { items } = mapValid(asArray(body['stations'], 'stations'), 'stations', parseStop)
  return items
}

function parseLeg(value: unknown, path: string): Leg {
  const record = asRecord(value, path)
  const journeyInfo = dig(record, 'journey')
  const departureStop = asRecord(record['departure'], `${path}.departure`)
  const arrivalStop = asRecord(record['arrival'], `${path}.arrival`)

  const category = optString(dig(journeyInfo, 'category')) ?? ''
  const number = optString(dig(journeyInfo, 'number')) ?? ''

  return {
    from: parseStop(departureStop['station'], `${path}.departure.station`),
    to: parseStop(arrivalStop['station'], `${path}.arrival.station`),
    line: `${category} ${number}`.trim(),
    category,
    departure: parseTiming(departureStop, `${path}.departure`, 'departure'),
    arrival: parseTiming(arrivalStop, `${path}.arrival`, 'arrival'),
    departurePlatform: optString(departureStop['platform']),
    arrivalPlatform: optString(arrivalStop['platform']),
  }
}

function parseJourney(value: unknown, path: string): Journey {
  const record = asRecord(value, path)
  const from = asRecord(record['from'], `${path}.from`)
  const to = asRecord(record['to'], `${path}.to`)

  const departure = parseTiming(from, `${path}.from`, 'departure')
  const arrival = parseTiming(to, `${path}.to`, 'arrival')

  // Walking-only sections have no journey and are not boardable legs.
  const sections = Array.isArray(record['sections']) ? record['sections'] : []
  const { items: legs } = mapValid(sections, `${path}.sections`, parseLeg)

  return {
    key: `${departure.scheduled}-${arrival.scheduled}`,
    legs,
    durationSeconds: Math.round((arrival.actual - departure.actual) / 1000),
    transfers: optNumber(record['transfers']) ?? Math.max(0, legs.length - 1),
  }
}

export async function fetchJourneys(
  deps: OpendataDeps,
  args: { fromId: string; toId: string; limit?: number; signal?: AbortSignal },
): Promise<JourneyPlan & { dropped: number }> {
  const url = buildUrl(
    '/connections',
    { from: args.fromId, to: args.toId, limit: args.limit ?? 4 },
    CONNECTION_FIELDS,
  )
  const body = asRecord(await getJson(deps, url, args.signal), 'response')

  const { items, dropped } = mapValid(
    asArray(body['connections'], 'connections'),
    'connections',
    parseJourney,
  )

  const first = items[0]
  const from: StopRef = first?.legs[0]?.from ?? { id: args.fromId, name: '', coord: null }
  const lastLeg = first?.legs[first.legs.length - 1]
  const to: StopRef = lastLeg?.to ?? { id: args.toId, name: '', coord: null }

  return { from, to, journeys: items, source: 'opendata', fetchedAt: deps.now(), dropped }
}

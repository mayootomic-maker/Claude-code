/**
 * The Worker as a departure source.
 *
 * Preferred when configured, because it is the only path to occupancy and
 * disruptions — OJP supplies both and the keyless API supplies neither. It is
 * optional: with no Worker URL set the app falls back to calling
 * transport.opendata.ch directly and simply shows less.
 *
 * The device token is sent as a header. It is not a login — it exists so that
 * anyone who finds the Worker's URL cannot burn the 20 000/day OJP quota.
 */

import { buildTiming } from '../time'
import type { Departure, DepartureBoard, Occupancy, Situation, StopRef } from '../types'
import { ParseError, asArray, asRecord, asString, mapValid, optNumber, optString } from '../parse'

export type WorkerConfig = {
  /** Base URL, no trailing slash. */
  baseUrl: string
  token: string
}

export type WorkerDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => number
  onResponseMeta?: (meta: { serverDate: string | null; sentAt: number; receivedAt: number }) => void
}

export async function fetchDepartureBoard(
  deps: WorkerDeps,
  config: WorkerConfig,
  args: { stopId: string; limit?: number; signal?: AbortSignal },
): Promise<DepartureBoard & { dropped: number }> {
  const url = new URL(`${config.baseUrl.replace(/\/$/, '')}/departures`)
  url.searchParams.set('stopId', args.stopId)
  url.searchParams.set('limit', String(args.limit ?? 8))

  const sentAt = deps.now()
  const response = await deps.fetch(url.toString(), {
    headers: { accept: 'application/json', 'x-pendlo-token': config.token },
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  })
  const receivedAt = deps.now()

  deps.onResponseMeta?.({ serverDate: response.headers.get('date'), sentAt, receivedAt })

  if (response.status === 401) {
    // A wrong token is a configuration problem, not a transient outage, and
    // retrying against the fallback is exactly the right response.
    throw new ParseError('worker rejected the device token', url.pathname)
  }
  if (!response.ok) {
    throw new ParseError(`worker returned HTTP ${response.status}`, url.pathname)
  }

  const body = asRecord(await response.json(), 'response')
  const stopRecord = asRecord(body['stop'], 'stop')

  const stop: StopRef = {
    id: optString(stopRecord['id']) ?? args.stopId,
    name: optString(stopRecord['name']) ?? '',
    coord: null,
  }

  const { items, dropped } = mapValid(
    asArray(body['departures'], 'departures'),
    'departures',
    parseDeparture,
  )

  const situations = Array.isArray(body['situations'])
    ? mapValid(body['situations'], 'situations', parseSituation).items
    : []

  return {
    stop,
    departures: items,
    situations,
    // The Worker reports which upstream actually answered, so the app can say
    // when it is showing fallback data without occupancy.
    source: optString(body['source']) === 'ojp' ? 'ojp' : 'opendata',
    fetchedAt: optNumber(body['fetchedAt']) ?? deps.now(),
    dropped,
  }
}

function parseDeparture(value: unknown, path: string): Departure {
  const record = asRecord(value, path)

  const scheduled = Date.parse(asString(record['scheduled'], `${path}.scheduled`))
  if (!Number.isFinite(scheduled)) throw new ParseError('unparseable scheduled time', path)

  const estimatedRaw = optString(record['estimated'])
  const estimated = estimatedRaw === null ? null : Date.parse(estimatedRaw)

  return {
    key: asString(record['key'], `${path}.key`),
    line: optString(record['line']) ?? '',
    category: optString(record['category']) ?? '',
    destination: optString(record['destination']) ?? '',
    platform: optString(record['platform']),
    timing: buildTiming({
      scheduled,
      // Null estimate means no realtime feed — not on time. buildTiming keeps
      // delayMinutes null in that case, which the UI renders as unknown.
      prognosis: estimated !== null && Number.isFinite(estimated) ? estimated : null,
      cancelled: record['cancelled'] === true,
    }),
    occupancy: Array.isArray(record['occupancy'])
      ? mapValid(record['occupancy'], `${path}.occupancy`, parseOccupancy).items
      : [],
    attributes: Array.isArray(record['attributes'])
      ? record['attributes'].filter((a): a is string => typeof a === 'string')
      : [],
  }
}

function parseOccupancy(value: unknown, path: string): Occupancy {
  const record = asRecord(value, path)
  return {
    fareClass: record['fareClass'] === 'first' ? 'first' : 'second',
    level: asString(record['level'], `${path}.level`),
  }
}

function parseSituation(value: unknown, path: string): Situation {
  const record = asRecord(value, path)
  return {
    id: asString(record['id'], `${path}.id`),
    summary: asString(record['summary'], `${path}.summary`),
    detail: optString(record['detail']),
  }
}

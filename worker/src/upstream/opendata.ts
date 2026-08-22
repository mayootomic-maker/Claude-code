/**
 * transport.opendata.ch, as the Worker's fallback source.
 *
 * Keyless and CORS-enabled, so the app can also call it directly when the
 * Worker itself is unreachable. Here it exists so that an OJP outage, an
 * expired credential, or a blown daily quota still leaves a working board.
 *
 * Always requests trimmed fields: an untrimmed six-departure stationboard is
 * ~35 KB because every entry embeds a full stop-by-stop `passList`, against
 * ~1.7 KB trimmed.
 */

import type { WireBoard, WireDeparture } from '../wire'

const BASE = 'https://transport.opendata.ch/v1'

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

export async function fetchDepartures(input: {
  stopId: string
  limit?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<Omit<WireBoard, 'fetchedAt' | 'source'>> {
  const doFetch = input.fetchImpl ?? fetch
  const url = new URL(`${BASE}/stationboard`)
  url.searchParams.set('id', input.stopId)
  url.searchParams.set('limit', String(input.limit ?? 8))
  url.searchParams.set('type', 'departure')
  for (const field of STATIONBOARD_FIELDS) url.searchParams.append('fields[]', field)

  const response = await doFetch(url.toString(), {
    headers: { accept: 'application/json', 'user-agent': 'pendlo-solo/1.0' },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  if (!response.ok) throw new Error(`opendata.ch returned HTTP ${response.status}`)

  const body = (await response.json()) as {
    station?: { id?: unknown; name?: unknown }
    stationboard?: unknown
  }

  const entries = Array.isArray(body.stationboard) ? body.stationboard : []
  const departures: WireDeparture[] = []

  for (const entry of entries) {
    const parsed = parseEntry(entry)
    // One malformed row must not blank the board.
    if (parsed !== null) departures.push(parsed)
  }

  return {
    stop: {
      id: typeof body.station?.id === 'string' ? body.station.id : input.stopId,
      name: typeof body.station?.name === 'string' ? body.station.name : '',
    },
    departures,
    // opendata.ch publishes neither occupancy nor disruptions; empty here means
    // "this source cannot say", which the app renders as unknown rather than none.
    situations: [],
  }
}

function parseEntry(entry: unknown): WireDeparture | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const stop = record['stop']
  if (typeof stop !== 'object' || stop === null) return null
  const stopRecord = stop as Record<string, unknown>

  const scheduled = isoFrom(stopRecord['departure'], stopRecord['departureTimestamp'])
  if (scheduled === null) return null

  const category = typeof record['category'] === 'string' ? record['category'] : ''
  const number = typeof record['number'] === 'string' ? record['number'] : ''

  // The operator prognosis wins over `delay`: they can disagree, and the
  // prognosis is the operator's own forecast.
  const prognosis = stopRecord['prognosis']
  const prognosisIso =
    typeof prognosis === 'object' && prognosis !== null
      ? isoFrom((prognosis as Record<string, unknown>)['departure'], null)
      : null

  const delay = stopRecord['delay']
  const estimated =
    prognosisIso ??
    (typeof delay === 'number' && Number.isFinite(delay)
      ? new Date(Date.parse(scheduled) + delay * 60_000).toISOString()
      : null)

  return {
    key: `${category}${number}@${scheduled}`,
    line: `${category} ${number}`.trim(),
    category,
    destination: typeof record['to'] === 'string' ? record['to'] : '',
    platform: typeof stopRecord['platform'] === 'string' ? stopRecord['platform'] : null,
    scheduled,
    estimated,
    cancelled: false,
    occupancy: [],
    attributes: [],
  }
}

/**
 * The API returns basic-format offsets (`+0200` rather than `+02:00`), which
 * not every engine parses. The epoch field is preferred where present.
 */
function isoFrom(iso: unknown, epochSeconds: unknown): string | null {
  if (typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)) {
    return new Date(epochSeconds * 1000).toISOString()
  }
  if (typeof iso !== 'string' || iso === '') return null
  const ms = Date.parse(iso.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3'))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * A stand-in for transport.opendata.ch, plus a static server for the built app.
 *
 * Two reasons this exists rather than pointing the browser at the live API:
 *
 *  1. The browser in this container has no outbound network access (the shell
 *     does, via a proxy, which is how the live API was verified and how the
 *     fixtures in src/lib/sources/__fixtures__ were captured).
 *  2. Live data cannot be made to produce the states that matter most —
 *     cancelled services, missing realtime, walk time already elapsed. Those
 *     are exactly the states that must be right, so they are driven explicitly.
 *
 * Response shapes mirror the real trimmed payloads, including the null delay
 * and null prognosis that the live API genuinely returns.
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.env.STUB_PORT ?? 4174)
const DIST = new URL('../dist/', import.meta.url).pathname

/** Scenario is chosen by stop id so the app needs no special-casing. */
const SCENARIOS = {
  '8502113': 'normal',
  '9000001': 'no-realtime',
  '9000002': 'cancelled',
  '9000003': 'go-now',
  '9000004': 'empty',
  '9000005': 'error',
  '9000006': 'malformed',
  '9000007': 'disrupted',
}

const STOPS = [
  { id: '8502113', name: 'Aarau', x: 47.391352, y: 8.05127 },
  { id: '8503000', name: 'Zürich HB', x: 47.377847, y: 8.540502 },
  { id: '8502119', name: 'Lenzburg', x: 47.391355, y: 8.169344 },
  { id: '9000001', name: 'Testhalt ohne Echtzeit', x: 47.0, y: 8.0 },
  { id: '9000002', name: 'Testhalt Ausfall', x: 47.0, y: 8.0 },
  { id: '9000003', name: 'Testhalt Sofort', x: 47.0, y: 8.0 },
  { id: '9000004', name: 'Testhalt Leer', x: 47.0, y: 8.0 },
  { id: '9000005', name: 'Testhalt Fehler', x: 47.0, y: 8.0 },
  { id: '9000007', name: 'Testhalt Störung', x: 47.0, y: 8.0 },
]

const iso = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  // Emit the basic-format offset the real API uses, so the parser's
  // normalisation is exercised rather than bypassed.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`
}

function departure({ minutesOut, category, number, to, platform, delay = null, prognosisDelay = null, cancelled = false }) {
  const scheduled = Date.now() + minutesOut * 60_000
  const stop = {
    departure: iso(scheduled),
    departureTimestamp: Math.floor(scheduled / 1000),
    delay,
    platform,
    prognosis: {
      departure: prognosisDelay === null ? null : iso(scheduled + prognosisDelay * 60_000),
    },
  }
  // The real API has no cancellation flag on the stationboard; it is modelled
  // here the way the OJP adapter will surface it in Phase 3.
  return { category, number, to, cancelled, stop }
}

function board(scenario) {
  switch (scenario) {
    case 'no-realtime':
      return [
        departure({ minutesOut: 22, category: 'IR', number: '37', to: 'Basel SBB', platform: '4' }),
        departure({ minutesOut: 52, category: 'IR', number: '37', to: 'Basel SBB', platform: '4' }),
      ]
    case 'cancelled':
      return [
        departure({ minutesOut: 18, category: 'S', number: '29', to: 'Turgi', platform: '1', delay: 0, cancelled: true }),
        departure({ minutesOut: 34, category: 'IC', number: '1', to: 'Bern', platform: '2', delay: 2, prognosisDelay: 2 }),
      ]
    case 'go-now':
      // Departs in 4 minutes with an 8-minute walk configured: walk time has
      // already elapsed, so the screen must say "go now", not show a negative.
      return [
        departure({ minutesOut: 4, category: 'S', number: '29', to: 'Turgi', platform: '1', delay: 0, prognosisDelay: 0 }),
        departure({ minutesOut: 24, category: 'IC', number: '1', to: 'Bern', platform: '2', delay: 0, prognosisDelay: 0 }),
      ]
    case 'empty':
      return []
    case 'malformed':
      return [
        { category: 'S', number: '1', to: 'Nirgendwo', stop: { departure: null, departureTimestamp: null } },
        departure({ minutesOut: 30, category: 'IC', number: '1', to: 'Bern', platform: '2', delay: 0, prognosisDelay: 0 }),
      ]
    default:
      return [
        departure({ minutesOut: 21, category: 'S', number: '29', to: 'Turgi', platform: '1', delay: 0, prognosisDelay: 0 }),
        departure({ minutesOut: 27, category: 'IR', number: '37', to: 'Basel SBB', platform: '4' }),
        departure({ minutesOut: 36, category: 'IC', number: '1', to: 'Bern', platform: '2', delay: 6, prognosisDelay: 6 }),
        departure({ minutesOut: 51, category: 'S', number: '23', to: 'Baden', platform: '3', delay: 12, prognosisDelay: 12 }),
      ]
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    date: new Date().toUTCString(),
  })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (url.pathname === '/v1/locations') {
    const query = (url.searchParams.get('query') ?? '').toLowerCase()
    const matches =
      query === ''
        ? STOPS
        : STOPS.filter((s) => s.name.toLowerCase().includes(query))
    return sendJson(res, 200, {
      stations: matches.map((s) => ({
        id: s.id,
        name: s.name,
        coordinate: { type: 'WGS84', x: s.x, y: s.y },
      })),
    })
  }

  // Worker-shaped endpoint: exercises the app's worker source, occupancy and
  // disruptions, none of which the keyless API can produce.
  if (url.pathname === '/worker/departures') {
    if (req.headers['x-pendlo-token'] !== 'test-token') {
      return sendJson(res, 401, { error: 'unauthorised' })
    }
    const id = url.searchParams.get('stopId') ?? ''
    const scenario = SCENARIOS[id] ?? 'normal'
    const iso8 = (m) => new Date(Date.now() + m * 60_000).toISOString()

    return sendJson(res, 200, {
      stop: { id, name: STOPS.find((s) => s.id === id)?.name ?? 'Aarau' },
      departures: [
        {
          key: 'IR16@1', line: 'IR16', category: 'IR', destination: 'Zürich HB',
          platform: '2', scheduled: iso8(21), estimated: iso8(21),
          cancelled: false,
          occupancy: [
            { fareClass: 'first', level: 'manySeatsAvailable' },
            { fareClass: 'second', level: 'standingRoomOnly' },
          ],
          attributes: ['Aussteigeseite: Rechts', 'Niederflureinstieg'],
        },
        {
          key: 'S29@2', line: 'S29', category: 'S', destination: 'Turgi',
          platform: '1', scheduled: iso8(33), estimated: iso8(35),
          cancelled: false,
          occupancy: [{ fareClass: 'second', level: 'fewSeatsAvailable' }],
          attributes: [],
        },
      ],
      situations:
        scenario === 'disrupted'
          ? [{ id: 'sit-1', summary: 'Streckenunterbruch Aarau–Olten', detail: 'Ersatzbusse verkehren.' }]
          : [],
      source: 'ojp',
      fetchedAt: Date.now(),
    })
  }

  if (url.pathname === '/v1/stationboard') {
    const id = url.searchParams.get('id') ?? ''
    const scenario = SCENARIOS[id] ?? 'normal'

    if (scenario === 'error') {
      res.writeHead(503, { 'content-type': 'text/html', 'access-control-allow-origin': '*' })
      return res.end('<html><body>upstream unavailable</body></html>')
    }

    const stop = STOPS.find((s) => s.id === id)
    return sendJson(res, 200, {
      station: { id, name: stop?.name ?? 'Aarau' },
      stationboard: board(scenario),
    })
  }

  // Static files from the built app.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''))

  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    const fallback = await readFile(join(DIST, 'index.html')).catch(() => null)
    if (fallback === null) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(fallback)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub server on http://127.0.0.1:${PORT}`)
})

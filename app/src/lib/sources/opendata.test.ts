import { describe, expect, it, vi } from 'vitest'
import { fetchDepartureBoard, searchStops, type OpendataDeps } from './opendata'
import { hasRealtime } from '../time'
import { ParseError } from '../parse'

import trimmedBoard from './__fixtures__/stationboard-trimmed.json'
import locations from './__fixtures__/locations-lenzb.json'

const NOW = Date.parse('2026-08-21T21:30:00Z')

function depsFor(body: unknown, init: { status?: number; contentType?: string; date?: string } = {}) {
  const response = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': init.contentType ?? 'application/json',
      ...(init.date === undefined ? {} : { date: init.date }),
    },
  })
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response)
  const deps: OpendataDeps = { fetch: fetchMock, now: () => NOW }
  return { deps, fetchMock }
}

describe('fetchDepartureBoard', () => {
  it('parses a real trimmed response from the live API', async () => {
    const { deps } = depsFor(trimmedBoard)
    const board = await fetchDepartureBoard(deps, { stopId: '8502113' })

    expect(board.stop.name).toBe('Aarau')
    expect(board.departures.length).toBeGreaterThan(0)
    expect(board.dropped).toBe(0)

    const first = board.departures[0]
    expect(first?.line).toBe('S 29')
    expect(first?.destination).toBe('Turgi')
    expect(first?.platform).toBe('1')
  })

  it('distinguishes a train with no realtime data from an on-time one', async () => {
    // This is the case the fixture was captured for: the IR 37 to Basel came
    // back with delay: null and a null prognosis. Rendering that as "on time"
    // would be a lie.
    const { deps } = depsFor(trimmedBoard)
    const board = await fetchDepartureBoard(deps, { stopId: '8502113' })

    const withRealtime = board.departures.filter((d) => hasRealtime(d.timing))
    const withoutRealtime = board.departures.filter((d) => !hasRealtime(d.timing))

    expect(withRealtime.length).toBeGreaterThan(0)
    expect(withoutRealtime.length).toBeGreaterThan(0)
    expect(withoutRealtime[0]?.timing.delayMinutes).toBeNull()
  })

  it('requests only the fields it renders, not the full passList', async () => {
    const { deps, fetchMock } = depsFor(trimmedBoard)
    await fetchDepartureBoard(deps, { stopId: '8502113' })

    const url = fetchMock.mock.calls[0]?.[0] ?? ""
    expect(url).toContain('fields%5B%5D=stationboard%2Fstop%2Fdeparture')
    expect(url).not.toContain('passList')
  })

  it('prefers the operator prognosis when it disagrees with the delay field', async () => {
    // Observed live: delay 0 but a prognosis 60s later. The prognosis wins.
    const scheduled = '2026-08-21T23:34:00+0200'
    const { deps } = depsFor({
      station: { id: '1', name: 'Test' },
      stationboard: [
        {
          category: 'S',
          number: '29',
          to: 'Turgi',
          stop: {
            departure: scheduled,
            departureTimestamp: Date.parse(scheduled) / 1000,
            delay: 0,
            platform: '1',
            prognosis: { departure: '2026-08-21T23:35:00+0200' },
          },
        },
      ],
    })

    const board = await fetchDepartureBoard(deps, { stopId: '1' })
    expect(board.departures[0]?.timing.delayMinutes).toBe(1)
  })

  it('drops one malformed departure instead of blanking the whole board', async () => {
    const { deps } = depsFor({
      station: { id: '1', name: 'Test' },
      stationboard: [
        { category: 'S', number: '1', to: 'A', stop: { departure: null, departureTimestamp: null } },
        {
          category: 'IR',
          number: '37',
          to: 'Basel SBB',
          stop: { departure: '2026-08-21T23:36:00+0200', departureTimestamp: 1787348160, delay: null },
        },
      ],
    })

    const board = await fetchDepartureBoard(deps, { stopId: '1' })
    expect(board.departures).toHaveLength(1)
    expect(board.dropped).toBe(1) // surfaced, not swallowed
  })

  it('rejects an HTML error page rather than failing on a JSON syntax error', async () => {
    const { deps } = depsFor({}, { contentType: 'text/html' })
    await expect(fetchDepartureBoard(deps, { stopId: '1' })).rejects.toThrow(ParseError)
  })

  it('rejects a rate-limit response', async () => {
    const { deps } = depsFor({}, { status: 429 })
    await expect(fetchDepartureBoard(deps, { stopId: '1' })).rejects.toThrow(/HTTP 429/)
  })

  it('reports the server Date header so the clock can correct drift', async () => {
    const onResponseMeta = vi.fn()
    const { deps } = depsFor(trimmedBoard, { date: 'Fri, 21 Aug 2026 21:30:00 GMT' })

    await fetchDepartureBoard({ ...deps, onResponseMeta }, { stopId: '1' })

    expect(onResponseMeta).toHaveBeenCalledWith(
      expect.objectContaining({ serverDate: 'Fri, 21 Aug 2026 21:30:00 GMT' }),
    )
  })
})

describe('searchStops', () => {
  it('parses real location results', async () => {
    const { deps } = depsFor(locations)
    const stops = await searchStops(deps, { query: 'Lenzb' })

    expect(stops.length).toBeGreaterThan(0)
    expect(stops[0]?.name).toContain('Lenzburg')
    expect(stops[0]?.coord).not.toBeNull()
  })

  it('drops address results, which have a null id and cannot be boarded', async () => {
    const { deps } = depsFor({
      stations: [
        { id: null, name: 'Bahnhofquai 15, Zürich', coordinate: { x: null, y: null } },
        { id: '8503000', name: 'Zürich HB', coordinate: { x: 47.377847, y: 8.540502 } },
      ],
    })

    const stops = await searchStops(deps, { query: 'Zürich' })
    expect(stops).toHaveLength(1)
    expect(stops[0]?.id).toBe('8503000')
  })
})

/**
 * Tested against responses captured from the live OJP API, not hand-written
 * XML. Two quirks in that real data would break a naive parser and are
 * asserted here explicitly: `FareClass` arrives as `"secondClass "` with a
 * trailing space, and every text node carries an `xml:lang` attribute.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  OjpError,
  buildStopEventRequest,
  fetchStopEvents,
  parseStopEvents,
} from './ojp'

// Path rather than a URL object: the Workers and Node URL types differ, and
// this file is typechecked with the Workers lib loaded.
const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url).pathname, 'utf8')

const aarau = fixture('ojp-stopevent-aarau.xml')
const zurich = fixture('ojp-stopevent-zurich.xml')

describe('buildStopEventRequest', () => {
  const at = new Date('2026-08-22T07:15:00Z')

  it('produces a request the live API accepts', () => {
    const xml = buildStopEventRequest({ stopId: '8502113', limit: 4, at })

    expect(xml).toContain('<StopPlaceRef>8502113</StopPlaceRef>')
    expect(xml).toContain('<NumberOfResults>4</NumberOfResults>')
    expect(xml).toContain('<StopEventType>departure</StopEventType>')
    expect(xml).toContain('<IncludeRealtimeData>true</IncludeRealtimeData>')
    expect(xml).toContain('<IncludeSituations>true</IncludeSituations>')
    expect(xml).toContain('2026-08-22T07:15:00.000Z')
  })

  it('escapes the stop id, which arrives over the wire', () => {
    const xml = buildStopEventRequest({ stopId: '8502113</StopPlaceRef><evil>', limit: 2, at })
    expect(xml).not.toContain('<evil>')
    expect(xml).toContain('&lt;evil&gt;')
  })

  it('clamps an absurd result count rather than passing it upstream', () => {
    expect(buildStopEventRequest({ stopId: '1', limit: 9999, at })).toContain('<NumberOfResults>30</NumberOfResults>')
    expect(buildStopEventRequest({ stopId: '1', limit: 0, at })).toContain('<NumberOfResults>1</NumberOfResults>')
  })
})

describe('parseStopEvents — real Aarau response', () => {
  const result = parseStopEvents(aarau)

  it('reads the stop name through the xml:lang attribute', () => {
    expect(result.stopName).toBe('Aarau')
  })

  it('extracts departures with line, category and destination', () => {
    expect(result.departures.length).toBeGreaterThan(0)

    const first = result.departures[0]
    expect(first?.line).toBe('IR16')
    expect(first?.category).toBe('IR')
    expect(first?.destination).toBe('Zürich HB')
    expect(first?.platform).toBe('2')
  })

  it('keeps timetabled and realtime departure separate', () => {
    const first = result.departures[0]
    expect(first?.scheduled).toBe('2026-08-22T07:15:00Z')
    // The train was running 84 seconds late when this was captured.
    expect(first?.estimated).toBe('2026-08-22T07:16:24Z')
    expect(first?.estimated).not.toBe(first?.scheduled)
  })

  it('reads occupancy, which opendata.ch cannot supply at all', () => {
    const first = result.departures[0]
    expect(first?.occupancy).toHaveLength(2)

    const second = first?.occupancy.find((o) => o.fareClass === 'second')
    // Live data ships "secondClass " with a trailing space; a naive comparison
    // would classify every second-class figure as first.
    expect(second).toBeDefined()
    expect(second?.level).toBe('manySeatsAvailable')

    expect(first?.occupancy.find((o) => o.fareClass === 'first')?.level).toBe('manySeatsAvailable')
  })

  it('captures operator attributes, including which side the doors open', () => {
    const first = result.departures[0]
    expect(first?.attributes).toContain('Aussteigeseite: Rechts')
    expect(first?.attributes).toContain('Niederflureinstieg')
  })

  it('gives every departure a distinct key', () => {
    const keys = result.departures.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reports nothing cancelled in a normal response', () => {
    expect(result.departures.every((d) => !d.cancelled)).toBe(true)
  })
})

describe('parseStopEvents — real Zürich HB response', () => {
  const result = parseStopEvents(zurich)

  it('handles a large multi-line board', () => {
    expect(result.departures.length).toBeGreaterThan(5)
    expect(result.stopName).toBe('Zürich HB')
  })

  it('returns no situations when the Situations container is empty', () => {
    // `<Situations />` was present but empty when captured — no live
    // disruptions. An empty container must read as "none", not as a parse
    // failure.
    expect(result.situations).toEqual([])
  })

  it('finds more than one product category across the board', () => {
    const categories = new Set(result.departures.map((d) => d.category))
    expect(categories.size).toBeGreaterThan(1)
  })
})

describe('parseStopEvents — edge cases', () => {
  it('surfaces a SIRI error reported inside a 200 response', () => {
    const xml = `<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri">
      <OJPResponse><siri:ServiceDelivery>
        <siri:ErrorCondition><siri:Description>Stop not found</siri:Description></siri:ErrorCondition>
      </siri:ServiceDelivery></OJPResponse></OJP>`
    expect(() => parseStopEvents(xml)).toThrow(/Stop not found/)
  })

  it('returns an empty board rather than throwing on an unexpected shape', () => {
    const result = parseStopEvents('<OJP><OJPResponse /></OJP>')
    expect(result.departures).toEqual([])
    expect(result.situations).toEqual([])
  })

  it('drops a departure with no timetabled time instead of failing the board', () => {
    const xml = `<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri">
      <OJPResponse><siri:ServiceDelivery><OJPStopEventDelivery>
        <StopEventResult><StopEvent>
          <ThisCall><CallAtStop><ServiceDeparture /></CallAtStop></ThisCall>
          <Service><PublicCode>S1</PublicCode></Service>
        </StopEvent></StopEventResult>
      </OJPStopEventDelivery></siri:ServiceDelivery></OJPResponse></OJP>`
    expect(parseStopEvents(xml).departures).toEqual([])
  })

  it('parses situations when they are present', () => {
    const xml = `<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri">
      <OJPResponse><siri:ServiceDelivery><OJPStopEventDelivery>
        <StopEventResponseContext><Situations>
          <PtSituationElement>
            <siri:SituationNumber>ch:1:sit:42</siri:SituationNumber>
            <siri:Summary><Text xml:lang="de">Streckenunterbruch Aarau–Olten</Text></siri:Summary>
            <siri:Description><Text xml:lang="de">Ersatzbusse verkehren.</Text></siri:Description>
          </PtSituationElement>
        </Situations></StopEventResponseContext>
      </OJPStopEventDelivery></siri:ServiceDelivery></OJPResponse></OJP>`

    const situations = parseStopEvents(xml).situations
    expect(situations).toHaveLength(1)
    expect(situations[0]?.id).toBe('ch:1:sit:42')
    expect(situations[0]?.summary).toBe('Streckenunterbruch Aarau–Olten')
    expect(situations[0]?.detail).toBe('Ersatzbusse verkehren.')
  })
})

describe('fetchStopEvents', () => {
  const now = new Date('2026-08-22T07:15:00Z')

  it('sends the bearer token and required user agent', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(aarau, { status: 200 }))
    await fetchStopEvents({ apiKey: 'secret', stopId: '8502113', now, fetchImpl })

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['authorization']).toBe('Bearer secret')
    expect(headers?.['user-agent']).toBe('pendlo-solo/1.0')
    expect(init?.method).toBe('POST')
  })

  it('reports an auth failure distinctly from an upstream outage', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('', { status: 401 }))
    const error = await fetchStopEvents({ apiKey: 'wrong', stopId: '1', now, fetchImpl }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(OjpError)
    expect((error as OjpError).status).toBe(401)
  })
})

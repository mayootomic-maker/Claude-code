/**
 * OJP 2.0 adapter.
 *
 * Verified against the live API at `https://api.opentransportdata.swiss/ojp20`.
 * OJP gives two things transport.opendata.ch cannot:
 *
 *  - **Occupancy** (`ExpectedDepartureOccupancy`), per fare class. The
 *    opendata.ch equivalent is documented but returns null on every request, so
 *    this is the only real source for it.
 *  - **Disruptions**, in a `Situations` container on the response context.
 *
 * It also carries per-service attributes, including which side the doors open
 * on — genuinely useful on a commute and published nowhere else we can reach.
 *
 * Parsing lives in the Worker rather than the app so the client never ships an
 * XML parser. The app consumes compact JSON.
 */

import { child, children, descendants, parseXml, path, textAt, type XmlNode } from '../xml'

const ENDPOINT = 'https://api.opentransportdata.swiss/ojp20'

/** Free tier is 50 req/min; the Worker's cache keeps us far below that. */
export const OJP_RATE_PER_MINUTE = 50

export type OjpOccupancy = {
  fareClass: 'first' | 'second'
  /** Raw SIRI level, e.g. manySeatsAvailable, seatsAvailable, standingRoomOnly. */
  level: string
}

export type OjpDeparture = {
  key: string
  /** Display label, e.g. "IR16". */
  line: string
  /** Product category, e.g. IR, IC, S. Drives inspection pooling in the app. */
  category: string
  destination: string
  platform: string | null
  scheduled: string
  /** Realtime estimate, when the operator publishes one. */
  estimated: string | null
  cancelled: boolean
  occupancy: OjpOccupancy[]
  /** Operator notes, e.g. "Aussteigeseite: Rechts". */
  attributes: string[]
}

export type OjpSituation = {
  id: string
  summary: string
  detail: string | null
}

export type OjpStopEvents = {
  stopName: string | null
  departures: OjpDeparture[]
  situations: OjpSituation[]
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export function buildStopEventRequest(input: {
  stopId: string
  limit: number
  at: Date
}): string {
  const timestamp = input.at.toISOString()
  // Attribute values are ours, not user input, but the stop id reaches us over
  // the wire, so it is escaped rather than trusted.
  const stopRef = escapeXml(input.stopId)

  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp>
      <siri:RequestorRef>pendlo-solo</siri:RequestorRef>
      <OJPStopEventRequest>
        <siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp>
        <Location>
          <PlaceRef><StopPlaceRef>${stopRef}</StopPlaceRef></PlaceRef>
          <DepArrTime>${timestamp}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>${Math.max(1, Math.min(30, Math.floor(input.limit)))}</NumberOfResults>
          <StopEventType>departure</StopEventType>
          <IncludeRealtimeData>true</IncludeRealtimeData>
          <IncludePreviousCalls>false</IncludePreviousCalls>
          <IncludeOnwardCalls>false</IncludeOnwardCalls>
          <UseRealtimeData>full</UseRealtimeData>
          <IncludeSituations>true</IncludeSituations>
        </Params>
      </OJPStopEventRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export class OjpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OjpError'
  }
}

export async function fetchStopEvents(input: {
  apiKey: string
  stopId: string
  limit?: number
  now: Date
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<OjpStopEvents> {
  const doFetch = input.fetchImpl ?? fetch
  const body = buildStopEventRequest({
    stopId: input.stopId,
    limit: input.limit ?? 8,
    at: input.now,
  })

  const response = await doFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/xml',
      // The portal rejects requests without one.
      'user-agent': 'pendlo-solo/1.0',
    },
    body,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })

  if (!response.ok) {
    // 401/403 means the credential is wrong or the subscription is still
    // pending — worth distinguishing from a transient upstream failure.
    throw new OjpError(`OJP returned HTTP ${response.status}`, response.status)
  }

  return parseStopEvents(await response.text())
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseStopEvents(xml: string): OjpStopEvents {
  const root = parseXml(xml)

  // A SIRI-level error is reported inside a 200 response, so an HTTP check
  // alone is not enough to know the request succeeded.
  const errorText = textAt(root, 'OJPResponse', 'ServiceDelivery', 'ErrorCondition', 'Description')
  if (errorText !== null) throw new OjpError(errorText, 200)

  const delivery = path(root, 'OJPResponse', 'ServiceDelivery', 'OJPStopEventDelivery')
  if (delivery === null) return { stopName: null, departures: [], situations: [] }

  const context = child(delivery, 'StopEventResponseContext')

  return {
    stopName: firstText(context, 'StopPlaceName'),
    // Malformed entries are dropped rather than failing the board.
    departures: children(delivery, 'StopEventResult')
      .map(parseResult)
      .filter((d): d is OjpDeparture => d !== null),
    situations: context === null ? [] : parseSituations(context),
  }
}

function firstText(node: XmlNode | null, name: string): string | null {
  if (node === null) return null
  const found = descendants(node, name)[0]
  if (found === undefined) return null
  return textAt(found, 'Text')
}

function parseResult(result: XmlNode): OjpDeparture | null {
  const event = child(result, 'StopEvent')
  if (event === null) return null

  const call = path(event, 'ThisCall', 'CallAtStop')
  const service = child(event, 'Service')
  if (call === null || service === null) return null

  const departure = child(call, 'ServiceDeparture')
  const scheduled = textAt(departure, 'TimetabledTime')
  // Without a scheduled time there is nothing to count down to.
  if (scheduled === null) return null

  const category =
    textAt(path(service, 'ProductCategory'), 'ShortName', 'Text') ??
    textAt(path(service, 'Mode'), 'ShortName', 'Text') ??
    ''

  const line = textAt(path(service, 'PublishedServiceName'), 'Text') ?? textAt(service, 'PublicCode') ?? ''

  return {
    // JourneyRef is stable per service per day; falling back to line+time keeps
    // the key unique when it is absent.
    key: textAt(service, 'JourneyRef') ?? `${line}@${scheduled}`,
    line,
    category,
    destination: textAt(path(service, 'DestinationText'), 'Text') ?? '',
    platform: textAt(path(call, 'PlannedQuay'), 'Text'),
    scheduled,
    estimated: textAt(departure, 'EstimatedTime'),
    // OJP marks a dropped call rather than using a cancellation flag.
    cancelled: textAt(call, 'NotServicedStop') === 'true' || textAt(event, 'Cancelled') === 'true',
    occupancy: parseOccupancy(call),
    attributes: children(service, 'Attribute')
      .map((a) => textAt(a, 'UserText', 'Text'))
      .filter((text): text is string => text !== null),
  }
}

function parseOccupancy(call: XmlNode): OjpOccupancy[] {
  const out: OjpOccupancy[] = []

  for (const entry of children(call, 'ExpectedDepartureOccupancy')) {
    const level = textAt(entry, 'OccupancyLevel')
    // Live data returns "secondClass " with a trailing space; textAt trims.
    const rawClass = textAt(entry, 'FareClass')
    if (level === null || rawClass === null) continue

    out.push({
      fareClass: rawClass === 'firstClass' ? 'first' : 'second',
      level,
    })
  }

  return out
}

function parseSituations(context: XmlNode): OjpSituation[] {
  const container = child(context, 'Situations')
  if (container === null) return []

  // Empty when nothing is disrupted, which is the normal case.
  return descendants(container, 'PtSituationElement')
    .map((situation): OjpSituation | null => {
      const summary = firstText(situation, 'Summary') ?? textAt(situation, 'Summary')
      if (summary === null) return null
      return {
        id: textAt(situation, 'SituationNumber') ?? summary,
        summary,
        detail: firstText(situation, 'Description') ?? textAt(situation, 'Description'),
      }
    })
    .filter((s): s is OjpSituation => s !== null)
}

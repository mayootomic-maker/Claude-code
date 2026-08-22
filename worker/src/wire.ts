/**
 * The contract between Worker and app.
 *
 * Deliberately flat and already normalised: whichever upstream answered, the
 * app sees one shape. Times are ISO strings in UTC — unambiguous on the wire,
 * and the app converts to Swiss local time for display.
 */

export type WireOccupancy = {
  fareClass: 'first' | 'second'
  /** Raw SIRI level, e.g. manySeatsAvailable, seatsAvailable, standingRoomOnly. */
  level: string
}

export type WireDeparture = {
  key: string
  line: string
  /** Product category (IR, IC, S). Drives inspection pooling in the app. */
  category: string
  destination: string
  platform: string | null
  scheduled: string
  /** Realtime estimate, or null when the operator publishes none. */
  estimated: string | null
  cancelled: boolean
  /** Empty when the answering source cannot supply occupancy at all. */
  occupancy: WireOccupancy[]
  /** Operator notes, e.g. "Aussteigeseite: Rechts". */
  attributes: string[]
}

export type WireSituation = {
  id: string
  summary: string
  detail: string | null
}

export type WireBoard = {
  stop: { id: string; name: string }
  departures: WireDeparture[]
  situations: WireSituation[]
  /** Which upstream answered, so the app can say when it is on the fallback. */
  source: 'ojp' | 'opendata'
  /** Server time when fetched, epoch ms. Also anchors the app's clock. */
  fetchedAt: number
}

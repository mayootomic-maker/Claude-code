/** Domain model. Nothing upstream-shaped survives past the source adapters. */

import type { DepartureTiming } from './time'

export type SourceId = 'opendata' | 'ojp'

export type StopRef = {
  /** UIC / DiDok id, e.g. "8502113". */
  id: string
  name: string
  coord: { lat: number; lon: number } | null
}

export type Departure = {
  /** Stable within a response; used as a list key and to match across refreshes. */
  key: string
  /** Display label, e.g. "IR 37". */
  line: string
  category: string
  destination: string
  platform: string | null
  timing: DepartureTiming
}

export type DepartureBoard = {
  stop: StopRef
  departures: Departure[]
  /** Which source answered — surfaced in the UI when it is not the primary. */
  source: SourceId
  /** Corrected clock time at which this was fetched. */
  fetchedAt: number
}

export type Leg = {
  from: StopRef
  to: StopRef
  line: string
  category: string
  departure: DepartureTiming
  arrival: DepartureTiming
  departurePlatform: string | null
  arrivalPlatform: string | null
}

export type Journey = {
  key: string
  legs: Leg[]
  /** Total duration in seconds, from the realtime-adjusted times. */
  durationSeconds: number
  transfers: number
}

export type JourneyPlan = {
  from: StopRef
  to: StopRef
  journeys: Journey[]
  source: SourceId
  fetchedAt: number
}

export type Direction = 'outbound' | 'inbound'

export type SavedRoute = {
  id: string
  label: string
  origin: StopRef
  destination: StopRef
  /** Seconds on foot from your usual start to the origin stop. */
  walkSeconds: number
  /** Free-text note, e.g. which coach to board. */
  note: string
}

/** Everything the app knows, as written to disk and to an export file. */
export type AppData = {
  version: number
  routes: SavedRoute[]
  settings: Settings
}

export type Settings = {
  language: 'de' | 'en'
  theme: 'system' | 'light' | 'dark'
  /** Notify when a departure on a saved route is at least this many minutes late. */
  delayAlertMinutes: number
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'de',
  theme: 'system',
  delayAlertMinutes: 3,
}

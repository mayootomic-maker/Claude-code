/**
 * Application state.
 *
 * Signals rather than a framework store: the reactive graph here is tiny, and
 * `@preact/signals` re-renders only the components that read a changed value,
 * which keeps the per-second countdown from re-rendering the whole screen.
 *
 * Everything durable lives under a single key so export/import is a straight
 * serialisation of one object.
 */

import { signal, computed } from '@preact/signals'
import { dbGet, dbSet } from './db'
import { DEFAULT_SETTINGS, type ActiveTrip, type AppData, type SavedRoute, type Settings } from './types'
import { detectLanguage, translator } from './i18n'
import {
  EMPTY_LOG,
  migrateLog,
  recordInspection,
  recordRide,
  type Inspection,
  type InspectionLog,
  type Ride,
} from './inspections'

const DATA_KEY = 'app-data'

/** Bump when the shape changes; `migrate` handles older payloads. */
export const DATA_VERSION = 1

export const routes = signal<SavedRoute[]>([])
export const settings = signal<Settings>(DEFAULT_SETTINGS)
export const log = signal<InspectionLog>(EMPTY_LOG)
export const activeTrip = signal<ActiveTrip | null>(null)
export const loaded = signal(false)
/** Epoch ms of the last export, or null. Drives the backup reminder. */
export const lastBackupAt = signal<number | null>(null)

export const t = computed(() => translator(settings.value.language))
export const hasRoutes = computed(() => routes.value.length > 0)

function snapshot(): AppData {
  return {
    version: DATA_VERSION,
    routes: routes.value,
    settings: settings.value,
    log: log.value,
    lastBackupAt: lastBackupAt.value,
    activeTrip: activeTrip.value,
  }
}

/**
 * Normalises any stored payload into the current shape.
 *
 * Written defensively because this also parses user-supplied import files,
 * which may be hand-edited, truncated, or from an older build.
 */
export function migrate(raw: unknown): AppData {
  if (typeof raw !== 'object' || raw === null) {
    return {
      version: DATA_VERSION,
      routes: [],
      settings: DEFAULT_SETTINGS,
      log: EMPTY_LOG,
      lastBackupAt: null,
      activeTrip: null,
    }
  }
  const record = raw as Partial<AppData>

  const storedRoutes = Array.isArray(record.routes) ? record.routes : []
  const validRoutes = storedRoutes.filter((route): route is SavedRoute => {
    if (typeof route !== 'object' || route === null) return false
    const r = route as Partial<SavedRoute>
    return (
      typeof r.id === 'string' &&
      typeof r.origin?.id === 'string' &&
      typeof r.destination?.id === 'string' &&
      typeof r.walkSeconds === 'number' &&
      Number.isFinite(r.walkSeconds)
    )
  })

  const storedSettings =
    typeof record.settings === 'object' && record.settings !== null ? record.settings : {}

  const storedBackup = (record as { lastBackupAt?: unknown }).lastBackupAt
  return {
    version: DATA_VERSION,
    routes: validRoutes,
    settings: { ...DEFAULT_SETTINGS, ...storedSettings },
    log: migrateLog(record.log),
    lastBackupAt: typeof storedBackup === 'number' && Number.isFinite(storedBackup) ? storedBackup : null,
    activeTrip: migrateActiveTrip(record.activeTrip),
  }
}

function migrateActiveTrip(raw: unknown): ActiveTrip | null {
  if (typeof raw !== 'object' || raw === null) return null
  const trip = raw as Partial<ActiveTrip>
  if (typeof trip.tripKey !== 'string') return null
  if (typeof trip.departedAt !== 'number' || !Number.isFinite(trip.departedAt)) return null
  if (typeof trip.routeId !== 'string') return null
  return {
    tripKey: trip.tripKey,
    routeId: trip.routeId,
    direction: trip.direction === 'inbound' ? 'inbound' : 'outbound',
    line: typeof trip.line === 'string' ? trip.line : '',
    destination: typeof trip.destination === 'string' ? trip.destination : '',
    departedAt: trip.departedAt,
    segment: Array.isArray(trip.segment) && trip.segment.length === 2
      ? [String(trip.segment[0]), String(trip.segment[1])]
      : ['', ''],
  }
}

export async function load(): Promise<void> {
  try {
    const stored = await dbGet<unknown>(DATA_KEY)
    if (stored === undefined) {
      // First run: follow the browser's language rather than forcing German.
      settings.value = { ...DEFAULT_SETTINGS, language: detectLanguage(navigator.languages ?? []) }
    } else {
      const data = migrate(stored)
      routes.value = data.routes
      settings.value = data.settings
      log.value = data.log
      lastBackupAt.value = data.lastBackupAt
      activeTrip.value = data.activeTrip
    }
  } catch {
    // A blocked or unavailable IndexedDB (private mode, storage disabled) must
    // not stop the app: it still works, it just will not remember anything.
    // The Settings screen surfaces this so it is never a silent failure.
    persistenceAvailable.value = false
  } finally {
    loaded.value = true
  }
}

export const persistenceAvailable = signal(true)

async function persist(): Promise<void> {
  try {
    await dbSet(DATA_KEY, snapshot())
    persistenceAvailable.value = true
  } catch {
    persistenceAvailable.value = false
  }
}

export async function saveRoute(route: SavedRoute): Promise<void> {
  const existing = routes.value.findIndex((r) => r.id === route.id)
  routes.value =
    existing === -1
      ? [...routes.value, route]
      : routes.value.map((r) => (r.id === route.id ? route : r))
  await persist()
}

export async function deleteRoute(id: string): Promise<void> {
  routes.value = routes.value.filter((r) => r.id !== id)
  await persist()
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch }
  await persist()
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

/**
 * The whole app as one JSON string.
 *
 * This is the real defence against iOS clearing PWA storage: `persist()` is a
 * request the browser may decline, but a file in your downloads folder is not.
 */
export function exportData(): string {
  return JSON.stringify(snapshot(), null, 2)
}

export async function importData(json: string): Promise<{ routes: number; rides: number; inspections: number }> {
  const parsed: unknown = JSON.parse(json)
  const data = migrate(parsed)
  routes.value = data.routes
  settings.value = data.settings
  log.value = data.log
  lastBackupAt.value = data.lastBackupAt
  activeTrip.value = data.activeTrip
  await persist()
  return {
    routes: data.routes.length,
    rides: data.log.rides.length,
    inspections: data.log.inspections.length,
  }
}

/** Marks a successful export so the backup reminder can stay quiet. */
export async function markBackedUp(now: number): Promise<void> {
  lastBackupAt.value = now
  await persist()
}

/**
 * Whether to nudge for a backup.
 *
 * iOS can clear PWA storage after about a week of inactivity, and the log is
 * months of hand-collected data that cannot be reconstructed. The nudge only
 * appears once there is something worth losing.
 */
const BACKUP_REMINDER_MS = 30 * 86_400_000

export function backupOverdue(now: number): boolean {
  const entries = log.value.rides.length + log.value.inspections.length
  if (entries < 10) return false
  if (lastBackupAt.value === null) return true
  return now - lastBackupAt.value > BACKUP_REMINDER_MS
}

// ---------------------------------------------------------------------------
// The trip you are on
// ---------------------------------------------------------------------------

/**
 * How long after departure a trip is still considered current.
 *
 * Long enough to cover any realistic Swiss commute including a change, short
 * enough that yesterday's trip never lingers. The stationboard gives no
 * arrival time, so this is a ceiling rather than a computed end.
 */
export const ACTIVE_TRIP_WINDOW_MS = 90 * 60_000

/**
 * Remembers the departure the user is counting down to, so it can be read back
 * after it has left and the Now screen has moved on to the next one.
 *
 * Refuses to overwrite a journey already under way. Without that guard the
 * marker is immediately re-pointed at the *next* train the moment the app is
 * opened mid-journey — which is exactly when it is needed — and the boarded
 * trip is lost.
 */
export async function markIntendedTrip(trip: ActiveTrip, now: number): Promise<void> {
  if (currentTrip(now) !== null) return

  const current = activeTrip.value
  if (current !== null && current.tripKey === trip.tripKey && current.departedAt === trip.departedAt) {
    return
  }
  activeTrip.value = trip
  await persist()
}

/** Forgets the boarded trip — you took a different train after all. */
export async function clearActiveTrip(): Promise<void> {
  activeTrip.value = null
  await persist()
}

/** The trip currently under way, or null. */
export function currentTrip(now: number): ActiveTrip | null {
  const trip = activeTrip.value
  if (trip === null) return null
  if (now < trip.departedAt) return null
  if (now - trip.departedAt > ACTIVE_TRIP_WINDOW_MS) return null
  return trip
}

// ---------------------------------------------------------------------------
// Inspection log
// ---------------------------------------------------------------------------

export async function logRide(ride: Omit<Ride, 'id'>): Promise<void> {
  const next = recordRide(log.value, ride)
  // recordRide is a no-op for a repeat on the same service day; skip the write
  // rather than churning IndexedDB on every poll.
  if (next === log.value) return
  log.value = next
  await persist()
}

export async function logInspection(inspection: Omit<Inspection, 'id'>): Promise<void> {
  const next = recordInspection(log.value, inspection)
  if (next === log.value) return
  log.value = next
  await persist()
}

export function exportFilename(now: number): string {
  const date = new Date(now).toISOString().slice(0, 10)
  return `pendlo-backup-${date}.json`
}

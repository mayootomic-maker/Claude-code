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
import { DEFAULT_SETTINGS, type AppData, type SavedRoute, type Settings } from './types'
import { detectLanguage, translator } from './i18n'

const DATA_KEY = 'app-data'

/** Bump when the shape changes; `migrate` handles older payloads. */
export const DATA_VERSION = 1

export const routes = signal<SavedRoute[]>([])
export const settings = signal<Settings>(DEFAULT_SETTINGS)
export const loaded = signal(false)

export const t = computed(() => translator(settings.value.language))
export const hasRoutes = computed(() => routes.value.length > 0)

function snapshot(): AppData {
  return { version: DATA_VERSION, routes: routes.value, settings: settings.value }
}

/**
 * Normalises any stored payload into the current shape.
 *
 * Written defensively because this also parses user-supplied import files,
 * which may be hand-edited, truncated, or from an older build.
 */
export function migrate(raw: unknown): AppData {
  if (typeof raw !== 'object' || raw === null) {
    return { version: DATA_VERSION, routes: [], settings: DEFAULT_SETTINGS }
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

  return {
    version: DATA_VERSION,
    routes: validRoutes,
    settings: { ...DEFAULT_SETTINGS, ...storedSettings },
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

export async function importData(json: string): Promise<{ routes: number }> {
  const parsed: unknown = JSON.parse(json)
  const data = migrate(parsed)
  routes.value = data.routes
  settings.value = data.settings
  await persist()
  return { routes: data.routes.length }
}

export function exportFilename(now: number): string {
  const date = new Date(now).toISOString().slice(0, 10)
  return `pendlo-backup-${date}.json`
}

/**
 * Route management.
 *
 * The walk time gets real prominence here because it silently determines the
 * app's most important number. A wrong walk time makes every countdown wrong
 * in a way that looks perfectly plausible.
 */

import { useState } from 'preact/hooks'
import { deleteRoute, routes, saveRoute, t as translate } from '../lib/store'
import type { SavedRoute } from '../lib/types'

export function Routes() {
  const t = translate.value
  const list = routes.value

  return (
    <div class="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-md flex-col px-5">
      <header class="safe-top pb-3">
        <h1 class="text-xl font-bold">{t('routes.title')}</h1>
      </header>

      <div class="safe-bottom flex-1 space-y-3">
        {list.length === 0 ? (
          <p class="text-sm text-muted">{t('routes.empty')}</p>
        ) : (
          list.map((route) => <RouteCard key={route.id} route={route} />)
        )}
      </div>
    </div>
  )
}

function RouteCard({ route }: { route: SavedRoute }) {
  const t = translate.value
  const [walkMinutes, setWalkMinutes] = useState(Math.round(route.walkSeconds / 60))
  const [note, setNote] = useState(route.note)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = walkMinutes * 60 !== route.walkSeconds || note !== route.note

  const commit = async () => {
    await saveRoute({ ...route, walkSeconds: walkMinutes * 60, note })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section class="animate-rise rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 class="font-semibold">
        {route.origin.name} <span class="text-faint">→</span> {route.destination.name}
      </h2>

      <label class="mt-4 block text-sm font-medium text-muted" for={`walk-${route.id}`}>
        {t('routes.walk')}: {t('onboarding.minutesOnFoot', { min: walkMinutes })}
      </label>
      <input
        id={`walk-${route.id}`}
        type="range"
        min={1}
        max={30}
        value={walkMinutes}
        onInput={(event) => setWalkMinutes(Number((event.target as HTMLInputElement).value))}
        class="mt-1 w-full accent-[var(--accent)]"
      />

      <label class="mt-3 block text-sm font-medium text-muted" for={`note-${route.id}`}>
        {t('routes.note')}
      </label>
      <input
        id={`note-${route.id}`}
        type="text"
        value={note}
        placeholder={t('routes.notePlaceholder')}
        onInput={(event) => setNote((event.target as HTMLInputElement).value)}
        class="mt-1 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line bg-bg px-3 text-base"
      />

      <div class="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!dirty}
          class="min-h-[var(--tap)] flex-1 rounded-[var(--radius-card)] bg-accent px-4 font-semibold text-on-accent disabled:opacity-40"
        >
          {saved ? '✓' : t('routes.save')}
        </button>

        {confirmingDelete ? (
          // Two-step rather than a modal: deleting a route also orphans its
          // inspection history, so it should take a deliberate second tap.
          <button
            type="button"
            onClick={() => void deleteRoute(route.id)}
            class="min-h-[var(--tap)] rounded-[var(--radius-card)] bg-critical/15 px-4 text-sm font-semibold text-critical"
          >
            {t('routes.confirmDelete')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            class="min-h-[var(--tap)] rounded-[var(--radius-card)] border border-line px-4 text-sm font-semibold text-muted"
          >
            {t('routes.delete')}
          </button>
        )}
      </div>
    </section>
  )
}

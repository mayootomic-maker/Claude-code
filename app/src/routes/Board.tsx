/**
 * Departure board for any stop.
 *
 * The Now screen answers the commute; this covers everything else — an
 * unfamiliar stop, the way back from somewhere new, checking a platform.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { searchStops, stopsNear } from '../lib/sources/opendata'
import { opendataDeps, pollIntervalMs, useDepartureBoard, useTick } from '../lib/live'
import { routes, t as translate } from '../lib/store'
import { formatClock } from '../lib/time'
import { Banner, DelayBadge, formatAge } from '../ui/status'
import type { StopRef } from '../lib/types'

export function Board() {
  const t = translate.value
  const now = useTick(true)

  // Defaults to the saved route's origin: the most likely stop to want, and it
  // means the screen is never empty on arrival.
  const fallback = routes.value[0]?.origin ?? null
  const [stop, setStop] = useState<StopRef | null>(fallback)

  return (
    <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header class="safe-top pb-3">
        <h1 class="text-xl font-bold">{t('board.title')}</h1>
      </header>

      <StopSearch onPick={setStop} current={stop} />

      <div class="flex-1 pt-3">
        {stop === null ? (
          <p class="text-sm text-muted">{t('board.pickStop')}</p>
        ) : (
          <Departures key={stop.id} stop={stop} now={now} />
        )}
      </div>
    </div>
  )
}

function Departures({ stop, now }: { stop: StopRef; now: number }) {
  const t = translate.value
  const state = useDepartureBoard(stop.id, pollIntervalMs(null))
  const board = state.board
  const age = board === null ? 0 : now - board.fetchedAt

  if (state.loading && board === null) {
    return (
      <ul class="animate-pulse-soft space-y-2" aria-label={t('state.loading')} role="status">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} class="h-9 rounded bg-sunken" />
        ))}
      </ul>
    )
  }

  if (board === null) {
    return (
      <Banner
        tone="error"
        title={t('state.error')}
        detail={t('state.errorHint')}
        action={{ label: t('state.retry'), onClick: state.refresh }}
      />
    )
  }

  if (board.departures.length === 0) {
    return <Banner tone="info" title={t('board.empty')} />
  }

  return (
    <>
      {age > 120_000 && (
        <div class="pb-2">
          <Banner tone="warn" title={t('state.stale', { age: formatAge(age, t) })} />
        </div>
      )}
      <ul class="divide-y divide-line">
        {board.departures.map((departure, index) => (
          <li
            key={departure.key}
            class="animate-rise flex items-center gap-3 py-2.5"
            style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
          >
            <span class="w-16 shrink-0 text-sm font-semibold">{departure.line}</span>
            <span class="min-w-0 flex-1 truncate text-sm">{departure.destination}</span>
            {departure.platform !== null && (
              <span class="w-10 shrink-0 text-right text-xs text-faint">{departure.platform}</span>
            )}
            <DelayBadge timing={departure.timing} t={t} compact />
            <span class="w-12 shrink-0 text-right text-sm font-medium">
              {formatClock(departure.timing.actual)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function StopSearch({ onPick, current }: { onPick: (stop: StopRef) => void; current: StopRef | null }) {
  const t = translate.value
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StopRef[]>([])
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied' | 'failed'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }

    // Debounced: the upstream API allows 3 requests a second.
    const timer = setTimeout(() => {
      abortRef.current?.abort(new Error('superseded'))
      const controller = new AbortController()
      abortRef.current = controller

      searchStops(opendataDeps, { query: trimmed, signal: controller.signal })
        .then((stops) => {
          if (controller.signal.aborted) return
          setResults(stops)
          setStatus('idle')
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setResults([])
          setStatus('failed')
        })
    }, 250)

    return () => clearTimeout(timer)
  }, [query])

  const useLocation = () => {
    if (navigator.geolocation === undefined) {
      setStatus('denied')
      return
    }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        stopsNear(opendataDeps, { lat: position.coords.latitude, lon: position.coords.longitude })
          .then((stops) => {
            setResults(stops)
            setStatus('idle')
          })
          .catch(() => setStatus('failed'))
      },
      () => setStatus('denied'),
      { timeout: 8_000, maximumAge: 60_000 },
    )
  }

  const pick = (stop: StopRef) => {
    onPick(stop)
    setQuery('')
    setResults([])
  }

  return (
    <div>
      <div class="flex gap-2">
        <input
          type="search"
          value={query}
          autocomplete="off"
          placeholder={current?.name ?? t('board.search')}
          aria-label={t('board.search')}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          class="min-h-[var(--tap)] min-w-0 flex-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 text-base"
        />
        <button
          type="button"
          onClick={useLocation}
          aria-label={t('board.nearby')}
          class="min-h-[var(--tap)] shrink-0 rounded-[var(--radius-card)] border border-line px-3 text-sm font-semibold text-accent"
        >
          {status === 'locating' ? '…' : t('board.nearby')}
        </button>
      </div>

      {(status === 'denied' || status === 'failed') && (
        <p class="pt-2 text-sm text-muted" role="status">
          {status === 'denied' ? t('onboarding.locationDenied') : t('onboarding.searchFailed')}
        </p>
      )}

      {results.length > 0 && (
        <ul class="mt-2 space-y-1">
          {results.slice(0, 8).map((stop) => (
            <li key={stop.id}>
              <button
                type="button"
                onClick={() => pick(stop)}
                class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] px-3 text-left hover:bg-sunken"
              >
                {stop.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

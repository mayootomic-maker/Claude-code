/**
 * First run.
 *
 * A zero-input home screen has an empty-state trap: with no route configured
 * there is nothing to show. Three questions fix that, and the walk time gets
 * real attention because it silently determines the app's most important
 * number — a wrong walk time makes every countdown wrong in a way the user
 * cannot see.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { searchStops, stopsNear } from '../lib/sources/opendata'
import { opendataDeps } from '../lib/live'
import { saveRoute, t as translate } from '../lib/store'
import type { StopRef } from '../lib/types'

type Step = 'origin' | 'destination' | 'walk'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = translate.value
  const [step, setStep] = useState<Step>('origin')
  const [origin, setOrigin] = useState<StopRef | null>(null)
  const [destination, setDestination] = useState<StopRef | null>(null)
  const [walkMinutes, setWalkMinutes] = useState(8)

  const finish = async () => {
    if (origin === null || destination === null) return
    await saveRoute({
      id: crypto.randomUUID(),
      label: `${origin.name} – ${destination.name}`,
      origin,
      destination,
      walkSeconds: walkMinutes * 60,
      note: '',
    })
    onDone()
  }

  return (
    <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header class="safe-top pb-6">
        <h1 class="text-2xl font-bold">{t('onboarding.welcome')}</h1>
        <p class="mt-1 text-sm text-muted">{t('onboarding.intro')}</p>
      </header>

      <main class="flex-1">
        {step === 'origin' && (
          <StopPicker
            key="origin"
            label={t('onboarding.originLabel')}
            offerLocation
            onPick={(stop) => {
              setOrigin(stop)
              setStep('destination')
            }}
          />
        )}

        {step === 'destination' && (
          <StopPicker
            key="destination"
            label={t('onboarding.destinationLabel')}
            offerLocation={false}
            onPick={(stop) => {
              setDestination(stop)
              setStep('walk')
            }}
          />
        )}

        {step === 'walk' && (
          <div class="animate-rise">
            <h2 class="text-lg font-semibold">{t('onboarding.walkLabel')}</h2>
            <p class="mt-1 text-sm text-muted">{t('onboarding.walkHint')}</p>

            <p class="mt-8 text-center text-5xl font-bold">
              {walkMinutes}
              <span class="ml-2 text-xl font-medium text-muted">{t('now.minutes')}</span>
            </p>

            <input
              type="range"
              min={1}
              max={30}
              value={walkMinutes}
              aria-label={t('onboarding.walkLabel')}
              onInput={(event) => setWalkMinutes(Number((event.target as HTMLInputElement).value))}
              class="mt-6 w-full accent-[var(--accent)]"
            />
          </div>
        )}
      </main>

      <footer class="safe-bottom flex gap-3 pt-4">
        {step !== 'origin' && (
          <button
            type="button"
            onClick={() => setStep(step === 'walk' ? 'destination' : 'origin')}
            class="min-h-[var(--tap)] flex-1 rounded-[var(--radius-card)] border border-line px-4 font-semibold"
          >
            {t('onboarding.back')}
          </button>
        )}
        {step === 'walk' && (
          <button
            type="button"
            onClick={() => void finish()}
            class="min-h-[var(--tap)] flex-[2] rounded-[var(--radius-card)] bg-accent px-4 font-semibold text-on-accent"
          >
            {t('onboarding.finish')}
          </button>
        )}
      </footer>
    </div>
  )
}

function StopPicker({
  label,
  offerLocation,
  onPick,
}: {
  label: string
  offerLocation: boolean
  onPick: (stop: StopRef) => void
}) {
  const t = translate.value
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StopRef[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'locating' | 'denied' | 'failed'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setStatus('idle')
      return
    }

    // Debounced: the API allows 3 requests a second, and a keystroke-per-request
    // search would exceed that on any normal typing speed.
    const timer = setTimeout(() => {
      abortRef.current?.abort(new Error('superseded'))
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('searching')

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
        stopsNear(opendataDeps, {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        })
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

  return (
    <div class="animate-rise">
      <h2 class="text-lg font-semibold">{label}</h2>

      <input
        type="search"
        value={query}
        autocomplete="off"
        placeholder={t('onboarding.searchPlaceholder')}
        aria-label={label}
        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
        class="mt-4 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line bg-surface px-4 text-base"
      />

      {offerLocation && (
        <button
          type="button"
          onClick={useLocation}
          class="mt-2 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line px-4 text-sm font-semibold text-accent"
        >
          {status === 'locating' ? t('onboarding.locating') : t('onboarding.useLocation')}
        </button>
      )}

      <p class="mt-3 min-h-5 text-sm text-muted" role="status">
        {status === 'denied' && t('onboarding.locationDenied')}
        {status === 'failed' && t('onboarding.searchFailed')}
        {status === 'idle' && query.trim().length >= 2 && results.length === 0
          ? t('onboarding.noResults')
          : ''}
      </p>

      <ul class="mt-1 space-y-1">
        {results.slice(0, 8).map((stop, index) => (
          <li key={stop.id} class="animate-rise" style={{ animationDelay: `${index * 30}ms` }}>
            <button
              type="button"
              onClick={() => onPick(stop)}
              class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] px-3 text-left hover:bg-sunken"
            >
              {stop.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

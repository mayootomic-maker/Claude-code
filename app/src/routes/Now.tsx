/**
 * The Now screen.
 *
 * Opens with zero input and answers one question: when do I need to leave?
 * Every other element on the screen is subordinate to that number.
 *
 * Direction is inferred from the time of day. Background geolocation does not
 * exist in a PWA, so GPS cannot be part of this decision — time-of-day is the
 * signal that is actually available, with a one-tap flip when it guesses wrong.
 */

import { useMemo, useState } from 'preact/hooks'
import { countdown, formatClock, localParts, minutesFromSeconds, pickDeparture } from '../lib/time'
import { clock, useDepartureBoard, useOnline, useTick, pollIntervalMs } from '../lib/live'
import { routes, t as translate } from '../lib/store'
import { Countdown, CountdownAnnouncer } from '../ui/Countdown'
import { Banner, DelayBadge, formatAge } from '../ui/status'
import type { Departure, SavedRoute } from '../lib/types'
import type { Translate } from '../lib/i18n'

/** Morning runs outbound; from midday onward, inbound. */
function inferDirection(now: number): 'outbound' | 'inbound' {
  const { hour } = localParts(now)
  return hour < 12 ? 'outbound' : 'inbound'
}

export function Now() {
  const t = translate.value
  const route = routes.value[0]

  const [flipped, setFlipped] = useState(false)
  const online = useOnline()
  const tick = useTick(true)

  const direction = useMemo(() => {
    const inferred = inferDirection(clock.now())
    if (!flipped) return inferred
    return inferred === 'outbound' ? 'inbound' : 'outbound'
    // Recomputed on each tick so it flips over midday on its own.
  }, [flipped, Math.floor(tick / 60_000)])

  if (route === undefined) return null

  const origin = direction === 'outbound' ? route.origin : route.destination
  const destination = direction === 'outbound' ? route.destination : route.origin

  return (
    <NowForStop
      key={origin.id}
      route={route}
      originId={origin.id}
      originName={origin.name}
      destinationName={destination.name}
      onFlip={() => setFlipped((f) => !f)}
      online={online}
      now={tick}
      t={t}
    />
  )
}

type StopProps = {
  route: SavedRoute
  originId: string
  originName: string
  destinationName: string
  onFlip: () => void
  online: boolean
  now: number
  t: Translate
}

function NowForStop({ route, originId, originName, destinationName, onFlip, online, now, t }: StopProps) {
  // Poll cadence follows urgency, but urgency comes from the board — so we seed
  // a slow poll and tighten it once we know. We store the *bucketed interval*
  // rather than the raw seconds: seconds change every tick, whereas the bucket
  // changes a handful of times per session, so this settles instead of
  // re-running the fetch effect on every render.
  const [intervalMs, setIntervalMs] = useState(() => pollIntervalMs(null))
  const state = useDepartureBoard(originId, intervalMs)

  const board = state.board
  const picked = board === null ? null : pickDeparture(board.departures, now)

  const leading = picked?.departure ?? null
  const leadingState = leading === null ? null : countdown(leading.timing, route.walkSeconds, now)

  const urgencySeconds =
    leadingState?.kind === 'counting' ? leadingState.secondsUntilLeave : leadingState === null ? null : 0
  const desiredInterval = pollIntervalMs(urgencySeconds)
  if (desiredInterval !== intervalMs) setIntervalMs(desiredInterval)

  const followUps =
    board === null || picked === null ? [] : board.departures.slice(picked.index + 1, picked.index + 4)

  // Cancelled services are skipped when choosing what to lead with, but they
  // must not disappear: if your usual train is cancelled, being shown a
  // different one with no explanation is worse than useless. Anything skipped
  // on the way to the leading departure is surfaced here.
  const skippedCancelled =
    board === null || picked === null
      ? []
      : board.departures.slice(0, picked.index).filter((d) => d.timing.cancelled)

  const age = board === null ? 0 : now - board.fetchedAt
  const stale = age > 120_000

  return (
    <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header class="safe-top flex items-baseline justify-between gap-3 pb-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-muted">{originName}</p>
          <p class="truncate text-xs text-faint">{t('now.toward', { destination: destinationName })}</p>
        </div>
        <button
          type="button"
          onClick={onFlip}
          class="min-h-[var(--tap)] shrink-0 rounded-full px-3 text-sm font-semibold text-accent"
        >
          {t('now.flip')}
        </button>
      </header>

      {skippedCancelled.length > 0 && (
        <div class="space-y-2 pt-1">
          {skippedCancelled.map((departure) => (
            <Banner
              key={departure.key}
              tone="error"
              title={t('now.cancelledSkipped', {
                line: departure.line,
                time: formatClock(departure.timing.scheduled),
              })}
              detail={t('now.cancelledSkippedHint')}
            />
          ))}
        </div>
      )}

      <main class="flex flex-1 flex-col justify-center py-6">
        {state.loading && board === null ? (
          <LoadingSkeleton label={t('state.loading')} />
        ) : board === null ? (
          <Banner
            tone="error"
            title={t('state.error')}
            detail={t('state.errorHint')}
            action={{ label: t('state.retry'), onClick: state.refresh }}
          />
        ) : leading === null || leadingState === null ? (
          <Banner tone="info" title={t('now.nothingLeft')} detail={t('now.nothingLeftHint')} />
        ) : (
          <Lead departure={leading} state={leadingState} t={t} />
        )}
      </main>

      <div class="space-y-2 pb-3">
        {!online && (
          <Banner
            tone="warn"
            title={t('state.offline')}
            detail={t('state.offlineHint', { age: formatAge(age, t) })}
          />
        )}
        {online && stale && board !== null && (
          <Banner tone="warn" title={t('state.stale', { age: formatAge(age, t) })} />
        )}
        {online && state.error !== null && board !== null && (
          <Banner
            tone="warn"
            title={t('state.error')}
            detail={t('state.stale', { age: formatAge(age, t) })}
            action={{ label: t('state.retry'), onClick: state.refresh }}
          />
        )}
        {state.usedFallback && <Banner tone="info" title={t('state.usingFallback')} />}
        {state.dropped > 0 && (
          <Banner tone="info" title={t('state.droppedSome', { count: state.dropped })} />
        )}
      </div>

      {followUps.length > 0 && (
        <section class="safe-bottom border-t border-line pt-3">
          <h2 class="pb-2 text-xs font-semibold tracking-wide text-faint uppercase">
            {t('now.nextUp')}
          </h2>
          <ul class="space-y-1">
            {followUps.map((departure, index) => (
              <li
                key={departure.key}
                class="animate-rise flex items-center gap-3 py-1.5"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <span class="w-16 shrink-0 text-sm font-semibold">{departure.line}</span>
                <span class="min-w-0 flex-1 truncate text-sm text-muted">{departure.destination}</span>
                <DelayBadge timing={departure.timing} t={t} compact />
                <span class="w-12 shrink-0 text-right text-sm font-medium">
                  {formatClock(departure.timing.actual)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Lead({
  departure,
  state,
  t,
}: {
  departure: Departure
  state: ReturnType<typeof countdown>
  t: Translate
}) {
  if (state.kind === 'cancelled') {
    return <Banner tone="error" title={t('now.cancelled')} detail={t('now.cancelledHint')} />
  }
  if (state.kind === 'departed') {
    return <Banner tone="info" title={t('now.nothingLeft')} detail={t('now.nothingLeftHint')} />
  }

  const minutes = state.kind === 'counting' ? minutesFromSeconds(state.secondsUntilLeave) : 0
  const departsIn = minutesFromSeconds(state.secondsUntilDeparture)

  return (
    <div>
      {state.kind === 'go-now' ? (
        <>
          <p class="animate-pulse-soft text-[3.25rem] leading-tight font-bold text-late">
            {t('now.goNow')}
          </p>
          <p class="mt-1 text-base text-muted">{t('now.goNowHint', { min: departsIn })}</p>
          <CountdownAnnouncer minutes={departsIn} text={`${t('now.goNow')} — ${t('now.goNowHint', { min: departsIn })}`} />
        </>
      ) : (
        <>
          <p class="pb-1 text-sm font-medium tracking-wide text-muted uppercase">{t('now.leaveIn')}</p>
          <Countdown seconds={state.secondsUntilLeave} label={t('now.minutes')} tone={minutes <= 2 ? 'urgent' : 'normal'} />
          <CountdownAnnouncer
            minutes={minutes}
            text={`${t('now.leaveIn')} ${minutes} ${t('now.minutes')}`}
          />
        </>
      )}

      <div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span class="text-lg font-semibold">{departure.line}</span>
        <span class="min-w-0 flex-1 truncate text-base text-muted">{departure.destination}</span>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
        <span>{t('now.departsAt', { time: formatClock(departure.timing.actual) })}</span>
        {departure.platform !== null && <span>{t('now.platform', { platform: departure.platform })}</span>}
        <DelayBadge timing={departure.timing} t={t} />
      </div>
    </div>
  )
}

function LoadingSkeleton({ label }: { label: string }) {
  // Matches the real layout's dimensions exactly so nothing shifts when data
  // lands — a skeleton that reflows is worse than no skeleton.
  return (
    <div class="animate-pulse-soft" role="status" aria-label={label}>
      <div class="h-4 w-24 rounded bg-sunken" />
      <div class="mt-3 h-[4.7rem] w-40 rounded bg-sunken" />
      <div class="mt-5 h-6 w-56 rounded bg-sunken" />
      <div class="mt-2 h-4 w-44 rounded bg-sunken" />
    </div>
  )
}

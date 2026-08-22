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

import { useEffect, useMemo, useState } from 'preact/hooks'
import { countdown, formatClock, localParts, minutesFromSeconds, pickDeparture } from '../lib/time'
import { clock, useDepartureBoard, useOnline, useTick, pollIntervalMs } from '../lib/live'
import {
  clearActiveTrip,
  currentTrip,
  logRide,
  markIntendedTrip,
  routes,
  t as translate,
} from '../lib/store'
import { tripKey as buildTripKey } from '../lib/inspections'
import { InspectionPanel } from '../ui/InspectionPanel'
import { TicketView } from '../ui/TicketView'
import { Countdown, CountdownAnnouncer } from '../ui/Countdown'
import { Banner, DelayBadge, OccupancyChip, formatAge } from '../ui/status'
import { LineBadge } from '../ui/LineBadge'
import type { ActiveTrip, Departure, Direction, SavedRoute } from '../lib/types'
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
      direction={direction}
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
  direction: Direction
  t: Translate
}

function NowForStop({
  route,
  originId,
  originName,
  destinationName,
  onFlip,
  online,
  now,
  direction,
  t,
}: StopProps) {
  const [showTicket, setShowTicket] = useState(false)
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

  const destinationId = direction === 'outbound' ? route.destination.id : route.origin.id

  // The train you are on, if its departure has passed and it is still within
  // the journey window. This is the key to the inspection log being correct:
  // mid-journey the board below shows the *next* train, so logging against
  // that would attach the inspection to a train you were never on.
  const onBoard = currentTrip(now)

  // Remember the departure being counted down to, so it can be recognised as
  // the boarded train after it leaves — including across an app close, which
  // is the normal case.
  useEffect(() => {
    if (leading === null) return
    void markIntendedTrip({
      tripKey: buildTripKey({
        line: leading.line,
        routeId: route.id,
        direction,
        scheduled: leading.timing.scheduled,
      }),
      routeId: route.id,
      direction,
      line: leading.line,
      destination: leading.destination,
      ...(leading.category === '' ? {} : { category: leading.category }),
      departedAt: leading.timing.actual,
      segment: [originId, destinationId],
    }, now)
    // Deliberately not keyed on `now`: this fires when the leading departure
    // changes, not every tick.
  }, [leading?.key, leading?.timing.actual, onBoard === null])

  // The ride is logged once you are actually on board, not when the app is
  // merely opened. recordRide dedupes per service day, so this is idempotent.
  useEffect(() => {
    if (onBoard === null) return
    void logRide({
      ts: now,
      tripKey: onBoard.tripKey,
      routeId: onBoard.routeId,
      direction: onBoard.direction,
      ...(onBoard.category === undefined ? {} : { category: onBoard.category }),
      hour: localParts(onBoard.departedAt).hour,
    })
    // Keyed on the trip, not on `now`: once per trip, not once per tick.
  }, [onBoard?.tripKey])

  return (
    <div class="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-md flex-col px-5">
      <header class="safe-top flex items-baseline justify-between gap-3 pb-2">
        <div class="min-w-0">
          <p class="truncate text-base font-semibold">{originName}</p>
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

      {board !== null && board.situations.length > 0 && (
        <div class="space-y-2 pt-1">
          {board.situations.slice(0, 2).map((situation) => (
            <Banner
              key={situation.id}
              tone="warn"
              title={situation.summary}
              {...(situation.detail === null ? {} : { detail: situation.detail })}
            />
          ))}
        </div>
      )}

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

      <main class="pt-6">
        {onBoard !== null ? (
          <OnBoardHero trip={onBoard} onNotThisTrain={() => void clearActiveTrip()} t={t} />
        ) : state.loading && board === null ? (
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

      <div class="space-y-2 pt-3">
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

      {(onBoard !== null || leading !== null) && (
        <InspectionPanel
          tripKey={
            onBoard !== null
              ? onBoard.tripKey
              : buildTripKey({
                  line: leading?.line ?? '',
                  routeId: route.id,
                  direction,
                  scheduled: leading?.timing.scheduled ?? now,
                })
          }
          routeId={route.id}
          direction={onBoard?.direction ?? direction}
          segment={onBoard?.segment ?? [originId, destinationId]}
          category={onBoard?.category ?? leading?.category}
          now={now}
          onShowTicket={() => setShowTicket(true)}
        />
      )}

      {showTicket && <TicketView onClose={() => setShowTicket(false)} />}

      {followUps.length > 0 && (
        <section class="safe-bottom mt-auto pt-5">
          <h2 class="pb-2 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
            {t('now.nextUp')}
          </h2>
          <ul class="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {followUps.map((departure, index) => (
              <li
                key={departure.key}
                class="animate-rise flex items-center gap-3 px-3 py-2"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <LineBadge line={departure.line} category={departure.category} size="sm" />
                <span class="min-w-0 flex-1 truncate text-sm">{departure.destination}</span>
                <DelayBadge timing={departure.timing} t={t} compact />
                <span class="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
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

  // OJP publishes which side the doors open. Worth surfacing: it decides where
  // you stand, and no other app on the platform tells you.
  const exitSide = departure.attributes.find((a) => a.startsWith('Aussteigeseite')) ?? null

  return (
    <div>
      {state.kind === 'go-now' ? (
        <div>
          <p class="animate-pulse-soft text-[3.5rem] leading-[1.05] font-bold tracking-tight text-late">
            {t('now.goNow')}
          </p>
          <p class="mt-1 text-base text-muted">{t('now.goNowHint', { min: departsIn })}</p>
          <CountdownAnnouncer
            minutes={departsIn}
            text={`${t('now.goNow')} — ${t('now.goNowHint', { min: departsIn })}`}
          />
        </div>
      ) : (
        <div>
          <p class="pb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            {t('now.leaveIn')}
          </p>
          <Countdown
            seconds={state.secondsUntilLeave}
            label={t('now.minutes')}
            tone={minutes <= 2 ? 'urgent' : 'normal'}
          />
          <CountdownAnnouncer
            minutes={minutes}
            text={`${t('now.leaveIn')} ${minutes} ${t('now.minutes')}`}
          />
        </div>
      )}

      {/* The departure sits on its own surface directly beneath the number, so
          the two read as one block rather than as text adrift on the page. */}
      <section class="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div class="flex items-center gap-2.5">
          <LineBadge line={departure.line} category={departure.category} size="lg" />
          <span class="min-w-0 flex-1 truncate text-lg font-semibold">{departure.destination}</span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
          <span class="font-medium text-ink">{formatClock(departure.timing.actual)}</span>
          {departure.platform !== null && (
            <span>{t('now.platform', { platform: departure.platform })}</span>
          )}
          <DelayBadge timing={departure.timing} t={t} />
        </div>

        {(departure.occupancy.length > 0 || exitSide !== null) && (
          <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
            <OccupancyChip occupancy={departure.occupancy} t={t} />
            {exitSide !== null && <span class="text-sm text-muted">{exitSide}</span>}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Shown while a journey is under way.
 *
 * Replaces the leave-by countdown rather than sitting alongside it: telling
 * someone to leave in twelve minutes while they are already on the train is a
 * contradiction, and the next departure is still listed below.
 */
function OnBoardHero({
  trip,
  onNotThisTrain,
  t,
}: {
  trip: ActiveTrip
  onNotThisTrain: () => void
  t: Translate
}) {
  return (
    <div class="animate-rise">
      <p class="pb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
        {t('onboard.title')}
      </p>

      <section class="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div class="flex items-center gap-3">
          <LineBadge line={trip.line} category={trip.category ?? ''} size="lg" />
          <span class="min-w-0 flex-1 truncate text-xl font-semibold">{trip.destination}</span>
        </div>

        <div class="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
          <p class="text-sm text-muted">
            {t('onboard.since', { time: formatClock(trip.departedAt) })}
          </p>
          <button
            type="button"
            // An escape hatch: you checked the app, then took a different
            // train. Without this the log would quietly record a ride you
            // never took.
            onClick={onNotThisTrain}
            class="min-h-[var(--tap)] shrink-0 text-sm font-semibold text-accent"
          >
            {t('onboard.notMyTrain')}
          </button>
        </div>
      </section>
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

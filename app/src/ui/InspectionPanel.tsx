/**
 * Inspection likelihood, capture, and the ticket shortcut.
 *
 * Calm by default. The estimate is a small chip, not an alarm — you are being
 * told to have your ticket handy, not warned of danger. When the odds are
 * elevated the ticket shortcut promotes itself, because that is the action
 * that actually helps.
 *
 * The estimate pools across everything you have logged, so it is useful from
 * the first ride rather than after eight on one train. What it currently rests
 * on — your seeded guess, this category of service, or this specific train —
 * is always stated, because those carry very different weight.
 */

import { useState } from 'preact/hooks'
import { predict, type Prediction } from '../lib/inspections'
import { log, logInspection, settings, t as translate } from '../lib/store'
import { serviceDayOfWeek } from '../lib/time'
import type { Direction } from '../lib/types'

/** Above this, the ticket shortcut becomes the primary action. */
const ELEVATED_PROBABILITY = 0.2

export function InspectionPanel({
  tripKey,
  routeId,
  direction,
  segment,
  category,
  now,
  onShowTicket,
}: {
  tripKey: string
  routeId: string
  direction: Direction
  segment: [string, string] | null
  /** Product category of the train, so the estimate can pool across services. */
  category: string | undefined
  now: number
  onShowTicket: () => void
}) {
  const t = translate.value
  const [justLogged, setJustLogged] = useState(false)
  const [showStats, setShowStats] = useState(false)

  const prediction = predict(
    log.value,
    { tripKey, ...(category === undefined ? {} : { category }) },
    now,
    {
      ...(settings.value.inspectionPrior === null ? {} : { prior: settings.value.inspectionPrior }),
      forWeekday: serviceDayOfWeek(now),
    },
  )
  const elevated = prediction.probability >= ELEVATED_PROBABILITY

  const capture = async () => {
    await logInspection({
      ts: now,
      tripKey,
      routeId,
      direction,
      segment,
      note: '',
      ...(category === undefined ? {} : { category }),
    })
    setJustLogged(true)
    setTimeout(() => setJustLogged(false), 2000)
  }

  return (
    <section class="mt-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
      <button
        type="button"
        onClick={() => setShowStats((s) => !s)}
        aria-expanded={showStats}
        class="flex min-h-[var(--tap)] w-full items-center gap-2 text-left"
      >
        <span class="min-w-0 flex-1 text-sm text-muted">
          <Summary prediction={prediction} />
        </span>
        <span class="shrink-0 text-xs text-faint" aria-hidden="true">
          {showStats ? '▾' : '▸'}
        </span>
      </button>

      {showStats && <Stats prediction={prediction} category={category} />}

      <div class="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onShowTicket}
          class={`min-h-[var(--tap)] flex-1 rounded-[var(--radius-card)] px-4 text-sm font-semibold ${
            elevated
              ? 'bg-accent text-on-accent'
              : 'border border-line text-ink'
          }`}
        >
          {t('insp.showTicket')}
        </button>

        <button
          type="button"
          onClick={() => void capture()}
          // One tap, large target. If logging costs more than this you stop
          // doing it within a week and the whole feature dies.
          class="min-h-[var(--tap)] flex-1 rounded-[var(--radius-card)] border border-line px-4 text-sm font-semibold text-muted"
        >
          {justLogged ? `✓ ${t('insp.logged')}` : t('insp.button')}
        </button>
      </div>
    </section>
  )
}

function Summary({ prediction }: { prediction: Prediction }) {
  const t = translate.value

  if (prediction.probability === 0) return <>{t('insp.never')}</>

  return (
    <>
      {t('insp.estimate', { oneIn: prediction.oneIn })}
      {prediction.hotSegment !== null && (
        <span class="text-faint">
          {' · '}
          {t('insp.hotSegment', {
            from: prediction.hotSegment.from,
            to: prediction.hotSegment.to,
          })}
        </span>
      )}
    </>
  )
}

function Stats({ prediction, category }: { prediction: Prediction; category: string | undefined }) {
  const t = translate.value

  // Says plainly what the number rests on. An estimate carried mostly by the
  // prior is a different thing from one built on thirty logged rides, and
  // presenting them identically would overstate the second-hand one.
  const basis =
    prediction.basis === 'trip'
      ? t('insp.basisTrip', {
          inspections: prediction.tripInspections,
          rides: prediction.tripRides,
        })
      : prediction.basis === 'category' && category !== undefined && prediction.categoryRides > 0
        ? t('insp.basisCategory', { rides: prediction.categoryRides, category })
        : prediction.basis === 'category'
          ? t('insp.basisAll', { rides: prediction.totalRides })
          : t('insp.basisPrior')

  return (
    <div class="animate-rise pt-2 text-sm text-muted">
      <p>{basis}</p>
      {prediction.weekdayNote === 'higher' && <p>{t('insp.weekdayHigher')}</p>}
      {prediction.weekdayNote === 'lower' && <p>{t('insp.weekdayLower')}</p>}
      {/* Always visible: this is a personal statistic, not a live radar, and
          the difference matters for how much you trust it. */}
      <p class="pt-1 text-xs text-faint">{t('insp.disclaimer')}</p>
    </div>
  )
}

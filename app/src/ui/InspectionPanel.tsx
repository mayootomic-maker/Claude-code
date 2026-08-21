/**
 * Inspection likelihood, capture, and the ticket shortcut.
 *
 * Calm by default. The estimate is a small chip, not an alarm — you are being
 * told to have your ticket handy, not warned of danger. When the odds are
 * elevated the ticket shortcut promotes itself, because that is the action
 * that actually helps.
 *
 * Below the confidence threshold this says "not enough data" and shows no
 * percentage. A number derived from three rides would be invented confidence.
 */

import { useState } from 'preact/hooks'
import { MIN_RIDES_FOR_ESTIMATE, predict, type Prediction } from '../lib/inspections'
import { log, logInspection, t as translate } from '../lib/store'
import { serviceDayOfWeek } from '../lib/time'
import type { Direction } from '../lib/types'

/** Above this, the ticket shortcut becomes the primary action. */
const ELEVATED_PROBABILITY = 0.2

export function InspectionPanel({
  tripKey,
  routeId,
  direction,
  segment,
  now,
  onShowTicket,
}: {
  tripKey: string
  routeId: string
  direction: Direction
  segment: [string, string] | null
  now: number
  onShowTicket: () => void
}) {
  const t = translate.value
  const [justLogged, setJustLogged] = useState(false)
  const [showStats, setShowStats] = useState(false)

  const prediction = predict(log.value, tripKey, now, serviceDayOfWeek(now))
  const elevated = prediction.kind === 'estimate' && prediction.probability >= ELEVATED_PROBABILITY

  const capture = async () => {
    await logInspection({ ts: now, tripKey, routeId, direction, segment, note: '' })
    setJustLogged(true)
    setTimeout(() => setJustLogged(false), 2000)
  }

  return (
    <section class="border-t border-line pt-3">
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

      {showStats && <Stats prediction={prediction} />}

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

  if (prediction.kind === 'insufficient') {
    return (
      <>
        {t('insp.insufficient')}
        {' · '}
        <span class="text-faint">
          {t('insp.insufficientHint', { missing: MIN_RIDES_FOR_ESTIMATE - prediction.rides })}
        </span>
      </>
    )
  }

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

function Stats({ prediction }: { prediction: Prediction }) {
  const t = translate.value

  return (
    <div class="animate-rise pt-2 text-sm text-muted">
      {prediction.kind === 'estimate' ? (
        <>
          <p>
            {t('insp.basis', { inspections: prediction.inspections, rides: prediction.rides })}
          </p>
          {prediction.weekdayNote === 'higher' && <p>{t('insp.weekdayHigher')}</p>}
          {prediction.weekdayNote === 'lower' && <p>{t('insp.weekdayLower')}</p>}
        </>
      ) : (
        <p>{t('insp.noneLogged')}</p>
      )}
      {/* Always visible: this is a personal statistic, not a live radar, and
          the difference matters for how much you trust it. */}
      <p class="pt-1 text-xs text-faint">{t('insp.disclaimer')}</p>
    </div>
  )
}

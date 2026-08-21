/**
 * Status display primitives.
 *
 * The governing rule: unknown is never rendered as fine. A departure with no
 * realtime feed shows as "no live data", not as "on time", because those lead
 * to different decisions about when to leave.
 */

import type { DepartureTiming } from '../lib/time'
import { hasRealtime } from '../lib/time'
import type { Translate } from '../lib/i18n'

/** Delay severity as a continuous ramp rather than three buckets. */
function delayTone(minutes: number): string {
  if (minutes <= 0) return 'text-ok'
  if (minutes < 3) return 'text-warn'
  if (minutes < 10) return 'text-late'
  return 'text-critical'
}

export function DelayBadge({
  timing,
  t,
  compact = false,
}: {
  timing: DepartureTiming
  t: Translate
  /** Icon-only rendering for the narrow follow-up rows, where the full label
   *  would crowd out the destination name. */
  compact?: boolean
}) {
  if (timing.cancelled) {
    return (
      <span class="inline-flex items-center gap-1 rounded-full bg-critical/12 px-2 py-0.5 text-sm font-medium text-critical">
        <Icon kind="cancelled" />
        {t('now.cancelled')}
      </span>
    )
  }

  if (!hasRealtime(timing)) {
    // Never a colour that could read as "fine".
    const label = t('now.noRealtime')
    return (
      <span
        class={`inline-flex items-center gap-1 rounded-full bg-sunken text-sm font-medium text-faint ${
          compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
        }`}
        title={label}
        aria-label={label}
      >
        <Icon kind="unknown" />
        {!compact && label}
      </span>
    )
  }

  const minutes = timing.delayMinutes ?? 0
  if (minutes <= 0) {
    return (
      <span class={`inline-flex items-center gap-1 text-sm font-medium ${delayTone(0)}`}>
        <Icon kind="ok" />
        {t('now.onTime')}
      </span>
    )
  }

  return (
    <span
      // Re-keyed on the delay value so a change nudges rather than silently
      // swapping. Transform-only: the row never reflows.
      key={minutes}
      class={`animate-nudge inline-flex items-center gap-1 text-sm font-semibold ${delayTone(minutes)}`}
    >
      <Icon kind="late" />
      {t('now.late', { min: minutes })}
    </span>
  )
}

/**
 * Icons paired with every semantic colour.
 *
 * Colour alone would fail for the ~8% of men with a colour-vision deficiency,
 * and washes out in direct sunlight on a platform — which is exactly where this
 * app gets read.
 */
function Icon({ kind }: { kind: 'ok' | 'late' | 'unknown' | 'cancelled' }) {
  const paths: Record<typeof kind, string> = {
    ok: 'M3.5 8.5l3 3 6-6.5',
    late: 'M8 4.5v4l2.5 1.5M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z',
    unknown: 'M8 11.5v.01M8 9c0-1.5 1.8-1.7 1.8-3.2A1.8 1.8 0 006.2 5.4',
    cancelled: 'M5 5l6 6M11 5l-6 6',
  }
  return (
    <svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <path d={paths[kind]} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  )
}

/** Relative age, for "as of" labels on stale data. */
export function formatAge(ms: number, t: Translate): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { min: minutes })
  return t('time.hoursAgo', { h: Math.floor(minutes / 60) })
}

export type BannerTone = 'info' | 'warn' | 'error'

export function Banner({
  tone,
  title,
  detail,
  action,
}: {
  tone: BannerTone
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
}) {
  const tones: Record<BannerTone, string> = {
    info: 'bg-sunken text-muted',
    warn: 'bg-warn/12 text-warn',
    error: 'bg-critical/12 text-critical',
  }

  return (
    <div class={`animate-rise flex items-start gap-3 rounded-[var(--radius-card)] px-4 py-3 ${tones[tone]}`} role="status">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{title}</p>
        {detail !== undefined && <p class="mt-0.5 text-sm opacity-90">{detail}</p>}
      </div>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          class="min-h-[var(--tap)] shrink-0 px-2 text-sm font-semibold underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * Your inspection history.
 *
 * Charts are hand-rolled SVG. A charting library would cost more than the whole
 * app and this needs two bar charts; the CSS variables already carry the
 * palette, so these inherit light and dark for free.
 *
 * Bars show *rate*, but every one is labelled with the counts behind it. A
 * lone bar at 100% from a single ride would otherwise read as a strong signal.
 */

import { useEffect } from 'preact/hooks'
import { summarise, type HourStat, type WeekdayStat } from '../lib/inspections'
import { log, t as translate } from '../lib/store'
import type { Translate } from '../lib/i18n'

/** Monday first: a commuter's week, not a calendar's. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const WEEKDAY_LABELS: Record<string, readonly string[]> = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export function StatsSheet({ onClose, language }: { onClose: () => void; language: 'de' | 'en' }) {
  const t = translate.value
  const stats = summarise(log.value)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const weekdays = WEEKDAY_ORDER.map((d) => stats.byWeekday[d]).filter(
    (d): d is WeekdayStat => d !== undefined,
  )
  const labels = WEEKDAY_LABELS[language] ?? WEEKDAY_LABELS['de'] ?? []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('stats.title')}
      class="fixed inset-0 z-50 flex flex-col bg-bg"
    >
      <div class="mx-auto w-full max-w-md flex-1 overflow-y-auto px-5">
        <header class="safe-top pb-4">
          <h2 class="text-2xl font-bold tracking-tight">{t('stats.title')}</h2>
        </header>

        {stats.totalRides === 0 ? (
          <div class="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p class="font-medium">{t('stats.empty')}</p>
            <p class="mt-1 text-sm text-muted">{t('stats.emptyHint')}</p>
          </div>
        ) : (
          <>
            <section class="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p class="text-lg font-semibold">
                {t('stats.totals', {
                  inspections: stats.totalInspections,
                  rides: stats.totalRides,
                })}
              </p>
              <p class="mt-1 text-sm text-muted">{t('stats.trips', { trips: stats.trips })}</p>
              {stats.since !== null && (
                <p class="text-sm text-muted">
                  {t('stats.since', {
                    date: new Date(stats.since).toLocaleDateString(
                      language === 'de' ? 'de-CH' : 'en-GB',
                      { day: 'numeric', month: 'long', year: 'numeric' },
                    ),
                  })}
                </p>
              )}
            </section>

            <Chart
              title={t('stats.byWeekday')}
              t={t}
              bars={weekdays.map((d) => ({
                label: labels[d.weekday] ?? '',
                rides: d.rides,
                inspections: d.inspections,
              }))}
            />

            {stats.byHour.length > 0 && (
              <Chart
                title={t('stats.byHour')}
                t={t}
                bars={stats.byHour.map((h: HourStat) => ({
                  label: `${String(h.hour).padStart(2, '0')}`,
                  rides: h.rides,
                  inspections: h.inspections,
                }))}
              />
            )}
          </>
        )}
      </div>

      <div class="safe-bottom mx-auto w-full max-w-md px-5 pt-3">
        <button
          type="button"
          onClick={onClose}
          class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] bg-accent font-semibold text-on-accent"
        >
          {t('stats.close')}
        </button>
      </div>
    </div>
  )
}

type Bar = { label: string; rides: number; inspections: number }

function Chart({ title, bars, t }: { title: string; bars: Bar[]; t: Translate }) {
  // Scale to the highest observed rate, not to 1. A commute where the worst day
  // is 30% would otherwise render as seven barely-visible stubs.
  const rates = bars.map((b) => (b.rides === 0 ? 0 : b.inspections / b.rides))
  const peak = Math.max(0.1, ...rates)

  return (
    <section class="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 class="pb-3 text-xs font-semibold tracking-[0.08em] text-faint uppercase">{title}</h3>

      <div class="flex items-end justify-between gap-1.5" style={{ height: '5.5rem' }}>
        {bars.map((bar, index) => {
          const rate = rates[index] ?? 0
          const height = bar.rides === 0 ? 0 : Math.max(3, (rate / peak) * 100)
          return (
            <div key={bar.label} class="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span class="text-[0.6rem] font-medium text-faint tabular-nums">
                {bar.rides === 0 ? '' : `${Math.round(rate * 100)}%`}
              </span>
              <div
                class={`w-full rounded-sm ${bar.rides === 0 ? 'bg-sunken' : 'bg-accent'}`}
                style={{ height: `${Math.max(2, height)}%` }}
                // The count is what makes the bar interpretable: 1-of-1 and
                // 12-of-40 both render as tall bars but mean very different things.
                title={
                  bar.rides === 0
                    ? t('stats.noRides')
                    : t('stats.ratio', { inspections: bar.inspections, rides: bar.rides })
                }
              />
            </div>
          )
        })}
      </div>

      <div class="flex justify-between gap-1.5 pt-1.5">
        {bars.map((bar) => (
          <span key={bar.label} class="min-w-0 flex-1 text-center text-[0.65rem] text-muted tabular-nums">
            {bar.label}
          </span>
        ))}
      </div>

      {/* Counts in text as well as tooltips: a tooltip is unreachable on a
          touchscreen, which is the only device this runs on. */}
      <ul class="sr-only">
        {bars.map((bar) => (
          <li key={bar.label}>
            {bar.label}: {t('stats.ratio', { inspections: bar.inspections, rides: bar.rides })}
          </li>
        ))}
      </ul>
    </section>
  )
}

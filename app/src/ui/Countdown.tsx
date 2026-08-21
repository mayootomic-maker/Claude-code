/**
 * The app's dominant number.
 *
 * Each digit is its own element keyed by value, so only the digits that
 * actually change animate. Rolling the whole number every second would be
 * visual noise; rolling only the changed digit reads as a clock.
 */

import { minutesFromSeconds } from '../lib/time'

type Props = {
  seconds: number
  /** Announced to screen readers; the digits themselves are aria-hidden. */
  label: string
  tone?: 'normal' | 'urgent'
}

export function Countdown({ seconds, label, tone = 'normal' }: Props) {
  const minutes = minutesFromSeconds(seconds)
  const digits = String(minutes).split('')

  const color = tone === 'urgent' ? 'text-late' : 'text-ink'

  return (
    <div class="flex items-baseline gap-2">
      <div class={`flex ${color}`} aria-hidden="true">
        {digits.map((digit, index) => (
          <span
            // Keying on value *and* position restarts the animation only for the
            // digit that changed.
            key={`${index}-${digit}`}
            class="animate-digit inline-block text-[5.5rem] leading-[0.85] font-semibold tracking-tight"
          >
            {digit}
          </span>
        ))}
      </div>
      <span class="text-2xl font-medium text-muted" aria-hidden="true">
        {label}
      </span>
    </div>
  )
}

/**
 * Announces the countdown at meaningful moments only.
 *
 * A live region updated every second would read the number continuously and
 * make the screen unusable with a screen reader on. Announcing on the minute
 * conveys the same information.
 */
export function CountdownAnnouncer({ minutes, text }: { minutes: number; text: string }) {
  return (
    <p class="sr-only" role="status" aria-live="polite" key={minutes}>
      {text}
    </p>
  )
}

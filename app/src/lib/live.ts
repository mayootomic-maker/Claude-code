/**
 * Runtime wiring: the corrected clock, the failover breaker, and the polling
 * loop that feeds the Now screen.
 *
 * Polling is adaptive because a fixed interval is either wasteful or too slow.
 * When you have half an hour before you leave, a refresh every twenty seconds
 * burns battery for nothing; when you have four minutes, a sixty-second gap
 * means acting on a stale delay. It also stops entirely when the tab is hidden,
 * because a background PWA has no reason to poll.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { createClock } from './time'
import { Breaker, DEFAULT_BREAKER, runWithFailover, type Attempt } from './sources/failover'
import { fetchDepartureBoard, type OpendataDeps } from './sources/opendata'
import type { DepartureBoard } from './types'

export const clock = createClock()

const breakerOptions = { ...DEFAULT_BREAKER, now: () => Date.now() }
export const breaker = new Breaker(breakerOptions)

export const opendataDeps: OpendataDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  onResponseMeta: ({ serverDate, sentAt, receivedAt }) => {
    // Sync against raw device time: the correction is derived from the gap
    // between device and server, so feeding it corrected time would compound.
    clock.sync(serverDate, sentAt, receivedAt)
  },
}

/** Poll cadence, chosen from how soon the user must act. */
export function pollIntervalMs(secondsUntilLeave: number | null): number {
  if (secondsUntilLeave === null) return 60_000
  if (secondsUntilLeave <= 600) return 20_000
  if (secondsUntilLeave <= 1800) return 45_000
  return 90_000
}

// ---------------------------------------------------------------------------
// A ticking clock for the countdown
// ---------------------------------------------------------------------------

/**
 * Re-renders once a second, aligned to the second boundary.
 *
 * A naive `setInterval(1000)` drifts and eventually updates mid-second, which
 * makes the countdown appear to skip or repeat a number.
 */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(() => clock.now())

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout>

    const schedule = () => {
      const current = clock.now()
      setNow(current)
      timer = setTimeout(schedule, 1000 - (current % 1000))
    }
    schedule()

    return () => clearTimeout(timer)
  }, [active])

  return now
}

/** True while the document is visible; polling pauses when it is not. */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return visible
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => {
      removeEventListener('online', on)
      removeEventListener('offline', off)
    }
  }, [])

  return online
}

// ---------------------------------------------------------------------------
// Departure loading
// ---------------------------------------------------------------------------

export type BoardState = {
  board: DepartureBoard | null
  /** True only while there is nothing to show at all. */
  loading: boolean
  error: Error | null
  /** A fallback source answered, so the UI can say so. */
  usedFallback: boolean
  /** Departures that failed to parse and were dropped. */
  dropped: number
  refresh: () => void
}

async function loadBoard(stopId: string, signal: AbortSignal) {
  const attempts: Array<Attempt<Awaited<ReturnType<typeof fetchDepartureBoard>>>> = [
    {
      id: 'opendata',
      run: (innerSignal) => fetchDepartureBoard(opendataDeps, { stopId, signal: innerSignal }),
    },
    // The OJP adapter joins this list in Phase 3; the failover path around it is
    // already built and tested.
  ]
  return runWithFailover(attempts, breaker, breakerOptions, signal)
}

/**
 * Keeps a departure board fresh.
 *
 * On refresh failure the previous board is deliberately retained rather than
 * cleared: stale times with an honest "as of" label beat an empty screen, and
 * the caller renders that label.
 */
export function useDepartureBoard(stopId: string | null, intervalMs: number): BoardState {
  const [state, setState] = useState<Omit<BoardState, 'refresh'>>({
    board: null,
    loading: stopId !== null,
    error: null,
    usedFallback: false,
    dropped: 0,
  })

  const visible = useVisible()
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (stopId === null) {
      setState({ board: null, loading: false, error: null, usedFallback: false, dropped: 0 })
      return
    }
    if (!visible) return

    let cancelled = false

    const run = async () => {
      abortRef.current?.abort(new Error('superseded'))
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await loadBoard(stopId, controller.signal)
        if (cancelled) return
        const { dropped, ...board } = result.value
        setState({
          board,
          loading: false,
          error: null,
          usedFallback: result.usedFallback,
          dropped,
        })
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }))
      }
    }

    void run()
    const timer = setInterval(() => void run(), intervalMs)

    return () => {
      cancelled = true
      clearInterval(timer)
      abortRef.current?.abort(new Error('unmounted'))
    }
  }, [stopId, intervalMs, visible, nonce])

  return { ...state, refresh: () => setNonce((n) => n + 1) }
}

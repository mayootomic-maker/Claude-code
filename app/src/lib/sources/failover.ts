/**
 * Source failover.
 *
 * The primary source (transport.opendata.ch) is volunteer-run with no SLA. A
 * build that depends on it alone shows a blank screen on the morning it is
 * down — which is the morning you most need it. This runs an ordered list of
 * sources and takes the first that answers.
 *
 * Two behaviours matter beyond "try the next one":
 *
 *  - **Per-attempt timeout.** A hung connection is worse than a failed one,
 *    because it blocks the fallback that would have worked.
 *  - **Circuit breaker.** Once a source has failed, retrying it on every poll
 *    costs a full timeout each time. We skip it for a cooldown, so the app
 *    stays fast while the primary is down instead of pausing on every refresh.
 */

export type Attempt<T> = {
  id: string
  run: (signal: AbortSignal) => Promise<T>
}

export type FailoverResult<T> = {
  value: T
  /** Which attempt answered. */
  sourceId: string
  /** True when a fallback answered, so the UI can say which data it is showing. */
  usedFallback: boolean
}

export class AllSourcesFailedError extends Error {
  constructor(readonly failures: ReadonlyArray<{ id: string; error: unknown }>) {
    const detail = failures.map((f) => `${f.id}: ${describe(f.error)}`).join('; ')
    super(`every source failed — ${detail}`)
    this.name = 'AllSourcesFailedError'
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export type BreakerOptions = {
  /** How long a failing source stays skipped. */
  cooldownMs: number
  /** How long one attempt may take before it is abandoned. */
  timeoutMs: number
  now: () => number
}

export const DEFAULT_BREAKER: Omit<BreakerOptions, 'now'> = {
  cooldownMs: 60_000,
  timeoutMs: 6_000,
}

/** Tracks which sources are in cooldown. One instance per app session. */
export class Breaker {
  private openUntil = new Map<string, number>()

  constructor(private readonly options: BreakerOptions) {}

  isOpen(id: string): boolean {
    const until = this.openUntil.get(id)
    if (until === undefined) return false
    if (this.options.now() >= until) {
      this.openUntil.delete(id)
      return false
    }
    return true
  }

  recordFailure(id: string): void {
    this.openUntil.set(id, this.options.now() + this.options.cooldownMs)
  }

  recordSuccess(id: string): void {
    this.openUntil.delete(id)
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outer?.reason)
  outer?.addEventListener('abort', onOuterAbort, { once: true })

  const timer = setTimeout(() => {
    controller.abort(new Error(`timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * Runs attempts in order, returning the first success.
 *
 * If every source is in cooldown we still try them all rather than failing
 * outright — a stale breaker must never be the reason the user sees nothing.
 */
export async function runWithFailover<T>(
  attempts: ReadonlyArray<Attempt<T>>,
  breaker: Breaker,
  options: BreakerOptions,
  outerSignal?: AbortSignal,
): Promise<FailoverResult<T>> {
  const ready = attempts.filter((a) => !breaker.isOpen(a.id))
  const order = ready.length > 0 ? ready : attempts

  const failures: Array<{ id: string; error: unknown }> = []

  // Read through a function: the signal can be aborted between iterations, and
  // narrowing a property access would let the compiler assume it cannot change.
  const cancelled = (): boolean => outerSignal !== undefined && outerSignal.aborted

  for (let i = 0; i < order.length; i++) {
    const attempt = order[i]
    if (attempt === undefined) continue

    // An explicit cancel from the caller must not be retried against the
    // fallback — the user navigated away or a newer request superseded this one.
    if (cancelled()) throw outerSignal?.reason

    try {
      const value = await withTimeout(attempt.run, options.timeoutMs, outerSignal)
      breaker.recordSuccess(attempt.id)
      return { value, sourceId: attempt.id, usedFallback: i > 0 }
    } catch (error) {
      if (cancelled()) throw outerSignal?.reason
      breaker.recordFailure(attempt.id)
      failures.push({ id: attempt.id, error })
    }
  }

  throw new AllSourcesFailedError(failures)
}

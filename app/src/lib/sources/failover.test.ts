import { describe, expect, it, vi } from 'vitest'
import { AllSourcesFailedError, Breaker, runWithFailover, type Attempt } from './failover'

const options = (now: () => number) => ({ cooldownMs: 60_000, timeoutMs: 100, now })

const ok = (id: string, value: string): Attempt<string> => ({ id, run: async () => value })
const fail = (id: string, message = 'boom'): Attempt<string> => ({
  id,
  run: async () => {
    throw new Error(message)
  },
})

describe('runWithFailover', () => {
  it('uses the primary when it works and does not touch the fallback', async () => {
    const fallbackRun = vi.fn(async () => 'fallback')
    const opts = options(() => 0)

    const result = await runWithFailover(
      [ok('opendata', 'primary'), { id: 'ojp', run: fallbackRun }],
      new Breaker(opts),
      opts,
    )

    expect(result.value).toBe('primary')
    expect(result.usedFallback).toBe(false)
    expect(fallbackRun).not.toHaveBeenCalled()
  })

  it('falls back when the primary fails, and flags that it did', async () => {
    const opts = options(() => 0)
    const result = await runWithFailover(
      [fail('opendata'), ok('ojp', 'fallback')],
      new Breaker(opts),
      opts,
    )

    expect(result.value).toBe('fallback')
    expect(result.sourceId).toBe('ojp')
    expect(result.usedFallback).toBe(true)
  })

  it('falls back when the primary hangs, rather than blocking on it', async () => {
    const opts = options(() => 0)
    const hang: Attempt<string> = {
      id: 'opendata',
      run: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    }

    const result = await runWithFailover([hang, ok('ojp', 'fallback')], new Breaker(opts), opts)
    expect(result.value).toBe('fallback')
  })

  it('throws an aggregate naming every failure when nothing works', async () => {
    const opts = options(() => 0)
    const error = await runWithFailover(
      [fail('opendata', 'HTTP 429'), fail('ojp', 'HTTP 500')],
      new Breaker(opts),
      opts,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AllSourcesFailedError)
    expect((error as Error).message).toContain('HTTP 429')
    expect((error as Error).message).toContain('HTTP 500')
  })
})

describe('circuit breaker', () => {
  it('skips a failed source on the next poll instead of paying its timeout again', async () => {
    let now = 0
    const opts = options(() => now)
    const breaker = new Breaker(opts)

    const primaryRun = vi.fn(async () => {
      throw new Error('down')
    })
    const attempts = [{ id: 'opendata', run: primaryRun }, ok('ojp', 'fallback')]

    await runWithFailover(attempts, breaker, opts)
    expect(primaryRun).toHaveBeenCalledTimes(1)

    now += 1_000
    await runWithFailover(attempts, breaker, opts)
    expect(primaryRun).toHaveBeenCalledTimes(1) // skipped while in cooldown
  })

  it('retries the primary once the cooldown expires', async () => {
    let now = 0
    const opts = options(() => now)
    const breaker = new Breaker(opts)
    const attempts = [fail('opendata'), ok('ojp', 'fallback')]

    await runWithFailover(attempts, breaker, opts)
    expect(breaker.isOpen('opendata')).toBe(true)

    now += 60_001
    expect(breaker.isOpen('opendata')).toBe(false)
  })

  it('still tries every source when all of them are in cooldown', async () => {
    // A stale breaker must never be the reason the user sees nothing.
    let now = 0
    const opts = options(() => now)
    const breaker = new Breaker(opts)
    breaker.recordFailure('opendata')
    breaker.recordFailure('ojp')

    const result = await runWithFailover(
      [fail('opendata'), ok('ojp', 'recovered')],
      breaker,
      opts,
    )
    expect(result.value).toBe('recovered')
  })

  it('clears the breaker once a source recovers', async () => {
    const opts = options(() => 0)
    const breaker = new Breaker(opts)
    breaker.recordFailure('opendata')

    await runWithFailover([ok('opendata', 'back')], breaker, opts)
    expect(breaker.isOpen('opendata')).toBe(false)
  })
})

describe('cancellation', () => {
  it('does not retry against the fallback when the caller cancels', async () => {
    const opts = options(() => 0)
    const controller = new AbortController()
    const fallbackRun = vi.fn(async () => 'fallback')

    const primary: Attempt<string> = {
      id: 'opendata',
      run: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          controller.abort(new Error('superseded'))
        }),
    }

    await expect(
      runWithFailover([primary, { id: 'ojp', run: fallbackRun }], new Breaker(opts), opts, controller.signal),
    ).rejects.toThrow('superseded')

    expect(fallbackRun).not.toHaveBeenCalled()
  })
})

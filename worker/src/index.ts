/**
 * The API edge.
 *
 * Sits between the app and two upstreams, and exists for four reasons the
 * browser cannot cover:
 *
 *  1. **It hides the OJP key.** Anything bundled into the app is publicly
 *     readable, so the key can only ever live here.
 *  2. **It parses XML.** OJP speaks XML; the app never ships a parser.
 *  3. **It caches.** Repeat opens inside the TTL make zero upstream calls,
 *     which keeps us far below OJP's 50/min and opendata.ch's 3/s.
 *  4. **It fails over.** OJP down, quota spent or credential expired still
 *     leaves a working board via keyless opendata.ch.
 *
 * The app can also call opendata.ch directly if this Worker is unreachable, so
 * no single failure — including this one — takes the app down.
 */

import { OjpError, fetchStopEvents } from './upstream/ojp'
import { fetchDepartures as fetchOpendata } from './upstream/opendata'
import type { WireBoard } from './wire'

export type Env = {
  CACHE?: KVNamespace
  /** Shared with the app; see `requireAuth`. */
  DEVICE_TOKEN?: string
  /** Only ever read here — never sent to the browser. */
  OJP_API_KEY?: string
}

/** Short enough that a delay change surfaces quickly, long enough to matter. */
const CACHE_TTL_SECONDS = 20

/**
 * KV's minimum expiration. Below this it rejects the write, so the cache entry
 * lives longer than we serve it; `fetchedAt` in the payload is what actually
 * decides freshness, and the app labels anything stale.
 */
const KV_MIN_TTL_SECONDS = 60

/** A ceiling far above real use, so a leaked token cannot drain the quota. */
const RATE_LIMIT_PER_MINUTE = 60

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  })
}

/**
 * Constant-time comparison.
 *
 * A plain `===` leaks the token's length and prefix through timing. Cheap to
 * do properly.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function requireAuth(request: Request, env: Env): Response | null {
  // With no token configured the Worker refuses rather than defaulting open: a
  // misconfigured deploy should fail loudly, not quietly serve the world.
  if (env.DEVICE_TOKEN === undefined || env.DEVICE_TOKEN === '') {
    return json({ error: 'worker is not configured with DEVICE_TOKEN' }, { status: 503 })
  }
  const presented = request.headers.get('x-pendlo-token') ?? ''
  if (!tokensMatch(presented, env.DEVICE_TOKEN)) {
    return json({ error: 'unauthorised' }, { status: 401 })
  }
  return null
}

/**
 * A coarse per-minute cap.
 *
 * KV is eventually consistent, so this counts approximately — which is fine
 * for its purpose. It is not protecting a resource from precise abuse; it is
 * stopping a runaway client or leaked token from burning 20 000 daily OJP
 * calls before anyone notices.
 */
async function overRateLimit(env: Env, now: number): Promise<boolean> {
  if (env.CACHE === undefined) return false
  const bucket = `rate:${Math.floor(now / 60_000)}`

  const current = Number.parseInt((await env.CACHE.get(bucket)) ?? '0', 10)
  if (Number.isFinite(current) && current >= RATE_LIMIT_PER_MINUTE) return true

  await env.CACHE.put(bucket, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: KV_MIN_TTL_SECONDS,
  }).catch(() => undefined)
  return false
}

/**
 * Departures for one stop, OJP first.
 *
 * A failure of either source is reported through the returned `source` field
 * rather than by throwing, so the app can say which data it is showing.
 */
async function loadBoard(env: Env, stopId: string, limit: number, now: number): Promise<WireBoard> {
  const failures: string[] = []

  if (env.OJP_API_KEY !== undefined && env.OJP_API_KEY !== '') {
    try {
      const events = await fetchStopEvents({
        apiKey: env.OJP_API_KEY,
        stopId,
        limit,
        now: new Date(now),
      })
      return {
        stop: { id: stopId, name: events.stopName ?? '' },
        departures: events.departures,
        situations: events.situations,
        source: 'ojp',
        fetchedAt: now,
      }
    } catch (error) {
      // An auth failure is worth distinguishing: it means the credential is
      // wrong or the subscription lapsed, not that the service is down.
      const detail =
        error instanceof OjpError && (error.status === 401 || error.status === 403)
          ? 'ojp credential rejected'
          : `ojp: ${error instanceof Error ? error.message : String(error)}`
      failures.push(detail)
    }
  }

  const fallback = await fetchOpendata({ stopId, limit })
  return { ...fallback, source: 'opendata', fetchedAt: now }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const now = Date.now()

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, { status: 405, headers: corsHeaders() })
    }

    if (url.pathname === '/health') {
      // Deliberately unauthenticated and says nothing about configuration
      // beyond whether the two secrets are present at all.
      return json(
        { ok: true, ojp: env.OJP_API_KEY !== undefined, auth: env.DEVICE_TOKEN !== undefined },
        { headers: corsHeaders() },
      )
    }

    if (url.pathname !== '/departures') {
      return json({ error: 'not found' }, { status: 404, headers: corsHeaders() })
    }

    const unauthorised = requireAuth(request, env)
    if (unauthorised !== null) {
      return new Response(unauthorised.body, {
        status: unauthorised.status,
        headers: { ...Object.fromEntries(unauthorised.headers), ...corsHeaders() },
      })
    }

    const stopId = url.searchParams.get('stopId') ?? ''
    if (!/^\d{5,9}$/.test(stopId)) {
      return json({ error: 'stopId must be a numeric stop id' }, { status: 400, headers: corsHeaders() })
    }
    const limit = Math.max(1, Math.min(20, Number.parseInt(url.searchParams.get('limit') ?? '8', 10) || 8))

    if (await overRateLimit(env, now)) {
      return json({ error: 'rate limited' }, { status: 429, headers: corsHeaders() })
    }

    const cacheKey = `board:${stopId}:${limit}`
    if (env.CACHE !== undefined) {
      const hit = await env.CACHE.get(cacheKey)
      if (hit !== null) {
        const board = JSON.parse(hit) as WireBoard
        // Serve only while genuinely fresh; KV cannot expire faster than a
        // minute, so freshness is decided here rather than by the TTL.
        if (now - board.fetchedAt < CACHE_TTL_SECONDS * 1000) {
          return json(board, { headers: { ...corsHeaders(), 'x-pendlo-cache': 'hit' } })
        }
      }
    }

    try {
      const board = await loadBoard(env, stopId, limit, now)

      if (env.CACHE !== undefined) {
        // A cache write failure must never fail the request.
        await env.CACHE.put(cacheKey, JSON.stringify(board), {
          expirationTtl: KV_MIN_TTL_SECONDS,
        }).catch(() => undefined)
      }

      return json(board, { headers: { ...corsHeaders(), 'x-pendlo-cache': 'miss' } })
    } catch (error) {
      // Both sources failed. Say so plainly; the app falls back to calling
      // opendata.ch directly and labels what it shows.
      return json(
        { error: error instanceof Error ? error.message : 'upstream unavailable' },
        { status: 502, headers: corsHeaders() },
      )
    }
  },
} satisfies ExportedHandler<Env>

/**
 * The app is served from a different origin to the Worker, so it needs CORS.
 * Open by origin because the device token, not the origin, is what authorises.
 */
function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'x-pendlo-token, content-type',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
  }
}

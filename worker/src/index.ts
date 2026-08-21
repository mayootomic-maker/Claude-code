/**
 * The API edge.
 *
 * Phase 1 ships this as a thin, working cache in front of transport.opendata.ch.
 * It is deliberately deployable now rather than left as a stub, because the two
 * things it already does are worth having on day one:
 *
 *  - **Caching.** Repeat app opens within the TTL make zero upstream calls,
 *    which keeps us far clear of opendata.ch's 3 req/s ceiling.
 *  - **Auth.** The endpoint is not public. Without a token check, anyone who
 *    found the URL could burn the OJP daily quota (20k requests) or, once push
 *    lands, send notifications to the device.
 *
 * Phase 3 adds the OJP adapter, disruption lookups scoped to saved stops, and
 * Web Push. The failover machinery those need already exists and is tested in
 * app/src/lib/sources/failover.ts.
 */

export type Env = {
  CACHE?: KVNamespace
  /** Shared with the app; see `requireAuth`. */
  DEVICE_TOKEN?: string
  /** Only ever read here — never sent to the browser. */
  OJP_API_KEY?: string
}

const UPSTREAM = 'https://transport.opendata.ch/v1'

/** Short enough that a delay change surfaces quickly, long enough to matter. */
const CACHE_TTL_SECONDS = 20

/** Endpoints we proxy, and nothing else — an open proxy is not the goal. */
const ALLOWED = new Set(['/stops', '/departures', '/connections'])

const UPSTREAM_PATH: Record<string, string> = {
  '/stops': '/locations',
  '/departures': '/stationboard',
  '/connections': '/connections',
}

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
 * Constant-time token comparison.
 *
 * A plain `===` leaks the token's length and prefix through timing. The check
 * is cheap; getting it wrong is the sort of thing that is embarrassing rather
 * than catastrophic here, but there is no reason to get it wrong.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function requireAuth(request: Request, env: Env): Response | null {
  // With no token configured the Worker refuses rather than defaulting open:
  // a misconfigured deploy should fail loudly, not quietly serve the world.
  if (env.DEVICE_TOKEN === undefined || env.DEVICE_TOKEN === '') {
    return json({ error: 'worker is not configured with DEVICE_TOKEN' }, { status: 503 })
  }

  const presented = request.headers.get('x-pendlo-token') ?? ''
  if (!tokensMatch(presented, env.DEVICE_TOKEN)) {
    return json({ error: 'unauthorised' }, { status: 401 })
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, { status: 405 })
    }

    if (url.pathname === '/health') {
      return json({ ok: true })
    }

    if (!ALLOWED.has(url.pathname)) {
      return json({ error: 'not found' }, { status: 404 })
    }

    const unauthorised = requireAuth(request, env)
    if (unauthorised !== null) return unauthorised

    const upstreamPath = UPSTREAM_PATH[url.pathname]
    if (upstreamPath === undefined) return json({ error: 'not found' }, { status: 404 })

    // Forward the query verbatim, including the fields[] trimming the app sends.
    const upstreamUrl = `${UPSTREAM}${upstreamPath}?${url.searchParams.toString()}`
    const cacheKey = `v1:${upstreamPath}:${url.searchParams.toString()}`

    if (env.CACHE !== undefined) {
      const hit = await env.CACHE.get(cacheKey)
      if (hit !== null) {
        return json(JSON.parse(hit), { headers: { 'x-pendlo-cache': 'hit' } })
      }
    }

    const upstream = await fetch(upstreamUrl, {
      headers: { accept: 'application/json', 'user-agent': 'pendlo-solo/1.0' },
    })

    if (!upstream.ok) {
      return json(
        { error: `upstream returned ${upstream.status}` },
        { status: upstream.status === 429 ? 429 : 502 },
      )
    }

    const body = (await upstream.json()) as unknown

    if (env.CACHE !== undefined) {
      // Fire-and-forget: a cache write failure must never fail the request.
      await env.CACHE.put(cacheKey, JSON.stringify(body), {
        expirationTtl: Math.max(60, CACHE_TTL_SECONDS),
      }).catch(() => undefined)
    }

    return json(body, { headers: { 'x-pendlo-cache': 'miss' } })
  },
} satisfies ExportedHandler<Env>

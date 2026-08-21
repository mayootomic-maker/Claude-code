# Pendlo Solo

A personal Swiss public-transport commute app. Installable PWA, no ads, no
accounts, no tracking, free to run. Built for one user with a fixed commute.

**The product thesis:** other apps make you *search* every time. With one user
and a known route, the app should already know. The home screen takes zero
input, and its dominant number is **minutes until you must leave** — departure
minus walking time — not the departure time.

Full plan, including phases still to build: `/root/.claude/plans/replicated-tinkering-pascal.md`

## Layout

```
app/      Vite + Preact + TS + Tailwind v4 → static PWA
worker/   Cloudflare Worker: cache + auth in front of the transport APIs
```

## Commands

```bash
cd app
npm run dev          # dev server
npm test             # vitest (unit + boundary)
npm run typecheck    # tsc, strict
npm run build        # production bundle

# End-to-end against a local fixture server (see "Testing" below)
node e2e/stub-server.mjs &
VITE_TRANSPORT_BASE=http://127.0.0.1:4174/v1 npm run build
node e2e/drive.mjs
```

## API facts learned the hard way

These were verified against the live API, not read from docs. Docs disagree
with reality in two places.

**transport.opendata.ch** — free, no key, CORS-enabled. The primary source.
- Limit **3 requests/second per IP**. Debounce anything user-driven.
- `capacity1st` / `capacity2nd` are documented but return **`null` in
  practice**. There is no occupancy data here. Do not build against it.
- There is **no disruption endpoint**. Disruptions need OJP.
- Responses embed a full `passList` per departure: a 6-departure stationboard
  is **35 KB** untrimmed and **1.7 KB** with `fields[]`. Always trim; see
  `STATIONBOARD_FIELDS` in `app/src/lib/sources/opendata.ts`.
- `prognosis.departure` and `delay` **can disagree** (observed: `delay: 0`
  alongside a prognosis 34s later). The prognosis wins.
- `delay: null` with a null prognosis is common and means **no realtime data** —
  which is not the same as on time. Never render it as on time.
- `/locations` returns address results with a **null `id`**. They are not
  boardable and are dropped at the boundary.
- Volunteer-run, wrapping `timetable.search.ch`, **no SLA**. Treat failure as
  routine; that is what `sources/failover.ts` is for.

**opentransportdata.swiss** — free for private use, needs a key from
`api-manager.opentransportdata.swiss`. Not yet wired up (Phase 3).
- OJP: 50 req/min, 20 000 req/day. Source for disruptions and possibly occupancy.
- GTFS-RT: **rejected by design.** It needs a key (bare request returns `401`),
  it is one national protobuf blob for all of Switzerland, and decoding it
  would run against the free Worker's CPU ceiling. `OJPStopEventRequest`
  returns disruptions already scoped to one stop. Do not reintroduce GTFS-RT.

## Non-negotiables

**Correctness**
- Never call `Date.now()` outside `createClock` in `lib/time.ts`. A device
  clock three minutes fast makes every countdown three minutes wrong, silently.
- Unknown is never rendered as fine. `delayMinutes: null` means no data.
- A cancelled service never renders a countdown, and never silently disappears —
  if one is skipped, it is announced (`skippedCancelled` in `routes/Now.tsx`).
- Countdowns never display a negative number: `counting` → `go-now` → `departed`.
- Stale data is labelled with its age. Offline says delays are not visible.

**Anti-slop bar**
1. No placeholders, dummy data, "coming soon", or dead buttons.
2. Every state designed: loading, empty, offline, stale, error, permission-denied.
3. No silent failures — every catch surfaces something honest and actionable.
4. No dead code or speculative abstraction.
5. Errors tested by killing the network, not by mocking it.
6. `any` is banned. `strict: true`. Upstream validated at the boundary.
7. Comments explain *why*, never *what*.
8. Every number on screen traces to a real API field. Nothing invented.

**Budget** (CI-enforced later)
- JS ≤ 50 KB gzip for the `Now` route · CSS ≤ 10 KB. Currently ~17.6 KB / 4.6 KB.
- No animation library, no charting library, no zod. Hand-rolled beats a
  dependency at this scale — zod alone would be a quarter of the JS budget.

**Accessibility**
- Countdown live regions announce on the minute, never per tick — a per-second
  live region makes the screen unusable with a screen reader.
- Colour is never the only signal; every semantic colour is paired with an icon.
- `prefers-reduced-motion` collapses all motion. Every animation is
  transform/opacity only, so removing them changes no layout.

## Platform limits (stated, not worked around)

- **iOS evicts PWA storage after ~7 days of inactivity.** `storage.persist()`
  is requested on every launch, but it is a request the browser may decline.
  Export/import to a JSON file is the real defence — do not remove it.
- **Background geolocation does not exist in a PWA.** Direction inference is
  time-of-day first, GPS only as refinement while the app is open.
- **iOS Web Push** requires home-screen install and is best-effort.

## Testing

Unit and boundary tests run under Vitest, including both DST transitions, the
fall-back night where 02:30 happens twice, service-day rollover, and clock
drift. Fixtures in `app/src/lib/sources/__fixtures__/` were captured from the
live API and include the null-delay case.

`e2e/drive.mjs` drives the built app in Chromium at iPhone dimensions across
both themes, forcing each state: normal, no-realtime, cancelled, go-now, empty,
error, malformed, offline. It fails on any console error or page error.

It runs against `e2e/stub-server.mjs` rather than the live API for two reasons:
**the browser in this container has no outbound network access** (the shell
does, via a proxy — that is how the API was verified and the fixtures
captured), and live data cannot be made to produce cancellations or missing
realtime on demand. Those are the states that most need testing.

## Worker

Not deployed yet. `worker/src/index.ts` is a working cache + token-auth proxy.
Before deploying: create the KV namespace and set `DEVICE_TOKEN`; set
`OJP_API_KEY` when Phase 3 lands. The API key must never reach the browser.

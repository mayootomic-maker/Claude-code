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
worker/   Cloudflare Worker: OJP + opendata.ch behind cache, auth and failover
```

**Source preference**: Worker (OJP, with occupancy and disruptions) → direct
opendata.ch (keyless, neither). The app works with no Worker deployed at all;
it just shows less. XML parsing lives in the Worker so the app ships no parser.

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

**opentransportdata.swiss / OJP 2.0** — `https://api.opentransportdata.swiss/ojp20`,
POST XML, `Authorization: Bearer <key>`. Verified working; the Worker uses it.
- 50 req/min, 20 000 req/day, free for private use.
- **Occupancy is real here** (`ExpectedDepartureOccupancy` → `OccupancyLevel`),
  per fare class. This is the only source for it.
- `FareClass` arrives as **`"secondClass "` with a trailing space**. Trim before
  comparing or every second-class figure classifies as first.
- Every text node carries `xml:lang`, so `<Text>` never matches bare.
- Disruptions live in `StopEventResponseContext/Situations`, usually empty.
  Empty means "nothing disrupted", not a parse failure.
- Carries per-service attributes including **`Aussteigeseite: Rechts/Links`** —
  which side the doors open. Nothing else we can reach publishes that.
- A SIRI `ErrorCondition` can arrive inside an HTTP 200; check for it.
- GTFS-RT: **rejected by design.** It needs a key (bare request returns `401`),
  it is one national protobuf blob for all of Switzerland, and decoding it
  would run against the free Worker's CPU ceiling. `OJPStopEventRequest`
  returns disruptions already scoped to one stop. Do not reintroduce GTFS-RT.

## Non-negotiables

**Correctness**
- Never call `Date.now()` outside `createClock` in `lib/time.ts`. A device
  clock three minutes fast makes every countdown three minutes wrong, silently.
- **Inspections bind to the trip you are ON, not the one on screen.** Mid-journey
  the board shows the *next* train. `activeTrip` in `lib/store.ts` records the
  departure being counted down to and reads it back after it leaves, so a
  mid-journey inspection attaches to the right train and the ride count grows.
  `markIntendedTrip` must never overwrite a journey already under way — that
  guard is the whole reason the feature works when the app is opened on board.
- **Trip identity uses nearest-match, never buckets.** `tripKey` is exact;
  tolerance lives in `resolveTripKey`. Rounding into buckets only moves the
  history-splitting problem to the bucket edges (07:44 vs 07:46).
- **Prediction pools across levels — prior → category → trip** — each shrunk
  toward the one above (`SHRINKAGE` in `lib/inspections.ts`). Counting only
  exact-trip matches meant eight rides on the 07:42 before saying anything, and
  nothing at all about a train never taken. Every ride now informs every trip.
- **The `basis` field is not decoration.** An estimate carried by the seeded
  prior and one built on thirty rides must never be presented identically; the
  panel states which it is.
- **No inspection data source exists.** Verified against live OJP: zero hits for
  Kontrolle/inspect/Zugbegleiter/staff. Nobody publishes inspector positions.
  Published statistics count *fare evaders caught*, not inspection frequency, so
  they cannot seed a base rate either. Do not scrape other apps for it.
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
- JS ≤ 50 KB gzip for the `Now` route · CSS ≤ 10 KB. Currently ~25.8 KB / 5.3 KB.
- No animation library, no charting library, no zod. Hand-rolled beats a
  dependency at this scale — zod alone would be a quarter of the JS budget.

**Visual system**
- **Line numbers render as coloured badges** (`ui/LineBadge.tsx`), grouped by
  category. Every Swiss departure board does this and people navigate by the
  colour before reading the text; plain bold text throws that cue away.
- Grouped information sits on a surface (`border-line bg-surface`) rather than
  floating as loose text.
- Screens are `min-h-[calc(100dvh-4.5rem)]`, never `min-h-dvh`: full viewport
  plus the fixed tab bar's padding overflows by exactly the bar's height, which
  hides the last row of every list behind it.

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
- **There is no web API to set screen brightness.** The ticket view holds a
  Screen Wake Lock and renders on pure white; that is all that is achievable.
- **PDFs cannot be rasterised in-browser** without `pdf.js` (~7× this app).
  Images are the first-class ticket path; PDFs go to the browser's own viewer
  and the UI says so.

## Testing

Unit and boundary tests run under Vitest, including both DST transitions, the
fall-back night where 02:30 happens twice, service-day rollover, and clock
drift. Fixtures in `app/src/lib/sources/__fixtures__/` were captured from the
live API and include the null-delay case.

`e2e/drive.mjs` drives the built app in Chromium at iPhone dimensions across
both themes, forcing each state: normal, no-realtime, cancelled, go-now, empty,
error, malformed, offline. It also walks all four tabs, logs an inspection,
opens the ticket view, exercises the on-board flow (asserting the ride is
logged against the *boarded* trip), and runs an export → wipe → restore cycle.
It fails on any console error or page error.

Two bugs were found by driving the app that unit tests passed clean on: a
cancelled train vanishing instead of being announced, and the intended-trip
marker overwriting the boarded trip. Run it after UI changes, not just tests.

It runs against `e2e/stub-server.mjs` rather than the live API for two reasons:
**the browser in this container has no outbound network access** (the shell
does, via a proxy — that is how the API was verified and the fixtures
captured), and live data cannot be made to produce cancellations or missing
realtime on demand. Those are the states that most need testing.

## Worker and secrets

Not deployed yet. `worker/src/index.ts` is a working cache + token-auth proxy.

**The OJP key must never reach the browser.** Anything bundled into `app/` is
publicly readable. The key lives only in the Worker:

```bash
cd worker
cp .dev.vars.example .dev.vars     # local dev; gitignored
npx wrangler kv namespace create CACHE   # then paste the id into wrangler.toml
npx wrangler secret put OJP_API_KEY      # production
npx wrangler secret put DEVICE_TOKEN     # openssl rand -base64 32
npx wrangler deploy
```

Getting the OJP key. The official docs say "create an Application", but the
portal never uses that word — it is labelled **"my apps"**, and every subscribe
control is hidden until you are logged in, so the product page looks like a
dead end. Actual path:

1. Register: `/auth/password/register` (password ≥ 12 chars, a number and a
   special character)
2. Create the app under **my apps**: `/portal/private/dashboard`
   (logged out this just redirects to the login page)
3. Subscribe OJP 2.0 to it: `/portal/catalogue-products/tedp_ojp20-1`, under
   "Plans available for subscription"

The portal shows a **token** and a **token hash** — take the **token**. The hash
is a one-way digest it keeps to identify the credential; it cannot authenticate.
The plaintext is shown once, and it is one key per API, so losing it means
regenerating.

Verify a credential without pasting it anywhere:

```bash
cd worker && node scripts/check-key.mjs
```

It reads the key from the environment or `.dev.vars`, makes one real request,
and separates the cases that look alike from the portal UI: `401`/`403` means
the credential is wrong or still pending approval, `400` means it authenticated
and only the body was rejected, `200` means both were fine. It prints only a
short fingerprint, never the key.

One key per API. It is a Bearer token (`Authorization: Bearer <key>`), free for
private use at 50 req/min and 20 000 req/day. Other product ids on the same
portal, should they ever be needed: `tedp_siri_sx-1` (unplanned disruptions),
`tedp_gtfs_rt-1` (rejected, see above), `tedp_ojpfare-1`.

`DEVICE_TOKEN` is a secret you invent, shared between app and Worker. Without
it the endpoint is open: anyone who found the URL could exhaust the daily OJP
quota or push notifications to your phone.

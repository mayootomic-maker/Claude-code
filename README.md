# Margin

An Android app for intelligent buying, deal hunting, ownership and selling of second-hand
goods. A personal trading desk for physical things.

```
Goal → capture a listing → personalised evaluation → watch / buy / reject → own → sell
```

Everything runs on the device. No accounts, no API keys, no backend, no network.

---

## Install

```
output/margin-debug.apk      ← install this one      (18 MB, app.margin.debug)
output/margin-release.apk    ← R8-minified           (1.5 MB, app.margin)
output/margin-ad.mp4         ← the product film      (1080x1920, 22s)
```

The two APKs use different application IDs, so both can be installed side by side.

```bash
adb install -r output/margin-debug.apk
```

The app seeds itself on first launch. There is nothing to configure.

## What to look at, in about two minutes

1. **Today** opens on a computed attention queue: watched items whose price moved, a sell
   signal on something you own, an unfinished listing. It is not a summary of the other tabs,
   and it is allowed to be empty.
2. **Deals → Gaming PC Ryzen 5 5600 + RTX 3060.** The centrepiece. Fair value from comparable
   sales, the asking price plotted against that range, every cost line, the net if you flipped
   it, and a walk-away price. All of it is arithmetic you can check.
3. **Deals → Canyon Grail:ON CF 7.** Tap the grey block under the verdict: `Base 50 · −5 from
   your history · = 45`, because the seeded decision record contains three Canyon rejections.
   That is the memory, shown as arithmetic rather than asserted.
4. **The PC flip goal** produces three different answers from one goal — a strong buy, a watch
   that falls short of the profit target, and an avoid. One category, three verdicts.
5. **Owned** is a ledger with a loss on it, and a scorecard: *Margin forecast CHF 188 and you
   realised CHF 260*. The app scoring itself.
6. **Owned → MacBook Air → Continue the listing** for the sell flow: price ladder, channel
   comparison including trade-in, a photo checklist that deliberately gates nothing, and
   generated listing copy you can edit and copy to the clipboard.
7. **Share any URL to Margin** from a browser, or use the link button on Today. Known links
   resolve against the catalogue; unknown ones are parsed locally, and the app tells you
   exactly which fields it guessed and which it could not determine.

---

## Honesty contract

The rules this codebase holds itself to, because a deal-evaluation app that fabricates
confidence is worse than no app:

- **No fake network calls.** Nothing pretends to reach a server.
- **Every figure is computed from local data** and traces back to arithmetic you can read.
- **Provenance is always visible** — a listing says where its data came from, an evaluation
  says which engine produced it.
- **When the engine has no basis, it declines.** It never derives fair value from the seller's
  own asking price, because that makes every listing look correctly priced.
- **No dead buttons.** "Mark as listed" changes state; "Copy listing text" writes to the
  clipboard. There is nothing to publish to, so nothing claims to publish.

---

## Architecture

```
core/design     tokens, motion system, component kit, category line art
core/format     money and time formatting
domain/model    pure Kotlin types, no Android imports
domain/engine   valuation, ranking, decision memory, attention, URL parsing, copywriting
domain/repository  interfaces
data/           Room, DataStore, repository implementations, seed corpus
ui/             Compose screens and view models
di/             AppContainer — manual dependency wiring
```

`domain/` has no Android dependencies, which is what makes the engine unit-testable on the JVM.

### Replaceable seams

```kotlin
interface ValuationService   { suspend fun evaluate(request: ValuationRequest): Evaluation }
interface ListingSource      { suspend fun resolve(input: String, nowMillis: Long): ResolveResult }
interface ListingCopywriter  { fun draft(request: CopyRequest): ListingCopy }
interface MarketDataSource   { fun lookup(category: Category, brand: String, model: String): MarketModel? }
```

All four are constructed in `AppContainer` and nowhere else. Connecting a real pricing
service or marketplace scraper is a change to that one file; no screen knows which
implementation answered.

### The valuation engine

Comparable sales are normalised to the item's age and condition, weighted by recency, and
reduced to a fair value with a dispersion-derived band and an honest confidence level. From
there: refurbishment cost (proportional to value, capped at one condition rank, with an
overrun allowance), sale channel, fees, collection, cost of tied-up capital, net profit, and a
walk-away price. Deal score blends discount, margin-against-your-target, liquidity, a risk
penalty and a bounded personalisation delta — and the delta is always shown as arithmetic.

Three invariants are enforced by tests, each of which was a real defect found in review:

1. `low ≤ fair ≤ high`, always.
2. The score never falls when the asking price falls.
3. Worse condition is never the better margin — a flat refurbishment cost against a
   proportional condition uplift once made the engine recommend buying scrap.

---

## Build

Requires JDK 17+ and an Android SDK with platform 35 and build-tools 35.0.0.

```bash
./gradlew testDebugUnitTest                                  # engine invariants, flows, seed report
./gradlew testDebugUnitTest -Proborazzi.test.record=true     # re-record screen captures
./gradlew assembleDebug assembleRelease
```

Screen captures land in `app/build/screens/` — 13 screens in light and dark. There is no KVM
in the build environment, so no emulator; these renders are how the UI is reviewed.

Release signing reads a keystore from `keystore.properties` or the `MARGIN_STORE_*`
environment variables, both outside version control. When neither is present the release build
signs with the debug identity and says so in the build log. **No key or password is committed.**

---

## Motion film

`motion/` is a Remotion project sharing the app's exact palette and spring constants, with one
vertical product film.

```bash
cd motion && npm install && npx remotion render MarginAd out/margin-ad.mp4
```

---

## Documents

- `PLAN.md` — the implementation plan this was built against
- `NEXT.md` — the highest-value steps to make this a real product
- `.claude/skills/product-engineering-director/` — project working rules and known failure modes
- `.claude/skills/council/` — the review-panel process used on this build
- `docs/screens/` — all 13 screens rendered in light and dark

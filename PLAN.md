# Margin — Implementation Plan

**Margin** is an Android app for intelligent buying, deal hunting, ownership and selling.
Positioning: *personal trading desk for physical goods*. Visual reference class is modern
finance/portfolio software, not consumer marketplace apps.

Core loop: **Goal → capture listing → personalized evaluation → watch / buy / reject → own → sell**

---

## 1. Product scope

### In scope (must be fully working)
| Capability | Definition of working |
|---|---|
| Goals | Create/edit/archive buy-goals and flip-goals with budget, target profit, category, keywords. Goals drive ranking and verdicts. |
| Capture | Paste a URL, receive it from the Android share sheet, or pick from the demo inbox. Resolves to a structured listing. |
| Evaluation | Fair value + range, asking price, deal score, resale estimate, refurb/fee costs, net profit, risks, personalized verdict, comparables. |
| Decisions | Watch / Reject / Mark bought, each with a reason. Persisted and fed back into future evaluations. |
| Opportunities | Ranked feed across goals with filters, sorted by a transparent relevance×value score. |
| Owned | Inventory with purchase price, estimated current value, unrealized P/L, depreciation trend, sell-now signal. |
| Sell | Multi-step flow: price recommendation, photo checklist, generated title + description, channel choice, publish-to-draft. |
| Today | Calm dashboard surfacing only items that need attention today. |
| Memory | Decision history changes future scores and verdict copy, visibly. |
| Settings | Theme, currency, data-source status, reset/reseed demo data. |

### Explicitly out of scope for this build
Accounts, sync, real marketplace scraping, real ML pricing, payments, messaging, notifications backend.
All of these sit behind interfaces (§4.3) so they can be implemented later without UI rewrites.

### Honesty rules (non-negotiable)
- No fake network calls. Nothing spins a fake spinner pretending to hit a server.
- Every derived number is computed by real code from local data and is explainable in-app.
- Data provenance is always visible: a listing says whether it came from the seeded catalog
  or was parsed locally from a URL, and the evaluation says which engine produced it.

---

## 2. Screens & navigation

Bottom bar, four destinations. Everything else is pushed or presented modally.

```
Today            ← default
Opportunities    ← ranked feed, goal filter chips
Owned            ← inventory + portfolio value
Goals            ← goal list

Modal / pushed:
  Capture (paste link)         from Today/Opportunities app-bar action + ACTION_SEND share target
  Evaluation                   full screen, the centrepiece
  Listing detail               comparables, risk detail, decision history
  Owned item detail            value history, sell signal
  Sell flow                    3 steps: Price → Photos → Listing copy → Draft
  Goal editor                  create/edit
  Settings
```

Navigation transitions: shared-axis X for lateral pushes, vertical rise for modals, both
spring-driven (§5.3). Back is always predictable; no dead ends; every screen has a real
empty, loading and error state.

---

## 3. Data model

Room, single database, version 1. JSON columns via kotlinx-serialization for value lists.

```
Goal(id, title, kind{BUY,FLIP}, category, budgetMaxMinor, targetProfitMinMinor,
     keywords[], conditionFloor, active, createdAt, note)

Listing(id, url, sourceName, provenance{SEEDED,PARSED_URL,MANUAL}, title, brand, model,
        year, category, condition, askingPriceMinor, currency, location, sellerType,
        sellerRating, listedAt, description, specs{}, capturedAt)

Evaluation(id, listingId, goalId?, fairValueMinor, fairLowMinor, fairHighMinor,
           dealScore 0..100, resaleValueMinor, refurbCostMinor, feeCostMinor,
           netProfitMinor, confidence{LOW,MEDIUM,HIGH}, verdict{STRONG_BUY,BUY,WATCH,PASS,AVOID},
           headline, rationale[], risks[Risk(severity,title,detail)], comparables[Comp],
           engineId, createdAt)

Decision(id, listingId, type{WATCH,REJECT,BOUGHT,DISMISSED}, reason, note, createdAt)

OwnedItem(id, listingId?, title, category, brand, purchasePriceMinor, purchasedAt,
          condition, currentValueMinor, status{OWNED,LISTED,SOLD}, soldPriceMinor?,
          soldAt?, note)

SaleDraft(id, ownedItemId, askPriceMinor, floorPriceMinor, channel, title, body,
          photoChecklist[ChecklistItem(id,label,hint,done)], status{DRAFT,READY,PUBLISHED},
          createdAt)

Preferences (DataStore): themeMode, currency, hapticsEnabled, seededAt, onboardingSeen
```

Money is stored as **minor units (Long)** everywhere. Formatting happens only at the edge.

---

## 4. Architecture

### 4.1 Layering
```
ui/        Compose screens + ViewModels (StateFlow<UiState>), no Android framework leakage downward
domain/    pure Kotlin: models, repository interfaces, use cases, valuation engine, ranking
data/      Room, DataStore, repository implementations, seeding, local service implementations
core/      design system, motion system, formatting
```
Single Gradle module for build speed, enforced package boundaries. `domain` has **no**
Android imports, which is what makes it unit-testable on the JVM.

### 4.2 DI
Manual `AppContainer` constructed in `Application`, ViewModels built by a small factory.
No Hilt — fewer dependencies, no codegen surprises, trivially testable.

### 4.3 Replaceable integration seams
```kotlin
interface ListingSource     { suspend fun resolve(url: String): ResolveResult }
interface ValuationService  { suspend fun evaluate(req: ValuationRequest): Valuation }
interface ListingCopywriter { suspend fun draft(req: CopyRequest): ListingCopy }
interface MarketSearch      { suspend fun search(q: GoalQuery): List<Listing> }
```
Shipped implementations: `LocalListingResolver`, `HeuristicValuationEngine`,
`TemplateCopywriter`, `SeedMarketSearch`. Each is registered in `AppContainer`; swapping in a
Retrofit/LLM-backed implementation is a one-line change and requires no UI edits.

### 4.4 Valuation engine (real computation, not decoration)
1. Match the listing against a local **comparables table** (category × brand × model × year).
2. Fair value = trimmed median of comps, adjusted for condition multiplier and age depreciation
   curve; the spread of comps sets the low/high band and the confidence level.
3. Resale value = fair value × channel realisation factor − platform fees − shipping.
4. Refurb cost from condition and category-specific defect rules.
5. Net profit = resale − asking − refurb − fees.
6. Deal score = weighted blend of discount-to-fair, margin, liquidity, risk penalty, and
   **personalization delta** from decision memory, clamped 0..100.
7. Risks from declarative rules (price-too-good, battery age, missing components, seller
   signals, unusually short description, etc.).
8. Verdict from score × goal fit × profit threshold.

### 4.5 Personalization (`DecisionMemory`)
Aggregates past decisions into brand/category/price-band affinities. A brand the user has
rejected three times is penalised and *said out loud* in the verdict copy
("You've passed on three Cannondales — this one is priced better than those"). This is what
makes recommendations feel consistent across a session.

---

## 5. Design system

### 5.1 Principles
Information-dense but calm. Hairlines and grouped rows instead of card soup. One accent colour,
used sparingly. Numbers are the hero and are always tabular-aligned.

Banned, enforced by review checklist: gradient blobs, glassmorphism, decorative pills, emoji,
sparkle icons, fake dashboards, meaningless motion, placeholder grey boxes.

### 5.2 Tokens
- **Colour**: near-neutral canvas; ink scale of 5 steps; one accent (signal blue); semantic
  positive / negative / caution; a 5-step deal-score scale. Full light and dark palettes,
  each authored separately rather than algorithmically inverted.
- **Type**: 9-step scale. All numeric styles carry `fontFeatureSettings = "tnum"` so figures
  align in columns and don't jitter during count-up animation.
- **Space**: 4pt grid. Section rhythm 32 / 24 / 16 / 12 / 8.
- **Shape**: 8 / 12 / 18dp. No pill-shaped anything except genuine toggles.
- **Elevation**: none. Separation comes from hairlines and surface tint.

### 5.3 Motion system
Spring-based throughout, physical and responsive, tuned to feel expensive rather than playful.
Reusable primitives, not one-off effects:

| Token | Spec | Used for |
|---|---|---|
| `Press` | stiffness 900, damping 0.9 | tap scale on every interactive surface |
| `Standard` | stiffness 380, damping 0.85 | layout changes, list reorder |
| `Gentle` | stiffness 170, damping 1.0 | sheets, large surfaces |
| `Reward` | stiffness 520, damping 0.55 | decision commits, sell-draft ready |

Primitives: `Pressable` (scale + haptic), `CountUp` (spring-driven numeric roll),
`ScoreDial` (arc sweep), `StaggeredReveal` (list entrance), `DecisionFlash` (commit
confirmation), shared-axis nav transitions, `ValueBar` (animated proportional bar).

Rule: motion carries meaning (state change, causality, confirmation) or it is deleted.

---

## 6. Implementation order

1. Gradle/Compose scaffold, prove `assembleDebug`.
2. Design tokens + motion primitives + component kit.
3. Domain models, valuation engine, ranking, decision memory — with unit tests.
4. Room, repositories, seed data, local service implementations.
5. Screens in dependency order: Evaluation → Opportunities → Today → Owned → Sell → Goals → Settings.
6. Share target + capture flow.
7. Screenshot inspection pass, fix visual defects.
8. APKs to `output/`.
9. Project skills, NEXT.md.
10. Remotion ad (strictly after the APK exists).

---

## 7. Test strategy

- **JVM unit tests** over the pure `domain` layer: valuation maths, score bounds and
  monotonicity, profit arithmetic, URL parsing, goal matching, ranking order, decision-memory
  effects, money formatting. This is where correctness actually lives.
- **Seed integrity test**: every seeded listing resolves, evaluates, and produces a sane verdict.
- **Screenshot tests (Robolectric + Roborazzi)**: no KVM in this environment, so no emulator.
  Every screen is rendered off-device in light and dark and inspected as a PNG — the substitute
  for running the app, and how visual defects get found and fixed.
- **Build gates**: `testDebugUnitTest`, `assembleDebug`, `assembleRelease` all green.

Explicit limitation recorded in NEXT.md: no on-device run happened in this environment, so
device-only concerns (real share-sheet handoff, true frame timing, gesture feel) need one pass
on hardware.

---

## 8. APK delivery

- `output/margin-debug.apk` — install and run immediately, no signing setup needed.
- `output/margin-release.apk` — R8-minified/shrunk release build.
- Release signs with a keystore supplied via environment/`local.properties` when present;
  when absent it falls back to the debug signing identity and the build prints that it did so.
  **No keystore, password, or key is committed to the repository.**

---

## 9. Definition of done

1. Every primary flow works end to end: goal → capture → evaluate → decide → own → sell.
2. Seeded content makes the product understandable in under a minute, with no setup.
3. UI reads as deliberately designed; the banned-pattern list in §5.1 has zero violations.
4. No placeholder screens, no dead buttons, no TODO text visible to a user.
5. App launches cleanly; cold start does not depend on network.
6. Empty, loading, error, first-run and "everything handled" states all exercised and reviewed.
7. Unit tests pass; debug and release APKs both build.
8. APKs present in root-level `output/`.
9. Exact APK path reported.
10. `NEXT.md` written, short, and only high-value.

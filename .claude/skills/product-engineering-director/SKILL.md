---
name: product-engineering-director
description: Working rules for the Margin Android app — settled architecture, visual and motion standards, the honesty contract for computed figures, the QA checklist, and the specific failure modes this project has already hit. Use when adding a screen, changing the valuation engine, touching the design tokens, editing seed data, or reviewing work on this repository, so decisions stay consistent instead of being re-derived.
---

# Product engineering director — Margin

This is project memory, not a personality. It records decisions that are **settled** and
failure modes that have **already happened here**, so neither gets rediscovered at cost.

It does not modify the underlying model. It is a checklist and a set of priors.

---

## 1. What the product is

A personal trading desk for physical goods. One loop, and everything serves it:

```
Goal → capture a listing → personalised evaluation → watch / buy / reject → own → sell
```

Reference class is modern finance and portfolio software. It is **not** a marketplace app,
and it is not an assistant.

### The honesty contract — non-negotiable

1. **No fake network calls.** Nothing spins a spinner pretending to reach a server.
2. **Every derived figure is computed by real code from local data**, and is explainable
   in-app by tapping through to the arithmetic.
3. **Provenance is always visible.** A listing states whether it came from the seeded
   catalogue or was parsed from a link. An evaluation states which engine produced it.
4. **When the engine does not know, it says so.** It never derives "fair value" from the
   seller's own asking price — that makes every listing look correctly priced.
5. **No button that does not do something real.** "Mark as listed" changes state.
   "Copy listing text" writes to the clipboard. There is nothing to "publish" to.

If a feature can only be built by violating one of these, build the honest smaller version.

---

## 2. Settled architecture — do not re-litigate

| Decision | Why | Status |
|---|---|---|
| Kotlin + Compose + Material 3, single module | Build speed; package boundaries enforce layering | Settled |
| `domain/` has zero Android imports | It is what makes the engine JVM-unit-testable | Settled |
| Manual DI via `AppContainer` | No codegen surprises, trivially fakeable in tests | Settled |
| Room with JSON columns for value lists | Avoids a table per list; enums decoded defensively | Settled |
| Money is `Long` minor units everywhere | Formatting happens only at the UI edge | Settled |
| `Category` is a closed enum | Free-text categories silently orphan listings from goals | Settled |
| Three replaceable seams | `ValuationService`, `ListingSource`, `ListingCopywriter`, all constructed in `AppContainer` and nowhere else | Settled |

**Adding a backend later** means implementing a seam and changing one line of `AppContainer`.
If a change would require editing a screen to swap an implementation, the seam is in the
wrong place.

---

## 3. Visual rules

### Tokens, with the reasoning attached
- **Primary action is ink** (`inkStrong` fill, `onInk` label), never the accent colour. A blue
  primary button over a cool-grey ramp is the recognisable costume of generated finance UI.
- **The accent is for links, selection and focus only.**
- **Neutrals carry a warm cast** — light is a stone ramp, dark is warm charcoal. Pure cool
  grey reads as a framework default.
- **Large text is light, small text is heavy.** `display`/`titleXl` are `Normal`,
  `heading` is `Medium`, numerals are `SemiBold`. Uniform SemiBold above body is a tell.
- **Tabular figures on numeral styles only.** `tnum` in running prose makes paragraphs read
  like a spreadsheet.
- **Score colours are five authored hexes**, never alpha derivations — compositing a
  translucent arc over its own track produces a muddy stroke.

### Structure
- **One `Grouped` container per screen outside Settings.** Structure comes from hairlines and
  full-bleed rows. Card soup is the default failure.
- **Each destination needs a distinct structural signature.** Today is a few large blocks;
  Opportunities is full-bleed rows; Owned is a real table with a column header; Goals is
  grouped. Four tabs that all render as the same list is the monotony failure.
- **Numbers share a decimal axis.** Right-aligned fixed-width numeric columns are what make a
  column of money read as a ledger.

### Banned, and checked in review
Gradient blobs · glassmorphism · decorative pills · emoji · sparkle icons · fake dashboards ·
motion without meaning · grey placeholder boxes · uppercase micro-labels on every element.

### Product imagery
Line art per category on a tinted plate. Stroke width scales **optically**, not linearly
(heavier below 56dp, lighter above 160dp) or it reads blobby small and spindly large.

---

## 4. Motion

Three tiers plus reward: `Press` (1700/0.88), `Standard` (420/0.82), `Gentle` (190/1.0),
`Reward` (560/0.52). Springs throughout, so interruption resolves instead of replaying.

- **Colour never springs.** There is no physical intuition for a hue overshooting; it reads as
  a rendering glitch. Colour uses a short tween.
- **Full-bleed rows tint on press; only discrete targets scale.** Scaling an edge-to-edge row
  opens visible gaps against its neighbours.
- **Entrance state is hoisted to screen level.** Per-item animation state replays the stagger
  on every scroll and every back-navigation.
- **Animated values start at their target**, not at zero, or every figure re-rolls as
  `LazyColumn` recycles rows.
- Motion must carry state change, causality or confirmation. Otherwise delete it.

---

## 5. Failure modes this project has already hit

Check these directly; they are not hypothetical.

1. **Sign-inverted economics.** A flat per-category refurbishment cost against a
   *proportional* condition uplift made net profit increase monotonically as condition got
   worse — the engine recommended buying scrap. Any cost that is flat while the value it
   affects is proportional will do this. **Test:** worse condition must never be the better
   margin at fair value.

2. **A score that moves the wrong way.** A "suspiciously cheap" risk subtracted 14 points, so
   halving an identical listing's price *lowered* its score. Flags that must be shown but must
   not move the score need `affectsScore = false`. **Test:** score is monotonic as price falls.

3. **A demo that cannot succeed.** The seeded goals and the market table were never reconciled:
   the headline budget sat below every matching item's fair value, and the flip target was
   unreachable against the refurbishment constant. Every seeded goal must be *arithmetically*
   satisfiable. **Test:** each goal yields at least two positive verdicts.

4. **A range that does not contain its value.** Coercing `low` and the centre against a floor
   but not `high` produced `CHF 748 (range 636–551)`. **Test:** `low <= fair <= high` across
   every condition, age and price.

5. **Confidence that cannot be low.** Both non-HIGH branches returned MEDIUM, and a
   brand-fallback match reported HIGH confidence off a *different product's* comparables.
   Fallback matches must be demoted and must raise a visible risk.

6. **Screenshots of the loading state.** `waitForIdle()` does not wait for a Room flow. Every
   capture must block on a data-dependent sentinel, and `SectionLabel` uppercases its text so
   matchers on section titles silently miss.

7. **False precision.** Derived figures quoted to the centime (`CHF 579.82`, `walk-away price
   of CHF 13.79`) read as machine output, not appraisal. Use `Money.whole` for anything
   computed; keep exact minor units in the domain.

8. **An orphaned listing.** An over-budget item fell below the goal-relevance threshold and
   was assigned no goal — so it could never display the over-budget risk written for it.
   Exclusion criteria must not remove the item from the context that explains the exclusion.

9. **Incoherent score/verdict pairs.** A 99-score sitting beside "Worth watching" because the
   margin component was scored against zero rather than against the user's target. The score
   must be measured against the same bar the verdict is.

---

## 6. QA checklist

Before calling any change done:

- [ ] `./gradlew testDebugUnitTest` green — includes engine invariants and the seed report.
- [ ] Read the **seed report table** printed by `SeedReportTest`. Verdicts must still spread;
      a feed that says the same thing everywhere teaches nothing.
- [ ] Re-record screenshots (`-Proborazzi.test.record=true`) and **actually look at them**,
      light and dark. Compiling is not evidence.
- [ ] Empty, loading and error states exercised for any screen touched.
- [ ] No new violation of the banned-pattern list in §3.
- [ ] `./gradlew assembleDebug assembleRelease` both succeed.
- [ ] No secret, keystore or key committed.

---

## 7. Working patterns that save budget here

- **Print the data, do not imagine it.** A test that renders the seeded corpus as a table
  found three defects that assertions missed. Prefer a report to a guess.
- **Compile after every file.** Incremental Kotlin compilation is ~2s here; a batch of ten
  files with one error costs far more to untangle.
- **Fix the model before the persistence.** Changing a domain type after Room entities exist
  costs an entity, a mapper, a DAO and a migration.
- **Write the heavy content file once, carefully.** Seed data and the market table are
  interdependent; patching them incrementally desynchronises the arithmetic.
- **Batch visual fixes.** Re-recording screenshots is ~20s; fixing one defect per cycle wastes
  most of it.
- **Do not re-derive settled decisions** (§2). If a change seems to require reopening one,
  that is a signal the change is in the wrong layer.

# NEXT

The highest-value work to turn this MVP into the real product. Ordered by leverage.

---

## 1. Replace the valuation engine's data, not its shape

`HeuristicValuationEngine` is sound arithmetic over a hand-written market table of ten
models. The arithmetic is the durable part; the table is the throwaway part.

- Implement `MarketDataSource` against a real comparable-sales feed. Ricardo is the only
  Swiss platform that publishes realised prices, so it is the anchor; tutti and Anibis give
  asking prices and time-to-delist, which are useful as a *separate*, lower-weighted signal.
- Keep the engine's outputs identical in shape. Every screen reads `Evaluation` and nothing
  else, so this swap should not touch the UI at all. If it does, the seam leaked.
- Add recency-weighted regression instead of a weighted median once there is enough volume.
  The current percentile approach is right for ten comps and wrong for ten thousand.

**Why first:** every number the user sees is downstream of this, and it is the only part of
the product a competitor cannot copy in a weekend.

## 2. Make capture real

`LocalListingResolver` parses what it can from a URL and is explicit about what it guessed.
That honesty is worth keeping, but it is a stopgap.

- Add a fetch-and-extract path behind the existing `ListingSource` interface, with per-site
  extractors for Ricardo, tutti and Anibis.
- Keep the "read from the link / could not determine" disclosure in the UI. It becomes *more*
  valuable with real extraction, not less, because extractors break silently.
- Fall back to the local parser when a fetch fails rather than erroring. Offline capture is a
  genuine feature, not a limitation.

## 3. Give watched items a real clock

Today's attention queue is computed from price history, and the seeded corpus has real price
movements. Nothing yet *creates* new movement.

- A `WorkManager` job that re-fetches watched listings, appends to `priceHistory`, re-runs the
  engine, and diffs the verdict.
- Notifications for the two events that justify interrupting someone: a watched item crossing
  their walk-away price, and an owned item's sell signal firing.
- This is what makes the app worth reopening tomorrow. Without it, Today eventually empties.

## 4. Photographs

The Sell flow's photo checklist is a preparation aid that deliberately gates nothing, because
self-reported checkboxes are not evidence. Close that gap properly:

- Camera capture and local storage per owned item, with the checklist tracking real files.
- On-device image quality hints (blur, framing) rather than a to-do list.
- Photos are also the missing input for condition assessment.

## 5. Two things to verify on real hardware before shipping

Neither could be checked in this environment, and both are cheap to confirm:

- **On-device run.** There is no KVM in the build container, so no emulator ran. Screens were
  verified by rendering them off-device through Robolectric and Roborazzi. Frame timing,
  spring feel and real share-sheet handoff need one pass on a phone.
- **The R8 release build.** It compiles, shrinks to 1.5 MB and keeps the classes that are
  referenced by name, but no minified build has been executed. Install
  `output/margin-release.apk` once and walk the loop before trusting it over the debug build.

## 6. Smaller, still worth doing

- **Sale outcome feedback into the engine.** `predictionErrorMinor` is recorded per sale and
  shown on Owned, but nothing consumes it. Feeding realised-versus-forecast error back as a
  per-category calibration term is the cheapest real learning in the product.
- **Multi-currency.** Everything is CHF and honestly labelled as such. Adding a currency
  switcher without conversion rates would relabel numbers rather than convert them, which
  breaks the honesty contract — do the rates or leave it.
- **Goal-level digests.** With more than three or four goals the blended feed lets one goal's
  inventory dominate. Cap items per goal or section the feed.
- **Accessibility pass.** Content descriptions exist on icon actions; TalkBack ordering,
  large-font reflow at 200%, and contrast in dark mode all need a real audit.
- **Room migrations.** Schema version 1 currently falls back to destructive migration. That is
  fine pre-release and unacceptable the moment anyone has data worth keeping.

---

## What not to do

- **Do not add a second card style, a gradient, or a colour to the primary button.** The
  restraint is the product's only visual asset and it is one commit away from being lost.
- **Do not let the engine guess when it lacks data.** It currently declines, says so, and caps
  the verdict. That refusal is more valuable than a plausible number.
- **Do not gate state on things the app cannot verify.** The reason the photo checklist gates
  nothing is that checking a box is not evidence a photograph exists.

# Event inspector — specification

> **Status: specification.** Nothing here is a critique of a rendered screen; none exists.
> uPlot API claims are `[verified]` against `uplot@1.6.32` source and a headless render this
> session. Layout numbers are `[decision]` derived from the measured Live-view grid, and are
> marked `[unverified]` where they have not been rendered.

The inspector is the surface the product is judged on. Everything else measures; this
explains. It has one job: let a competent non-expert see *why* the engine reached its
conclusion, and disagree with it if the evidence does not hold.

Tokens from `docs/design/design-system.md`. Availability rendering from
`docs/design/availability-states.md`.

---

## 1. Shape

A full-view route (`/event/:sessionId/:eventId`) that replaces the Live/Sessions content
region. Not a modal, not a drawer. It is a workspace, and workspaces do not live in dialogs.

Two columns:

```
┌──────────────┬────────────────────────────────────────────────┬─────────────────────────┐
│ NAV RAIL     │ HEADER                                  64px   │                         │
│ 200px        │ ← Back   Severe hitch · 142.3 ms · 14:32:07.412 │  EXPLANATION COLUMN     │
│              │          Cyberpunk 2077 · window ±2.0 s        │  420px (360 compact,    │
│              ├────────────────────────────────────────────────┤   480 wide) fixed       │
│              │ PANEL STACK  (scrolls; shared X across all)    │  scrolls independently  │
│              │                                                 │                         │
│              │ ┌gutter 168px┬─── plot ─────────────────────┐   │  1 WHAT HAPPENED        │
│              │ │FRAME TIME  │            ╷142.3        142.3│   │  2 MOST LIKELY CAUSE    │
│              │ │frame.time  │            ┃              max │   │  3 MECHANISM            │
│              │ │300 Hz Exact│~~~~~~~~~~~~┃~~~~~~~~~~~~~ 6.4 │   │  4 EVIDENCE             │
│              │ │▲ subject   │            ╵            min   │   │  5 RULED OUT / BLIND    │
│              │ └────────────┴──────────────────────────────┘   │                         │
│              │ ┌────────────┬──────────────────────────────┐   │                         │
│              │ │PROC CPU    │        ●───────●        41.0 │   │                         │
│              │ │proc.cpu[92]│  ●──●                    2.0 │   │                         │
│              │ │1 Hz ▪▪▪▪▪  │  ┆  ┆  ┆  ┆  ┆  ┆  ┆        │   │                         │
│              │ │→ CAUSE     │                              │   │                         │
│              │ └────────────┴──────────────────────────────┘   │                         │
│              │ … more panels …                                 │                         │
│              ├────────────────────────────────────────────────┤                         │
│              │ SHARED X AXIS                           28px   │                         │
│              │  -2.0s   -1.0s   ▮EVENT▮   +1.0s   +2.0s        │                         │
└──────────────┴────────────────────────────────────────────────┴─────────────────────────┘
```

```css
.inspector { display: grid; grid-template-columns: minmax(0,1fr) 420px; height: 100%; }
.stack     { display: grid; grid-auto-rows: min-content; overflow-y: auto; }
.panel     { display: grid; grid-template-columns: 168px minmax(0,1fr); }
```

Explanation column: 360 px under `compact`, 420 px default, 480 px at `wide`.
`border-left: var(--border-default)`, `background: var(--bg-raised)`.

---

## 2. The panel stack is generated from the diagnosis, not hardcoded

**The set of panels is a function of `Diagnosis.Evidence`.** This is the central mechanic
and it is what makes the inspector feel like it is showing you *this* event rather than a
dashboard that happens to be open.

Given a `Diagnosis` (`src/FrameDoctor.Diagnostics/Diagnosis.cs`) and its
`CorrelationWindow`:

| Tier | Source | Height | Order |
|---|---|---|---|
| **0 — Subject** | `MetricId.FrameTime`, always, unconditionally | **132 px** | first |
| **0b — Subject secondary** | `FrameAnimationError` **only if** the event `Class` is `PacingMicroStutter`, `FrameDropped` **only if** `DroppedFrameBurst` | 76 px | second |
| **1 — Cause** | every `EvidenceItem` with `Role == Cause`, in `Evidence` order (already strongest-first) | **76 px** each, max 4 | by contribution |
| **2 — Contradicting** | every `EvidenceItem` with `Role == Contradicting` | **76 px** each, **no cap, never collapsed** | after causes |
| **3 — Consequence** | every `EvidenceItem` with `Role == Consequence` | **56 px** each, max 3 | after contradictions |
| **4 — Context** | series in the window that are *not* cited, plus every metric named in `Confidence.MissingMetrics` | **32 px** each | collapsed behind a disclosure |

Rules that fall out of this and must be implemented literally:

1. **A panel exists because a piece of evidence cited it.** Never because "a GPU chart looks
   good here". If the diagnosis did not use `gpu.clock.core`, it is tier 4.
2. **Cause outranks consequence, visually and positionally.** `EvidenceRole.Consequence`
   exists in the model precisely because a GPU utilization collapse during a CPU stall is
   *not* the problem. A 56 px consequence panel below a 76 px cause panel says that with
   layout instead of prose. The gutter also labels it `→ CONSEQUENCE`.
3. **Contradicting evidence is never below the fold and never collapsible.** If the engine
   found something arguing against its own conclusion, burying it would make the whole
   surface dishonest. It sits directly under the causes with a `✕ CONTRADICTS` gutter tag in
   `--sev-warning`.
4. **Tier 4 is collapsed but its count is always visible**:
   `Context — 6 series measured, not cited` with a chevron. Expanding animates with
   `--motion-select`.
5. **Missing required metrics appear as tier-4 panels in their `Unavailable` rendering**,
   labelled `not measured` — so the blind spot has a physical place on the timeline rather
   than only a sentence. This is what turns `ConfidenceCap.RequiredMetricMissing` from a
   caveat into something the user can see.

Worst case at 1920×1080: `64 + 132 + 76 + 4×76 + 76 + 3×56 + 28 = 812 px` of a 1080 px
column — the eleven synchronised series the product spec asks for fit without scrolling.
`[unverified]` — computed, not rendered.

---

## 3. The shared X axis

One axis, drawn **once**, at the bottom of the stack, 28 px, sticky to the bottom of the
scroll container so it stays visible while the stack scrolls.

- Domain: `CorrelationWindow.Start … CorrelationWindow.End`, default event ± 2.0 s
  (`CorrelationWindow.Build`'s default padding).
- Units: **seconds relative to `StutterEvent.Start`**, signed. `-2.0 s … +2.0 s`, ticks every
  0.5 s. Not wall-clock, not absolute monotonic ticks.
- The **event span** (`Start..End`) is shaded `--chart-event-span` across **every panel**,
  full height, with 1 px `--sev-critical` edges. Its width is real: a 210 ms event in a 4 s
  window is 5.25 % of the plot. A user seeing how *narrow* the event is against a 1 Hz
  sensor's sample spacing learns more about the diagnosis's limits than any caption.
- Duration label `210 ms` sits centred in the axis strip beneath the span.
- Zoom: drag-select on any panel sets the shared domain on all panels (`setScale('x', …)`
  broadcast). Double-click restores ± 2.0 s. Minimum domain 40 ms.
- Every panel's uPlot instance uses the identical `scales.x` min/max. Panels never
  independently range x.

### Cursor sync — verified API

```ts
const SYNC_KEY = `event-${eventId}`;

const opts: uPlot.Options = {
  cursor: {
    sync: { key: SYNC_KEY, scales: ['x', null] },  // sync x by VALUE, y not at all
    points: { show: false },
    drag: { setScale: false, x: true, y: false },
  },
  legend: { show: false },
  // …
};
```

`[verified]` this session in headless Chromium: two uPlot instances sharing
`cursor.sync.key` reported identical `cursor.left = 495` and identical `cursor.idx = 2457`
after a single mouse move over one of them. `uPlot.sync(key)` is a real static
(`uPlot.esm.js:6124`, `uPlot.d.ts:161`) returning `{ key, plots, sub, unsub, pub }`.

- `scales: ['x', null]` syncs by **x value**, not by pixel fraction — essential, because
  panels have different plot widths only if their gutters differ, and they must not.
- `sync.setSeries` stays `false` (the default when `cursor.sync` is given a key): focusing a
  series in one panel must not toggle another.
- The crosshair is 1 px `--chart-cursor`, drawn by uPlot, on every panel simultaneously.
- Each panel's **gutter value slot** shows that panel's value at the cursor, live. That is
  the readout — there is no floating tooltip. A tooltip that follows the mouse across eleven
  stacked panels is unusable.
- Leaving the plot area restores each gutter to its at-event value (the value at
  `StutterEvent.Start`), not to blank. A gutter that empties on mouse-out destroys the
  comparison the user was making.

---

## 4. The left gutter (168 px)

`background: var(--bg-raised)`, `border-right: var(--border-hairline)`,
`padding: var(--sp-2) var(--sp-3)`. Six slots, top to bottom:

```
┌────────────────────────────┐
│ PROCESS CPU          41.0 %│  ① display name (--t-label)   ② live value (--t-metric-sm)
│ proc.cpu[9214]             │  ③ MetricKey.ToString()       (--t-mono-sm, --text-tertiary)
│ OneDrive.exe               │  ④ instance resolution        (--t-mono-sm)
│ 1 Hz · Exact · ▪▪▪▪▪       │  ⑤ rate · quality · sample ticks
│ → CAUSE            LR 8.0  │  ⑥ evidence role tag + likelihood ratio
└────────────────────────────┘
```

| Slot | Binds to | Notes |
|---|---|---|
| ① Display name | catalog display name for `MetricKey.Metric` | uppercase, `--text-secondary`. Never the raw id — that is slot ③. |
| ② Value at cursor | the sample at (or step-held before) the cursor | `--t-metric-sm`, `--text-primary`, right-aligned, tabular. Renders `—` per `availability-states.md` when the cursor sits in a gap. |
| ③ Metric key | `MetricKey.ToString()` → `proc.cpu[9214]` | `--t-mono-sm`, `--text-tertiary`. Selectable and copyable. This is how a user files a useful bug report. |
| ④ Instance resolution | pid → process name, core index → `core 7`, disk id → `NVMe0` | omitted when `Instance == NoInstance` |
| ⑤ Rate · quality · ticks | `MetricSeries.NativeRateHz`, `MetricSeries.Quality` | `4 Hz · Derived`. Quality is coloured only when it is not `Exact`: `Derived`/`Estimated`/`Degraded` in `--sev-warning`, with the word — never the colour alone. |
| ⑥ Role + LR | `EvidenceItem.Role`, `EvidenceItem.LikelihoodRatio` | `→ CAUSE` / `→ CONSEQUENCE` / `✕ CONTRADICTS` / `· context`. LR shown as `LR 8.0`, `--t-mono-sm`. |

Slot ⑤'s **sample ticks** are five small marks summarising sample density and are
decorative-free: they render the actual count of readable samples in the window, capped at
five, using `▪` for readable and `▫` for unreadable. `MetricSeries.ReadableCount` vs
`SampleCount`. A series showing `▪▪▫▫▫` has told the reader something true before they look
at the plot.

`⑥` also carries the ordering claim. When `EvidenceItem.CanEstablishOrdering == false` the
tag becomes `→ CAUSE (coincident)` — because a 1 Hz sensor cannot prove its change *preceded*
a 142 ms event, and `MetricSeries.CanEstablishOrdering` says so in the model. Rendering the
distinction is not optional.

---

## 5. Five rules for drawing a sparse series honestly next to a dense one

This is the hardest problem on the screen and the one most tools get wrong. A 300 Hz frame
series and a 1 Hz process-CPU series share an x axis. Drawn identically, the 1 Hz series
becomes a smooth curve that appears to have 300 Hz resolution, and the reader concludes the
diagnosis has evidence it does not have.

A series is **dense** when `NativeRateHz ≥ 10`, **sparse** below. The threshold is 10 Hz
because the IPC bucket size is 100 ms (ADR 0001); below that we are not resolving the
transport, let alone the phenomenon.

### Rule 1 — A sparse series is never interpolated. It is stepped and dotted.

Dense: continuous polyline (plus min/max envelope where columns hold > 1 sample).

Sparse: **step-after** — hold each value until the next real sample — **plus a 3 px filled
dot at every real sample**. The dots are the measurement; the steps are the hold. A
straight diagonal between two 1 Hz samples asserts a trajectory that was never observed.

```ts
const dense = series.nativeRateHz >= 10;
// sparse: for each sample i: lineTo(x[i], y[i]); lineTo(x[i+1], y[i]); then arc() a dot at each (x[i], y[i])
```

### Rule 2 — Every real sample is marked, or the rendering switches.

Dots are drawn at every sample, at every zoom. If two adjacent dots would be < 4 px apart,
the series is redrawn as dense (continuous, no dots) — because at that density the dots
*are* the line and drawing them adds nothing. The switch is per-render, driven by pixel
spacing, and it means zooming in on a sparse series reveals its true granularity rather than
smoothing it away.

### Rule 3 — Sample positions are drawn on their own row.

Every sparse panel reserves the bottom **6 px** of its plot area for a **tick row**: a 1 px,
4 px-tall mark in `--text-tertiary` at the exact x of each real sample, on the shared axis.

This is the rule that does the most work. A reader looking at a 4-second window sees four
ticks under the process-CPU panel and three hundred-odd frames above it, and understands the
resolution asymmetry instantly and without a caption. It costs 6 px.

The event span is shaded through the tick row too, so "how many samples landed inside the
event" is directly countable. Often the answer is zero, and that is the most important thing
the panel can say.

### Rule 4 — A series that cannot establish ordering says so, and is de-ranked.

When `MetricSeries.CanEstablishOrdering == false` (sample interval ≥ event duration):

- the trace renders at **70 % opacity**;
- the gutter role tag gains `(coincident)`;
- **no value is drawn beyond the last real sample in either direction.** The step-hold stops
  at the final sample; it does not extend to the panel edge. Extending it would be a
  fabricated value at exactly the moment the reader is looking hardest.
- Bracketing samples that `CorrelationWindow.Build` pulled from *outside* the window are
  drawn, because without them the boundary trajectory is unknown — but they sit outside a
  1 px `--line-default` window boundary and are labelled `bracket` on hover. They are context,
  not window data.

### Rule 5 — Gaps are gaps. Nothing is ever bridged.

Any interval longer than **2.5 × the series' median sample interval** is a gap:

- the trace **breaks**;
- the gap region fills with a 45° hatch, `--chart-hatch`, 4 px pitch, spanning the full panel
  height;
- if the gap is ≥ 40 px wide it carries a centred label, `--t-mono-sm`, `--text-tertiary`:
  `no data 1.8 s`.

A gap is never spanned, never dashed-through, and never imputed. This applies equally to
`Stale`, `Failed` and `Denied` intervals; the hatch is identical and the label carries the
reason (`denied 1.2 s`, `source faulted 3.4 s`).

### Corollaries these five rules imply

- **Min/max labels come from readable samples only.** `MetricSeries.Max()` / `Min()` already
  skip unreadable samples and return `NaN` when there are none. A panel with `NaN` extremes
  renders the whole plot as the unavailable state, not as an empty axis.
- **A panel is never scaled to include zero unless zero was measured.** Y range is
  `[min − 0.1·range, max + 0.1·range]` of readable samples, snapped outward to a round step.
  Forcing a temperature panel to start at 0 °C flattens a 71 → 84 °C climb into nothing.
  Exception: `%` metrics are always `[0, 100]`, because "38 %" means nothing without the
  scale.
- **Per-panel min/max labels** sit at the plot's right edge, `--t-mono-sm`,
  `--text-tertiary`, with a 4 px leader tick: `max` value at the y of the maximum, `min` at
  the y of the minimum, vertically clamped to stay inside the panel and nudged apart if they
  would overlap. They are the panel's y axis — **sparse panels get no y-axis ticks at all**,
  because two numbers at the extremes is more information per pixel than five tick labels and
  it leaves the plot area to the data.

---

## 6. The explanation column — five blocks

Fixed order, always all five, always in this order. A block with nothing to say still
renders, with its reason. Blocks are separated by `--border-hairline` and 20 px of padding;
**no cards, no backgrounds, no rounded containers.**

### Block 1 — WHAT HAPPENED

Label `--t-label` / `--text-tertiary`. Body `Diagnosis.WhatHappened` at `--t-body`.
Facts only. **No cause may appear here** — that is enforced at the rule level
(`RuleEvaluation.WhatHappened`) and reviewed as copy.

Beneath it, a four-item measured strip, `--t-metric-sm`, right-aligned values:

```
Peak frame time     142.3 ms
Baseline median       6.9 ms       ← StutterEvent.BaselineMedianMs
Threshold in force   21.4 ms       ← StutterEvent.ThresholdMs
Duration              210 ms  ·  9 frames  ·  merged from 2
```

`BaselineMedianMs` and `ThresholdMs` are carried on the event precisely so the detection is
reproducible after the fact. Showing them is what lets a sceptical user check the engine's
work, which is the difference between a diagnostic instrument and an oracle.

### Block 2 — MOST LIKELY CAUSE / POSSIBLE CAUSE

- Heading: `MOST LIKELY CAUSE` when `Confidence.Value ≥ 0.60`, `POSSIBLE CAUSE` below.
  (`ConfidenceScore.PossibleRatherThanLikelyThreshold`, and `IsMerelyPossible` is the flag.)
- `Diagnosis.Title` at `--t-subtitle`, `--text-primary`.
- Confidence at `--t-metric-lg`, then a **five-segment discrete meter** (5 × 24 px cells,
  2 px gap, filled cells in `--text-secondary`, empty in `--line-default`) — discrete so it
  reads as a rating, not a percentage, and so confidence is never colour-only.
- `Confidence.BindingCap`, always, as prose:

| Cap | Rendered as |
|---|---|
| `None` | `not capped — this is the raw evidence score` |
| `GlobalCeiling` | `capped at 0.97 — attributing a stutter to a cause is always correlational` |
| `SingleEvidenceClass` | `capped — all evidence came from one family (Power); independent confirmation would raise this` |
| `EstimatedEvidence` | `capped — at least one input was modelled, not measured` |
| `RequiredMetricMissing` | `capped — cpu.temperature was not measurable (no sensor)`, listing every id in `MissingMetrics` |

- When `IsMerelyPossible`, a **required** sentence follows, naming the measurement that would
  settle it: `A CPU die-temperature sensor would separate a thermal limit from a power limit.
  FrameDoctor cannot read one without a kernel-mode driver, which it does not install.`

### Block 3 — MECHANISM

`Diagnosis.Mechanism` at `--t-body`. This is the block that decides whether the product is
worth installing. It answers *why that cause produces that symptom*, in physical terms.

A diagnosis with `Mechanism == null` renders `Mechanism not established.` in
`--text-tertiary` and **the diagnosis title is automatically demoted to `Possible —`**
regardless of its confidence value. A number without a mechanism is a correlation with good
PR.

### Block 4 — EVIDENCE

An ordered list, `Diagnosis.Evidence` order (strongest first). One row each:

```
→ CAUSE                                                    LR 12.0   ████████░░
CPU effective clock fell 4.59 GHz to 1.41 GHz
cpu.clock.effective · 4 Hz · Derived · 9 samples · coincident
```

| Element | Binds to | Type / colour |
|---|---|---|
| Role tag | `EvidenceItem.Role` | `--t-label-sm`; `→ CAUSE` `--text-secondary`, `→ CONSEQUENCE` `--text-tertiary`, `✕ CONTRADICTS` `--sev-warning` |
| Statement | `EvidenceItem.Statement` — authored with the evidence, never templated later | `--t-body` / `--text-primary` |
| Provenance | `Metric`, `NativeRateHz`, `Quality`, `SampleCount`, `CanEstablishOrdering` | `--t-mono-sm` / `--text-tertiary` |
| `LR` | `LikelihoodRatio` | `--t-mono-sm` |
| Contribution bar | `EvidenceItem.BaseLogOdds`, normalised to the largest item in the list | 10 discrete 6 px cells, `--text-secondary` on `--line-default` |

Clicking an evidence row **scrolls its panel into view in the stack and flashes the panel
gutter** with `--motion-select`. That link — sentence to timeline — is the inspector's
reason to exist.

`Consequence` rows carry an inline caption the first time one appears in a diagnosis:
`A consequence corroborates the mechanism but does not explain it.` Once per diagnosis, not
once per row.

### Block 5 — RULED OUT, BLIND SPOTS, AND WHAT TO DO

Three sub-sections, always present.

**Ruled out** — `Diagnosis.RuledOut.Where(r => r.WasCheckable)`. Each renders
`Title` in `--text-secondary` and `Reason` in `--text-tertiary`, prefixed by a 7 px hollow
square. The reason is phrased as the observation — `no process exceeded 5 % CPU` — never
`insufficient evidence`.

**Could not check** — `Diagnosis.BlindSpots` (`!WasCheckable`). Prefixed by a lock glyph, in
`--sev-warning`. Each names the metric that was missing and what would provide it. This
section is what makes the ruled-out list trustworthy: a user who can see the boundary of the
search can believe the search.

**Recommended action** — `Diagnosis.RecommendedAction`. Rendered as a single `--t-body`
paragraph with the actionable object in `--t-body-strong`. When `null`, renders
`No action available. FrameDoctor does not have a safe, evidence-backed change for this.`
in `--text-tertiary` — which, per ADR 0005, is a legitimate and valuable answer.

### The unexplained event

When `Diagnosis.IsExplained == false`, blocks 2–4 change:

- Block 2 heading `NO CAUSE ESTABLISHED`, title `Unexplained`, no confidence number at all
  (not `0.00` — no hypothesis reached the reporting threshold, which is a different thing
  from low confidence).
- Block 3 renders the exclusion sentence:
  `Consistent with an in-engine hitch — shader compilation or asset streaming — which
  FrameDoctor cannot yet observe directly.`
- Block 4 renders `No hypothesis reached the reporting threshold.` and the panel stack shows
  tier 0 plus every checked metric as tier-3 panels, so the user can look for themselves.
- Block 5 becomes the **primary** block and is visually promoted: it moves above block 4 and
  its `Ruled out` heading takes `--t-subtitle`. Ruling out *is* the diagnosis here. This is
  ADR 0005's retention argument, implemented.

---

## 7. Copy rules for diagnosis text

These govern the strings authored in `src/FrameDoctor.Diagnostics/Rules/*.cs`. They are
design rules, not engineering preferences, and a rule that violates them fails review.

**Structure**

1. `WhatHappened` states measurements and never names a cause.
2. `Mechanism` contains a causal chain with at least one physical verb (*waits*, *reduces*,
   *stalls*, *evicts*, *competes*), and names what it **cannot** distinguish when the data
   cannot distinguish it. `CpuFrequencyCollapseRule` is the model: *"a thermal limit, a power
   or current limit, and an operating-system power policy change all look identical without a
   CPU temperature sensor."*
3. `RecommendedAction` names an object the user can act on — a process, a setting, a physical
   part — or is `null`. `"Optimize your system"` is illegal. `"Close OneDrive.exe"` is legal.
4. `RuledOutHypothesis.Reason` is the observation, not the verdict.
   `"no process exceeded 5 % CPU"` ✓ · `"ruled out"` ✗ · `"insufficient evidence"` ✗.
5. `EvidenceItem.Statement` is a complete clause containing its own units, authored where the
   values are in scope. Never assembled later from a template that has lost the unit.

**Quantity**

6. Every claim carries a measured number with its unit. A clause with an adjective and no
   number (*"CPU usage was high"*) is illegal.
7. Numbers follow the formatting table in `design-system.md` §3 exactly. `142 ms` not
   `142.00ms`; `4.61 GHz` not `4610.5 MHz`; `41 %` not `41.0%`.
8. Value and unit are separated by a narrow no-break space `U+202F`, so a line break never
   lands between them.
9. A change states both endpoints and, when useful, the delta: `fell 4.59 GHz to 1.41 GHz`,
   not `fell 69 %`. Both is better: `fell 4.59 GHz to 1.41 GHz (−69 %)`.

**Uncertainty**

10. Uncertainty is carried by the confidence value, the binding cap, and the ruled-out list.
    **It is not carried by hedging prose.** `"may have been caused by"` is banned; the
    heading already says `POSSIBLE CAUSE` and the number already says `0.42`.
11. Correlation is never written as causation. `"while"`, `"in the same window"`,
    `"at the same time"` — not `"because"` — unless the mechanism block establishes the
    causal link and the evidence supports ordering.
12. A `Consequence` is never described in prose as if it were a cause. The GPU dropping to
    42 % during a CPU stall is written `GPU utilization fell to 42 % — the GPU was waiting`,
    with the role tag carrying the claim.
13. Never state or imply 100 % certainty. The hard ceiling is 0.97 and the copy must not
    outrun it.

**Register**

14. Second person, present or simple past. No first person plural — FrameDoctor is an
    instrument, not a colleague. `"Frame time rose to 142 ms"` ✓ · `"We detected…"` ✗.
15. No marketing language, no exclamation marks, no emoji, no "Welcome back", no
    encouragement. `PRODUCT-SPEC.md` forbids all of it.
16. Sentences ≤ 28 words. The paragraph in the Live view's region E is ≤ 3 sentences; the
    inspector's mechanism block is ≤ 5.
17. Jargon is permitted once it has been defined by a number in the same paragraph.
    `"effective clock"` is fine next to `4.59 GHz → 1.41 GHz`. `"DPC time"` requires the
    gloss `time spent in kernel-mode deferred procedure calls` on first use per diagnosis.
18. Never name a vendor product as a culprit without the measurement that implicates it, and
    never name one at all in a `Mechanism` block — mechanisms are physical, not commercial.

**Worked example — the shipping form of the brief's headline sentence**

> **What happened.** Frame time rose to 142 ms against a 6.9 ms baseline and stayed above
> the 21.4 ms threshold for 210 ms.
>
> **Possible cause: CPU frequency collapse.** Confidence 0.52 — capped, cpu.temperature was
> not measurable (no sensor).
>
> **Mechanism.** The CPU reduced its clock from 4.59 GHz to 1.41 GHz while the workload was
> unchanged, so each frame's CPU work took roughly three times longer. Why it reduced the
> clock cannot be determined here: a thermal limit, a power or current limit, and an
> operating-system power-policy change all look identical without a CPU temperature sensor,
> which requires a kernel-mode driver FrameDoctor does not install.
>
> **Recommended action.** If this recurs, check cooling and the Windows power mode. A CPU
> temperature sensor would distinguish the two.

That is 0.52 rather than 0.97, and it is a better product than the confident version because
it is true — and it still sends the user to clean their heatsink.

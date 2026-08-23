# Live view — specification

> **Status: specification.** There is no FrameDoctor build and no screenshot of the real
> product. Every dimension below was measured from a throwaway HTML/uPlot mock rendered
> headlessly at 1280×720, 1920×1080 and 2560×1440 this session, so the numbers are real
> layout output rather than invented. Tagged `[verified]` where measured, `[decision]` where
> chosen, `[unverified]` where it depends on Windows.

Tokens come from `docs/design/design-system.md`. This file never states a colour or a font
size directly.

---

## 1. The two-second test — what answers what

The view must answer five questions in ~2 s. Each is assigned to exactly one region, and
each region is placed so the eye traverses them in order, top-left to bottom-right.

| # | Question | Region | Answered by |
|---|---|---|---|
| 1 | What game is running? | **A. Header** | 16 px game name, first thing on the first row |
| 2 | Is performance healthy *right now*? | **A. Header** state dot + **D. Chart** | one 6 px dot; the shape of the trace against the threshold line |
| 3 | What are FPS and frame consistency? | **B. Metric cluster** | 44 px FPS, then p99 / 1 % low / 0.1 % low at 28 px |
| 4 | Did a stutter just happen? | **D. Chart** event ribbon + **E. Diagnosis** | markers in the ribbon; the diagnosis panel appearing with `--motion-arrive` |
| 5 | What likely caused it? | **E. Diagnosis** | title + one prose paragraph + confidence |

Regions **C** (telemetry strip) and **F** (event log) are deliberately *not* on the
two-second path. They are the second and third glances. That is the whole reason C is
14 px and B is 44 px.

**The test as a build gate:** screenshot the Live view, blur it to `σ = 6 px`, and the
FPS number, the trace, the event markers and the diagnosis title must still be locatable.
If the telemetry strip is legible at that blur, C is too loud.

---

## 2. Layout

Two columns. Nav rail is a fixed 200 px; everything else is one grid column with six rows.

```
┌──────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ NAV RAIL     │  A. HEADER                                                    56px (fixed)   │
│ 200px fixed  │  ● Cyberpunk 2077   Cyberpunk2077.exe · 14872    ELAPSED 00:42:17            │
│              │                                DISPLAY 2560×1440 · 144 Hz  [TELEMETRY 9/11]  │
│ FRAMEDOCTOR  ├──────────────────────────────────────────────────────────────────────────────┤
│  (56px)      │  B. METRIC CLUSTER                                           108px (fixed)   │
│ ─────────────│  FPS · 5 S     │ FRAME TIME P99│ 1 % LOW      │ 0.1 % LOW  │ EVENTS         │
│ ▌Live        │                │               │              │            │                │
│  Sessions    │  143 fps       │  11.4 ms      │  87 fps      │    —       │  6 · 2 severe  │
│  System      │  median 6.9 ms │ p95 8.2 · 6.9 │ 2 041 frames │ needs 2000 │ 1 warm-up excl │
│  Settings    ├──────────────────────────────────────────────────────────────────────────────┤
│              │  C. TELEMETRY STRIP                              34px/row, 1 or 2 rows      │
│              │  CPU 38 %│CLOCK 4.61 GHz│DPC 0.4 %│CPU TEMP —│GPU 97 %│GPU CLOCK 2 610 MHz│…│
│              ├──────────────────────────────────────────────────────────────────────────────┤
│              │  D. FRAME-TIME CHART               clamp(214px, 26vh, 320px)                 │
│              │  FRAME TIME — LAST 60 S      ── frame time  ── min/max  --- baseline 6.9 ms  │
│              │                              --- threshold 21.4 ms  ··· refresh 6.94 ms      │
│              │  25 ms┤- - - - - - - - - - - - -▲- - - - - - - - - - - - - - - - - - - - - - │
│              │  20 ms┤        │              ┃142ms                    │                    │
│              │  15 ms┤        │              ┃                         │                    │
│              │  10 ms┤   ╷    │   ╷      ╷   ┃   ╷        ╷            │   ╷                │
│              │   5 ms┤~~~~~~~~~~~~~~~~~~~~~~~┃~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │
│              │   0 ms┼──────────────────────────────────────────────────────────────────────│
│              │       ╵ RIBBON      ■        ■  ▲          ■              (18px)             │
│              │      -60s    -50s     -40s     -30s     -20s     -10s      now               │
│              ├──────────────────────────────────────────────────────────────────────────────┤
│              │  E. LATEST DIAGNOSIS                                         136px (fixed)   │
│              │ ▌[▲ SEVERE HITCH]  Background CPU contention        CONFIDENCE               │
│              │ ▌ Frame time rose to 142.3 ms against a 6.9 ms baseline…        0.74         │
│              │ ▌ 14:32:07.412 · 3 evidence items, 2 classes · ruled out: …  capped — …      │
│              │ ▌                                                       [ Inspect event → ]  │
│ ─────────────├──────────────────────────────────────────────────────────────────────────────┤
│ OWN OVERHEAD │  F. SESSION EVENT LOG                                        1fr (scrolls)   │
│ 0.4 % · 18MB │  TIME         CLASS          PEAK  EXCESS  DUR  DIAGNOSIS       CONF EVIDENCE│
│              │ ▌14:32:07.412 ▲ Severe hitch  142.3  135.4  210  Background CPU… 0.74  3 items│
│              │  14:29:51.008 ■ Stutter        38.1   31.2   44  Unexplained —…    —  1 blind │
│              │  …                                                                           │
│              │  6 events in 42 min · 4 explained · explanation rate 67 %   floor 21.4 ms     │
└──────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

```css
.app  { display: grid; grid-template-columns: 200px minmax(0, 1fr); height: 100vh; }
.main { display: grid;
        grid-template-rows: 56px 108px auto auto 136px minmax(0, 1fr);
        min-width: 0; overflow: hidden; }
```

### Measured row heights `[verified]`

| Viewport | main col | A | B | C | D (region / plot) | E | F |
|---|---|---|---|---|---|---|---|
| 1280 × 720 | 1080 | 56 | 108 | **68** (2 rows) | 214 / 179 | 136 | 138 |
| 1920 × 1080 | 1720 | 56 | 108 | **34** (1 row) | 281 / 246 | 136 | 465 |
| 2560 × 1440 | 2360 | 56 | 108 | **34** (1 row) | 320 / 285 | 136 | 786 |

At 1280×720 region F shows 4 rows plus the sticky header and the footer summary. That is
the design floor and it is acceptable: the log is the third glance.

`26vh` for the chart, clamped `[214, 320]`. Below 214 px a 60-second frame-time trace loses
the vertical resolution to distinguish 6.9 from 11.4 ms; above 320 px the plot becomes a
poster and starves the event log. Both bounds are hit exactly at 720 and 1440.
`[verified]`

---

## 3. Region A — header (56 px)

`background: var(--bg-raised)`, `border-bottom: var(--border-default)`, padding `0 var(--gutter-view)`.
Single flex row, `align-items: center`, `gap: var(--sp-4)` (14 px between the first three
items, 20 px between the right-hand group's items).

| Slot | Binds to | Type token | Colour | Behaviour |
|---|---|---|---|---|
| State dot, 6 px circle | derived: capture running + `frame.time` availability | — | `--sev-normal` running / `--sev-warning` capture degraded / `--text-tertiary` no game | 3 px ring in the matching `-wash` token. **Never blinks.** |
| Game name | `sys.*` game title (session) | `--t-title` | `--text-primary` | truncates with ellipsis at `min-width: 0`; full name in `title` |
| Executable · pid | session metadata | `--t-mono` | `--text-tertiary` | never truncates; drops out below `compact` |
| `ELAPSED` + value | monotonic session clock | `--t-label-sm` key / `--t-metric-sm` value | `--text-tertiary` / `--text-secondary` | ticks at 1 Hz, from the 10 Hz headline setState, not its own timer |
| `DISPLAY` + value | `sys.*` monitor config + refresh | same | same | static per session |
| Availability chip | aggregate of all bound metrics | `--t-label-sm` | see `availability-states.md` §5 | click → System view, telemetry sources table |

**No game running.** The dot goes `--text-tertiary`, the name slot reads
`No game detected` in `--text-secondary`, the executable slot reads
`Watching for a known game · 214 executables in catalog` in `--t-mono`. Regions B–F render
their empty states (§9). **The Live view is never blank.**

---

## 4. Region B — metric cluster (108 px)

`display: flex; align-items: flex-end; padding: 14px var(--gutter-view) 12px;`
`border-bottom: var(--border-hairline)`.

Five cells. `.m { padding-right: 40px }`, `.m + .m { padding-left: 40px; border-left: var(--border-hairline) }`.

**No cell has a background or a border-box.** The vertical hairline plus 80 px of combined
padding is the entire separation mechanism. This is the ADR 0004 review gate.

Each cell is `label / value+unit / sub-line`:

| # | Label | Value binds to | Value type | Sub-line binds to |
|---|---|---|---|---|
| 1 | `FPS · 5 S` | `frame.fps.rolling` (`MetricId.FrameFpsRolling`) | `--t-hero` | `frame.time.median` → `median 6.9 ms` |
| 2 | `FRAME TIME P99` | `frame.time.p99` (`FrameTimeP99`) | `--t-metric-lg` | `frame.time.p95` + `frame.time.median` → `p95 8.2 · median 6.9` |
| 3 | `1 % LOW` | `frame.low.1pct` (`FrameLow1Pct`) | `--t-metric-lg` | window frame count → `2 041 frames in window` |
| 4 | `0.1 % LOW` | `frame.low.01pct` (`FrameLow01Pct`) | `--t-metric-lg` | when `InsufficientData`: `needs 2 000 frames · have 1 204` |
| 5 | `EVENTS THIS SESSION` | `frame.stutter.count` + `frame.stutter.severe.count` | `--t-metric-lg` | `1 warm-up hitch excluded` when any `DuringWarmUp` event exists |

Cell 1 is the hero at 44 px / weight 620. Cells 2–5 are 28 px / weight 600. The ratio is
1.57 — enough that the eye lands on FPS first without the others becoming secondary noise.

### Why p99 and not "frame time"

The instantaneous frame time is already the chart. A single scalar labelled "frame time"
next to a chart of frame time is redundant, and the number the user actually cannot read off
the chart is the tail. `[decision]`

### Cell 4 is the honesty cell

`frame.low.01pct` requires 2 000 frames (`docs/architecture/telemetry-model.md`,
*Percentile definitions*). For the first ~15 seconds of any session it is `Unavailable /
InsufficientData`. It renders `—` in `--text-tertiary` at `--t-metric-lg`, with the exact
counts in the sub-line. It **never** shows a provisional number, and it never disappears —
a cell that vanishes when data is thin teaches the user that absence means nothing happened.

### `[decision]` Unit colour and the units-subdued rule

Unit spans are `--t-label-sm` / `--text-tertiary`, 4 px gap. At 44 px value against a 10 px
unit the ratio is 4.4:1 — the value dominates completely, which is correct. Do not scale the
unit with the value.

---

## 5. Region C — telemetry strip (34 px per row, 1–2 rows)

```css
.tele { display: grid;
        grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
        padding: 0 var(--gutter-view);
        border-bottom: var(--border-hairline); }
.t    { display: flex; align-items: baseline; gap: var(--sp-2);
        padding: 0 14px; height: 34px; border-left: var(--border-hairline); min-width: 0; }
```

`minmax(148px, 1fr)` is not arbitrary: the widest item is `GPU CLOCK  2 610 MHz` and it
requires 128 px of glyphs plus 28 px of padding. `[verified]` — at 124 px the label and
value collide at 1280×720; at 148 px they do not, and 11 items reflow to 6 + 5.

Items, in fixed order (never reordered by value — a strip that re-sorts is unreadable):

| Label | `MetricId` | Format |
|---|---|---|
| `CPU` | `CpuLoadTotal` | `38 %` |
| `CLOCK` | `CpuClockEffective` | `4.61 GHz` |
| `DPC` | `CpuDpcTime` | `0.4 %` |
| `CPU TEMP` | `CpuTemperature` | `71 °C` — commonly `—` |
| `GPU` | `GpuUtilization` | `97 %` |
| `GPU CLOCK` | `GpuClockCore` | `2 610 MHz` |
| `GPU TEMP` | `GpuTemperature` | `71 °C` |
| `VRAM` | `GpuVramUsed` / `GpuVramTotal` | `9.8 / 12 GB` |
| `RAM` | `MemoryUsed` / `MemoryTotal` | `21.4 / 32 GB` |
| `FAULTS` | `MemoryHardFaults` | `0 /s` |
| `DISK` | `DiskLatency` (busiest instance) | `0.4 ms` |

Label `--t-label-sm` / `--text-tertiary`, left. Value `--t-metric-md` / `--text-primary`,
`margin-left: auto` so **every value in a column right-aligns** — with tabular figures that
produces a true decimal grid across two rows.

**No bars, no sparklines, no gauges in this strip.** Eleven micro-charts is the "twenty tiny
gauges" the product spec explicitly forbids. If a value needs context, it belongs in the
inspector. `[decision]`

Non-`Available` values render per `availability-states.md` §2 — `—` in `--text-tertiary`,
reason on hover, **no per-item warning glyph**.

---

## 6. Region D — the frame-time chart

This is the product. Specified completely.

### 6.1 Geometry

```
region height  = clamp(214px, 26vh, 320px)
 ├─ 12px  padding-top
 ├─ 15px  title row (--t-label + legend, right-aligned)
 ├─  8px  margin
 └─ plot host = region − 35px            [verified: 246px at 1080, 179px at 720]

inside the plot host, uPlot geometry:
 uPlot padding      = [10, 10, 0, 0]      (top, right, bottom, left)
 y-axis size        = 46px                (fits "25 ms" at --t-label-sm plus 8px gap)
 x-axis size        = 38px  = 20px labels + 18px event ribbon
 plot area height   = host − 38 − 10      [verified: 198px at 1080]
 plot area width    = host width − 46 − 10
```

The ribbon is **inside** the x-axis allocation (`axes[0].size = 20 + RIBBON`, `gap = RIBBON`)
so uPlot reserves the space and the tick labels sit below the ribbon, not on top of it.
`[verified]`

### 6.2 X axis

- Window: **last 60 s**, right edge = now. Fixed. Not user-scrollable in the Live view —
  history is the Sessions view's job, and a scrubbing live chart is a chart nobody can read
  at a glance.
- Ticks every 5 s (10 s below `compact`), labelled `-60 s … -10 s`, and the right-most tick
  is the literal word `now`.
- Values are seconds-before-now derived from `MonotonicTimestamp`. Wall-clock never enters
  the axis (`telemetry-model.md`, *Clocks*).
- On a **discontinuity** (suspend/resume) the axis draws a 2 px vertical `--line-strong` bar
  with the label `clock discontinuity` rotated in the ribbon, and the trace breaks. Series
  are never drawn across it.

### 6.3 Y axis — fixed default, and exactly when it expands

**Default range is `[0, 25] ms`, fixed.** Not auto-ranged.

This is the single most consequential chart decision in the product. Auto-ranging a
frame-time series means a 142 ms hitch rescales the axis, the 6.9 ms baseline collapses to a
flat line at the bottom, and **the chart's appearance stops being comparable from one second
to the next.** A fixed axis makes "healthy" a *shape you learn*.

The range expands under exactly two conditions, and contracts under one:

| Trigger | New range | Notes |
|---|---|---|
| `p99.5` of visible frames > `0.7 × axisMax` for **3 consecutive seconds** | `[0, nextStep(p99.5 / 0.7)]` | sustained-low-performance regime; the whole trace has moved up |
| `refreshInterval × 3 > axisMax` | `[0, nextStep(refreshInterval × 3)]` | a 30 Hz display makes 25 ms the *normal* frame time; evaluated once at session start |
| `p99.5 < 0.4 × axisMax` for **20 consecutive seconds** | contract one step | hysteresis is deliberately asymmetric: 3 s to grow, 20 s to shrink |

`nextStep()` snaps to the ladder `[25, 40, 60, 100, 160, 250, 400]` ms. Never a continuous
value — an axis that slides by 3 ms is an axis that flickers.

Range changes animate with `--motion-select` **on the axis labels and gridlines only**; the
trace re-renders instantly at the new scale in the same frame. The axis top always carries a
1-frame `--sev-warning` flash at `--motion-state` when it expands, so a range change is never
silent. Under `prefers-reduced-motion`, no animation; the label change is the signal.

### 6.4 Off-scale spikes — the clipped-spike rule

A 142 ms spike on a `[0, 25]` axis **must not be silently clipped, and must not be allowed
to rescale the axis.** Both are wrong. The rendering is:

1. The min/max envelope column is drawn to the top edge of the plot area.
2. A **filled chevron**, 8 px wide × 6 px tall, apex up, in the severity colour of the
   containing event, is drawn flush with the top edge at that column.
3. The peak value is printed **in the event ribbon** next to the event's marker, as
   `142 ms`, `--t-mono-sm` in the severity colour — *not* inside the plot area.

Point 3 is a correction to the obvious design. `[verified]` — drawing the peak label inside
the plot at the top edge collides with the `21.4 ms` threshold reference line, which sits at
86 % of a `[0,25]` axis. The ribbon is empty space that already belongs to the event.

Off-scale chevrons are coalesced: at most one label per 70 px of x, and no label within
34 px of either plot edge.

### 6.5 Reference lines

Three horizontal references, drawn in the `draw` hook **below** the trace (uPlot's
`drawOrder` stays `["axes","series"]`; references are drawn first inside the hook, then the
series is drawn by the `drawSeries` hook which fires later).

| Line | Value | Style | Token | Label |
|---|---|---|---|---|
| **Display refresh interval** | `1000 / sys.refreshHz` | 1 px dotted, dash `[1,3]` | `--chart-refresh` | in the legend: `refresh 6.94 ms` |
| **Rolling baseline median** | `frame.time.median` | 1 px dashed, dash `[4,3]` | `--chart-baseline` | legend: `baseline 6.9 ms` |
| **Stutter threshold** | live threshold from the detector | 1 px dashed, dash `[6,4]` | `--chart-threshold` | legend: `threshold 21.4 ms` |

The refresh-interval line is the most under-rated of the three. Without it, "is 8.2 ms good"
is unanswerable; with it, the user sees at a glance whether the trace is riding the vsync
floor or above it. It is drawn even when the game is uncapped.

The threshold line is the detector's own `ThresholdMs`, live. When the detection floor is
high — ADR 0006 records a measured floor of 29.2 ms at 25–40 fps — the line sits visibly
high, and the legend appends `(regime floor)`. That is the "publish the per-regime floor in
the UI" mitigation, discharged here.

All three lines are drawn with `y = Math.round(u.valToPos(v, 'y', true)) + 0.5` to land on a
pixel boundary. Blurry 1 px references are the fastest way to make a chart look cheap.

### 6.6 The series — min/max column decimation, drawn by us

uPlot draws **no series**. Confirmed by reading `uPlot.esm.js:4198-4256`: `drawSeries()`
calls `s.paths(...)`, and when the result is `null`, `s._paths == null` short-circuits
`drawPath`. The `drawSeries` hook still fires. `[verified]` — and confirmed visually in a
headless screenshot where our own trace rendered and uPlot's did not.

```ts
series: [
  {},
  {
    // typed: PathBuilder returns `Paths | null` (uPlot.d.ts:869)
    paths:  () => null,
    points: { show: false },   // REQUIRED — points are drawn independently of _paths
    scale:  'y',
  },
]
```

> **Gotcha, easy to miss:** returning `null` from `paths` does *not* disable points.
> `drawSeries()` still evaluates `s.points.show(...)` and will draw hover/density points.
> `points: { show: false }` is mandatory. `[verified]` — read at `uPlot.esm.js:4238-4245`.

Per pixel column, over the visible index range, compute `min`, `max` and `last`. Draw two
passes:

```ts
function drawFrameTime(u: uPlot, seriesIdx: number) {
  if (seriesIdx !== 1) return;
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;   // CANVAS pixels, already × dpr
  const dpr = devicePixelRatio;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();                       // uPlot does NOT clip for us — verified

  // pass 1 — envelope: one vertical segment per column, min→max
  ctx.strokeStyle = C.envelope;     // cached from --chart-envelope
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (let k = 0; k < cols; k++) {
    const x = left + Math.round(k * dpr) + 0.5 * dpr;
    ctx.moveTo(x, u.valToPos(mins[k], 'y', true));
    ctx.lineTo(x, u.valToPos(maxs[k], 'y', true));
  }
  ctx.stroke();

  // pass 2 — core: polyline through each column's last value
  ctx.strokeStyle = C.trace;
  ctx.lineWidth = 1.25 * dpr;
  ctx.beginPath();
  for (let k = 0; k < cols; k++) {
    const x = left + Math.round(k * dpr) + 0.5 * dpr;
    const y = u.valToPos(lasts[k], 'y', true);
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}
```

Two passes, not one, and the reason is a design reason:

- The **envelope** (`--chart-envelope`, dimmer) is the honest one. Min/max column decimation
  cannot drop a single-frame spike — that property is the entire justification recorded in
  ADR 0004. At 1672 px and 1800 samples it is ~1.08 samples/column, so the envelope *is* the
  data; at 60 s of a 300 fps game it is 10.8 samples/column and the envelope is what stops a
  spike disappearing.
- The **core** (`--chart-trace`, near-white, 11.65:1 on `--bg-panel`) is what the eye tracks
  for regime and shape. Without it, dense data reads as a fuzzy blue band with no trend.

Never `lineJoin: 'round'`, never a gradient fill under the trace, never a shadow.

### 6.7 Event ribbon (18 px, directly under the plot area)

A dedicated horizontal band, not markers floating in the plot. It exists so that events
have a home that does not occlude data.

| Element | Rendering |
|---|---|
| Severe hitch | full-height vertical band across the **plot area** at `α = 0.85`, 3 px wide, `--sev-critical`; plus a **filled triangle** 10×10 px in the ribbon, apex up; plus the peak label `142 ms` in `--t-mono-sm` to the right of the triangle |
| Stutter / micro-stutter | 1 px vertical line across the plot at `α = 0.5`, `--sev-warning`; **filled square** 6×6 px in the ribbon |
| Pacing micro-stutter | same line; **filled diamond** 7×7 px |
| Dropped-frame burst | same line; **hollow square** 6×6 px, 1 px stroke |
| Warm-up event | no plot-area line at all; **hollow square** in `--text-tertiary` in the ribbon only |
| Regime change | 1 px `--line-strong` vertical line across the plot; **2×9 px bar** glyph in the ribbon |
| Selected event | any of the above gains a 1 px `--sev-selected` outline and the event's `Start..End` span shades `--chart-selection` |

Markers within 8 px of each other collapse into a **cluster glyph**: the highest-severity
shape with a superscript count (`▲³`) in `--t-mono-sm`. Hovering a cluster lists its
members. Never stack overlapping markers.

New markers arrive with `--motion-arrive`. Under reduced motion they paint immediately and
the matching event-log row takes a 200 ms static `--sev-selected` outline instead.

### 6.8 Cursor and hover

`cursor: { points: { show: false }, sync: { key: 'live' }, drag: { setScale: false } }`

- Crosshair: 1 px vertical `--chart-cursor`, no horizontal line. A horizontal crosshair on a
  spiky series is noise.
- A **readout block** replaces the legend row in place (same 15 px line, no layout shift):
  `-18.4 s   frame 142.3 ms   min 6.4  max 142.3  n 12   fps 7`, `--t-mono-sm`, values in
  `--text-primary`, labels `--text-tertiary`.
- `n` is the number of real samples in the hovered column. It is not decoration: it tells the
  reader whether they are looking at one frame or twelve.
- Hovering an event marker in the ribbon shows a 3-line popover: class, peak/excess, and the
  diagnosis title. Clicking it selects the event — which updates region E, highlights the row
  in region F, and shades the span. It does **not** open the inspector; that needs a second,
  deliberate action.
- `drag.setScale: false`: dragging in the Live chart selects a time range and offers
  `Open 12.4 s in inspector`. It never zooms the live axis.

### 6.9 Update discipline

Straight out of ADR 0004, restated as UI obligations:

- The ring buffer is module scope. React never sees a sample.
- One `rAF` loop draws the canvas; it returns immediately if the ring's monotonic `seq` is
  unchanged. A paused game costs nothing.
- One `setInterval(100 ms)` derives the ~10 headline numbers for regions B and C into a
  single `setState`. **≤ 10 React commits/sec**, measured at 10.00 in ADR 0004.
- `u.setData(data, false)` — the `false` matters. The default `resetScales = true`
  auto-ranges the y scale on every update and would silently undo §6.3. `[verified]`,
  `uPlot.d.ts:74`.
- Redraw budget p95 ≤ 3 ms. Instrument it and surface it in the nav rail footer
  (`OWN OVERHEAD 0.4 % CPU · 18 MB`) — invariant 8.

---

## 7. Region E — latest diagnosis (136 px, fixed)

```css
.evt { display: grid;
       grid-template-columns: 3px minmax(0, 1fr) 216px;   /* 180px under `compact` */
       gap: var(--sp-4);
       background: var(--bg-raised);
       border-bottom: var(--border-default);
       padding: 14px var(--gutter-view); }
```

| Column | Contents |
|---|---|
| 3 px severity bar, full height | `--sev-critical` / `--sev-warning` / `--text-tertiary` |
| Body | severity tag + diagnosis title (`--t-subtitle`), one paragraph (`--t-body`, `max-width: 104ch`), meta line (`--t-mono`) |
| Right, right-aligned | `CONFIDENCE` label, the value at `--t-metric-lg`, the binding cap in `--t-label-sm`, then the `Inspect event →` button |

Binds to the newest `Diagnosis` for a `StutterEvent` where `CountsTowardTally == true`, or
to the user-selected event.

- **Severity tag** — `▲ SEVERE HITCH`, `--t-label-sm` weight 600, 1 px outline in the
  severity colour, `--r-sm`. Shape + colour + word: three channels.
- **Title** — `Diagnosis.Title`. When `Confidence.IsMerelyPossible` the title is prefixed
  `Possible — `.
- **Paragraph** — `WhatHappened` then `Mechanism`, joined by a space, with every measured
  quantity wrapped `<b>` (`--text-primary`, weight 600) against `--text-secondary` prose.
  This is the "numbers are the hero" rule applied inside running text, and it is what makes
  a 3-line paragraph scannable in the two-second window.
- **Meta line** — `HH:mm:ss.SSS · N evidence items, M classes · ruled out: a, b, c`. Mono,
  `--text-tertiary`. Truncates from the right with `…`, never wraps.
- **Confidence** — `0.74` at `--t-metric-lg`. Directly beneath, `Confidence.BindingCap`
  rendered as prose: `capped — cpu.temperature unavailable (no sensor)`. The cap is not an
  advanced detail; it is the reason the number is not higher, and hiding it is exactly the
  overstatement invariant that this product exists to avoid.
- **Button** — `Inspect event →`, `--border-strong`, 28 px tall, `--r-md`. Also bound to
  <kbd>Enter</kbd> on the selected event-log row.

### The three states of region E

| State | Rendering |
|---|---|
| No events yet this session | severity bar `--text-tertiary`; title `No events detected`; body: `42 minutes measured · 152 400 frames · baseline 6.9 ms · detection threshold 21.4 ms`. Confidence column is empty, not `—`. |
| Latest event is unexplained | severity bar in the event's severity; title `Unexplained`; body is the exclusions sentence (see `event-inspector.md` §6); confidence column shows `—` with the caption `no hypothesis reached the reporting threshold` |
| Diagnosis pending | title `Analysing…`; body `Correlation window closes 2.0 s after the event.` Determinate, not a spinner. Maximum lifetime 3 s; after that it is a `Failed` state with a reason. |

**The empty state is never a large empty area.** It is 136 px of specific measured facts,
which is also the "clean session" definition-of-done item.

---

## 8. Region F — session event log (1fr, scrolls)

A dense table, not cards. Sticky header. Row height 28 px.

| Column | Binds to | Align | Type |
|---|---|---|---|
| `TIME` | `StutterEvent.Start` + session epoch | left | `--t-mono` / `--text-tertiary` |
| `CLASS` | `StutterEvent.Class` | left | shape glyph + `--t-body-sm` |
| `PEAK MS` | `PeakFrameTimeMs` | right | `--t-metric-sm` |
| `EXCESS MS` | `ExcessMs` | right | `--t-metric-sm` |
| `DUR MS` | `Duration` | right | `--t-metric-sm` |
| `DIAGNOSIS` | `Diagnosis.Title` | left | `--t-body-sm` / `--text-primary` |
| `CONF` | `Confidence.Value` | right | `--t-metric-sm` |
| `EVIDENCE` | `N items · M classes`, or `K ruled out · J blind spots` | left | `--t-body-sm` / `--text-secondary` |

- Newest first. New rows insert at the top with `--motion-arrive`.
- Row selection drives region E, the chart span shade and the chart cursor. Full keyboard
  navigation: <kbd>↑</kbd>/<kbd>↓</kbd> select, <kbd>Enter</kbd> inspect, <kbd>Home</kbd>/<kbd>End</kbd>.
- Warm-up rows render the whole row in `--text-tertiary` with a hollow-square glyph and
  `Not counted — warm-up` in the diagnosis column. They are present because hiding them
  would make the tally unverifiable, and de-emphasised because they are not what the user
  means by "my game stuttered" (`StutterEvent.CountsTowardTally`).
- `EVIDENCE` column hides below `compact`.

### Footer line (28 px, sticky to the bottom of the region)

```
6 events in 42 min · 4 explained · 2 unexplained · explanation rate 67 %     Detection floor
                                                       for this regime: 21.4 ms · 152 400 frames
```

`--t-body-sm` / `--text-tertiary`, `border-bottom: var(--border-hairline)`.

**Explanation rate is the release-gating KPI** in ADR 0005. Putting it in the product, in
the user's own session, is the strongest possible commitment to not shipping a tool that
detects and cannot explain.

The footer is also what bounds the empty area at 1920×1080 and above, where six events leave
~300 px of unused height. That space stays empty and dark — a deliberately quiet region is
correct; filling it with a decorative chart is not.

---

## 9. Empty, degraded and failure states

| Condition | Region A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| No game running | dot tertiary, `No game detected` | all cells `—` with `no active capture` | all `—` | plot area hatched, label `No capture running` | `Waiting for a game` + what FrameDoctor is watching for | `No session` |
| Game running, PresentMon denied (`EtwProviderSlotsExhausted`) | dot `--sev-warning`, chip warns | frame cells `—`, reason `frame capture unavailable` | **still live** — system telemetry is independent | hatched band across the whole plot with the reason and the fix | `Frame capture unavailable` + the specific remedy | `No events — not measuring` |
| Capture interrupted mid-session | dot `--sev-warning` | frame cells `—` | live | hatched band **only over the affected interval**, trace resumes after | unchanged | unchanged |
| Engine process gone | dot `--text-tertiary` | all `—` | all `—` | frozen at last data, dimmed 55 %, `Engine not responding · last data 14 s ago` | `Connection lost` + `Retry` | frozen |

The frame-capture-denied message is a definition-of-done item (`PRODUCT-SPEC.md` §16) and
must be specific enough to act on:

> **Frame capture unavailable.** Windows allows a limited number of concurrent trace sessions
> for the graphics provider, and they are all in use. Close other overlay or capture tools
> (RivaTuner, MSI Afterburner, the Xbox Game Bar) and click Retry. System telemetry below is
> unaffected. `[unverified]` — the remedy text needs Windows validation before release.

**Nothing on this screen ever renders a missing metric as `0`.** See
`availability-states.md`.

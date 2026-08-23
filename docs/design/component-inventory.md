# Component inventory — the tree to build

> **Status: specification.** This is the file to code from. Every component is named, has
> props, and is classified by its relationship to the ring buffer.

Stack fixed by ADR 0004: WPF shell → WebView2 → React 19 + TypeScript, uPlot **1.6.32** for
axes/scales/cursor, hand-written Canvas 2D for every series.

**Pin uPlot exactly:** `"uplot": "1.6.32"` — no caret. `[verified]` 1.6.32 is the latest
published version as of this session; the hooks and `paths → null` behaviour were read from
its source and exercised headlessly. A minor bump changes `drawSeries()` internals we depend
on.

---

## 0. Classification legend

| Mark | Meaning |
|---|---|
| **○** | **Pure presentational.** Props in, DOM out. No effects touching data, no imperative handles, trivially testable and screenshot-testable. |
| **▲** | **Touches the ring buffer.** Reads module-scope mutable data on `rAF` or `setInterval`. Must never call `setState` per sample. These are the only components allowed to. |
| **◑** | **Owns an imperative canvas instance** (a uPlot handle) but consumes **immutable** data. Inspector panels: the window snapshot arrives once, then never changes. |
| **◆** | **Talks to the shell over IPC** (`.ctl` request/response). Suspends; has explicit loading and failure states. |

There are exactly **three** ▲ components and **two** ▲ hooks in the whole application. If a
fourth appears, the data-flow contract from ADR 0004 has been broken.

---

## 1. Module layout

```
src/FrameDoctor.Shell/web/src/
├── main.tsx
├── App.tsx
├── styles/          tokens.css · base.css · utilities.css
├── ipc/
│   ├── transport.ts     WebView2 bridge, binary .dat decode + JSON .ctl
│   ├── ring.ts          ▲ the ring buffer. Module scope. Not React state.
│   ├── headline.ts      ▲ 10 Hz derivation of the ~10 numbers React sees
│   └── wire.ts          types mirroring the C# structs
├── hooks/
│   ├── useHeadline.ts       ▲
│   ├── useRingDraw.ts       ▲
│   ├── useEventWindow.ts    ◆
│   ├── useSessionList.ts    ◆
│   ├── useCanvasTokens.ts   cached CSS custom properties for canvas code
│   ├── useReducedMotion.ts
│   └── useSelectedEvent.ts  selection store (zustand or context; not per-sample)
├── charts/
│   ├── plot.ts          createPlot(): the one uPlot factory
│   ├── decimate.ts      pure: min/max/last per pixel column
│   ├── drawSeriesDense.ts · drawSeriesSparse.ts
│   ├── drawReferences.ts · drawRibbon.ts · drawGaps.ts · drawOffScaleCaps.ts
│   └── format.ts        pure: every number → string, per design-system §3
├── components/   (all ○ unless marked)
└── views/
```

---

## 2. Data types (`ipc/wire.ts`)

These mirror the C# records so the whole tree is typed against the real model. Names match
`MetricId`, `Availability`, `Quality`, `StutterClass`, `EvidenceRole`, `EvidenceClass`,
`ConfidenceCap`.

```ts
export type MetricId =
  | 'frame.time' | 'frame.fps.rolling' | 'frame.time.median' | 'frame.time.p95'
  | 'frame.time.p99' | 'frame.low.1pct' | 'frame.low.01pct' | 'frame.animation_error'
  | 'frame.dropped' | 'frame.stutter.count' | 'frame.stutter.severe.count'
  | 'cpu.load.total' | 'cpu.load.core' | 'cpu.clock' | 'cpu.clock.effective'
  | 'cpu.temp' | 'cpu.power' | 'cpu.throttle.state' | 'cpu.dpc.time' | 'cpu.isr.time'
  | 'gpu.util' | 'gpu.clock.core' | 'gpu.clock.memory' | 'gpu.vram.used'
  | 'gpu.vram.total' | 'gpu.temp' | 'gpu.temp.hotspot' | 'gpu.power' | 'gpu.throttle.reason'
  | 'mem.total' | 'mem.used' | 'mem.available' | 'mem.committed' | 'mem.commit.limit'
  | 'mem.pagefault.hard'
  | 'disk.active' | 'disk.read' | 'disk.write' | 'disk.latency' | 'disk.queue'
  | 'proc.cpu' | 'proc.mem.working_set' | 'proc.disk.bytes' | 'proc.gpu.util'
  | 'self.cpu' | 'self.working_set' | 'self.telemetry_latency';

export type Availability = 'Available' | 'Unavailable' | 'Denied' | 'Failed' | 'Stale';
export type Quality      = 'Exact' | 'Derived' | 'Estimated' | 'Degraded';
export type UnavailableReason =
  | 'NoSensor' | 'RequiresSensorDriver' | 'InsufficientPrivilege' | 'NotExposedByVendor'
  | 'InsufficientData' | 'NotYetSampled' | 'SourceFaulted' | 'EtwProviderSlotsExhausted'
  | 'TargetProcessProtected' | 'NotMeaningfulInCurrentState' | 'ClockDiscontinuity';

export type Unit = 'ms' | 'ms2' | 'fps' | '%' | 'MHz' | '°C' | 'W' | 'MB' | 'B/s'
                 | 'count' | '/s' | 'flags' | 'none';

/** A metric ready to render. The ONLY shape a readout component accepts. */
export interface Readout {
  metric: MetricId;
  instance?: number;
  value: number | null;            // null iff availability !== 'Available' && !== 'Stale'
  unit: Unit;
  availability: Availability;
  reason?: UnavailableReason;
  reasonDetail?: string;           // e.g. "needs 2 000 frames · have 1 204"
  quality: Quality;
  ageMs?: number;                  // Stale only
}

export type StutterClass =
  | 'Normal' | 'MicroStutter' | 'Stutter' | 'SevereHitch'
  | 'PacingMicroStutter' | 'DroppedFrameBurst' | 'SustainedLowPerformance' | 'RegimeChange';

export interface StutterEventDto {
  id: string;
  class: StutterClass;
  startTicks: number; endTicks: number;   // monotonic, session epoch
  peakFrameTimeMs: number; excessMs: number; thresholdMs: number;
  baselineMedianMs: number; baselineScaleMs: number;
  frameCount: number; mergedCount: number;
  duringWarmUp: boolean; forceClosed: boolean;
  countsTowardTally: boolean;
}

export type EvidenceRole = 'Cause' | 'Consequence' | 'Contradicting';
export type EvidenceClassName =
  | 'Frame' | 'Thermal' | 'Power' | 'Contention' | 'Memory' | 'Storage'
  | 'Driver' | 'Configuration';

export interface EvidenceItemDto {
  metric: MetricId; instance?: number;
  statement: string;
  likelihoodRatio: number;
  class: EvidenceClassName;
  role: EvidenceRole;
  sampleCount: number;
  nativeRateHz: number;
  canEstablishOrdering: boolean;
  quality: Quality;
  baseLogOdds: number;             // for the contribution bar
}

export type ConfidenceCap =
  | 'None' | 'GlobalCeiling' | 'SingleEvidenceClass'
  | 'EstimatedEvidence' | 'RequiredMetricMissing';

export interface ConfidenceDto {
  value: number; rawValue: number; logOdds: number;
  bindingCap: ConfidenceCap; missingMetrics: MetricId[];
  isMerelyPossible: boolean;       // value < 0.60
}

export interface RuledOutDto {
  ruleId: string; title: string; reason: string; wasCheckable: boolean;
}

export interface DiagnosisDto {
  event: StutterEventDto;
  ruleId: string | null;           // null ⇒ unexplained
  title: string;
  confidence: ConfidenceDto;
  whatHappened: string;
  mechanism: string | null;
  recommendedAction: string | null;
  evidence: EvidenceItemDto[];     // strongest first
  ruledOut: RuledOutDto[];
  isExplained: boolean;
}

/** One metric's samples in a correlation window. Immutable once received. */
export interface SeriesSnapshot {
  metric: MetricId; instance?: number;
  displayName: string;
  x: Float64Array;                 // seconds relative to event start
  y: Float64Array;                 // NaN where the sample was not readable
  unit: Unit;
  availability: Availability;
  reason?: UnavailableReason;
  quality: Quality;
  sampleCount: number; readableCount: number;
  nativeRateHz: number;
  canEstablishOrdering: boolean;
  min: number; max: number;        // NaN when readableCount === 0
  sourceId: string;
  bracketBeforeIdx: number; bracketAfterIdx: number;  // -1 when absent
}

export interface EventWindow {
  event: StutterEventDto;
  diagnosis: DiagnosisDto;
  startSec: number; endSec: number;
  series: SeriesSnapshot[];
}
```

---

## 3. The ring buffer and the two hooks that touch it

### `ipc/ring.ts` ▲

Module scope. **Not a React store. Not a context. Not exported as state.**

```ts
export interface Ring {
  /** monotonically increasing; rAF returns early when unchanged */
  readonly seq: number;
  /** capacity 6000 buckets = 600 s at 100 ms. Fixed, preallocated. */
  readonly capacity: number;
  readonly count: number;
  /** column-major, preallocated Float64Array per channel; NEVER reallocated */
  readonly t: Float64Array;           // seconds since session epoch
  readonly frameMin: Float64Array;
  readonly frameMax: Float64Array;
  readonly frameLast: Float64Array;
  readonly frameN: Int32Array;        // real frames in the bucket
  readonly channels: Map<MetricId, Float64Array>;
  readonly availability: Map<MetricId, Uint8Array>;
}

export function pushBucket(b: WireBucket): void;   // called by transport, ~10 Hz
export function snapshotRange(fromSec: number, toSec: number): RangeView;
export function getRing(): Ring;
```

Rules, from ADR 0004 and non-negotiable:

- Zero allocation in `pushBucket`. Preallocated typed arrays, head index, wraparound.
- `seq` increments once per bucket. Nothing else may mutate it.
- No React import in this file. Enforce with an ESLint `no-restricted-imports` rule.

### `hooks/useHeadline.ts` ▲

```ts
export interface Headline {
  fpsRolling: Readout;
  frameTimeP99: Readout; frameTimeP95: Readout; frameTimeMedian: Readout;
  low1pct: Readout; low01pct: Readout;
  windowFrameCount: number;
  stutterCount: number; severeCount: number; warmUpExcluded: number;
  telemetry: Readout[];              // the 11 strip items, fixed order
  availability: { available: number; consulted: number;
                  byReason: Record<UnavailableReason, MetricId[]>;
                  frameCaptureLost: boolean };
  elapsedMs: number;
  seq: number;
}

export function useHeadline(): Headline;
```

One `setInterval(100)`. One `setState` per tick. **10 commits/sec, hard ceiling** — the
number ADR 0004 measured at exactly 10.00. Add a dev-mode assertion that fails loudly above
12.

### `hooks/useRingDraw.ts` ▲

```ts
export function useRingDraw(
  draw: (ring: Ring, dtMs: number) => void,
  enabled: boolean,
): void;
```

One `requestAnimationFrame` loop. Captures `lastSeq`; if `ring.seq === lastSeq`, returns
without calling `draw`. This is what makes a paused game free.

Only `LiveFrameTimeChart` uses it. If a second caller appears, there are two rAF loops and
the budget analysis is void.

---

## 4. Shell and navigation

### `App` ○
```ts
function App(): JSX.Element
```
Router + theme attribute + reduced-motion provider. No props.

### `AppShell` ○
```ts
interface AppShellProps { children: ReactNode; }
```
The `grid-template-columns: 200px minmax(0,1fr)` frame. Owns the global keyboard map
(<kbd>1</kbd>–<kbd>4</kbd> switch views, <kbd>Esc</kbd> closes the inspector).

### `NavRail` ○
```ts
interface NavRailProps {
  active: 'live' | 'sessions' | 'system' | 'settings';
  onNavigate(v: NavRailProps['active']): void;
  overhead: { cpuPercent: Readout; workingSetMb: Readout };  // invariant 8, always visible
}
```

### `NavItem` ○
```ts
interface NavItemProps { label: string; selected: boolean; onSelect(): void; }
```

---

## 5. Primitives (all ○)

These are the vocabulary. Nothing outside this list may render a number or a state.

### `MetricValue` ○ — **the single most-used component in the app**
```ts
interface MetricValueProps {
  readout: Readout;
  size: 'hero' | 'lg' | 'md' | 'sm';
  /** override; defaults to Readout.unit rendered per design-system §3 */
  unitLabel?: string;
  align?: 'left' | 'right';        // default left
  /** compound denominator, e.g. "/ 12 GB" */
  denominator?: string;
}
```
Owns *all* availability rendering for readouts (`availability-states.md` §2): the `—`, the
glyph, the dimming, the width stability, the tooltip. **No other component is permitted to
render `—` for a metric.** That is how the "never zero" invariant becomes structural rather
than remembered.

### `MetricCell` ○
```ts
interface MetricCellProps {
  label: string; readout: Readout;
  size: 'hero' | 'lg'; subline?: ReactNode;
}
```
Label + `MetricValue` + sub-line. **Renders no border and no background** — asserted by a
unit test that snapshots computed style, because ADR 0004 names this as the highest-risk
drift in the whole UI.

### `SeverityGlyph` ○
```ts
interface SeverityGlyphProps {
  class: StutterClass; size?: 7 | 9 | 10; selected?: boolean;
}
```
Triangle / square / diamond / hollow square / bar per `design-system.md` §2. The **only**
place severity shapes are defined; the canvas ribbon code imports the same path data.

### `SeverityTag` ○
```ts
interface SeverityTagProps { class: StutterClass; }
```
`▲ SEVERE HITCH` — glyph + word + 1 px outline.

### `AvailabilityChip` ○
```ts
interface AvailabilityChipProps {
  available: number; consulted: number;
  byReason: Record<UnavailableReason, MetricId[]>;
  frameCaptureLost: boolean;
  affectedDiagnoses: string[];
  onOpenSystemView(): void;
}
```
Implements `availability-states.md` §5 in full, including the popover.

### `ConfidenceReadout` ○
```ts
interface ConfidenceReadoutProps {
  confidence: ConfidenceDto | null;   // null ⇒ unexplained: renders nothing, not 0.00
  size: 'lg' | 'sm';
  showMeter?: boolean;                // the 5-segment discrete meter
}
```
Renders the value, the five-segment meter, and the binding-cap prose. The cap copy table
lives here and nowhere else.

### `Button` ○ · `Chip` ○ · `Tooltip` ○ · `Popover` ○ · `Disclosure` ○ · `Icon` ○
Standard, per `design-system.md` §6 and §8. `Icon` accepts only the ten closed-set names.

### `DataTable` ○
```ts
interface Column<T> {
  key: string; header: string;
  align?: 'left' | 'right';
  width?: number | 'auto';
  hideBelow?: 'compact';
  render(row: T): ReactNode;
}
interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; rowKey(row: T): string;
  selectedKey?: string;
  onSelect?(key: string): void;
  onActivate?(key: string): void;    // Enter / double-click
  stickyHeader?: boolean;
  footer?: ReactNode;
  emptyState: ReactNode;             // required — never an empty table body
}
```

---

## 6. Chart layer

### `charts/plot.ts` ○ (pure factory, no React)
```ts
export interface PlotSpec {
  width: number; height: number;
  xRange: [number, number];
  yRange: [number, number] | 'auto-readable';
  yAxis: { show: boolean; size?: number; format(v: number): string };
  xAxis: { show: boolean; size: number; format(v: number): string };
  syncKey?: string;
  onCursor?(xValue: number | null, idx: number | null): void;
  onSelect?(x0: number, x1: number): void;
  hooks: {
    drawUnder?(u: uPlot): void;      // draw hook, before the series pass
    drawSeries?(u: uPlot): void;     // drawSeries hook, seriesIdx 1
    drawOver?(u: uPlot): void;       // draw hook, after everything
  };
}
export function createPlot(host: HTMLElement, spec: PlotSpec): uPlot;
```

The single place uPlot is configured. Every plot in the product goes through it. The
non-negotiable parts of that config, all `[verified]` against uPlot 1.6.32 source:

```ts
{
  series: [
    {},
    {
      paths:  () => null,        // uPlot draws no series (esm.js:4210 → _paths == null)
      points: { show: false },   // REQUIRED: points are drawn independently of _paths
      scale:  'y',
    },
  ],
  legend: { show: false },
  cursor: {
    points: { show: false },
    sync: syncKey ? { key: syncKey, scales: ['x', null] } : undefined,
    drag: { setScale: false, x: true, y: false },
  },
  scales: { x: { time: false }, y: { auto: false, range: () => yRange } },
  hooks: {
    draw:       [ (u) => { spec.hooks.drawUnder?.(u); } ],   // fires AFTER axes+series
    drawSeries: [ (u, i) => { if (i === 1) spec.hooks.drawSeries?.(u); } ],
  },
}
```

**Two corrections to the naive reading of ADR 0004, both verified this session:**

1. ADR 0004 says "we draw the series ourselves on uPlot's canvas via its draw hooks." True,
   but the draw **order** matters and is not obvious. uPlot's `_draw()` fires
   `drawClear` → `drawOrder` (`["axes","series"]` by default) → `draw`
   (`uPlot.esm.js:4887-4889`). So the `draw` hook fires **after** the series pass, not
   before. To paint reference lines *under* the trace, either use the `drawClear` hook or
   set `drawOrder: ["series","axes"]`. Do not assume `draw` means "before".
2. **uPlot does not clip to the plot area for you.** Clipping is per-path inside `drawPath()`
   using a `Path2D` bounds clip (`uPlot.esm.js:4293-4300`). Custom canvas code must do its
   own `ctx.save(); ctx.rect(u.bbox.…); ctx.clip(); … ctx.restore()`, or a 142 ms spike will
   paint straight over the axis labels. `u.bbox` is in **canvas** pixels (already × dpr);
   `u.valToPos(v, scale, /* canvasPixels */ true)` matches it.

Everything else in ADR 0004 held up under inspection: `uPlot.sync` exists as a static
(`uPlot.d.ts:161`), `paths` is typed `Paths | null` (`uPlot.d.ts:869`), and cursor sync
across plots by x **value** works (measured: identical `cursor.idx` on both plots).

### `charts/decimate.ts` ○ (pure, no DOM — unit-testable on Linux)
```ts
export interface Columns {
  min: Float64Array; max: Float64Array; last: Float64Array;
  n: Int32Array;                     // real samples per column
  cols: number;
}
export function decimateMinMax(
  y: Float64Array, i0: number, i1: number, cols: number, out: Columns,
): Columns;                          // writes into `out`; allocates nothing
```
Min/max column decimation, two vertices per pixel column. The reason it is correct and not
merely fast: it cannot drop a single-frame spike, which LTTB and nth-point sampling can.
A 142 ms stutter surviving decimation is the product.

### Draw functions ○ (pure given `(ctx, geometry, data, tokens)`)
`drawSeriesDense` · `drawSeriesSparse` · `drawReferences` · `drawRibbon` ·
`drawGaps` · `drawOffScaleCaps` · `drawSampleTicks`

All take an explicit `tokens: CanvasTokens` object. **None reads `getComputedStyle`** — that
is `useCanvasTokens`'s job, once per theme change.

### `hooks/useCanvasTokens.ts` ○
```ts
export interface CanvasTokens {
  trace: string; envelope: string; grid: string; axis: string;
  baseline: string; threshold: string; refresh: string; cursor: string;
  hatch: string; eventSpan: string; selection: string;
  sevNormal: string; sevWarning: string; sevCritical: string; sevSelected: string;
  bgBase: string; bgPanel: string; textTertiary: string;
  fontAxis: string;                  // e.g. `10px "Inter Variable"`
  fontMono: string;
}
export function useCanvasTokens(): CanvasTokens;
```
Reads once on mount and on `[data-theme]` change. Calling `getComputedStyle` inside a rAF
draw would be a layout-thrash bug in the hot path.

---

## 7. Live view

### `LiveView` ○
```ts
interface LiveViewProps {}   // pulls from useHeadline() + useSelectedEvent()
```
The six-row grid from `live-view.md` §2.

### `SessionHeader` ○
```ts
interface SessionHeaderProps {
  game: { title: string; executable: string; pid: number } | null;
  captureState: 'running' | 'degraded' | 'stopped' | 'no-game';
  elapsedMs: number;
  display: { width: number; height: number; refreshHz: number } | null;
  availability: Headline['availability'];
  onOpenSystemView(): void;
}
```

### `MetricCluster` ○
```ts
interface MetricClusterProps {
  fps: Readout; p99: Readout; p95: Readout; median: Readout;
  low1: Readout; low01: Readout;
  windowFrameCount: number;
  events: { total: number; severe: number; warmUpExcluded: number };
}
```
Five `MetricCell`s. No wrapper with a background. Ever.

### `TelemetryStrip` ○
```ts
interface TelemetryStripProps { items: Readout[]; }   // fixed order, never re-sorted
```
`repeat(auto-fit, minmax(148px, 1fr))`. The 148 px minimum is measured, not guessed —
`live-view.md` §5.

### `LiveFrameTimeChart` ▲
```ts
interface LiveFrameTimeChartProps {
  windowSec: 60;
  refreshIntervalMs: number | null;      // null ⇒ refresh line not drawn
  baselineMedianMs: number | null;
  thresholdMs: number | null;
  regimeFloorHit: boolean;               // appends "(regime floor)" to the legend
  events: StutterEventDto[];
  selectedEventId: string | null;
  onSelectEvent(id: string | null): void;
  onRangeSelect(fromSec: number, toSec: number): void;
  captureGaps: Array<{ fromSec: number; toSec: number; reason: UnavailableReason }>;
}
```
The one live-drawing component. Owns:
- one `createPlot` handle;
- one `useRingDraw` callback;
- one preallocated `Columns` buffer, reused every frame;
- the Y-range state machine from `live-view.md` §6.3 (3 s to expand, 20 s to contract, snapped
  to the `[25, 40, 60, 100, 160, 250, 400]` ladder).

**It renders no React children that change per frame.** The legend/readout row is a sibling
that updates from `useHeadline` at 10 Hz.

### `ChartLegend` ○
```ts
interface ChartLegendProps {
  refreshIntervalMs: number | null;
  baselineMedianMs: number | null;
  thresholdMs: number | null;
  regimeFloorHit: boolean;
  cursor: { xSec: number; frameMs: number; min: number; max: number; n: number } | null;
}
```
When `cursor` is non-null it replaces the legend text in place, same 15 px line, **no layout
shift**.

### `LatestDiagnosisPanel` ○
```ts
interface LatestDiagnosisPanelProps {
  state: 'none' | 'pending' | 'ready';
  diagnosis: DiagnosisDto | null;
  sessionSummary: { elapsedMs: number; frames: number;
                    baselineMedianMs: number; thresholdMs: number };
  onInspect(eventId: string): void;
}
```
The three states from `live-view.md` §7. The empty state is 136 px of measured facts, not an
empty box.

### `DiagnosisProse` ○
```ts
interface DiagnosisProseProps {
  text: string;
  /** substrings to emphasise — the measured quantities */
  emphasise: string[];
  maxLines?: number;
}
```
Wraps every quantity in `--text-primary` / weight 600 against `--text-secondary` prose. The
"numbers are the hero" rule applied inside running text. Emphasis ranges are produced by the
engine alongside the string, **not** by a regex in the UI — a regex would eventually bold the
wrong thing in a sentence that matters.

### `EventLog` ○
```ts
interface EventLogProps {
  rows: Array<{ event: StutterEventDto; diagnosis: DiagnosisDto | null }>;
  selectedId: string | null;
  onSelect(id: string): void;
  onInspect(id: string): void;
  summary: { total: number; explained: number; unexplained: number;
             explanationRate: number; detectionFloorMs: number; framesMeasured: number };
}
```
A `DataTable` with the eight columns from `live-view.md` §8, plus the footer summary carrying
the explanation rate — the release-gating KPI, shown to the user in their own session.

---

## 8. Event inspector

### `EventInspector` ◆
```ts
interface EventInspectorProps { sessionId: string; eventId: string; onClose(): void; }
```
Calls `useEventWindow(sessionId, eventId)`. Renders `loading` / `failed` / `ready`. On
`ready`, everything below it is pure or ◑ — the window snapshot never changes.

### `hooks/useEventWindow.ts` ◆
```ts
export function useEventWindow(sessionId: string, eventId: string):
  | { status: 'loading' }
  | { status: 'failed'; reason: string; retry(): void }
  | { status: 'ready'; window: EventWindow };
```
One `.ctl` request. Returns immutable typed arrays. **Does not read the ring buffer** — an
event's window is a persisted artefact, and reading it from a live ring would give a
different answer depending on when you opened it.

### `InspectorHeader` ○
```ts
interface InspectorHeaderProps {
  event: StutterEventDto; gameTitle: string;
  windowSec: number; onBack(): void; onResetZoom(): void;
}
```

### `PanelStack` ○
```ts
interface PanelStackProps {
  window: EventWindow;
  syncKey: string;
  domain: [number, number];
  onDomainChange(d: [number, number]): void;
  focusedMetric: string | null;         // MetricKey.toString()
}
```
Runs the tier assignment from `event-inspector.md` §2. **This function is the inspector.**

```ts
export function assignTiers(w: EventWindow): PanelSpec[];

export interface PanelSpec {
  key: string;                          // "cpu.clock.effective" | "proc.cpu[9214]"
  series: SeriesSnapshot;
  tier: 0 | 1 | 2 | 3 | 4;
  height: 132 | 76 | 56 | 32;
  role: EvidenceRole | 'subject' | 'context' | 'missing';
  evidence: EvidenceItemDto | null;
  collapsed: boolean;
}
```
Extract it as a pure function and unit-test it against all six simulation scenarios. It is
pure logic over a DTO and runs on Linux in CI.

### `SeriesPanel` ◑
```ts
interface SeriesPanelProps {
  spec: PanelSpec;
  domain: [number, number];
  syncKey: string;
  eventSpan: [number, number];
  onCursor(xSec: number | null): void;
  focused: boolean;
  onFocus(): void;
}
```
Owns one uPlot handle. Chooses `drawSeriesDense` vs `drawSeriesSparse` on
`series.nativeRateHz >= 10`. Draws gaps, sample ticks, min/max edge labels, the event span,
and the availability hatch. All five sparse-honesty rules live here.

### `PanelGutter` ○
```ts
interface PanelGutterProps {
  series: SeriesSnapshot;
  evidence: EvidenceItemDto | null;
  role: PanelSpec['role'];
  cursorValue: number | null;          // null ⇒ cursor sits in a gap
  atEventValue: number | null;         // restored on mouse-out
  focused: boolean;
}
```
The six slots from `event-inspector.md` §4.

### `SharedXAxis` ○
```ts
interface SharedXAxisProps {
  domain: [number, number];
  eventSpan: [number, number];
  eventDurationMs: number;
  cursorSec: number | null;
}
```
Sticky to the bottom of the scroll container. One axis for the whole stack.

### `ExplanationColumn` ○
```ts
interface ExplanationColumnProps {
  diagnosis: DiagnosisDto;
  event: StutterEventDto;
  onFocusMetric(key: string): void;   // evidence row → panel
}
```
The five blocks, in fixed order, always all five.

Children, all ○:
`WhatHappenedBlock` · `CauseBlock` · `MechanismBlock` · `EvidenceBlock` · `RuledOutBlock`

```ts
interface EvidenceBlockProps {
  items: EvidenceItemDto[];
  onFocusMetric(key: string): void;
}
interface RuledOutBlockProps {
  ruledOut: RuledOutDto[];             // component splits on wasCheckable
  recommendedAction: string | null;
  promoted: boolean;                   // true when the event is unexplained
}
```

### `EvidenceRow` ○
```ts
interface EvidenceRowProps {
  item: EvidenceItemDto;
  contributionFraction: number;        // baseLogOdds / max(baseLogOdds)
  onFocus(): void;
  showConsequenceCaption: boolean;     // true only on the first Consequence in the list
}
```

---

## 9. Sessions, System, Settings — v1 scope only

Per ADR 0005 there is no Diagnostics view and no Optimize view. Do not scaffold them.

### `SessionsView` ◆ → `SessionList` ○ · `SessionSummary` ○ · `SessionEventLog` ○ (reuses `EventLog`) · `ConfigDiff` ○
```ts
interface ConfigDiffProps {
  previous: Record<string, string> | null;
  current: Record<string, string>;
  /** ADR 0005: an explicit state, not an empty table */
  insufficientData: boolean;
}
```

### `SystemView` ◆ → `HardwareSummary` ○ · `TelemetrySourceTable` ○ · `ConfigurationReport` ○
```ts
interface TelemetrySourceTableProps {
  rows: Array<{ metric: MetricId; instance?: number; sourceId: string;
                availability: Availability; reason?: UnavailableReason;
                quality: Quality; observedRateHz: number; lastSampleAgeMs: number }>;
  highlightMetric?: MetricId;          // deep-linked from the availability chip
}
```
The only surface allowed a full per-metric inventory with glyphs
(`availability-states.md` §5).

### `SettingsView` ○
Restrained. Retention, simulation scenario picker, display-keep-awake, session export,
About (with the two OFL licence files). No sensitivity sliders — ADR 0005 cut configurable
thresholds.

### `SimulationBanner` ○
```ts
interface SimulationBannerProps { scenario: string; onExit(): void; }
```
When simulation mode is active, a **persistent 24 px strip** below the header:
`SIMULATION — cpu-frequency-collapse · this is not your machine`, `--sev-warning` left bar.
Invariant 10 makes simulation first-class; invariant 9 makes it unmistakable. It is never
dismissible.

---

## 10. Build order

1. `styles/tokens.css`, `base.css`, the ten `.t-*` utilities, the two `woff2` files.
2. `ipc/wire.ts`, `charts/format.ts`, `charts/decimate.ts` — **all pure, all unit-testable on
   Linux today.** `decimate` gets a property test: no spike is ever dropped.
3. `MetricValue`, `MetricCell`, `SeverityGlyph`, `ConfidenceReadout` — screenshot-test each
   against every `Availability` value. This is the honesty surface and it is testable before
   anything is connected.
4. `charts/plot.ts` + `drawSeriesDense` against a static fixture. Screenshot it. Confirm
   uPlot draws no series of its own.
5. `ipc/ring.ts` + `transport.ts` against the simulation engine's output over the real IPC
   shape. Assert ≤ 10 React commits/sec and rAF draw p95 ≤ 3 ms **in CI**, not once by hand.
6. `LiveView` end to end against all six simulation scenarios. Screenshot at 1280×720,
   1920×1080, 2560×1440 and 3440×1440. Run `/council-ui` on the real pixels.
7. `assignTiers` + `SeriesPanel` + the five sparse-honesty rules. Screenshot the
   `unexplained-hitch` and `cpu-frequency-collapse` scenarios specifically — one exercises the
   promoted ruled-out block, the other exercises `RequiredMetricMissing` and a sparse 4 Hz
   series against a 300 Hz one.
8. `ExplanationColumn`. Review the **strings**, not the layout.
9. Sessions, System, Settings.

Steps 1–4 need no engine, no IPC and no Windows. They are the largest de-risking available
from this host, and they should be done first for exactly that reason.

# 0004. UI stack and chart rendering

- Status: Accepted
- Date: 2026-08-23
- Council: product-designer (lead), systems-architect

## Context

Charts are the product. The Live view must answer five questions in ~2 seconds, and the event
inspector must show up to eleven synchronized series around one moment. The build host is Linux
and cannot run Windows UI, so the choice also decides whether design review has any evidence
source at all before a Windows machine appears.

## Decision

**WPF shell hosting WebView2, React + TypeScript frontend.**

**Chart layer: uPlot for axes, scales and cursor; hand-written Canvas 2D for the frame-time
series**, drawn on uPlot's canvas via its draw hooks. Not "a chart library."

**The Shell exits, rather than hides, on minimize-to-tray.**

**Data flow — verified end to end:**

```
IPC (10 msg/s, 100 ms buckets) → ring buffer (module scope, NOT React state)
                                      │
                        ┌─────────────┴──────────────┐
           requestAnimationFrame                setInterval(100 ms)
           reads ring, draws canvas             derives ~8 headline numbers,
           skips draw if seq unchanged          ONE setState
                  (60 Hz)                            (10 Hz)
```

React never sees a sample. A monotonic `seq` on the ring lets the rAF callback return
immediately when nothing changed, so a paused game costs nothing.

## Rationale

Six chart stacks were benchmarked headlessly at 4096 points, 1200×220, p95 over 1000 redraws:

| Stack | p95 draw | vs ≤3 ms budget |
|---|---|---|
| Hand-written Canvas 2D, min/max column decimation | **0.5 ms** | 6× margin |
| **uPlot 1.6.32** | **1.3 ms** | 2.3× margin |
| lightweight-charts 5.2.1 | 3.0 ms | at the line |
| ECharts 6.1.0 | 10.0 ms | 3.3× over |
| **ScottPlot 5.1.59** (native SkiaSharp) | **24.1 ms** | **8× over** |
| **Recharts 3.10.1** (SVG + React) | **223 ms** | **74× over** |

Recharts is not a candidate at any size that matters — 36 ms even at 1024 points. The failure
mode is not DOM node count (208 nodes, one `<path>`); it is React reconciliation over 4096 data
objects plus rebuilding a 4096-command path string per update. **SVG is out, verified.**

The data flow was built and measured, not assumed:

| Measurement | Result | Budget |
|---|---|---|
| React commits/sec at a 299 Hz producer | **10.00** | ≤10 ✓ |
| Canvas draw p95 | **0.3 ms** | ≤3 ms ✓ |
| rAF frame rate | 59.9 fps, zero jank | — |
| Same code with naive `setState` per batch | **99.7 commits/sec** | ✗ |

**Min/max column decimation** — two vertices per pixel column — is not merely fast, it is the
*correct* rendering: it cannot drop a single-frame spike the way LTTB or nth-point sampling can.
A 142 ms stutter surviving decimation is the entire point of the product.

For 800k-point sessions, a min/max pyramid (10 levels, 6.4 MB, 40 ms to build in a worker)
takes full-range redraw from p95 12.8 ms to **p95 0.3 ms**.

## Rejected alternatives

### Pure WPF/XAML with custom-drawn charts — *considered by product-designer and systems-architect*
Genuinely Windows-native, in-box, ~50–80 MB. Rejected: `/council-ui` would be **BLOCKED, not
approximated** — the chart engine, which *is* the product, would be built and shipped
unreviewed until a Windows machine appeared. And it buys nothing over Avalonia on the charting
work, since neither ships a chart.

### WinUI 3 — *considered by both*
Strictly dominated by pure WPF: everything WPF costs, plus Windows App SDK deployment friction,
and it **cannot build on this Linux host at all** (`makepri.exe`, exec format error).

### Avalonia + hand-written Skia charts — *advocated seriously by product-designer; NOT rejected, recorded as the live fallback*

This deserves its own note because the designer **falsified its own strongest argument** rather
than letting it stand:

> The "pure XAML cannot be design-reviewed on Linux" claim is true for WPF and WinUI 3. It is
> **false for Avalonia** — verified this session: Avalonia 11.2.3 + Skia headless renders on
> this container, `CaptureRenderedFrame()` produces a real PNG, and a custom decimating chart
> control was drawn, saved, and read back visually. So that factor is decisive against WPF and
> WinUI 3, and **worth exactly zero** between WebView2 and Avalonia. Anyone using it to justify
> web over Avalonia is using an argument I falsified.

Avalonia buys: 60.2 MB working set against a ~277 MB Chromium floor, one process, one language,
no runtime to ship, and Skia rendering identical on Windows and Linux.

It loses on chart maturity, measured: ScottPlot 5, the mature SkiaSharp option, is 8× over
budget at 4096 points, so the entire chart engine — cursor sync, zoom, brush, markers, overlays
— would be hand-built with no CSS, no DevTools and no hot reload.

**Switch trigger, stated precisely:** if the measured WebView2 process-group working set on
Windows exceeds 220 MB with the Live view visible, **or** the A/B protocol shows Δp99 frame
time > 0.3 ms attributable to the UI being visible, Avalonia becomes correct.

### Electron — *rejected, no technical justification exists*
Everything WebView2 costs, plus a bundled Chromium, a Node runtime, and a second GC.

## Consequences

### Positive
- A real design-review loop exists on Linux from day one: build, screenshot headlessly, run
  `/council-ui` against actual pixels.
- The chart budget has 2.3–6× margin, which is the headroom that will absorb integrated
  graphics and software compositing.

### Negative / accepted costs
- **The memory finding is uncomfortable and is recorded honestly.** Measured on this host:
  Chromium is 277 MB PSS / 133 MB private for a *blank page*, 337/176 MB for a
  FrameDoctor-shaped app across 8 processes. Lean flags do not move it. Our application code is
  only ~60 MB of that; the JS heap holding 810k samples is 13.3 MB, which is nothing. **There
  is no frontend-discipline lever here — the engine floor is the entire cost.** Against the
  ≤190 MB line, private working set fits with almost no margin and PSS does not fit at all.
- Which of those Windows Task Manager reports for a WebView2 group is unknown from Linux, and
  is the number that decides whether this ADR survives.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The WebView2 GPU process steals frame time from the game while the Live view is visible** — our UI causes the stutter it measures | Medium | `REQUIRES-WINDOWS-VALIDATION`, **CRITICAL**. Design mitigations already in place: rAF draw skipped when nothing changed, ≤10 commits/s, no CSS animation on data. If it fails, the Live view becomes an alt-tab surface and gameplay is served by nothing — an honest outcome, not a defeat. |
| WebView2 exceeds the memory line on Windows | Medium-High | Switch to Avalonia per the trigger above. **Do not** try to fix it by shrinking the bundle. |
| uPlot's cursor model does not extend to 11-panel sync with brush, overlays and markers | Medium | Structural mitigation already chosen: uPlot owns only axes, scales and cursor; we draw the series ourselves. That keeps the exit cheap. |
| The four-number cluster drifts into a KPI-card grid during implementation | **High** — the most common failure mode of this layout | Review gate: no `border` or `background` on a metric container in the Live view. `scripts/slop-scan.sh` greps for it. |

## Dissent

`product-designer` recorded that this decision is **close**, that Avalonia wins on the criteria
the original brief actually named ("Windows-native reliability and low overhead"), and that a
single Windows memory measurement can overturn it. That dissent is preserved rather than
resolved, and the switch trigger above is its operative form.

## What would change this decision

- WebView2 process-group working set > 220 MB with the Live view visible on Windows.
- Δp99 frame time > 0.3 ms attributable to the UI being visible.
- Either one → Avalonia, with the chart engine hand-built on Skia.

---

## Amendment, 2026-08-23: uPlot is not in the shipped build

Recorded after implementing the charts. The decision above is amended rather than reversed: the
split it describes — a library for axes and scales, hand-written canvas for the series — turned
out to have no library half.

**What changed.** Three facts about uPlot's API surfaced while writing the Live view, all
verifiable in its source:

1. Suppressing a series' own rendering needs `points: {show: false}` alongside
   `paths: () => null`. Path suppression alone leaves the point markers drawn, which on a
   12,000-frame series is 12,000 circles per redraw.
2. uPlot does not clip custom drawing to the plotting area. Anything drawn in a hook that
   overflows the plot writes over the axes.
3. The `draw` hook fires *after* axes and series, so custom drawing lands on top of the axis
   labels unless `drawClear` or an explicit `drawOrder` is used.

None of these is a defect; they are the consequences of uPlot being a fast renderer rather than a
framework. But together they meant the "uPlot owns axes and scales" half of the split was being
fought rather than used, for a component that draws four gridlines and five tick labels.

**What ships instead.** `src/frontend/src/charts/frameTimeChart.ts` is hand-written Canvas 2D
throughout, and `src/frontend/src/charts/metricPanel.ts` likewise for the inspector's panels. No
chart library is a dependency of the shipped build.

**The axis is logarithmic.** Not recorded in the original decision, and it is the more consequential
change. The first real screenshot of the Live view showed one 104 ms hitch setting the scale and
pressing a 6.9 ms baseline flat against the axis line — the whole pacing signal destroyed by a
single frame. Frame-time series routinely span more than a decade in ordinary play, which is why
the pipeline already stores them in a log histogram; the chart now follows that rather than
contradicting it. The axis is labelled "log ms" on the chart, because a compressed axis that does
not say so understates how large a spike was.

**What this costs.** Cursor, brush selection and synchronized panning across panels are now ours
to write. The original decision took uPlot partly to avoid that. The estimate is one to two days
of work for the inspector's synchronized cursor, against an ongoing cost of working around the
three points above on every chart change — and against a dependency whose upgrade could change
any of them.

**What would reverse this.** A second chart family with genuinely different needs — a
distribution plot, or a scatter with hit-testing — where hand-writing axes stops being a
rounding error. The seam is drawn so that a future chart may use a library without the frame-time
chart changing.

**Unchanged:** the WebView2/React decision itself, the Avalonia fallback, the switch trigger, and
`product-designer`'s recorded dissent. Removing a chart library does not weaken the case for
Avalonia; if anything it strengthens it, since the hand-written renderer would port to Skia
largely intact.

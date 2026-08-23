# FrameDoctor performance budget

FrameDoctor must never be the cause of a stutter. This document defines the budget every
component is held to, and how each line is measured. `/council-performance` checks against it.

A budget line with no measurement is reported as **NOT MEASURED**, which is a finding, not
an excuse.

> **Revision, architecture council Phase A.** The `windows-perf-engineer` exercised the
> overhead veto on three lines of the first draft. The unit for CPU, the disk-write line and
> the Live-view latency line were all unachievable or unmeasurable as originally written.
> The reasoning is recorded inline below, because the *why* is more useful than the number.

## Why a budget rather than "keep it light"

A monitoring tool that costs 3 % of a CPU on a machine that is already CPU-bound has changed
the thing it is measuring. Worse, its cost is *correlated* with the events it is trying to
catch — background load spikes are exactly when a heavy collector starts missing samples and
allocating. The budget exists so that "low overhead" is falsifiable.

---

## The line that actually tests the claim

Every other line in this document is a proxy. This one is the claim itself:

| Measurement | Requirement |
|---|---|
| **Frame-time impact, A/B** | **Δp99 frame time ≤ 0.3 ms** and **Δ1 % low ≤ 1 %**, at 95 % confidence |

Method: a deterministic in-game benchmark, three runs with FrameDoctor off and three with it
monitoring. `REQUIRES-WINDOWS-VALIDATION`.

If this line fails, FrameDoctor is the thing it exists to detect, and no amount of passing
proxy lines redeems that.

---

## CPU

**The unit is core-milliseconds per second, not percentage of total CPU.**

A "% of all logical processors" budget silently *shrinks* on smaller CPUs. 155 core-ms/s is
0.97 % on a 16-thread machine and 3.9 % on a 4-thread machine — so a percentage budget is
most permissive exactly where the machine has the most headroom, and most punishing on the
modest hardware that needs FrameDoctor most. The absolute unit does not have that inversion.

| Condition | Budget | Notes |
|---|---|---|
| Idle, no game detected | ≤ 35 core-ms/s | WinEvent hook + 2 s foreground reconcile + 5 s GPU-engine discovery |
| **Monitoring, UI hidden / tray** | **≤ 120 core-ms/s** | The gameplay case. Summed over FrameDoctor **and** the PresentMon child or service. |
| Monitoring, UI visible, Live view | ≤ 400 core-ms/s | |
| Session finalization | ≤ 1 core-second | Requires percentiles over a bounded window, not the whole session |

A secondary guard caps total CPU percentage, but the absolute figure governs. Machines with
≤ 8 logical processors run a **reduced-fidelity profile and are told so** — degrading
silently would make the budget a fiction on the hardware where it matters.

### The self-limiting guard

Every `PdhCollectQueryData` is timed. If p95 exceeds 5 ms, that query's rate is automatically
halved and every metric it feeds is marked `quality = Degraded`, surfaced in the UI.

This is the only mechanism that makes the budget enforceable on machines nobody has tested,
and it is the mechanical expression of invariant 8. A budget that depends on the developer
having seen your hardware is not a budget.

## Memory

The old line counted one process, which was wrong in two directions.

| Component | Budget |
|---|---|
| Backend process, UI hidden | ≤ 70 MB |
| PresentMon child process | ≤ 40 MB (unmeasured) |
| **ETW kernel non-paged pool** | **16 MB floor, 64 MB ceiling — not configurable by us** |
| UI visible, additional | ≤ 190 MB (the web view) |
| Growth over a 4-hour session | ≤ 15 MB |

The ETW pool figure is not an estimate: PresentMon hardcodes `BufferSize=64` KB,
`MinimumBuffers=256`, `MaximumBuffers=1024`. We inherit that allocation on either integration
route and cannot tune it. Declaring it is more honest than omitting it because it does not
appear in our process's working set.

Unbounded growth is a defect regardless of the absolute number: every buffer in the pipeline
is fixed-size at construction.

## Disk

**Raw per-frame persistence is prohibited.**

A 144-byte frame sample at 240 fps is 118.7 MB/hour — 1.98 MB/min, which is the *entire*
original write budget consumed by a single series. At 1000 fps it is 8.2 MB/min. The first
draft's budget and its implied design were mutually impossible.

| Condition | Budget |
|---|---|
| Writes during an active session | ≤ 0.4 MB / minute |
| Write syscalls during an active session | ≤ 5 / minute |
| Read IOPS in steady state | **zero** — nothing in the hot path touches the disk |
| Idle | no sustained writes |

What is persisted instead: 4 Hz aggregates (~0.14 MB/min) plus **full-resolution frame
windows only around detected events** (~20 events/hour at ±5 s ≈ 0.12 MB/min). Total ≈
0.26 MB/min, comfortably inside budget — and it is the same shape the telemetry model already
mandates for process history.

A default-configured SQLite breaches the syscall line immediately (journal + database +
fsync per transaction). If SQLite is used it runs WAL with `synchronous` relaxed and
checkpoints at session end only.

## Latency

**The Live-view latency line is source-dependent**, and each source declares its class.

The first draft required 400 ms from event to visible. That is not achievable with the
PresentMon CLI: it never sets `FlushTimer`, and ETW's documented default for a real-time
session with `FlushTimer = 0` is **one second**. ETW also reserves at least two buffers per
logical processor, so on a 16-thread machine the event stream is split 16 ways and each
buffer fills 16× slower. Either buffers fill fast (latency fine, CPU worse) or slowly (CPU
fine, ~1 s latency). There is no good horn.

| Path | Budget (p95) |
|---|---|
| Sensor sample → normalized telemetry | ≤ 50 ms (counters) |
| Normalized telemetry → stutter classified | ≤ 100 ms |
| Event detected → visible on the Live timeline | source-dependent: `Low` ≤ 400 ms · `Batched` ≤ 1200 ms |
| Event detected → diagnosis available | ≤ 1500 ms |

Crucially, **the data is correct either way — only freshness differs.** Frame timestamps are
QPC values carried in the events themselves, so detection, correlation and diagnosis are
unaffected by transport latency. Only the Live view's sense of "now" degrades, and it says so
through the source's declared `LatencyClass` rather than pretending.

Diagnosis is deliberately allowed to lag display. Showing the stutter immediately and the
explanation a beat later is correct; making the user wait for both is not.

## UI

| Path | Budget |
|---|---|
| Live view render | ≤ 6 ms per frame at 60 Hz |
| Frame-time chart draw, 4096 points | ≤ 3 ms |
| Event inspector open, 9 synchronized series | ≤ 120 ms |
| React commits per second, Live view | ≤ 10 |

Sampling rate and UI refresh rate are independent. Telemetry arriving at 1000 Hz must not
produce 1000 React commits per second — it produces at most 10, with the chart drawing from a
ring buffer outside React's reconciliation.

## Transport

Two separate lines. Conflating them was an error in the first draft.

| Boundary | Budget |
|---|---|
| **Backend ↔ UI IPC** | ≤ 10 msg/s, ≤ 20 KB/s |
| **Collector transport** (PresentMon stdout) | 59.5 KB/s at 240 fps · 248 KB/s at 1000 fps |

Raw frames never cross the backend↔UI boundary in steady state. The UI receives 100 ms
buckets — min/max/mean/count/last per series plus a bounded frame-time envelope — explicitly
labelled as decimated so it cannot be mistaken for resolution. The event inspector pulls a
full-resolution window on demand, as a one-off.

Backpressure is drop-oldest with a counted drop, never unbounded buffering. A dropped sample
is recorded in the telemetry quality signal so the UI shows degraded fidelity honestly
rather than silently interpolating.

## Allocation

Steady-state allocation in the collector and normalization hot path is **zero** in the common
case. Frame batches use pooled arrays; CSV parsing uses `Utf8Parser` over spans with no
per-row string allocation.

Gen-2 collections during an active session are a defect: a GC pause in the process watching
for stutters is a stutter we caused.

## How each line is measured

| Line | Method | Runs where |
|---|---|---|
| **Frame-time impact A/B** | Deterministic in-game benchmark, 3+3 runs | Windows only |
| CPU core-ms/s | Process-set summation across FrameDoctor **and** the PresentMon child | Windows |
| Growth over time | Long-run simulation harness, 4 h compressed replay | Linux CI |
| Disk writes and syscalls | Storage-layer counters + syscall count | Linux CI / Windows |
| Pipeline latency | Timestamps stamped at each stage boundary, histogram | Linux CI |
| Chart draw time | `performance.measure` around the draw, p95 over 1000 frames | Linux CI (headless Chromium) |
| React commits | Instrumented commit counter | Linux CI |
| IPC rate | Transport-level counters | Linux CI |
| Allocation | Benchmark harness with `MemoryDiagnoser`, asserting zero | Linux CI |

### A known defect in self-measurement

Measuring our own CPU with process counters at 1 Hz **systematically under-reports**. It
cannot see:

- the PresentMon child process or service,
- the ETW logger thread's kernel CPU, which is attributed to the *session* rather than to any
  process of ours and has no documented per-process attribution,
- a 40 ms GC pause falling between two 1 Hz samples.

Mitigations: sum across the process set, keep a GC pause histogram, and treat the A/B
frame-time test as authoritative. A budget that passes on paper while the app causes stutters
is worse than no budget, because it manufactures confidence.

## Enforcement

Budgets measurable on Linux are asserted in tests and fail the build when exceeded. Budgets
needing Windows are measured by the app itself and surfaced in its own diagnostics view, so a
regression on a user's machine is visible rather than theoretical.

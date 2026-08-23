# FrameDoctor performance budget

FrameDoctor must never be the cause of a stutter. This document defines the budget every
component is held to, and how each line is measured. `/council-performance` checks against it.

A budget line with no measurement is reported as **NOT MEASURED**, which is a finding, not
an excuse.

## Why a budget rather than "keep it light"

A monitoring tool that costs 3% of a CPU on a machine that is already CPU-bound has changed
the thing it is measuring. Worse, its cost is *correlated* with the events it is trying to
catch — background load spikes are exactly when a heavy collector starts missing samples and
allocating. The budget exists so that "low overhead" is falsifiable.

## Budget

### CPU

| Condition | Budget | Rationale |
|---|---|---|
| Idle, no game detected | ≤ 0.3 % total CPU | Detection polling only, 1 Hz |
| Monitoring, UI hidden / tray | ≤ 1.0 % total CPU | The gameplay case. Must be the cheapest path. |
| Monitoring, UI visible, Live view | ≤ 3.5 % total CPU | User is looking at it; charts are rendering |
| Session finalization | ≤ 1 core-second | One-off at game exit |

"Total CPU" means percentage of all logical processors, matching what Task Manager shows.
On a 16-thread CPU, 1.0 % total ≈ 0.16 of one core.

### Memory

| Condition | Budget |
|---|---|
| Monitoring, UI hidden | ≤ 90 MB working set |
| Monitoring, UI visible | ≤ 260 MB working set (includes the web view) |
| Growth over a 4-hour session | ≤ 15 MB |

Unbounded growth is a defect regardless of the absolute number: every buffer in the pipeline
is explicitly bounded.

### Disk

| Condition | Budget |
|---|---|
| Writes during an active session | ≤ 2 MB / minute, amortized |
| Write syscalls during an active session | ≤ 6 / minute |
| Idle | 0 sustained writes |

Telemetry is batched and flushed on an interval, never per sample. Per-sample `fsync` is
prohibited — it is both a disk-latency source and pointless for data we can regenerate.

### Latency

| Path | Budget (p95) |
|---|---|
| Sensor sample → normalized telemetry | ≤ 50 ms |
| Normalized telemetry → stutter classified | ≤ 100 ms |
| Event detected → visible on the Live timeline | ≤ 400 ms |
| Event detected → diagnosis available | ≤ 1500 ms |

Diagnosis is deliberately allowed to be slower than display. Showing the stutter immediately
and the explanation a beat later is correct; making the user wait for both is not.

### UI

| Path | Budget |
|---|---|
| Live view render | ≤ 6 ms per frame at 60 Hz |
| Frame-time chart draw, 4096 points | ≤ 3 ms |
| Event inspector open, 9 synchronized series | ≤ 120 ms |
| React commits per second, Live view | ≤ 10 |

Sampling rate and UI refresh rate are independent. Telemetry arriving at 200 Hz must not
produce 200 React commits per second — it produces at most 10, with the chart drawing from a
ring buffer outside React's reconciliation.

### IPC

| Metric | Budget |
|---|---|
| Messages/second, steady state | ≤ 120 |
| Bytes/second, steady state | ≤ 120 KB |
| Queue depth before backpressure | bounded, explicit, and observable |

Backpressure policy is drop-oldest with a counted drop, never unbounded buffering. A dropped
sample is recorded in the telemetry quality signal so the UI can show degraded fidelity
honestly rather than silently interpolating.

### Allocation

Steady-state allocation in the collector and normalization hot path is **zero** in the
common case. Buffers are pooled and reused. Gen-2 collections during an active session are a
defect: a GC pause in the process that is watching for stutters is a stutter we caused.

## How each line is measured

| Line | Method | Runs where |
|---|---|---|
| CPU, memory, working set | Self-instrumentation via process counters, sampled at 1 Hz, reported in the app's own diagnostics | Windows |
| Growth over time | Long-run simulation harness, 4 h compressed replay | Linux CI |
| Disk writes | Storage-layer write counters + syscall count | Linux CI (counters), Windows (syscalls) |
| Pipeline latency | Timestamps stamped at each stage boundary, histogram | Linux CI |
| Chart draw time | `performance.measure` around the draw call, p95 over 1000 frames | Linux CI (headless Chromium) |
| React commits | Instrumented commit counter in the Live view | Linux CI |
| IPC rate | Transport-level counters | Linux CI (loopback), Windows (real) |
| Allocation | Benchmark harness with `MemoryDiagnoser`, asserting zero allocation | Linux CI |

Lines marked Windows are `REQUIRES-WINDOWS-VALIDATION` until measured on a real machine.

## Enforcement

Budgets that can be measured on Linux are asserted in tests and fail the build when
exceeded. Budgets that need Windows are measured by the app itself and surfaced in its own
diagnostics view, so a regression on a user's machine is visible rather than theoretical.

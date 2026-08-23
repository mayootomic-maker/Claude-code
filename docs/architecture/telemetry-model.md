# Normalized telemetry model

Every collector, whatever its source, emits samples in this one shape. Everything downstream
— statistics, detection, correlation, diagnosis, storage, UI — consumes only this. A
collector that needs a downstream component to know where its data came from has leaked.

## Sample

| Field | Type | Notes |
|---|---|---|
| `timestamp` | monotonic ticks since session epoch | Never wall-clock. See *Clocks*. |
| `metric` | metric id | From the catalog below. Stable across versions. |
| `value` | double | Meaningless unless `availability = Available`. |
| `unit` | enum | Fixed per metric; carried so the UI never guesses. |
| `source` | source id | Which collector produced it, for provenance and debugging. |
| `availability` | enum | See below. |
| `quality` | enum | See below. |
| `instance` | optional string | Core index, disk id, process id, GPU engine — the sub-identity. |

### Availability

| State | Meaning | UI renders |
|---|---|---|
| `Available` | Real reading | the value |
| `Unavailable` | No sensor, or the source cannot provide it on this hardware | "—" plus the reason on hover |
| `Denied` | Exists but we lack privilege | "—" plus what would grant it |
| `Failed` | Source errored; may recover | "—" plus a fault indicator |
| `Stale` | Last known value, older than its expected interval | the value, visibly de-emphasised, with age |

**A missing metric is never zero.** This rule prevents the single most damaging class of
false diagnosis: reading an absent temperature sensor as 0 °C and concluding the CPU is cold,
or an absent GPU utilization as 0 % and concluding GPU starvation.

### Quality

| State | Meaning |
|---|---|
| `Exact` | Directly measured |
| `Derived` | Computed from other measurements (e.g. effective clock from a performance ratio) |
| `Estimated` | Modelled or interpolated; carries reduced diagnostic weight |
| `Degraded` | Measured, but the source reported dropped events or missed intervals |

Quality propagates. A diagnosis built on `Estimated` or `Degraded` evidence cannot reach the
same confidence as one built on `Exact` evidence — this is enforced in scoring, not left to
the reader.

## Clocks

Telemetry timestamps use a **monotonic** clock captured at session start, expressed as ticks
since the session epoch.

Wall-clock time (`DateTime.UtcNow`) is stored **once per session** as the epoch, for display.
It is never used for interval arithmetic.

The reason is specific and not theoretical: a machine that suspends mid-session, or has its
clock corrected by NTP or a DST change, will produce negative or wildly inflated intervals in
a wall-clock series. Correlating a 142 ms stutter against telemetry that jumped an hour
sideways yields confident nonsense. Suspend/resume is detected explicitly and marks a
**discontinuity** in the series; statistics do not span a discontinuity.

## Rates

Sources sample at different natural rates. Normalization does not resample or interpolate;
it timestamps and forwards. Alignment happens in the statistics layer, which is explicit
about the window it aligned into and how many sources actually contributed.

| Source | Natural rate |
|---|---|
| Frame events | per present (variable, ~30–1000 Hz) |
| CPU/GPU/memory counters | 2–4 Hz |
| Hardware sensors (temp, power, clocks) | 1–2 Hz |
| Per-process activity | 1 Hz, and on demand around events |
| System configuration | on change |

Correlating a 4 Hz temperature series against a 300 Hz frame series is legitimate; pretending
the temperature series has 300 Hz resolution is not. Evidence records the true resolution of
each contributing series so the event inspector can draw it honestly.

## Metric catalog

Ids are stable, lowercase, dot-separated, and never reused for a different meaning.

### Frame — `frame.*`

| Metric | Unit | Notes |
|---|---|---|
| `frame.time` | ms | The base series. Everything else is derived from it. |
| `frame.fps.instant` | fps | `1000 / frame.time` |
| `frame.fps.rolling` | fps | Frames in window ÷ window duration. Not a mean of instant FPS. |
| `frame.time.median` | ms | Rolling |
| `frame.time.p95` | ms | Rolling |
| `frame.time.p99` | ms | Rolling |
| `frame.low.1pct` | fps | See *Percentile definitions* |
| `frame.low.01pct` | fps | See *Percentile definitions* |
| `frame.time.variance` | ms² | Rolling |
| `frame.stutter.count` | count | Cumulative in session |
| `frame.stutter.severe.count` | count | Cumulative in session |

### CPU — `cpu.*`

| Metric | Unit | Instance | Notes |
|---|---|---|---|
| `cpu.load.total` | % | — | |
| `cpu.load.core` | % | core index | |
| `cpu.clock` | MHz | — or core | Nominal/reported |
| `cpu.clock.effective` | MHz | — or core | `Derived` quality where computed from a performance ratio |
| `cpu.temp` | °C | — or core | Frequently `Unavailable` without a sensor source |
| `cpu.power` | W | — | Often `Unavailable` |
| `cpu.throttle.state` | enum | — | Often `Unavailable`; never inferred silently |

### GPU — `gpu.*`

| Metric | Unit | Notes |
|---|---|---|
| `gpu.util` | % | |
| `gpu.clock.core` | MHz | |
| `gpu.clock.memory` | MHz | |
| `gpu.vram.used` | MB | |
| `gpu.vram.total` | MB | Capacity; changes only on hardware change |
| `gpu.temp` | °C | |
| `gpu.temp.hotspot` | °C | Vendor-dependent; commonly `Unavailable` |
| `gpu.power` | W | |
| `gpu.throttle.reason` | flags | Vendor-dependent. Strong evidence when present. |

### Memory — `mem.*`

| Metric | Unit |
|---|---|
| `mem.total` | MB |
| `mem.used` | MB |
| `mem.available` | MB |
| `mem.committed` | MB |
| `mem.commit.limit` | MB |
| `mem.pagefault.hard` | /s |

`mem.pagefault.hard` is the paging metric that matters for games. Soft faults are normal and
carry no diagnostic weight.

### Storage — `disk.*`

| Metric | Unit | Instance |
|---|---|---|
| `disk.active` | % | disk id |
| `disk.read` | B/s | disk id |
| `disk.write` | B/s | disk id |
| `disk.latency` | ms | disk id |
| `disk.queue` | count | disk id |

### Process — `proc.*`

| Metric | Unit | Instance |
|---|---|---|
| `proc.cpu` | % | pid |
| `proc.mem.working_set` | MB | pid |
| `proc.disk.bytes` | B/s | pid |
| `proc.gpu.util` | % | pid |

Process telemetry is deliberately **not** collected continuously for every process. A small
set of relevant processes is tracked at low rate; around a detected event, collection widens
briefly to capture the correlation window. Storing a complete process history for every
session is a large amount of data that answers no question anyone asks.

### System — `sys.*`

Configuration, sampled on change rather than on an interval: OS build, CPU/GPU model, GPU
driver version, active power scheme and overlay, Game Mode state, uptime, monitor
configuration and refresh rate, and FrameDoctor's own applied optimizations.

Changes here are recorded as events, because "what changed between the session that was fine
and the session that regressed" is the question regression detection exists to answer.

## Percentile definitions

These are stated once, here, and the implementation is tested against this text.
Ambiguity in "1% low" is the most common source of disagreement between measurement tools.

- **`frame.time.p95` / `p99`** — the 95th/99th percentile of *frame times* in the window,
  by nearest-rank on the sorted frame-time series. Higher is worse.

- **`frame.low.1pct`** — the *frame-time percentile* definition: take the slowest 1 % of
  frames in the window by frame time, and express the **99th-percentile frame time** as an
  FPS value (`1000 / p99`). This is CapFrameX's "1% low" and is a *percentile*, not an
  average of the worst frames.

- **`frame.low.01pct`** — the same, at `1000 / p99.9`.

Minimum sample sizes, below which the metric reports `Unavailable` with reason
`InsufficientData`:

| Metric | Minimum frames |
|---|---|
| `frame.time.median` | 30 |
| `frame.time.p95`, `frame.low.1pct` | 200 |
| `frame.time.p99`, `frame.low.01pct` | 2000 |

A 0.1 % low computed from 300 frames is describing a single frame. Reporting it as a stable
metric would be dishonest, and comparing two such values across sessions would manufacture
regressions that do not exist.

## Source provenance

Every sample carries its source id. This exists so that:

- the System view can show what is actually providing each metric,
- a diagnosis can state *how* it knows something,
- a source that starts producing garbage can be identified and disabled without guessing,
- and swapping a source (say, counter-derived GPU clock for a vendor-API clock) is visible in
  the data rather than silent.

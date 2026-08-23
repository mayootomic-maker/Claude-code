# 0006. Storage, rolling statistics, and stutter detection

- Status: Accepted
- Date: 2026-08-23
- Council: data-detection-engineer (lead), windows-perf-engineer (Phase B challenge)
- Phase B: run — this was the one genuine conflict in Phase A

## Context

Frame data arrives at 30–1000 Hz. Statistics must be exact enough to defend publicly, cheap
enough not to perturb the measurement, and stored in a way that survives a power cut without
costing the disk budget.

## Decision

### Split store

- **Append-only, CRC-framed, delta-encoded segment file per session** for all series data.
  One `write()` per 20 s flush. No `fsync` during the session; one `FlushFileBuffers` at
  finalize.
- **SQLite in WAL, `synchronous=NORMAL`, `page_size=16384`** as a catalog — sessions, events,
  diagnoses, the evidence ledger, baselines, aggregates — written in **one transaction at
  session finalize**, never during play.

### Encoding

Second difference of quantized timestamps, zigzag + varint, 1/64 ms quantum for the frame hot
set. Absolute QPC anchor per chunk. Measured **25–40 bits per frame** for `frame.time`,
`frame.displayed.time`, `frame.animation_error`, the dropped-frame bitmap and flags combined.

### Rolling statistics: fixed-bucket logarithmic histogram

256 sub-buckets per octave, 13 octaves (0.25–2048 ms), bucket index computed **directly from
float32 bits** — one shift and one mask, no `log()`, no branch on data, no allocation.

- **O(1) insert *and* delete**, which is what makes a sliding window expressible at all
- 6.5 KiB per series; whole rolling-statistics layer ≈ 370 KB worst case
- Measured **≤ 0.17 %** max error on p50/p95/p99/p99.9 across four regimes
- Level and scale refresh at **10 Hz, not per frame** — a 10-second rolling median cannot move
  meaningfully in 100 ms, and recomputing it per frame at 1000 Hz would be a genuine overhead
  defect. Between refreshes the threshold is a held constant and the per-frame test is one
  comparison.

### Stutter detection

Level = rolling median over 10 s. Scale = **median absolute successive difference (MASD)** —
a robust scale of the *first differences*, not of the values.

```
excess    = frame.time − median
floor     = max(3.0 ms, 0.5 × refreshInterval, 0.5 × median)
threshold = clamp(6.0 × σ̂_MASD, floor, 3.0 × median)
```

Three hysteresis mechanisms, all required: a Schmitt trigger (open above threshold, close after
N consecutive frames below half of it), a 500 ms merge window, and — the one that is easy to
omit and catastrophic when omitted — **the baseline is frozen while an event is open.** A
142 ms hitch fed into the scale estimator inflates σ̂ and blinds the detector for the next ten
seconds.

### Confidence

Weighted log-odds sum of per-rule likelihood ratios, weighted by quality × resolution ×
1/k-within-evidence-class, with a **hard ceiling of 0.97**.

**Absence of evidence counts only when the metric is `Available`.** A rule predicting a clock
collapse, on a machine where clocks are readable and flat, earns a strong negative. On a machine
with no clock sensor it earns **zero — never negative.** That falls straight out of the
availability enum and is the most important honesty property in the scoring model.

### Regression detection

Sessions are the sampling unit, not frames — which disposes of frame-level autocorrelation at
the boundary. Test is distribution-free: the probability that all *m* new sessions rank above
all *N* baseline sessions is exactly `m!·N!/(N+m)!`. Shipping rule: m = 2 consecutive new
sessions against N ≥ 8, giving p = 0.022, **plus** a practical-significance gate of ≥ 3 % and
≥ 0.5 ms.

## Rationale

### Why MASD rather than MAD — this single choice resolves both hard cases

A plain MAD of the *values* on a genuinely unstable 25–40 FPS game measures the slow drift
(σ̂ ≈ 11 ms), so a 6σ threshold of 66 ms would miss an 80 ms hitch entirely. MASD is computed on
first differences, so slow drift cancels: σ̂ ≈ 3.5 ms, threshold 21 ms, hitch caught.

It is also the statistically correct estimator given that frame-time series are autocorrelated —
differencing removes the low-frequency component that invalidates a naive dispersion estimate.

Meanwhile the **floor** handles the opposite case: on a vsync-locked series σ ≈ 0.03 ms, so
`6σ̂` = 0.18 ms, but `0.5 × refreshInterval` = 8.3 ms binds and trivial deviations cannot fire.
The floor uses real data from `sys.*`, not a magic constant.

`k = 6.0` was chosen by sweep: k = 5 is the knee where false positives reach zero on both hard
regimes; 6 takes one step of margin.

### Why not t-digest or P²

Both are **structurally** disqualified, not merely less accurate: they are cumulative-stream
sketches and **cannot delete**, so a sliding window is not expressible. Additionally P² was
measured at **22.9 % p99 error** on a 1000 Hz frame-time series — it converges only for
stationary streams, and a frame-time series with hitches is precisely the non-stationary case.

An exact sorted window is correct but costs O(n) deletion in the 1000 Hz hot path for accuracy
the histogram already provides to 0.17 %. Frame times have a known bounded useful range, and
that is exactly what makes the histogram exact-enough, O(1), *and* deletable.

### The three-series requirement, confirmed by measurement

| Scenario | `frame.time` detector | Animation-error detector |
|---|---|---|
| Even present cadence, AE alternating ±4 ms at 144 Hz | **0 events** | `PacingMicroStutter` |
| Real hitch (both spike) | 3 `SevereHitch` | not double-counted |

Row one is exactly the case the telemetry model claims a frame-time-only detector reports
"healthy" through. Now confirmed by measurement rather than asserted.

## Phase B: the conflict and its resolution

Phase A produced a direct contradiction. The performance budget prohibited raw per-frame
persistence on the basis of **144 bytes per sample**; the data engineer measured the columnar
encoding at **25–40 bits per frame** and challenged the prohibition.

**The perf engineer conceded the number, and by more than was claimed.** It measured the actual
struct in this repository — `TelemetrySample` is **32 bytes** — so 144 B was 4.5× larger than
even the naive row-per-sample shape the repo already had, and 44× the measured columnar cost.
In its own words: *"I did not measure the number I vetoed with. I estimated a SQLite row
footprint, then used it as if it were the cost of the data, then used that to prohibit the
data."*

**But it held ground on two points, both correct:**

1. The budget governs **bytes written**, not encoder output. Amplification is a container
   decision and is doing more work here than the encoding. The proposed `page_size=65536` fix
   for the syscall problem writes a fixed ~197 KB/min *regardless of payload* — 49 % of budget
   to store 11.6 KB at 60 fps, and an outright breach at 1000 fps.
2. The 1000 fps figure was a component, not a total. Rolled up with event windows, histograms
   and a corrected low-rate count, the worst case is **0.394 MB/min — 99 % of budget, not 51 %.**

**And it found a real defect in the challenger's design.** Cumulative-summing quantized deltas
is a random walk: 7.02 ms of timestamp drift at 1000 Hz over a 300 s chunk. The fix costs
nothing — second difference of quantized timestamps, same 8 bits/frame, exact integer
round-trip.

**Verdict: amend the prohibition, and replace the instrument.** The prohibition now reads *"in a
row-per-sample representation"*, which is true and which the columnar design also obeys. The
`≤ 6 write syscalls/min` line is replaced, because it was **inverted** — it forbade 625 buffered
4 KB writes costing 1.94 ms of CPU per minute while permitting a single 256 KB write that can
stall 8.95 ms.

Both agents changed position on evidence. Neither was simply right.

## Rejected alternatives

### Single SQLite store for everything — *considered by data-detection-engineer*
Rejected on measurement: SQLite issues **two writes per dirty page** (a 24-byte frame header
plus the page) in portable code above the VFS, so syscalls scale as `bytes ÷ page_size`. Source-
verified in the 3.45.1 amalgamation, so **this is identical on Windows, not merely similar.**
At the best page size the byte amplification breaches the budget.

### DuckDB — *considered by data-detection-engineer*
Excellent columnar analytics, but a 30+ MB native library against a 70 MB working-set budget,
and it is a bulk-load engine whose worst case is appending ~300 rows/s. It solves a problem we
do not have at a cost we cannot pay.

### Parquet for series storage — *considered by data-detection-engineer*
Immutable on close, so a live writer must buffer a whole row group in memory. **Rejected for
storage; recommended as an export format**, which is a different question and a good feature.

### `fps < X` threshold detection — *rejected*
Fires constantly on a 30 fps console port and never on a 240 fps game that hitches to 100.

## Consequences

### Positive
- Purging a session's raw frame data is `File.Delete` — **zero bytes written**. Inside SQLite it
  would write ~4.5 MB of pages plus freelist churn.
- The bulk data is **not inside a corruptible B-tree**. If the catalog is unrecoverable, summary
  rows are rebuilt by scanning the self-describing segment files. The user's history survives a
  SQLite corruption; the reverse split does not have this property.
- Six-month steady-state footprint ≈ **141 MB**.

### Negative / accepted costs
- Two formats to version, and we write our own CRC framing and recovery.
- **No `fsync` during a session.** Power loss costs ≤ 1 flush interval (20 s) of frame data.
  Deliberate, and stated rather than discovered.
- At 1000 fps the budget has 1.5 % margin, and decimation becomes mandatory above ~1030 fps.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **A hitch during warm-up is missed entirely** — measured: a 180 ms hitch at frame 100 is invisible. Shader compilation happens exactly then, and it is one of the most-complained-about stutter classes | Retain the raw window across warm-up and **re-run detection retrospectively at session finalize**, when the baseline is known. Recorded as the highest-value follow-up in this design. |
| **Sensitivity collapses on genuinely unstable games** — measured floor 29.2 ms at 25–40 fps vs 3.8 ms at 300 fps | Publish the per-regime floor in the UI. Above ~25 ms, switch the headline from stutter counting to sustained-low-performance: the honest diagnosis is "this is uniformly bad", not "no stutters". |
| **Abrupt regime change produces exactly one false event** per scene transition — the median lags 10 s | A `RegimeChange` class that reclassifies and resets the level estimator. Bounded at one per transition, never a train. |
| Our own GC pause registers as a stutter | Correlate against the GC-pause histogram; tag and exclude. A self-inflicted diagnosis is the worst possible failure for this product. |
| Regression detection has **12 % power at a 5 % regression** (measured at realistic session-to-session variability) | State the detectable effect size in the UI. False-positive rate stays at 1–2 %, so a *reported* regression is very unlikely to be noise — which is the direction that matters. |

## Dissent

Both parties moved. The data engineer's prohibition challenge was upheld; the perf engineer's
insistence that the budget governs written bytes, and its correction of the timestamp encoding,
were also upheld. Recorded because it is the clearest case in this project of the protocol
working as intended: two agents with measurements, neither wholly right.

The data engineer additionally questioned whether `frame.displayed.time` earns its ~35 % of the
frame chunk given its correlation with `frame.time`, and flagged it as the first thing to drop
if the budget tightens. Left open.

## What would change this decision

- Session-to-session variability proving nearer 15 % than 6 % → regression detection below a
  20 % effect is not viable and the feature must say so rather than shipping a statistic nobody
  can act on.
- `GetProcessIoCounters().WriteOperationCount` proving not to be per-`WriteFile` on Windows →
  the enforcement instrument changes, though not the analysis.
- Real captures showing animation error that does not resemble the synthetic alternation the
  pacing thresholds were tuned on. Marked CRITICAL: those thresholds rest entirely on synthetic
  data today.

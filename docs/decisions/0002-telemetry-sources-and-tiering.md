# 0002. Telemetry sources and privilege tiering

- Status: Accepted
- Date: 2026-08-23
- Council: windows-perf-engineer (lead), windows-internals-engineer, product-critic, data-detection-engineer

## Context

FrameDoctor needs frame timing plus CPU, GPU, memory, disk and process telemetry, at an
overhead that cannot perturb the thing being measured, on machines whose sensors we have never
seen.

## Decision

### Frame telemetry: bundled PresentMon CLI first, service second

v1 ships the **PresentMon 2.5.1 console application** (MIT, redistributable) as an Engine
child process, behind an `IFrameSource` seam. The PresentMon Service SDK is a v2 driver behind
the same seam.

Pinned invocation:

```
PresentMon-2.5.1-x64.exe --process_id <pid> --output_stdout --qpc_time
                         --session_name FrameDoctor --stop_existing_session
                         --terminate_on_proc_exit --no_track_input
```

`--no_track_input` because tracking is **on by default** and opted *out* of — a correction to
our own research file, which had the flag polarity backwards. A 1000 Hz gaming mouse would
otherwise add an input-event stream comparable to the present stream. Never
`--no_track_display`: that removes present mode, displayed time and dropped-frame detection,
which are three core signals.

Three drivers implement the seam from day one: CLI, **ETL replay** (the deterministic CI
corpus), and **Simulation**.

The seam carries an explicit **`LatencyClass`** — `Batched(~1s)` for the CLI, `Low(≤50ms)` for
the service. Without it the two sources are not interchangeable and swapping them would
silently change what the Live view means.

### Hardware telemetry: three tiers

| Tier | Requires | Provides |
|---|---|---|
| **Tier 0 — the default** | nothing | per-core load and **effective clock**, DPC/ISR time, per-process GPU utilization, commit headroom, hard faults, disk latency, and **full vendor GPU telemetry unelevated** (NVML / ADLX / IGCL) including NVIDIA's documented throttle-reason bitmask |
| **Tier 1 — elevated helper** | elevation | SMART, disk temperature. **Does not ship in v1** — the delta is small and elevation does not buy CPU temperature |
| **Tier 2 — LibreHardwareMonitor + PawnIO** | a third-party signed kernel driver, user-installed | CPU package/per-core temperature, RAPL power, NVIDIA hotspot, fan RPM |

**Tier 2 is opt-in, never prompted, never silently installed, and never load-bearing.** We
detect an *already-installed* PawnIO via its uninstall registry key and light the sensor layer
up if present. Every panel renders and every diagnosis reaches a conclusion on Tier 0 alone.

### The word "thermal" is not available to a CPU diagnosis in Tier 0

`cpu.throttle.state` in Tier 0 is `Unavailable(NoThermalSensor)` — not `Derived`, not
`Estimated`. Tier 0 may report **frequency collapse** as a first-class `Exact` observation, and
must then say it cannot distinguish thermal from a power limit without a temperature sensor.

## Rationale

**On CLI-first.** Both routes need admin exactly once, at install. The real difference is that
the CLI route needs the user in Performance Log Users (a security-relevant group change plus a
sign-out) while the service route redistributes a third-party privileged service that has
already demonstrated it can conflict with other vendors' installs.

The argument that settles the order is not either of those: **CLI-first makes the risky
assumption non-blocking.** The claim that an unelevated SDK client works rests on reading a
pipe ACL in source. If it is false on a real machine, the blast radius is "v2 never ships",
not "v1 is broken."

**On rejecting the Tier 0 thermal claim.** Our own research proposed that
`% Processor Performance` collapse plus thermal-zone throttle reasons could carry a CPU thermal
diagnosis. The perf engineer rejected this, and the reasoning is the most important finding in
this ADR:

> The confounders for a `% Processor Performance` drop are thermal throttle, PL1/PL2 power
> limit, current limit, OS power policy, core parking, hybrid P-to-E-core migration, AC adapter
> removal — and, the killer, **a normal all-core boost-bin change**. Going from one active core
> to eight legitimately drops per-core frequency 15–25 % with zero throttling, and in
> `% Processor Performance` it looks identical.

The offered corroborators do not close the gap: thermal-zone throttle reasons miss
silicon-internal PROCHOT, which is the dominant desktop case, and using a *GPU* throttle
bitmask as evidence for a *CPU* verdict is a category error.

Consequence for the product: **the flagship example sentence — "the CPU reached 96 °C" — is a
Tier 2 sentence.** The product critic independently reached the same conclusion and proposed
changing the example rather than the architecture. See ADR 0005.

**Four Tier 0 additions, all free, all confounder-killers**, that the research had missed:
active-core count correlated with per-instance performance; effective-power-mode notifications
(catches Windows switching to battery saver mid-session); core parking status; and AC-vs-battery
edge detection — the last being embarrassing to omit, since unplugging a laptop is the most
common cause of a sudden frequency collapse.

## Rejected alternatives

### Writing our own ETW present-reconstruction consumer — *considered by windows-perf-engineer*
Would give total control of buffer size, flush period and providers, fixing the latency problem
outright. Rejected: PresentMon's consumer is a state machine correlating DXGI → DxgKrnl → DWM →
VSync-DPC across seven present modes, HAGS, MPO, flip model and frame generation, refined since
2017 and MIT-licensed. Six to twelve months to match, silently mis-measuring throughout.

### LibreHardwareMonitor as the default sensor path — *considered by windows-perf-engineer*
Buys the headline sentence. Rejected: an install-time kernel-driver prompt for third-party
ring-0 code we do not sign and cannot support. A diagnosis that only works for users who
clicked yes is two products.

### WinRing0 — *rejected outright, never a candidate*
CVE-2020-14979 gives any local low-privilege caller arbitrary physical-memory read/write.
Microsoft Defender blocks it by name. The signing certificate expired and it can never be fixed.
LibreHardwareMonitor 0.9.6 no longer contains it.

### HWiNFO shared memory — *considered by windows-perf-engineer*
Rejected on licensing: its terms require the consuming application be unconditional freeware.

### Continuous `\Process(*)` polling — *considered by windows-perf-engineer*
Rejected. Instead, process nomination is **event-driven and rare**: one `\GPU Engine(*)`
expansion every 5 s yields every GPU-active pid from the instance name alone; when a stutter
fires, two `NtQuerySystemInformation` snapshots 250 ms apart give a CPU/IO delta for every
process. Paid ~20×/hour instead of 3600×/hour — roughly a 100× reduction.

## Consequences

### Positive
- v1 needs no elevated FrameDoctor component at all (see ADR 0003).
- NVML's throttle-reason bitmask gives a documented, driver-free, admin-free **GPU** thermal
  diagnosis — so the product's flagship capability survives without a kernel driver, on the GPU
  side.

### Negative / accepted costs
- CPU die temperature is unavailable by default, and the honest CPU diagnosis is weaker:
  *"effective clock fell 3.2 → 1.1 GHz under unchanged load; why it dropped: not determined —
  CPU temperature requires a kernel-mode sensor driver."*
- CLI transport costs ~1 s of Live-view freshness. Detection is unaffected: frame timestamps are
  QPC values carried in the events themselves.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **ETW manifest-provider slots exhausted.** Only 8 sessions may enable a manifest provider; DXGI, DxgKrnl and DWM are all manifest-based, and RTSS, Afterburner, FrameView, CapFrameX and Game Bar all contend | Pre-flight with `EnumerateTraceGuidsEx` before spawning; map the resulting `ERROR_NO_SYSTEM_RESOURCES` to a typed fault distinct from three other causes of the same error number; render `Unavailable(EtwProviderSlotsExhausted)`. **Never zero** — an exhausted-slot state rendered as a clean frame-time chart is a confidently wrong all-clear, and is the single most dangerous silent failure in the product. |
| `\GPU Engine(*)` expansion can enumerate ~1800 instances and cost 6–30 % of the entire CPU budget from one query | Wildcard only in a 0.2 Hz discovery tick; bind explicit instance paths once the pid is known. Plus a **self-limiting guard**: any PDH query whose p95 collect time exceeds 5 ms has its rate halved and its metrics marked `Degraded`, surfaced in the UI. |
| Counter names are localized on non-English Windows | `PdhAddEnglishCounterW` always, never `System.Diagnostics.PerformanceCounter`, which has no language-neutral path. Best mitigation is structural: the steady-state path uses explicit constructed instance paths, so wildcard expansion survives only in the discovery tick. |
| Anti-cheat blocks or flags ETW collection | `REQUIRES-WINDOWS-VALIDATION`, CRITICAL. Decides whether the product works on competitive titles at all. |

## Dissent

`windows-perf-engineer` **dissented from the research file's own recommendation** that Tier 0
suffices for CPU thermal diagnosis, and its position was adopted. The dissent is recorded here
because it changed a product-defining sentence, not merely an implementation detail.

## What would change this decision

- The Performance Log Users sign-out flow measurably costing installs → service goes first.
- The PresentMon service proving to supply `PM_METRIC_CPU_TEMPERATURE` on consumer hardware.
  The enum exists; availability is unknown. **This is the highest-upside open question in the
  project** — if true, Tier 2 shrinks to hotspot and fan RPM, and the flagship CPU thermal
  diagnosis becomes reachable with no kernel driver.
- Any Tier 0 combination that genuinely separates an all-core boost-bin drop from a thermal or
  power limit. If none exists, the answer is not a cleverer heuristic — it is that Tier 0
  reports frequency collapse and stops talking.

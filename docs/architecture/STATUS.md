# Implementation status

Single source of truth for what actually works. Keep it honest — "partially working" and "not
started" are useful entries. Anything claimed here must be backed by a passing test, a captured
screenshot, or a measurement.

Legend: **Done** · **Partial** · **Not started** · **Needs Windows**

_Last updated: 2026-08-23_

**Toolchain: .NET 10.0.400 SDK.** .NET 8 reaches EOL 2026-11-10, so it was never a candidate for
a product with no code yet.

**Test count: 305 .NET tests, 35 frontend unit tests, 18 screenshot tests. All passing.**

---

## The one-sentence summary

The measure → diagnose → explain pipeline is complete and exercised end to end on Linux against
simulated telemetry; the interface renders its real output on five screens; every Windows
collector and the one system mutation are written, compiled, and unit-tested behind seams — and
**none of them has ever executed against Windows.**

---

## Stage 0 — foundations

| Item | Status | Evidence |
|---|---|---|
| Environment inspection | Done | WPF compiles on Linux with `EnableWindowsTargeting`, verified by building a scratch project |
| Council system | Done | `.claude/agents` (9), `.claude/commands` (6), `.claude/council/PROTOCOL.md` |
| Council meta-review | Done | Applied once and stopped, per plan |
| Research: frame, hardware, internals, collectors | Done | `docs/research/` — four documents, source-line citations, evidence tags |
| Architecture decisions | Done | ADRs 0001–0006 in `docs/decisions/` |
| Performance budget, telemetry model | Done | `docs/architecture/` |
| Anti-slop scan | Done | `scripts/slop-scan.sh`, verified against a slopped fixture |

## Stage 1 — the portable core

| Item | Status | Evidence |
|---|---|---|
| Telemetry model, availability as a type | Done | 23 tests; an unavailable sample cannot yield a value |
| Metric catalog with minimum-sample rules | Done | `MetricCatalog.cs` |
| Monotonic clock, discontinuity types | Done | `Time/` |
| Log histogram, rolling window, frame statistics | Done | Percentile accuracy checked against exact values, four regimes |
| Adaptive stutter detector | Done | 32 tests; zero false positives on both hard regimes |
| GPU throttle vocabulary | Done | Interpreted in one place; an unnamed hardware slowdown is never read as thermal |

## Stage 2 — simulation

| Item | Status | Evidence |
|---|---|---|
| Simulation engine, 7 scenarios | Done | Every scenario asserted against an expected-outcome oracle |
| `framedoctor run-all` | Done | 6 of 7 diagnosed at 100 %; the seventh is the deliberately unexplained one |

## Stage 3 — diagnosis

| Item | Status | Evidence |
|---|---|---|
| Correlation windows | Done | Native rates preserved, bracketing samples included, no resampling |
| Confidence scoring | Done | Hard 0.97 ceiling, four caps, each verified |
| Diagnostic engine + 7 rules | Done | All scenarios diagnosed correctly, including power-limit vs. thermal |
| Unexplained as a first-class result | Done | Ruled-out list and blind spots kept distinct |

## Stage 4 — the interface

| Item | Status | Evidence |
|---|---|---|
| Design system and tokens | Done | `docs/design/`, `src/frontend/src/styles/tokens.css` |
| Live view | Done | Screenshots at four resolutions × seven scenarios |
| Frame-time chart | Done | Logarithmic axis, min/max column decimation, 17 axis tests |
| Event inspector | Done | Stepped metric panels at native rates; absent metrics keep their panel |
| Sessions | Done | Reads a fixture round-tripped through the real catalog |
| System | Done | Every metric listed with its source, working or not |
| Settings | Done | Real backend; no controls, because the command channel is not built |
| Screenshot harness | Done | 18 Playwright tests; the simulation banner is asserted in every one |

## Stage 5 — collection and storage

| Item | Status | Evidence |
|---|---|---|
| Collector seam (`IFrameSource`, `ISensorSource`, probes) | Done | Probing is separate from starting so the System view can answer per metric |
| PresentMon CSV parser | Done — **Needs Windows** | 14 tests including the three ambiguous-zero columns |
| PresentMon failure classification | Done — **Needs Windows** | 13 tests; exit 6 separated into three different answers |
| QPC conversion | Done | 9 tests; `Int128` arithmetic, overflow at 29 s proven absent |
| PDH sensor source | Done — **Needs Windows** | Counter names are per-machine data; the start-up probe is what makes them safe |
| Counter derivations | Done | 15 tests; effective clock, disk activity, busiest engine, busy cores |
| NVML GPU source | Done — **Needs Windows** | 8 status tests; absent NVML is an answer, not an error |
| Process attribution | Done — **Needs Windows** | 10 delta tests; event-driven, not on a timer |
| Memory source | Done — **Needs Windows** | Two kernel32 calls; commit charge in pages, not bytes |
| Session catalog, segments, codecs | Done | 52 tests |
| Settings store | Done | 12 tests; a corrupt file yields defaults, never a refusal to start |
| Pipeline → storage wiring | Done | 9 integration tests; a session reads back describing what happened |

## Stage 6 — the engine and the shell

| Item | Status | Evidence |
|---|---|---|
| `LiveSession` — bounded streaming pipeline | Done | 15 tests proving it matches the batch analyzer, confidence included |
| Collector loop | Done | One thread, rented buffers, worst-poll duration tracked |
| Telemetry pipe server | Done — **Needs Windows** | One client, engine outlives it |
| `framedoctor-engine` verbs | Done | `probe`, `serve`, `simulate`, `sessions`, `settings`, `reconcile` |
| WPF shell + WebView2 | Compiles — **Needs Windows** | Has never been launched; every visual judgement so far is from headless screenshots |
| Telemetry bridge | Done | 10 tests; a claimed reading with no number renders as absent, never as zero |

## Stage 7 — reversible optimization

| Item | Status | Evidence |
|---|---|---|
| Change journal | Done | 15 tests; written and flushed before the change, one file per entry |
| Compare-and-restore | Done | 13 tests; a value changed by someone else is never overwritten |
| Apply protocol | Done | 13 tests; read, re-read, journal, apply, verify, revert on disagreement |
| Throttle deny-list | Done | 18 tests; fails closed, and refuses anything encoding video |
| EcoQoS change | Done — **Needs Windows** | 10 mapping tests; three states, not two |
| `reconcile` verb | Done | One code path for engine start, logon, uninstall and the user |

## Stage 8 — packaging

| Item | Status | Evidence |
|---|---|---|
| Publish script | Done | Produces both PE32+ binaries and the interface, 150 MB installed |
| Shared runtime between the two executables | Done | One copy rather than two; about a third of the installed size |
| WiX package definition | Written — **Needs Windows** | `packaging/FrameDoctor.wxs`; WiX 5 builds MSIs on Windows only |
| Clean-machine install / upgrade / uninstall | Not started — **Needs Windows** | — |
| Code signing | Not started | No certificate |

## Not built

| Item | Why it is not here |
|---|---|
| Command channel, shell → engine | Settings are therefore read-only in the interface, and the screen says so rather than showing controls that would do nothing |
| Game detection | The engine measures what it is pointed at; automatic detection is Stage 9 |
| Baselines and regression detection | Sessions record `baselineEligible`; nothing consumes it yet |
| Retention purge on a schedule | `PurgeHighResolution` exists and is tested; nothing calls it on a timer |
| AMD and Intel GPU sources | The seam and the shared throttle vocabulary are in place for them |
| Tier 2 sensors (CPU temperature) | Requires a kernel driver. Reported as unavailable with the reason instead |
| Display power request during gamepad play | ADR 0003 lists it; not started |

## Known environment limitations

These are not defects; they define how work is verified.

| Limitation | Consequence |
|---|---|
| No Windows runtime | The shell compiles and cannot be launched. Every Windows path is marked `REQUIRES-WINDOWS-VALIDATION`. |
| No GPU, no PresentMon, no sensors | Real collectors cannot be exercised. Simulation carries verification, and the seams are drawn so the pure logic is testable. |
| WiX builds MSIs on Windows only | The package definition is authored and the payload is produced; the MSI itself is not. |
| No signing certificate | The binaries are unsigned, which Windows SmartScreen will warn about. |

## Requires Windows validation

The full register, with severities and the test that resolves each row, is
`docs/WINDOWS-VALIDATION.md`. It currently holds **14 CRITICAL rows**, and
`/council-prerelease` cannot return READY-FOR-WINDOWS-VALIDATION while any of them is open.

The four that would change the product's shape if they came back wrong:

1. **Explanation rate on real Tier 0 telemetry.** If a low share of real stutters reach a named
   cause, v1 is a stutter counter rather than a diagnostician.
2. **Whether 4 Hz counters can resolve a 20–200 ms stutter at all.** Everything downstream of
   the collectors assumes they can.
3. **FrameDoctor's own frame-time impact.** Invariant 8 is currently asserted by
   self-instrumentation, which cannot see the ETW logger thread's kernel CPU or a GC pause.
4. **Whether an unelevated process can start the trace session.** If not, v1 needs a UAC prompt
   per session and the no-elevation deployment story does not hold.

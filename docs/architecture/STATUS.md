# Implementation status

Single source of truth for what actually works. Keep it honest — "partially working" and
"not started" are useful entries. Anything claimed here must be backed by a passing test, a
captured screenshot, or a measurement.

Legend: **Done** · **Partial** · **Not started** · **Blocked** · **Needs Windows**

_Last updated: 2026-08-23_

**Toolchain: .NET 10.0.400 SDK.** .NET 8 reaches EOL 2026-11-10, so it was never a
candidate for a product with no code yet.

## Stage 0 — foundations

| Item | Status | Evidence |
|---|---|---|
| Environment inspection | Done | .NET 8.0.424 at `/opt/dotnet`; WPF compiles on Linux with `EnableWindowsTargeting` (verified by building a scratch WPF project); Node 22 + pnpm 10; Chromium at `/opt/pw-browsers` |
| Council system | Done | `.claude/agents` (9), `.claude/commands` (6), `.claude/council/PROTOCOL.md` |
| Council meta-review | Done | Applied once and stopped, per plan. See commit history; `scripts/slop-scan.sh` verified against a slopped fixture |
| Research: frame telemetry | In progress | → `docs/research/frame-telemetry.md` |
| Research: hardware telemetry | In progress | → `docs/research/hardware-telemetry.md` |
| Research: Windows internals | In progress | → `docs/research/windows-internals.md` |
| Architecture decision | ADRs 0001-0005 accepted | `docs/decisions/` |
| Council Phase A | Done — 6 agents, all ran real experiments | ADR rationale sections |
| Council Phase B | Running — one genuine conflict: frame persistence cost | — |
| Performance budget | Done | `docs/architecture/performance-budget.md` |
| Telemetry model spec | Done | `docs/architecture/telemetry-model.md` |

## Stage 1 — foundations in code

| Item | Status | Evidence |
|---|---|---|
| Solution scaffolding (global.json, Directory.Build.props, central packages) | Done | Builds clean with `TreatWarningsAsErrors` |
| `FrameDoctor.Abstractions` — telemetry model | Done | `dotnet build -c Release`, 0 warnings |
| Metric catalog with minimum-sample rules | Done | `MetricCatalog.cs` |
| Monotonic clock + discontinuity types | Done | `Time/` |
| Telemetry model tests | Done | **10 passing** — including that an unavailable sample refuses to yield a value |
| Rolling statistics: log histogram | Done | Accuracy verified against exact percentiles, 4 regimes x 4 percentiles |
| Rolling window + frame-time statistics | Done | Sliding window proven exactly equal to a fresh histogram |
| Adaptive stutter detector | Done | **28 tests** — zero false positives on both hard regimes |
| Diagnostics / Storage / Ipc / Simulation | Scaffolded, empty | — |
| Windows platform layer | Not started | — |
| Frontend | Not started | — |

## Stages 2–10

Not started. See `CLAUDE.md` for the staging plan.

## Known environment limitations

These are not defects; they define how work is verified.

| Limitation | Consequence |
|---|---|
| No Windows runtime | WPF shell compiles but cannot be launched here. Windows-only paths are marked `REQUIRES-WINDOWS-VALIDATION`. |
| No GPU, no PresentMon, no sensors | Real collectors cannot be exercised. Simulation mode and interface-level fakes carry verification. |
| No installer testing | Clean-machine install test is deferred to a Windows machine. |

## Requires Windows validation

Running list of everything that compiles and is unit-tested here but has never executed
against real Windows. Nothing on this list may be described as "working".

_(empty — nothing built yet)_

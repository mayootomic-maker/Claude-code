# FrameDoctor

Real-time gaming performance diagnostics for Windows.

FrameDoctor measures frame and system telemetry, detects stutters, and explains their most
likely cause with inspectable evidence. It optimizes only where measurement justifies it.

The product is defined by this distinction:

- **Not**: "BOOST FPS by 500%"
- **Yes**: "Your 142 ms stutter was most likely caused by CPU frequency collapsing from
  3.2 GHz to 1.1 GHz while the CPU reached 96 °C. Thermal throttling confidence: 97%."

---

## Invariants

These are not preferences. Changing one requires an ADR.

1. **Measure → diagnose → optimize.** Never reversed. No optimization exists because someone
   online claimed it raises FPS.
2. **Fixed layering.** collectors → raw telemetry → normalization → rolling statistics →
   anomaly detection → correlation → diagnostic engine → session storage → UI.
   Collectors contain no diagnostic logic. The UI contains no system-level business logic.
3. **The diagnostic engine is deterministic**, explainable, inspectable and testable.
   No LLM in the hot diagnostic path.
4. **Every system change is reversible.** Original state is captured and durably persisted
   *before* mutation, and is restorable without the UI being alive.
5. **No unsafe tweaks.** No kernel drivers, process injection, anti-cheat interference,
   registry folklore, fake RAM cleaning, blanket service disabling, or REALTIME priority.
6. **Not elevated as a whole.** Elevation is confined to a narrow, auditable surface.
7. **Local-only and offline.** No account, no telemetry upload, no analytics, no cloud.
8. **FrameDoctor's own overhead is a feature.** It must never be the cause of a stutter.
   Measurable gameplay impact is a critical bug.
9. **No fake implementation.** No placeholder buttons, fake charts, hardcoded metrics,
   random data outside simulation mode, or controls with no backend. Anything unimplemented
   is explicitly rendered as unavailable, with the reason.
10. **Simulation mode is first-class**, not a test fixture. The UI, diagnostics and tests all
    run against it.

## Honesty rules that apply to the product itself

- A metric with no sensor renders as *unavailable*, never as zero.
- Correlation is presented as correlation. Confidence reflects evidence quality.
- Percentiles below the minimum sample size report "insufficient data".
- An optimization is only "successful" with an effect size that survives the noise.

---

## The council

An expert council of independently-executed agents reviews major decisions.
Say **"run the council on X"** → `/council X`.

| Command | Use for |
|---|---|
| `/council <topic>` | Major cross-cutting decisions |
| `/council-architecture <area>` | Boundaries, IPC, privilege, reliability |
| `/council-ui <screen>` | Any UI change — **requires real screenshots** |
| `/council-performance <component>` | FrameDoctor's own overhead |
| `/council-diagnostics <detector>` | Detection, statistics, confidence honesty |
| `/council-prerelease <milestone>` | Release gate |

Protocol: `.claude/council/PROTOCOL.md`. Standard brief: `.claude/council/BRIEF.md`.
Decisions land in `docs/decisions/`. Research lands in `docs/research/`.

**Escape hatch:** small, local, reversible changes do not need a council. Use judgement;
the council exists to make FrameDoctor better, not to be satisfied.

---

## Build environment reality

This repository is developed in a **Linux container**. That shapes verification:

- .NET 8 SDK at `/opt/dotnet`. `net8.0-windows` and WPF **compile** here with
  `EnableWindowsTargeting=true`, but cannot **execute**.
- Node 22 + pnpm. Chromium at `/opt/pw-browsers` (never run `playwright install`).
- No Windows, no GPU, no PresentMon, no hardware sensors.

Therefore: **all Windows-specific code sits behind interfaces**, and the portable core —
telemetry model, statistics, detection, correlation, diagnosis, storage, simulation — is
fully testable on Linux. Anything that genuinely requires Windows is marked
`REQUIRES-WINDOWS-VALIDATION` and tracked, never silently assumed to work.

---

## Dangerous areas

Touch these only with the relevant council review:

- **Anything that writes system state.** Power policy, process priority, startup entries.
  Requires `windows-internals-engineer` review and a proven rollback path.
- **The elevation boundary and its IPC.** Every message crossing it is untrusted input.
- **Retention and purge.** A bug here destroys the user's history irreversibly.
- **The collector hot path.** Allocation here becomes GC pressure becomes a stutter —
  the exact thing we exist to prevent.
- **Confidence scoring.** Overstating certainty destroys the product's reason to exist.

---

## Status

Current stage and what is genuinely working: see `docs/architecture/STATUS.md`.
That file is the single source of truth for implementation status. Keep it honest —
"partially working" is a valid and useful entry.

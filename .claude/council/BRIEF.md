# Standard council brief

Paste into every Phase A agent prompt, above the topic-specific brief.

---

## Product

**FrameDoctor** — a Windows real-time gaming performance diagnostics application.

It detects games automatically, measures frame and system telemetry, detects stutters,
determines the most likely cause with explainable confidence, tracks performance across
sessions, detects regressions, applies only safe reversible evidence-based optimizations,
and benchmarks whether they actually helped.

The product is defined by this distinction:

- NOT: "BOOST FPS by 500%"
- YES: "Your 142 ms stutter was most likely caused by CPU frequency collapsing from
  3.2 GHz to 1.1 GHz while the CPU reached 96 °C. Thermal throttling confidence: 97%."

## Invariants — do not propose violating these

1. **Measure → diagnose → optimize.** Never reversed.
2. Fixed layering: collectors → raw telemetry → normalization → rolling statistics →
   anomaly detection → correlation → diagnostic engine → session storage → UI.
   Collectors hold no diagnostic logic. The UI holds no system-level business logic.
3. The diagnostic engine is deterministic, explainable, inspectable, testable.
   **No LLM in the hot diagnostic path.**
4. Every system change is reversible, with original state captured before mutation and
   restorable without the UI.
5. No kernel drivers, process injection, anti-cheat interference, registry folklore, fake
   RAM cleaning, blanket service disabling, or REALTIME priority.
6. The application does not run elevated as a whole. Elevation is narrow and auditable.
7. Local-only, offline-capable. No account, no telemetry upload, no analytics.
8. FrameDoctor's own overhead is a feature. It must not cause stutters.
9. **No fake implementation.** No placeholder buttons, fake charts, hardcoded metrics,
   random data outside simulation mode, or controls with no backend.
   The canonical unavailable form: every metric carries an explicit availability state and
   renders as `Unavailable(<reason>)`. A control with no implementation behind it is
   **absent**, not disabled-with-a-tooltip. All simulation data flows through one named
   transport, so any randomness outside it is greppably illegal.
10. Simulation mode is mandatory and first-class: 18 deterministic scenarios that the UI,
    diagnostics, and tests all run against.

---

## Evidence tags — use exactly these three

| Tag | Means |
|---|---|
| `[verified]` | I executed it or read it **in this session** |
| `[documented]` | Primary source — **must carry a URL**. A documentation claim without a URL is `[unverified]`, however confident you are. |
| `[unverified]` | Everything else, including anything from memory |

Plus one marker, `REQUIRES-WINDOWS-VALIDATION`, for the environment gap (see below).

No other tags. A taxonomy nobody applies consistently is worse than none, and Phase B's
assumption audit depends on this one.

---

## Repository state — check before citing

Open the file before you cite it. When the code you would cite does not exist, write
`NOT YET BUILT — <what would have to exist>`.

**A fabricated `file:line` is the most serious protocol violation available to you** — worse
than being wrong, because a wrong claim can be argued with and an invented citation cannot.
If you cite a path, you opened it in this session.

## Build environment

Linux container.

- **.NET 8 SDK at `/opt/dotnet` — NOT on `PATH`.** Invoke as `/opt/dotnet/dotnet`, or
  `export PATH="$PATH:/opt/dotnet"` first.
- Node 22 + pnpm 10. Chromium at `/opt/pw-browsers` (never run `playwright install`).
- `net8.0-windows`/WPF **compiles** here with `EnableWindowsTargeting=true` `[verified]`
  but cannot **execute**.
- No Windows, GPU, PresentMon, or hardware sensors.

Anything unverifiable here is marked `REQUIRES-WINDOWS-VALIDATION` and **appended as a row to
`docs/WINDOWS-VALIDATION.md`**. A marker that exists only in a council transcript does not
exist.

---

## Shared output contract

Every Phase A response uses these six sections. Individual agents add a delta on top.

## Recommendation
One sentence a person could act on, then the detail.

## Rationale
Evidence-based. Measured facts and primary documentation beat convention.

## Assumptions
Every one tagged with the three tags above.

## Risks
Each with likelihood, blast radius, and a mitigation.

## Alternatives considered
For each: what it buys, what it costs, why not chosen.

## Unresolved questions
Genuine open items only.

### Empty sections
Write the heading and "None." Padding a section is worse than omitting it.
**Length is not a quality signal.**

### If this is not your remit
Reply with one line — `NOT MY REMIT — <why> — <which agent should own it>` — and stop.
This is a valued outcome and costs the council nothing. Generic commentary outside your
expertise actively harms the council: it pads Phase B and dilutes the ADR.

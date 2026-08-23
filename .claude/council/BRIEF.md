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
   random data outside simulation mode, or controls with no backend. Unimplemented things
   are explicitly marked unavailable.
10. Simulation mode is mandatory and first-class: 18 deterministic scenarios that the UI,
    diagnostics, and tests all run against.

## Build environment

Linux container. .NET 8 SDK at `/opt/dotnet`. Node 22 + pnpm. Chromium at
`/opt/pw-browsers/chromium`. `net8.0-windows`/WPF compiles (`EnableWindowsTargeting=true`)
but cannot execute. No Windows, GPU, PresentMon, or hardware sensors.

Mark anything unverifiable here as `REQUIRES-WINDOWS-VALIDATION`.

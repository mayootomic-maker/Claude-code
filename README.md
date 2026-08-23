# FrameDoctor

Real-time gaming performance diagnostics for Windows.

FrameDoctor measures frame and system telemetry, detects stutters, and explains their most likely
cause with inspectable evidence. It optimizes only where measurement justifies it.

The product is defined by this distinction:

- **Not**: "BOOST FPS by 500%"
- **Yes**: *"Frame time rose to 88 ms while CPU effective clock fell 34 %. Why it did so cannot be
  determined here: a thermal limit, a power or current limit, and an operating-system power policy
  change all look identical without a CPU temperature sensor, which requires a kernel-mode driver
  this machine does not have."* — Confidence 60 %, capped because a sensor this diagnosis needs is
  unavailable.

That second answer is the actual output of the diagnostic engine, and the caveat in it is the
point. A tool that says "thermal throttling, 97 % confident" on a machine that cannot measure
temperature is guessing with a percentage attached.

---

## What state it is in

The pipeline is complete and runs end to end. The interface renders its real output. Every
Windows collector is written and unit-tested behind a seam — and **none of them has executed
against Windows.** `docs/architecture/STATUS.md` is the honest account, and
`docs/WINDOWS-VALIDATION.md` is the list of everything that compiles here and has never run
there.

Nothing in this repository should be described as "working on Windows" yet.

---

## Trying it without a gaming PC

The whole product runs against simulated telemetry, on any platform. This is not a test fixture:
the detector, the correlation windows, the rules and the confidence scoring are the same code a
live capture uses. Only the input is synthetic, and every screen says so.

```bash
# Run one scenario through the real pipeline and print the diagnosis
dotnet run --project src/FrameDoctor.Cli -- run gpu-power-limit

# Every scenario, with the expected-outcome oracle
dotnet run --project src/FrameDoctor.Cli -- run-all

# What this machine could actually measure, if it were Windows
dotnet run --project src/FrameDoctor.Engine -- probe

# The same pipeline through the streaming session the engine uses
dotnet run --project src/FrameDoctor.Engine -- simulate cpu-frequency-collapse
```

The interface:

```bash
cd src/frontend
pnpm install && pnpm dev
```

---

## Architecture in one table

| Process | Lifetime | Holds |
|---|---|---|
| `framedoctor-engine` | resident; outlives the window | collectors, pipeline, detection, diagnosis, storage, rollback journal |
| `framedoctor` (shell) | only while a window is open | WPF host, WebView2, React. Presentation only. |

Plus a PresentMon child process while a capture is live.

The layering is fixed and one-directional: collectors → raw telemetry → normalization → rolling
statistics → anomaly detection → correlation → diagnostic engine → session storage → UI.
Collectors contain no diagnostic logic. The UI contains no system-level logic.

Decisions and their rationale are in `docs/decisions/`. Six ADRs, each recording what was
rejected and why.

---

## The rules the code is written to

These are invariants, not preferences. Changing one requires an ADR.

1. **Measure → diagnose → optimize.** Never reversed. No optimization exists because someone
   online claimed it raises FPS.
2. **Fixed layering**, as above.
3. **The diagnostic engine is deterministic**, explainable, inspectable and testable. No language
   model in the hot diagnostic path.
4. **Every system change is reversible.** Original state is captured and durably persisted
   *before* mutation, and is restorable without the UI being alive.
5. **No unsafe tweaks.** No kernel drivers, process injection, anti-cheat interference, registry
   folklore, fake RAM cleaning, blanket service disabling, or REALTIME priority.
6. **Not elevated as a whole.** Elevation is confined to a narrow, auditable surface.
7. **Local-only and offline.** No account, no telemetry upload, no analytics, no cloud.
8. **FrameDoctor's own overhead is a feature.** It must never be the cause of a stutter.
9. **No fake implementation.** No placeholder buttons, fake charts, hardcoded metrics, random
   data outside simulation mode, or controls with no backend.
10. **Simulation mode is first-class**, not a test fixture.

The honesty rules that follow from them, applied to what a user reads:

- A metric with no sensor renders as *unavailable*, never as zero.
- Correlation is presented as correlation. Confidence reflects evidence quality.
- Percentiles below the minimum sample size report "insufficient data".
- An optimization is only "successful" with an effect size that survives the noise.

---

## Building

Developed in a Linux container. `net10.0-windows` and WPF compile here with
`EnableWindowsTargeting` but cannot execute, which is why every Windows-specific type sits behind
an interface and the portable core is fully testable.

```bash
dotnet build -c Release                      # everything
dotnet test  -c Release                      # 305 tests
cd src/frontend && pnpm test                 # 35 unit tests
cd src/frontend && pnpm exec playwright test --config=playwright.shots.ts   # 18 screenshots
bash scripts/slop-scan.sh                    # greppable enforcement of invariant 9
bash packaging/publish.sh                    # both executables plus the interface
```

Screenshots land in `artifacts/screenshots/`. They are the artefacts `/council-ui` reviews, and
the simulation banner is asserted in every one — a screenshot pasted into an issue without it
would have a wrong diagnosis debugged as if it were real.

---

## The council

An expert council of independently-executed agents reviews major decisions. It exists because the
failure mode of a project like this is not bad code; it is confident code that is subtly
dishonest, and that is easier to catch from a different seat.

| Command | Use for |
|---|---|
| `/council <topic>` | Major cross-cutting decisions |
| `/council-architecture <area>` | Boundaries, IPC, privilege, reliability |
| `/council-ui <screen>` | Any UI change — **requires real screenshots** |
| `/council-performance <component>` | FrameDoctor's own overhead |
| `/council-diagnostics <detector>` | Detection, statistics, confidence honesty |
| `/council-prerelease <milestone>` | Release gate |

Protocol: `.claude/council/PROTOCOL.md`. Decisions land in `docs/decisions/`, research in
`docs/research/`.

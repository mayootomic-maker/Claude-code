# FrameDoctor — product specification

Condensed from the original brief so council agents and future sessions read requirements
rather than a paraphrase of them. Invariants live in `.claude/council/BRIEF.md` and
`CLAUDE.md` and are not repeated here.

## Purpose

1. Detect games automatically
2. Measure actual frame performance and system behaviour
3. Detect stutters and performance collapses
4. Determine the most likely cause
5. Track performance across sessions
6. Detect regressions over time
7. Apply only safe, reversible, evidence-based optimizations
8. Benchmark whether those optimizations actually helped
9. Present all of it through an exceptionally well-designed desktop interface

## Stutter detection

Not `FPS < X`. Adaptive frame-time analysis against a rolling local baseline, detecting
abnormal spikes relative to *recent* frame behaviour. Classes: normal variance ·
micro-stutter · stutter · severe hitch · sustained low performance.

Every detected event opens a correlation window (event ± ~2 s) capturing the metrics around
it, e.g. frame time 6.4 → 112 ms; CPU core 7 46 → 100 %; chrome.exe 2 → 34 %; GPU
utilization 96 → 42 %. That evidence feeds the diagnostic engine.

## Diagnostic engine

Deterministic, explainable, inspectable, testable. Hypotheses for at least: CPU thermal
throttling · GPU thermal throttling · CPU clock collapse · GPU clock collapse · CPU
single-thread bottleneck · GPU saturation · GPU starvation · VRAM pressure · RAM pressure ·
paging · disk stall · background CPU spike · background disk spike · competing GPU process ·
process priority/resource contention · possible driver interruption/reset · unknown anomaly.

A diagnosis carries: type · title · confidence · evidence · telemetry changes · event
timestamp · affected interval · suggested next action.

**Never display 100 % certainty unless evidence genuinely proves causation.** Correlation is
presented as correlation.

## Baselines and regressions

Learn normal behaviour per game using statistical baselines — without pretending basic
statistics are AI. Track typical FPS, 1 % low, 0.1 % low, frame-time percentiles, CPU/GPU
usage, clocks, temperatures, VRAM, RAM, stutter frequency. After enough data, detect
regressions, and where possible correlate them with system changes (driver update,
application install, changed power plan, changed profile).

## Sessions

Created automatically. Store game, executable, start/end, duration, summary metrics,
detected events, diagnoses, hardware state, important system state, and which optimizations
were active. Tiered retention: high resolution for recent/event windows, aggregated
session-wide, compact long-term statistics.

## Optimization lifecycle

Eligibility → capture original state → apply → verify application → benchmark → compare →
keep or roll back.

Each optimization exposes: what it changes · why · original value · new value · expected
impact · risk · measured impact · rollback availability.

Prohibited absolutely: fake RAM cleaning · registry folklore · arbitrary service disabling ·
timer-resolution hacks · undocumented scheduler magic without evidence · REALTIME priority ·
anti-cheat bypasses · process injection · game memory modification · kernel drivers ·
arbitrary command execution · destructive permanent tweaks · mass Windows debloating.

**Knowing when not to optimize is part of the product.** Example of a correct non-answer:
"Your CPU reaches 96 °C and reduces frequency by ~62 %. Software cannot meaningfully fix
this. Inspect CPU cooling."

## A/B benchmarking

Treat an optimization as an experiment. Compare average FPS, median frame time, 1 % low,
0.1 % low, p95, p99, frame-time variance, stutter count, severe stutter count.
**Do not declare success from statistically meaningless differences.**

## Simulation mode

Mandatory from the beginning; the UI, diagnostics and tests all run against it. Scenarios:
healthy · CPU thermal throttling · GPU thermal throttling · CPU clock collapse · GPU clock
collapse · single-core bottleneck · GPU bottleneck · RAM pressure · VRAM pressure · paging ·
disk stall · background CPU spike · background disk spike · repeated micro-stutters · single
huge hitch · noisy telemetry · missing sensor · unknown anomaly. Recorded telemetry must be
replayable.

## Navigation

Live · Sessions · Diagnostics · Optimize · System · Settings. Not every feature belongs in
navigation.

**Live** is the main screen and must answer within ~2 s: what game is running; is
performance healthy; FPS and frame consistency; did a stutter just occur; what likely caused
it. Structure: header (game, running state, elapsed) → primary metrics (FPS, frame time,
1 % low) → real-time frame-time timeline with stutters marked inline → secondary telemetry
(CPU/GPU/VRAM/RAM) → latest event with likely cause, confidence, and an inspect action.
Not twenty tiny gauges.

**Event inspector** — a standout surface. Synchronized timelines on one X axis (frame time,
CPU usage, CPU clock, GPU usage, GPU clock, CPU temp, GPU temp, disk activity, relevant
process activity) with the event time highlighted, then: what happened · likely cause ·
evidence · what changed · recommended action. Understandable without hiding the evidence.

**Diagnostics** answers "what is currently limiting performance?" per subsystem, with
inspectable evidence, and without pretending uncertain diagnoses are definitive.

**Optimize** shows evidence-backed opportunities, never a "BOOST MY PC" button.

**System** shows hardware relevant to gaming performance — not a re-creation of CPU-Z.

**Settings** stays restrained. No hundreds of obscure toggles.

## First launch

No eight-screen carousel. Explain what FrameDoctor does, detect available telemetry sources,
show missing permissions/components, run a short system check, enter the app.

## Design

Direction: **precision engineering instrument + modern motorsport telemetry + premium
Windows desktop software.** Not: gaming launcher, crypto dashboard, enterprise admin panel,
generic SaaS template.

Avoid: giant headings · giant cards · excessive roundness · excessive borders · random
gradients · glass everywhere · neon RGB · gamer clichés · large empty areas · fake status
badges · meaningless charts · excessive shadows · pointless animations · emoji · "Welcome
back" · inspirational copy · marketing language inside the tool.

Information density high but controlled. Serious, fast, expensive. Dark mode primary.
Colour carries meaning only. Motion is deliberate and respects reduced-motion.

Targets: Windows 11 primarily, Windows 10 where reasonable. Test at 1280×720, 1920×1080,
2560×1440, ultrawide. Desktop-designed, not a stretched mobile site. Native title bar,
minimize/maximize/close, system tray, launch minimized, reopen from tray. No intrusive
overlay in v1.

## Charts

Central to the product. Smooth real-time updates · hover inspection · synchronized cursors ·
zoom · event markers · selection · comparison overlays · large data sets. Do not re-render
the app on every sample. Performance matters more than library popularity.

## Security and privacy

Do not run the whole app as administrator; separate privileged operations and elevate only
where required. Validate process ids, executable paths, IPC messages, optimization requests.
No arbitrary command execution. Local services bound locally. No internet-facing APIs.

Default: local-only data, no account, no telemetry upload, no analytics, no cloud. Fully
functional offline.

## Failure handling

Design the failure states: PresentMon unavailable · sensor unsupported · GPU metric
unavailable · permission denied · collector crashed · game disappeared · database recovery ·
partial telemetry · rollback failure. **Never fail silently. Never let one missing sensor
crash the application.**

## Definition of done — first usable version

1. Install on Windows
2. Launch a game
3. FrameDoctor detects it automatically
4. See real frame-time data
5. See CPU/GPU/RAM telemetry
6. A real stutter is detected
7. Inspect synchronized telemetry around that event
8. Receive an evidence-backed probable diagnosis
9. Finish the session
10. Inspect the recorded session afterwards
11. Relaunch without losing data
12. Run simulation scenarios
13. Uninstall without leaving unsafe system modifications behind

### Added by the council (Phase A, product critic)

14. A **clean session**: play a healthy session and have FrameDoctor correctly report no
    stutters and no diagnosis. A tool that only proves itself by finding something will
    find something.
15. An **unexplained stutter** correctly reported as unexplained, with its exclusions listed.
16. The **capture-failure path**: frame capture denied or blocked by anti-cheat produces a
    clear, specific, fixable message.
17. **Kill it mid-session** (End Task / power cut): the partial session is readable or
    cleanly discarded, and any system change is rolled back.
18. **FrameDoctor's own overhead measured during that session** and visible in the app.

## The first real-world mission

"Games that previously ran smoothly have started randomly becoming extremely laggy,
including very lightweight games."

FrameDoctor should eventually catch that event and explain the most likely cause. Do not tune
the whole application to this one issue — use it as the first serious validation case.

## The product standard

At every stage:

- Would I trust this application to tell me why my game is stuttering?
- Would I voluntarily keep this installed on my PC?
- Is this actually better than opening Task Manager and HWiNFO manually?

If the answer is no, keep improving it.

# 0005. First-release scope

- Status: Accepted
- Date: 2026-08-23
- Council: product-critic (lead, holds the scope veto), windows-internals-engineer, windows-perf-engineer

## Context

The brief specifies 52 sections. Building all of them before anything runs on real Windows
would produce a large amount of unvalidated software and delay the only thing that can prove
the product works.

## Decision

**Ship a diagnostic instrument, not an optimizer.**

v1 is: auto-detect → capture frame times and Tier 0 telemetry → detect stutter events →
**event inspector** → seven named diagnoses including *unexplained-with-exclusions* → persist
and reopen sessions.

### Cut entirely from v1
The optimization engine and the Optimize view · network telemetry, including its metric
namespace · A/B benchmarking · light mode · multi-game comparison · Tier 1 elevated helper ·
Tier 2 kernel driver · in-game overlay · configurable sampling rates, thresholds and
sensitivity sliders · any 0–100 score.

### Deferred
Cross-session regression *statistics* — but v1 **stores** what makes them possible later
(per-session summaries and the `sys.*` configuration snapshot with change events), because that
is cheap now and impossible to backfill. Tier 2 telemetry: detect-if-already-installed, later,
never prompt.

### Build smaller
Session comparison → one previous-session table plus a config diff, with an explicit
"insufficient data to compare" state. No alerts, no trend charts, no significance claims.
Notifications → exactly one session-end toast. **No live in-game stutter alerts** — they
interrupt the thing we are measuring, so we would become the distraction we exist to prevent.
Simulation scenarios → **6, not 18**.

### Added by the council
- `cpu.dpc.time` / `cpu.isr.time` and a **DPC-storm diagnosis** (see below)
- **"Unexplained with exclusions"** as a first-class result
- **Explanation rate as the primary KPI**, gating release
- Session export, one button, one format
- Display-keep-awake, as a *setting*, not an optimization
- Five additional definition-of-done items (see `docs/PRODUCT-SPEC.md`)

## Rationale

### Why the optimization engine is cut, not stubbed

Of ~18 candidate optimizations, exactly **one** has strong evidence. Building an engine, a
policy layer, a rollback journal, an elevation boundary and a view around one button is
complexity that does not pay for itself.

More importantly, it is a **sequencing** requirement, not just a design ordering: the one good
action is only as correct as a diagnostic engine that has never run on real Windows. EcoQoS on
the wrong process is user-visible harm — a degraded voice call, a stalled download, a build
that takes 3× longer. *Measure → diagnose → optimize* means you must establish diagnostic
accuracy before you are allowed to act on it, and we have no accuracy number yet.

And the trap: ship an Optimize view and the first thing every user looks for is the
raise-game-priority toggle, which has **no methodologically sound supporting measurement
anywhere**. We would either ship it, violating invariant 1, or spend credibility explaining its
absence inside a view whose entire purpose is offering optimizations. Better to have no view.

What replaces it costs almost nothing and delivers the same value: **a recommended action
attached to the diagnosis, which the user performs** ("Close `OneDrive.exe` — it consumed 41 %
of one core during this stutter"), plus a **read-only system-configuration report** naming
settings demonstrably hurting. Zero mutation, zero rollback obligation, zero elevation.

### Why "unexplained" must list its exclusions

The biggest product risk is not a crash or a wrong number. It is:

> FrameDoctor detects stutters and cannot explain them. The user opens a session: 23 events,
> 19 "unexplained". The app has confirmed a complaint they already had and delivered nothing
> else. **Worse than useless, because it looks like it is working.** Nothing crashed. Every
> number was true. They uninstall in a week.

This is likely, not paranoid: Tier 0 counters sample at 1–4 Hz while stutters are 20–200 ms, so
an honest engine must frequently say "cannot resolve"; and several leading causes of modern
stutter — shader compilation, asset streaming, driver hitches — are not in the metric catalog.

The mitigation is cheap and is now a requirement: *"Unexplained. Ruled out: CPU contention (no
process above 5 %), CPU frequency (stable at 4.6 GHz), GPU throttle (no reason bits), paging
(0 hard faults), disk (0.4 ms). Consistent with an in-engine hitch, which FrameDoctor cannot
yet observe directly."*

**Ruling out is a diagnosis.** It saves the user a weekend of tweaking, and it converts a
retention-killing empty state into evidence of competence.

### Why DPC/ISR time was added

The first real-world mission is *"games that previously ran smoothly have started randomly
becoming extremely laggy, including very lightweight games."*

"Including lightweight games" rules out GPU capability and settings. Either something is
stealing time from a machine with headroom, or the machine's capability has dropped. A
misbehaving kernel-mode driver does exactly the former **without appearing as any process's CPU
usage** — which is why "nothing in Task Manager looks busy." It was absent from the metric
catalog and costs one `NtQuerySystemInformation` call.

### Why 6 simulation scenarios rather than 18

**Against:** 18 authored scenarios are 18 fixtures where someone *invents* what a failure looks
like. Tune a detector against fiction and you ship a detector that is beautiful on our fakes and
useless on reality — a self-confirming loop, and the most seductive failure available to a team
that cannot run its own product.

**For, and decisive:** the development machine cannot run the app at all. Without simulation,
*zero percent* of the UI, statistics, detection, correlation, diagnosis and storage can be
exercised before it lands on someone else's PC. The alternative is not less work — it is
writing ten thousand lines blind and debugging them all at once, remotely.

**Resolution:** the mechanism is first-class and non-negotiable; the scenario *count* starts at
6, one per shipped diagnosis plus the two honesty cases (clean session, unexplained stutter).
The rule that keeps it honest: **a scenario with no detector consuming it tests nothing.** The
18 is an output, not an input, and it regrows legitimately as diagnoses land.

**And recorded ambition:** recorded-ETL replay outranks authored fixtures the moment any Windows
machine exists. Real captures cannot be self-confirming; authored ones can.

### The headline example depends on a kernel driver

The brief's defining sentence — *"CPU frequency collapsing … while the CPU reached 96 °C"* —
needs CPU die temperature, which needs ring 0. Two agents reached this independently.

The **causal claim** is fully supported on Tier 0: effective clock collapse correlated against
frame time. What degrades is the *reason* for the collapse.

The honest v1 form: *"Frame time spiked to 142 ms while CPU effective clock fell from 3.2 to
1.1 GHz under unchanged load. Why the clock dropped: not determined — CPU temperature requires a
kernel-mode sensor driver. Confidence in the frequency collapse: high. Confidence that it is
thermal: low."*

**That is a better product than the confident 97 %-thermal version, because it is true** — and
it still tells the user to go clean their heatsink.

On the GPU side we get the full headline for free, with no driver and no elevation, from NVML's
documented throttle-reason bitmask. **Recommendation: make the flagship thermal example the GPU
one.**

## Rejected alternatives

### Ship the optimizer with EcoQoS behind an "experimental" label — *considered by product-critic*
Rejected: the full mutation/rollback/elevation/uninstall tail for one button, and an
"experimental" label is a settings-shaped way of avoiding a decision. If it is not defensible it
should not be present; if it is, it does not need a label.

### Ship Tier 2 as an optional first-run step — *considered by product-critic*
Buys the headline sentence verbatim. Rejected: a kernel-driver prompt in the install funnel for
code we do not sign and cannot support, and a diagnosis whose quality depends on whether the
user clicked yes — which is two products.

### Keep regression detection in v1 — *considered by product-critic*
Rejected in favour of the configuration change log, which answers most of the same question with
no statistics at all. The statistics need real sessions on real hardware to calibrate, and
manufactured regressions destroy trust faster than missed ones.

### Cut simulation entirely and go straight to Windows — *considered by product-critic*
Rejected — nothing would be testable in CI or on the dev machine, and invariant 9's
"greppably illegal randomness" enforcement disappears with the single named transport. Its
*insight* is adopted: ETL replay outranks authored fixtures.

## Consequences

### Positive
Every cut buys the only things that can actually kill v1: explanation rate, unattended-capture
reliability, and a first run that does not ask for a kernel driver.

### Negative / accepted costs
The user asked for an optimization engine and A/B benchmarking, and v1 ships neither. If v1
explains stutters, the optimizer is a small follow-up with earned credibility. If it does not,
the optimizer would have been a Boost button on a tool that cannot diagnose — precisely the
product FrameDoctor is defined against.

## Dissent

`product-critic` **exercised the scope veto** on the optimization engine in v1. The veto is
upheld here rather than overridden.

It also stated the floor if the veto is ever overridden, and that floor is adopted as binding:
exactly one action (EcoQoS on one named process), offered **only from inside a specific
diagnosed stutter event** and never from a standing view, auto-reverted on game or app exit,
journalled before mutation, **followed by an automatic before/after comparison that is permitted
to conclude "no measurable improvement."** That last clause is the only thing separating this
from folklore.

## What would change this decision

- v1 achieving a high explanation rate on real hardware → the optimizer becomes the obvious next
  release.
- `PM_METRIC_PSO_COMPILE_*` proving available in the shipping PresentMon binary → shader-compile
  stutter moves into v1 and materially improves the explanation-rate risk.
- Real captures showing session-to-session variability low enough for regression detection to
  have usable power → regression statistics undefer.

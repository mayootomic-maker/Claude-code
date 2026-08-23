---
description: Full pre-release gate — every agent reviews the real build, tests, and screenshots
argument-hint: <version or milestone>
---

Pre-release review for: $ARGUMENTS

**Precondition — gather real evidence first and pass it to the agents:**
1. `dotnet build -c Release` — capture full output
2. `dotnet test` — capture full output including counts
3. frontend: typecheck, lint, unit tests, build — capture output
4. run the app in simulation mode; capture logs
5. capture screenshots of every major screen at 1920×1080 and 2560×1440
6. capture FrameDoctor's own performance measurements

Then Phase A (parallel) — all eight: `systems-architect`, `windows-perf-engineer`,
`windows-internals-engineer`, `data-detection-engineer`, `product-designer`,
`anti-slop-reviewer`, `qa-adversarial`, `product-critic`. Each receives the real evidence.

Phase B: cross-review.
Phase C: `council-synthesizer` produces a release verdict: **SHIP / SHIP WITH FIXES / HOLD**,
with a numbered blocker list.

Check the definition of done in `CLAUDE.md`. Verify each item against real evidence, and
mark any item that cannot be verified in this Linux environment as
**REQUIRES-WINDOWS-VALIDATION** rather than silently passing it.

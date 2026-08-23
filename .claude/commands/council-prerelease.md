---
description: Full pre-release gate — every agent reviews the real build, tests, and screenshots
argument-hint: <version or milestone>
---

Pre-release review for: $ARGUMENTS

**Precondition — gather real evidence first and pass it to the agents:**
1. `/opt/dotnet/dotnet build -c Release` — capture full output
2. `/opt/dotnet/dotnet test` — capture full output including counts
   (the SDK is **not on `PATH`**; bare `dotnet` is `command not found`)
3. frontend: typecheck, lint, unit tests, build — capture output
4. run the app in simulation mode; capture logs
5. capture screenshots of every major screen at 1920×1080 and 2560×1440
6. capture FrameDoctor's own performance measurements
7. run `scripts/slop-scan.sh` and capture its output
8. signing status of the elevated helper, plus a clean-machine
   install → apply → uninstall → verify-restored walkthrough (`REQUIRES-WINDOWS-VALIDATION`)

Then Phase A (parallel) — all eight: `systems-architect`, `windows-perf-engineer`,
`windows-internals-engineer`, `data-detection-engineer`, `product-designer`,
`anti-slop-reviewer`, `qa-adversarial`, `product-critic`. Each receives the real evidence.

Phase B: cross-review.
Phase C: `council-synthesizer` produces a verdict from:
**READY-FOR-WINDOWS-VALIDATION / NOT READY**, with a numbered blocker list.

`SHIP` is **not available from this environment** and claiming it is a protocol violation —
no Windows behaviour has been executed here. Report the count of open
`REQUIRES-WINDOWS-VALIDATION` rows in `docs/WINDOWS-VALIDATION.md`; READY is impossible while
any of them is CRITICAL.

Check the definition of done in `CLAUDE.md`. Verify each item against real evidence, and
mark any item that cannot be verified in this Linux environment as
**REQUIRES-WINDOWS-VALIDATION**, and confirm it has a row in `docs/WINDOWS-VALIDATION.md`,
rather than silently passing it.

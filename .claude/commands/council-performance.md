---
description: Council performance review — FrameDoctor's own overhead and telemetry cost
argument-hint: <component or measurement run>
---

Performance review of: $ARGUMENTS

FrameDoctor must not become the thing causing stutters. Treat measurable gameplay impact as
a CRITICAL bug.

Phase A (parallel): `windows-perf-engineer` (lead), `systems-architect`,
`data-detection-engineer`, `qa-adversarial`. Add `product-critic` **only** if the proposed
fix introduces a feature or a user-facing setting — on a pure measurement review it has
nothing to cut.

Require **measured numbers**, not adjectives. Budgets live in
`docs/architecture/performance-budget.md`; if that file is missing, the sole deliverable of
this review is to propose it with justified numbers. **Never review against budgets you
invented in this session.** Lines to check:
- idle CPU, active-monitoring CPU (% of one core, and % of total)
- working set (MB), and growth over a long session
- disk writes per minute during a session
- telemetry end-to-end latency (sample → UI)
- UI frame cost and chart render time
- IPC message rate and bytes/second
- allocation rate / GC pressure in the collector path

Phase B: cross-review — challenge measurement methodology before challenging results.

Phase C: verdict per budget line: PASS / OVER BUDGET / NOT MEASURED. "Not measured" is a
finding, not an excuse.

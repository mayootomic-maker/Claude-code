---
description: Run the full FrameDoctor expert council (Phases A→E) on a topic
argument-hint: <topic or decision to decide>
---

Run the **full council** on: $ARGUMENTS

Follow `.claude/council/PROTOCOL.md` exactly. Do not simulate the experts in one response —
each must be a separately executed agent via the Agent tool.

**Phase A — independent analysis (parallel, single message, multiple Agent calls).**
Spawn all of: `systems-architect`, `windows-perf-engineer`, `windows-internals-engineer`,
`data-detection-engineer`, `product-designer`, `qa-adversarial`, `product-critic`.
Give each the same brief and repository pointers. Do **not** show any agent another
agent's output in this phase.

**Phase B — cross-review (parallel).** Give each relevant agent the *other* agents'
Phase A outputs verbatim and ask them to attack: false assumptions, hidden risks,
unnecessary complexity, performance problems, Windows-specific issues, UX issues,
maintenance risks, safer alternatives. Disagreement is the point — do not seek consensus.

**Phase C — decision.** Spawn `council-synthesizer` with all Phase A and Phase B output.
It writes an ADR to `docs/decisions/`.

**Phase D — implement** the decision.

**Phase E — review the real result.** Send the actual diff, test output, logs, and
screenshots back through the relevant agents. Never review imaginary code.

Write the session transcript to `docs/council/` with a dated filename.

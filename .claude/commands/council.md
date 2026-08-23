---
description: Run the full FrameDoctor expert council (Phases A→E) on a topic
argument-hint: <topic or decision to decide>
---

Run the **full council** on: $ARGUMENTS

Follow `.claude/council/PROTOCOL.md` exactly. Do not simulate the experts in one response —
each must be a separately executed agent via the Agent tool.

**Phase A — independent analysis (parallel, single message, multiple Agent calls).**
Spawn **only the agents whose remit the topic actually touches — typically three to four**,
from: `systems-architect`, `windows-perf-engineer`, `windows-internals-engineer`,
`data-detection-engineer`, `product-designer`, `anti-slop-reviewer`, `qa-adversarial`,
`product-critic`. Then list the agents you excluded, one line each.

Spawning an agent whose remit the topic does not touch is a defect, not thoroughness: it
costs an invocation and pads Phase B. `anti-slop-reviewer` joins Phase A only when the topic
produces user-visible surface or shippable code.

Give each the same brief (`.claude/council/BRIEF.md`) and real repository pointers. Do **not**
show any agent another agent's output in this phase.

**Phase B — cross-review (conditional, parallel).** Run it **only where Phase A produced a
real conflict, or an unverified assumption sitting inside another agent's remit** — name the
conflict before spawning. If Phase A converged, record "no conflicts in Phase A — Phase B
skipped" and go to C.

Give each agent the others' Phase A output verbatim. Enforce the Phase B output contract in
`PROTOCOL.md`: quoted claim + evidence, an assumption audit, and a position-change line.
"Looks good" is a protocol violation. Disagreement is the point — do not seek consensus.

**Phase C — decision.** Spawn `council-synthesizer` with all Phase A and Phase B output.
It writes an ADR to `docs/decisions/`.

**Phase D — implement** the decision.

**Phase E — review the real result.** Send the actual diff, test output, logs, and
screenshots back through the relevant agents. Never review imaginary code.

Write a transcript to `docs/council/` **only when Phase B produced conflicts that the ADR
necessarily compresses away**. The ADR is the artefact; a transcript nobody rereads is cost.

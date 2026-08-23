---
description: Council architecture review — structure, boundaries, IPC, privilege, reliability
argument-hint: <area, file, or proposal>
---

Architecture review of: $ARGUMENTS

Phase A (parallel Agent calls): `systems-architect`, `windows-internals-engineer`,
`qa-adversarial`, `product-critic`.
Brief them on the **actual current code** — give file paths; require `file:line` citations.

Phase B: cross-review between systems-architect and windows-internals-engineer at minimum.

Phase C: `council-synthesizer` — ADR only if a real decision was made; otherwise a findings
list. Do not manufacture an ADR for a review that decided nothing.

Focus: module boundaries and dependency direction; process/privilege separation; IPC
failure semantics; crash isolation and supervision; testability on Linux CI; packaging.

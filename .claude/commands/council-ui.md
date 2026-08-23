---
description: Council UI/UX review — requires real screenshots, runs designer + anti-slop
argument-hint: <screen name or screenshot path>
---

UI/UX review of: $ARGUMENTS

**Precondition: real rendered screenshots must exist.** If they do not, build and capture
them first — see `.claude/council/PROTOCOL.md` → *UI stack*. Do not run this review against
source code alone; a design verdict from code is worthless.

If the shell is pure WPF/XAML there is no Linux capture path, and this command is **BLOCKED,
not approximated**. Say so and mark the review `REQUIRES-WINDOWS-VALIDATION`.

Phase A (parallel Agent calls):
- `product-designer` — hierarchy, density, typography, colour, charts, the 2-second test
- `anti-slop-reviewer` — visual slop, copy slop, and **integrity slop** (fake data, dead
  controls, uncomputed numbers). Integrity findings are blockers.
- `product-critic` — does this screen answer a question the user actually has?

Phase B: designer and anti-slop reviewer cross-review each other's findings.

Phase C: consolidate into a prioritised fix list. Blockers first.

Phase D/E: implement fixes, re-capture screenshots, re-run this review. Loop until the
anti-slop verdict is PASS, **capped at two loops**. If a finding survives two rounds, stop
and escalate it to a decision with the disagreement recorded — the loop is not the
decision-maker, and an agent asked to keep reviewing until it says PASS will eventually
say PASS.

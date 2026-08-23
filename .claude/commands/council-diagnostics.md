---
description: Council diagnostics review — detection, statistics, correlation, confidence honesty
argument-hint: <detector, hypothesis, or scenario>
---

Diagnostics review of: $ARGUMENTS

Phase A (parallel): `data-detection-engineer` (lead), `windows-perf-engineer`,
`qa-adversarial`, `product-critic`.

Check specifically:
- Is the stutter definition adaptive and baseline-relative, not a fixed threshold?
- Are percentile and "1% low" definitions documented and matched by the implementation?
- Is there a minimum sample size, and is "insufficient data" reported below it?
- Does confidence reflect evidence quality? Is any path capable of emitting 100% wrongly?
- Is correlation presented as correlation rather than causation?
- Which simulation scenarios cover this, and do the tests assert the *expected diagnosis*?
- What are the false-positive and false-negative modes? Are they tested?
- Does every diagnosis carry inspectable evidence the user can check?

Phase B: cross-review. `qa-adversarial` must attempt to produce a wrong diagnosis with a
crafted scenario and report the actual result.

Phase C: findings and required changes.

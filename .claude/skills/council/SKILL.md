---
name: council
description: Convene a panel of independent reviewers on a decision, plan, or artefact and synthesise their verdicts. Use when the user asks to "convene the council", "get multiple perspectives", "have this reviewed from several angles", or before committing to an architecture, product loop, or design direction that is expensive to reverse. Works with no API keys — the panel is made of role-specialised subagents. For genuine cross-vendor diversity (ChatGPT/Gemini), use the `llm-council` skill instead, which requires OPENAI_API_KEY/GEMINI_API_KEY.
---

# Council

A panel of independent reviewers, convened on one question, synthesised into decisions.

## What this is and is not

**Is:** role diversity and adversarial independence. Each member sees the artefact cold,
reviews through one lens only, and does not see the others' findings. That independence is
where most of the value comes from — it is what stops a single reviewer's first framing from
anchoring everything that follows.

**Is not:** model diversity. Every member is the same underlying model wearing a different
role. Say this out loud when reporting. It does not reproduce what you get from asking a
genuinely different vendor's model, and it must never be described as if it did.

If cross-vendor perspectives are actually required, use `llm-council` (needs API keys).

## Convening

1. **State the question as a decision**, not a topic. "Does the Today screen earn its place,
   or is it a fake dashboard?" beats "review the Today screen".

2. **Pick 3–5 lenses that can genuinely disagree.** Overlapping lenses produce consensus
   theatre. Useful sets:
   - product coherence — does the core loop hold; what is missing; what is ceremony
   - adversarial correctness — attack the maths/logic; find where it lies or is gameable
   - design integrity — what will read as generated or unfinished; name specific fixes
   - first-run comprehension — what a new user understands in 60 seconds, and what misleads
   - operational reality — what breaks under real data, offline, at scale, on a bad device

3. **Run members in parallel, blind to one another.** Each gets the same artefact and one
   lens. Never show member A's output to member B.

4. **Demand decision-shaped output.** Every finding must carry a concrete change, not an
   observation. Require the format below.

5. **Synthesise, do not average.** Report where members converged (high confidence),
   where they conflicted (the real decisions), and what you are doing about each.

## Required output format from each member

```
VERDICT: <one line — does the thing work, yes/no/qualified>
TOP FINDINGS (ranked, max 5):
  1. <finding> -> <specific change to make> -> <cost: S/M/L>
  ...
STRONGEST OBJECTION: <the single thing most likely to sink this>
WHAT YOU WOULD CUT: <what is ceremony and should be deleted>
```

## Synthesis rules

- **Converged findings are cheap to trust.** If three lenses independently flag the same
  thing, act on it without further deliberation.
- **Conflicts are the point.** Where members disagree, that is a real decision the council
  cannot make for you. Decide it explicitly and record why.
- **Discard confident vagueness.** A finding without a concrete change is noise, however
  well argued.
- **Never launder a member's opinion as fact.** Attribute, then say what you decided.
- **Do not re-convene on settled questions.** The council is for decisions that are open and
  expensive to reverse, not for reassurance about ones already made.

## Reporting to the user

Lead with what changed as a result. A council that produced no change in plan either asked
the wrong question or was convened too late. Report:

1. What the panel converged on (and what you are doing).
2. Where it conflicted (and how you decided).
3. What you rejected from the panel, and why.
4. The honest caveat: same model, different roles.

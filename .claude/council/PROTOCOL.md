# FrameDoctor Council Protocol

The council exists to make FrameDoctor better. It is not a bureaucracy to be satisfied.
If a phase is not adding information, skip it and say why.

## When NOT to convene

The default is a single specialist `Agent` call, or no agent at all.

Convene the council only if **at least two** of these hold:

- the decision is expensive to reverse (on-disk format, process/privilege boundary, public contract)
- it crosses two or more remits with a genuine trade-off between them
- it touches a product invariant
- it changes state on the user's machine

Otherwise: one agent, or none. **"No council needed because `<reason>`" is a valid one-line
outcome** and needs no artefact. A council convened out of caution costs four to eight
invocations and produces a document nobody rereads.

## Invocation

| Command | Use for |
|---|---|
| `/council <topic>` | Major decisions with cross-cutting impact |
| `/council-architecture <area>` | Structure, boundaries, IPC, privilege, reliability |
| `/council-ui <screen>` | Any UI change — **requires real screenshots** |
| `/council-performance <component>` | FrameDoctor's own overhead |
| `/council-diagnostics <detector>` | Detection, statistics, confidence honesty |
| `/council-prerelease <milestone>` | Release gate |

"Run the council on X" means `/council X`.

## Members

| Agent | Remit | Veto |
|---|---|---|
| `systems-architect` | Architecture, .NET, IPC, boundaries, packaging/signing, licensing | — |
| `windows-perf-engineer` | Telemetry **acquisition** and source semantics, overhead | Monitoring overhead |
| `windows-internals-engineer` | Win32, power, UAC, rollback, **privilege-boundary threat model** | System safety |
| `data-detection-engineer` | Telemetry model, statistics, detection, **store schema/migrations** | — |
| `product-designer` | IA, interaction, hierarchy, charts, **diagnosis copy** | — |
| `anti-slop-reviewer` | **Integrity violations** (primary), mechanical pattern detection | Integrity violations |
| `qa-adversarial` | Breaks it: crashes, dropouts, corruption, failed rollback | — |
| `product-critic` | Usefulness, simplicity, anti-feature-creep | Scope |
| `council-synthesizer` | Phase C adjudication and ADR authorship | — |

Vetoes are *effective*, not absolute: the synthesizer may override one, but must record the
override and its justification in the ADR's Dissent section.

## Phases

### A — Independent analysis

Spawn **only the agents whose remit the topic actually touches** — typically three to four —
in parallel, in a single message with multiple `Agent` tool calls. Then list the agents you
excluded, one line each. Spawning an agent whose remit the topic does not touch is a defect,
not thoroughness: it costs an invocation and pads Phase B.

`anti-slop-reviewer` joins Phase A only when the topic produces user-visible surface or
shippable code.

No agent sees another's output in this phase. Output follows the shared contract in `BRIEF.md`.

### B — Cross-review (conditional)

**Run Phase B only where Phase A produced a real conflict, or an unverified assumption
sitting inside another agent's remit.** Name the conflict before spawning. If Phase A
converged, record "no conflicts in Phase A — Phase B skipped" and go to C. Skipping a phase
that would add nothing is compliance with this protocol, not a shortcut around it.

Each agent receives the others' Phase A output *verbatim*. **Do not force agreement.**

**Phase B output contract (mandatory):**

```
## Challenges
For each: the exact quoted claim, why it is wrong or risky, and the evidence
(file:line, a documentation URL, or a measured number).
Unsupported disagreement is noise.

## Assumption audit
For every [unverified] assumption in another agent's Phase A output that falls in your
remit: verify it now and report the result, or state exactly what would verify it.

## Position change
One place another agent moved you off your Phase A position, or "none".

## If you have no challenge
Enumerate what you checked and why each is fine.
"Looks good" is a null result and a protocol violation.
```

### C — Decision

`council-synthesizer` adjudicates on evidence and writes an ADR to `docs/decisions/`.
Records: selected solution, rejected alternatives *and why*, known risks, dissent, and what
evidence would justify revisiting.

### D — Implementation

**The ADR is the spec.** Any deviation from it during implementation is appended to the ADR
as an amendment with its reason — a decision silently overridden in code is worse than no
ADR. If implementation reveals the ADR was wrong, that is a Phase C revisit, not a quiet edit.

### E — Review of the real result

**Never review imaginary code.** If evidence does not exist yet, produce it before running
Phase E.

Route evidence to the agent that can actually read it:

| Evidence | Goes to |
|---|---|
| Diff, test output | the remit owner + `qa-adversarial` |
| Profiling numbers | `windows-perf-engineer` |
| Screenshots | `product-designer` + `anti-slop-reviewer` |
| Applied-and-rolled-back system state | `windows-internals-engineer` |

An agent handed evidence it cannot interpret will produce a rubber stamp.

## Rules

1. **Real agents, not roleplay.** One response impersonating eight experts is a protocol
   violation. Use the `Agent` tool.
2. **Evidence over assertion.** Cite `file:line` you actually opened, a documentation URL, or
   a measured number. Untagged assumptions are treated as `[unverified]`.
3. **No imaginary review.** Phase E requires artefacts that exist.
4. **Disagreement survives.** The ADR records dissent; it does not launder it.
5. **Proportionality.** See *When NOT to convene* above.
6. **Windows honesty.** Anything unverifiable here is marked `REQUIRES-WINDOWS-VALIDATION`
   **and appended as a row to `docs/WINDOWS-VALIDATION.md`**: what is unverified | the exact
   Windows test that resolves it | the file or decision it protects | severity.

## UI stack — decide before the first `/council-ui`

FrameDoctor's UI stack is recorded in `docs/decisions/`. It is load-bearing for review,
because it determines whether design review has any evidence source on Linux at all.

**If a web frontend (WebView2 + React):** screens capture headlessly, and `/council-ui` runs
normally:

```bash
export PATH="$PATH:/opt/dotnet"
cd src/frontend && pnpm build && pnpm exec playwright test --config=playwright.shots.ts
```

Output lands in `artifacts/screenshots/`. If `src/frontend/playwright.shots.ts` does not
exist, building the capture harness is the prerequisite deliverable — do not proceed with a
code-only critique.

**If pure WPF/XAML:** there is **no Linux screenshot path**. `/council-ui` is BLOCKED, not
approximated. Design review is limited to a XAML + design-token reading, every visual verdict
is marked `REQUIRES-WINDOWS-VALIDATION`, and capture becomes a Windows-side deliverable.
Never substitute a source reading for a screenshot and call it a design verdict.

## Environment reality

- Linux container. No Windows, no GPU, no PresentMon, no real sensors.
- **.NET 8 SDK at `/opt/dotnet`, not on `PATH`.** Use `/opt/dotnet/dotnet`.
- `net8.0-windows` + WPF compiles here with `EnableWindowsTargeting=true`; it cannot run.
- Verification vehicle: compilation + headless tests + simulation mode + frontend screenshots.
  Windows-only behaviour is isolated behind interfaces so the portable core is fully testable.

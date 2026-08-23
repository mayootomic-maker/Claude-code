# FrameDoctor Council Protocol

The council exists to make FrameDoctor better. It is not a bureaucracy to be satisfied.
If a phase is not adding information, skip it and say why.

## Invocation

| Command | Use for |
|---|---|
| `/council <topic>` | Major decisions with cross-cutting impact |
| `/council-architecture <area>` | Structure, boundaries, IPC, privilege, reliability |
| `/council-ui <screen>` | Any UI change — **requires real screenshots** |
| `/council-performance <component>` | FrameDoctor's own overhead |
| `/council-diagnostics <detector>` | Detection, statistics, confidence honesty |
| `/council-prerelease <milestone>` | Release gate — requires real build/test/screenshot evidence |

"Run the council on X" means `/council X`.

## Members

| Agent | Remit | Veto |
|---|---|---|
| `systems-architect` | Architecture, .NET, IPC, process/privilege boundaries, reliability | — |
| `windows-perf-engineer` | PresentMon, ETW, counters, GPU/CPU telemetry, overhead | Monitoring overhead |
| `windows-internals-engineer` | Win32, power, UAC, services, rollback, unsafe-tweak rejection | System safety |
| `data-detection-engineer` | Telemetry model, statistics, detection, correlation, confidence | — |
| `product-designer` | IA, interaction, hierarchy, charts, diagnostic workflows | — |
| `anti-slop-reviewer` | Rejects generic UI, marketing copy, and **fake implementations** | Integrity violations |
| `qa-adversarial` | Breaks it: crashes, dropouts, corruption, failed rollback | — |
| `product-critic` | Usefulness, simplicity, anti-feature-creep | Scope |
| `council-synthesizer` | Phase C adjudication and ADR authorship | — |

Vetoes are *effective*, not absolute: the synthesizer may override one, but must record the
override and its justification in the ADR's Dissent section.

## Phases

**A — Independent analysis.** All relevant agents run in parallel, in a single message with
multiple `Agent` tool calls. No agent sees another's output. Each returns: Recommendation,
Rationale, Assumptions (tagged `[verified]`/`[unverified]`/`[needs-research]`), Risks,
Alternatives, Unresolved questions.

**B — Cross-review.** Each agent receives the others' Phase A output *verbatim* and attacks
it. Target: false assumptions, hidden risks, unnecessary complexity, performance problems,
Windows-specific issues, UX issues, maintenance risks, safer alternatives.
**Do not force agreement.** Recorded disagreement is a deliverable.

**C — Decision.** `council-synthesizer` adjudicates on evidence and writes an ADR to
`docs/decisions/`. Records: selected solution, rejected alternatives *and why*, known risks,
dissent, and what evidence would justify revisiting.

**D — Implementation.**

**E — Review of the real result.** Feed back the actual diff, test output, logs, profiling
data, screenshots, and benchmarks. **Never review imaginary code.** If evidence does not
exist yet, produce it before running Phase E.

## Rules

1. **Real agents, not roleplay.** One response impersonating eight experts is a protocol
   violation. Use the `Agent` tool.
2. **Evidence over assertion.** Cite `file:line`, primary documentation, or measured numbers.
   Untagged assumptions are treated as unverified.
3. **No imaginary review.** Phase E requires artefacts that exist.
4. **Disagreement survives.** The ADR records dissent; it does not launder it.
5. **Proportionality.** A one-line change does not need eight agents. Use a focused command,
   or no council at all.
6. **Windows honesty.** This repo builds on Linux. Anything that cannot be verified here is
   marked `REQUIRES-WINDOWS-VALIDATION` — never silently passed.

## Screenshot capture

`/council-ui` requires real screenshots. The frontend runs standalone against the simulation
transport, so screens can be captured headlessly on Linux:

```bash
cd src/frontend && pnpm build && pnpm exec playwright test --config=playwright.shots.ts
```

Output lands in `artifacts/screenshots/`. Chromium is preinstalled at
`/opt/pw-browsers/chromium`; never run `playwright install`.

## Environment reality

- Linux container. No Windows, no GPU, no PresentMon, no real sensors.
- `net8.0-windows` + WPF **compiles** here with `EnableWindowsTargeting=true`; it cannot run.
- Verification vehicle is: compilation + headless tests + simulation mode + frontend
  screenshots. Windows-only behaviour is isolated behind interfaces so the portable core is
  fully testable here.

# 0003. Privilege model, rollback, and game detection

- Status: Accepted
- Date: 2026-08-23
- Council: windows-internals-engineer (lead, holds the system-safety veto), systems-architect, product-critic

## Context

Every "PC optimizer" ever shipped has had a local-privilege-escalation hole in the path between
its unprivileged UI and its privileged helper. FrameDoctor changes system state and must be
able to undo it after a crash, a reboot, or an uninstall.

## Decision

### No elevated FrameDoctor component in v1

No service, no helper, no scheduled task, no COM elevation moniker.

Elevation appears exactly twice, both third-party, both consented, both optional: the
PresentMon service MSI (if the v2 route is taken) and PawnIO (Tier 2, user-initiated).

### Exactly two system mutations in v1

1. **EcoQoS restraint of a user-confirmed background offender** —
   `SetProcessInformation(ProcessPowerThrottling)` with
   `ControlMask = StateMask = EXECUTION_SPEED`; reset is the documented
   `ControlMask = StateMask = 0`. Needs only `PROCESS_SET_INFORMATION` on a same-user target.
2. **Display/system power request during a gamepad-only session** — `PowerCreateRequest` /
   `PowerSetRequest`, refcounted, released on process exit. **Labelled a UX fix, never a
   performance claim.**

### The EcoQoS deny-list is the feature

Never applied to: anything not same-user; anything under `%SystemRoot%`; `svchost.exe`;
`audiodg.exe`; the game or its launcher; any foreground process; our own process tree; any
anti-cheat or DRM service; **and any active capture or encode process.**

That last entry matters most. A video encoder is exactly what a naive tool sees as "a
background CPU offender," and throttling it mid-recording drops the user's stream. We already
have the signal — `engtype_VideoEncode` on that pid. Restraining the process that is recording
your gameplay is a harm we would be *causing*, and it is the single most likely way this
feature hurts someone.

### Rollback: compare-and-restore, never blind-restore

| Current value | Action |
|---|---|
| equals what we applied | restore the captured previous value, verify, delete the entry |
| equals what we captured | already restored, or we are re-running. Delete the entry. **Idempotent.** |
| **neither** | **a third party changed it after us. Do not restore.** Record and surface it; offer a restore the *user* triggers |

That third row is the point. Writing our captured value over a *later* user choice is a
mutation, not a rollback. **A rollback system that always restores is a system that overwrites
its user.**

Apply protocol: read the current value through a documented API and **abort if the read fails
or is ambiguous**; read twice and require equality; write the journal entry atomically
(temp file → `FlushFileBuffers` → `MoveFileEx` with `REPLACE_EXISTING | WRITE_THROUGH`);
*then* apply; then verify by reading back, reverting immediately if the read-back disagrees.

Journal-before-apply ordering buys the invariant that makes power loss survivable: **there is
no reachable state in which the mutation is applied and its journal entry is absent.**

The journal is one plain file per entry in `%LOCALAPPDATA%`, **never inside the session
database** — the rollback doctrine requires restoration to survive database corruption, which
is unsatisfiable if the rollback state lives in the database.

Reconciliation runs as `FrameDoctor.Engine.exe --reconcile-and-exit`: no UI, no collectors, no
database. Invoked at every Engine start, by the logon Run entry, by the uninstaller, and by the
user. One verb, one code path, no second always-on process.

### Game detection: hard exclusions first, then a required conjunction

**Gate A — unoverridable exclusions**, evaluated before any positive evidence: image under
`%SystemRoot%`; our own process; and a launcher deny-list matched on **filename AND signer
subject**, so a renamed binary cannot ride the list and a game shipping a similarly-named
binary is not silently excluded.

**Gate B — confirmation requires all three**, not a weighted score:
foreground dwell ≥ 2 s · sustained `engtype_3D` utilization attributable to the pid ·
**a sustained present rate for that pid from our own frame collector.**

Confirmation is **sticky to the process, not to the foreground.** Alt-tabbing does not end the
session; it enters a `Background` sub-state where samples are tagged `gameForeground=false` and
bucketed separately. A minimised process legitimately drops to Low QoS and its frame rate
legitimately collapses — scoring that as a regression is exactly the confident nonsense the
telemetry model exists to prevent.

### Clocks

QPC for all intervals and ordering. An anchor pair `(qpcTicks, GetSystemTimePreciseAsFileTime)`
for wall-clock display, re-anchored on resume and on `WM_TIMECHANGE`. Suspend is detected from
the **difference between biased and unbiased interrupt time**, because the documented resume
notification is not guaranteed to arrive.

A refinement beyond the research: the same two clocks catch *us*. A large monotonic delta with
near-zero sleep delta means **we were starved** — GC, scheduler, or a thrashing machine — not
that the machine slept. That is invariant 8's tripwire, and those samples are marked `Degraded`
rather than silently trusted.

## Rejected alternatives

### `PowerSetActiveOverlayScheme` (Windows 11 power mode) — *advocated as a gated candidate by the research; REJECTED by windows-internals-engineer*
The strongest rejection in this ADR, and not on general distaste for undocumented APIs:

- **It fails rollback doctrine point 1** — capture the original value *and prove you read it
  correctly*. The documented read returns the **effective** power mode, which is a different
  object from the **actual** overlay: effective is transiently overridden by Battery Saver and
  Game Mode. Restoring an effective value would write a setting the user never chose. The API
  that reads the actual overlay is itself undocumented. **You cannot build a rollback on a
  capture you cannot prove.**
- Microsoft's own documentation gives contradictory GUIDs on the same page, one of them a power
  *scheme* GUID where an overlay GUID belongs. Writing an uncertain GUID through an undocumented
  setter is not an operation with a defined outcome.
- Measured benefit: zero. No primary measured evidence that changing power settings improves
  desktop frame rate.
- It is the only v1 candidate whose blast radius **survives a reboot**, and it alone would force
  the heavyweight half of the journal machinery to exist.

**Ruling: an undocumented API is acceptable for reads and never for a write to persistent user
system state.** What ships instead costs nothing: read the effective mode, and when the machine
is on a power-saving mode, say so with a deep link to the Windows setting. Zero mutation.

### Raising the game's process priority — *the example from the original brief; REJECTED*
The evidence is **absent, not weak** — every source is a forum post or SEO blog with no
methodology. `windows-internals-engineer` went further than the research and rejected it *even
as a labelled experiment*: an experiment that mutates a user's system to test a hypothesis with
no prior is a mutation without a diagnosis — invariant 1 reversed, in the one place the product
exists not to reverse it.

There is also a mechanism-level harm: `SetPriorityClass` raises the base priority of *every*
thread, so on a contended machine the classic symptom is *worse* pacing, as the render thread
starves the thread it is waiting on.

### Job-object CPU rate control — *considered as a second-line candidate; deferred*
Assigning a running third-party process to our job requires `PROCESS_TERMINATE`. Acquiring the
right to kill a user's process in order to *restrain* it is a right we should not hold when
EcoQoS does the same job with a documented reset and no dangerous access right.

### Windows service or scheduled-task-with-highest-privileges for elevation — *REJECTED*
A scheduled task registered with highest privileges is the standard trick for "elevate without
a prompt" and is precisely the LPE primitive: a privileged action triggerable by an
unprivileged principal, with no consent moment. Rejected on sight, including as a startup
mechanism.

### Timer resolution, RAM cleaning, service disabling, HAGS, MMCSS registry, power-plan switching, processor-state writes — *all REJECTED*
See `docs/research/windows-internals.md`. Two rejections deserve their stronger reasons on the
record: `PROCTHROTTLEMIN=100` on a laptop *reduces* sustained clocks once the thermal budget
binds, so the tweak would degrade the exact metric we measure — an invariant 8 violation, not
merely a weak optimization. And switching the active power plan away from a Balanced-derived one
**removes the Windows 11 power slider from the user's Settings app** — our "optimization" would
delete a control from the user's UI.

## Consequences

### Positive
FrameDoctor's "no admin" story is **not a constraint we squeezed a feature set into — it is a
consequence of refusing the folklore.** Every admin-requiring item was rejected on evidence
grounds independently. Any future proposal to add an elevated helper must first answer: *which
rejected tweak are you trying to un-reject?*

### Negative / accepted costs
- The window of exposure for a stale EcoQoS change is "until the next launch", bounded by the
  logon Run entry. If the user disables launch-at-startup, rollback promptness degrades and the
  UI must say so at the moment of that choice.
- Uninstall can legitimately complete with an unrestored entry (the "user changed it themselves"
  case), which sits against doctrine point 6. Resolved as *report, do not force, leave the
  evidence.*

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `SetProcessInformation` on another same-user process turns out to need elevation | `REQUIRES-WINDOWS-VALIDATION`, CRITICAL. **If it needs elevation, the feature does not ship** — we do not silently add a UAC prompt to keep it. |
| Steam Big Picture Mode is fullscreen, `steam.exe`, with sustained GPU work — it passes every positive signal | A signed launcher stays denied even in Big Picture. When a game launches from it, the game is a *different process* with its own foreground window, and that is what we detect. |
| A future helper gets built without the threat-model contract | The contract is normative in this ADR: closed verb enum, ordinal parameters the helper resolves itself, `ImpersonateNamedPipeClient` for everything except the one privileged call, `SetDefaultDllDirectories`, and the honest admission that none of it is a security boundary against a same-user attacker — so **design the verbs so the worst case is acceptable.** |

## Dissent

`windows-internals-engineer` recorded one place where two of its own rules pull against each
other and asked for it to be challenged: the "user changed it themselves" branch means uninstall
can complete without full restoration, against doctrine point 6. It resolved this as *report, do
not force*, and the resolution is accepted here because the alternative — overwriting a later
user choice during uninstall — is worse.

## What would change this decision

- `SetProcessInformation` requiring elevation against a same-user target → v1 ships one mutation
  instead of two, and we drop the feature rather than adding elevation.
- Microsoft documenting `PowerSetActiveOverlayScheme` → the power-mode optimization reopens.
- Any measured, methodologically sound evidence that raising game priority helps → the priority
  rejection reopens. None currently exists anywhere.

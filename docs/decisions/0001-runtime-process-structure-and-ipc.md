# 0001. Runtime, process structure, and IPC

- Status: Accepted
- Date: 2026-08-23
- Council: systems-architect (lead), windows-perf-engineer, windows-internals-engineer, product-critic

## Context

FrameDoctor must monitor a game without becoming the cause of a stutter, survive its own UI
crashing, restore system state after a hard kill, and be verifiable from a Linux build host
that cannot execute any of it.

The proposed stack was C# / modern .NET / WPF shell / WebView2 / React / TypeScript / SQLite.
The council was asked to challenge rather than accept it.

## Decision

**.NET 10 LTS**, targeting `net10.0` for the portable core and `net10.0-windows` for the
platform layer, pinned by `global.json`.

**Two processes:**

| Process | Lifetime | Owns |
|---|---|---|
| `FrameDoctor.Engine` | resident from logon; owns the tray icon and the rollback journal | collectors → normalization → statistics → detection → correlation → diagnosis → storage |
| `FrameDoctor.Shell` | only while a window is open | WPF host, WebView2, React. Presentation only. |

Plus the PresentMon child process while a capture is live.

**Deployment:** self-contained, ReadyToRun, single-file, trimmed `win-x64`. Not
framework-dependent, not NativeAOT.

**IPC: two named pipes**, scoped by SDDL to the Shell's logon SID with
`PIPE_REJECT_REMOTE_CLIENTS` and `FILE_FLAG_FIRST_PIPE_INSTANCE`:

- `…​.dat` — unidirectional Engine→Shell, binary, fixed-layout structs over
  `MemoryMarshal`, written by a **dedicated blocking thread**
- `…​.ctl` — duplex request/response, source-generated `System.Text.Json`, ~1 msg/min

Frame events are aggregated in the Engine before IPC. Raw frames never cross the boundary in
steady state; the Shell receives 100 ms buckets and pulls a full-resolution window on demand.

## Rationale

The runtime choice is arithmetic, not preference: **.NET 8 reaches end of life on
2026-11-10**, 79 days from this decision, for a product with no code yet.

The process count is set by the memory budget. The ~190 MB delta between UI-hidden and
UI-visible *is* the WebView2 process tree, and only a separate process can release it. It also
buys crash isolation in the direction that matters: losing 40 minutes of recorded session
because a browser renderer crashed is this product's worst failure.

The IPC design is measured, not reasoned. On identical framing over 20 000 messages:

| Variant | Throughput | Steady-state allocation |
|---|---|---|
| `await stream.WriteAsync` | 101 089 msg/s | **24.5 B/msg** |
| blocking `Write(ReadOnlySpan<byte>)` on a dedicated thread | 115 069 msg/s | **0.0 B/msg** |

Against a ≤120 msg/s budget, named pipes clear the requirement by roughly 1000×, so shared
memory buys nothing and costs mapping-lifetime bugs. The `await`-versus-blocking choice is
normally a style argument; here it is the difference between meeting and missing the
zero-allocation rule.

## Rejected alternatives

### Single process — *considered by systems-architect*
Saves IPC, lifecycle and one installer target. Rejected: the UI-hidden memory budget becomes
unreachable because the web view cannot be released, and a native collector fault (ETW
interop, vendor DLLs, optionally a kernel-driver ioctl) would kill the UI mid-session.

### Persistent Windows service — *considered by systems-architect and windows-internals-engineer*
Would survive logoff and own ETW centrally. Rejected on three converging grounds: nothing
FrameDoctor ships needs admin, so it buys privilege we have no use for; a permanently-running
privileged endpoint is a permanent local-privilege-escalation target; and Intel — with far
more Windows leverage than we have — shipped exactly this model and **withdrew PresentMon
v2.5.0's binaries** over a compatibility conflict with a downstream customer.

### On-demand elevated helper in v1 — *considered by windows-internals-engineer*
Rejected as having no work to do. It is defined as an interface with zero implementations and
no UI surface — absent, not disabled, per invariant 9.

### Four processes (UI + collector + engine + helper) — *considered by systems-architect*
Rejected: two more IPC hops inside the ≤100 ms detection-latency budget, for isolation between
components that share a data structure and a failure domain.

### NativeAOT for the Engine — *considered by systems-architect*
Would cut startup and working set. Rejected on a hard blocker: cross-OS native compilation is
unsupported, so the shipping binary would become unbuildable on this Linux host — converting a
verifiable artifact into a Windows-only one. ReadyToRun recovers most of the startup win.

### gRPC / MessagePack / shared memory on the wire — *considered by systems-architect*
gRPC brings HTTP/2 framing and a listening endpoint for 10 msg/s of one message shape.
MessagePack 3.1.4 carries three high-severity advisories, and the hand-rolled layout already
measured zero-allocation. Shared memory is unjustified at 1000× headroom.

### MSIX packaging — *considered by systems-architect*
Rejected on invariant 4. MSIX's only uninstall-time code hook requires a restricted capability
gated on Microsoft approval, and MSIX uninstall deletes redirected AppData and registry writes.
A user uninstalling with a change applied would be left permanently modified, with no code run
to revert it. **The packaging format itself would violate the rollback invariant.**
Decision: per-user **WiX 5.0.2** MSI (MS-RL; WiX 6/7 carry an Open Source Maintenance Fee
EULA that WiX 7 enforces at build time), with a deferred custom action running
`FrameDoctor.Engine.exe --revert-all` before file removal.

## Consequences

### Positive
- The portable core — pipeline, diagnostics, storage, IPC transport and codec, simulation — is
  fully testable on Linux. Only `Platform.Windows` and the shell's rendering are not.
- Invariant 2 ("the UI holds no system-level business logic") is **mechanical**: `Shell` has no
  project reference to `Platform.Windows`, and banned-API analyzers reject `DllImport` there,
  so a violation fails the build rather than failing review.
- Detection keeps running with no UI, which the UI-hidden budget requires anyway.

### Negative / accepted costs
- Two processes means orphaned-Engine and respawn-loop failure modes to design against.
- The installer must be produced on a Windows agent: no WiX version can emit an MSI on Linux
  (`msi.dll` missing), so the pipeline is Linux-builds-and-tests, Windows-packages-and-signs.
- Trimming may break LibreHardwareMonitor's WMI reflection paths. If it does, ship untrimmed —
  a size penalty is acceptable, silent sensor loss is not.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A `net10.0-windows` test project **runs on Linux and passes**, and `Registry.CurrentUser` returns null there rather than throwing — so Windows-only code can fail arbitrarily or return plausible nulls | Linux CI enumerates test projects explicitly and excludes `*.Platform.Windows.Tests` by name. The portable core is exercised only through `Simulation` and interface fakes. |
| Linux IPC numbers do not hold on Windows (a different kernel object) | `REQUIRES-WINDOWS-VALIDATION`. The whole "no shared memory needed" argument rests on a Linux measurement. |
| Orphaned PresentMon child leaves a stale ETW session that breaks the next launch | Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, plus `--stop_existing_session` and `--terminate_on_proc_exit`. |

## Dissent

None recorded on the process structure or runtime; Phase A converged, so Phase B was not run
on this question.

`windows-internals-engineer` noted a boundary it declined to cross: the *mechanism* for an
elevated helper, should one ever be needed, is its call and not the architect's. The architect
asserted only that no such component ships in v1, which internals independently agreed with.

## What would change this decision

- Named-pipe throughput or allocation measuring materially worse on Windows than on Linux.
- An MSI deferred custom action proving unable to complete `--revert-all` before file removal —
  which would reopen the packaging choice, since invariant 4 would need another mechanism.
- A feature genuinely requiring admin, which would reopen the elevated-helper question (and
  must first answer: *which rejected tweak are you trying to un-reject?*).


---

## Amendment, 2026-08-23: single-file, for two executables, is two runtimes

Recorded after building the publish path. The decision above says "self-contained, ReadyToRun,
single-file, trimmed win-x64", which is correct for one executable and wrong for two.

Publishing `framedoctor-engine` and `framedoctor` as separate self-contained single-file bundles
produces two complete copies of the .NET runtime: 188 MB installed. Publishing both into one
directory, sharing one copy, is 150 MB — about a third of the installed size, for no behavioural
difference.

Neither executable is single-file in the shipped layout, and the shell has an independent reason
to avoid it: WebView2's loader resolves its native component relative to the executable, and a
self-extracting bundle relocates that to a temporary directory on first run. That turns a missing
WebView2 runtime — the most likely first-run failure on a real machine — into a confusing error
instead of the explicit message the window is written to show.

**Trimming is also not applied.** WPF does not support it, and applying it to the engine alone
would fork the two halves' runtime configuration for a saving smaller than the shared-runtime one
just made. `PublishReadyToRun` is unchanged and does apply to both.

**Unchanged:** the two-process split, both processes being self-contained, the runtime version,
and the IPC design. `packaging/publish.sh` is the operative form of this amendment.

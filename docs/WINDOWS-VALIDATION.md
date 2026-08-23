# Windows validation register

Everything that compiles and unit-tests on Linux but has **never executed against real
Windows**. Nothing on this list may be described as "working".

This file exists because a marker that nothing collects gets ignored within a few sessions.
`REQUIRES-WINDOWS-VALIDATION` in a council transcript is not a record — a row here is.

`/council-prerelease` counts open CRITICAL rows. **READY-FOR-WINDOWS-VALIDATION is impossible
while any CRITICAL row is open**, and `SHIP` is not a verdict this environment can produce at
all.

## How to add a row

| Column | Meaning |
|---|---|
| **What is unverified** | The specific behaviour, not the component |
| **Windows test that resolves it** | Concrete enough that someone else could run it |
| **Protects** | The file or ADR that depends on this being true |
| **Severity** | CRITICAL / HIGH / MEDIUM / LOW |

Severity is about consequence-if-wrong, not effort-to-test:

- **CRITICAL** — could leave the user's system in a modified state, lose their data, or
  produce a confidently wrong diagnosis
- **HIGH** — a core feature silently does not work
- **MEDIUM** — degraded behaviour with a visible symptom
- **LOW** — cosmetic or convenience

## Open

| What is unverified | Windows test that resolves it | Protects | Severity |
|---|---|---|---|
| An **unelevated** PresentMon SDK client can actually consume the service. The service's control pipe is ACL'd to Authenticated Users in source, but this has never been exercised end to end. | Install the PresentMon service as admin; from a standard-user session, `pmOpenSession` + `pmRegisterFrameQuery` + `pmConsumeFrames` against a running game. | The entire no-elevation deployment story. If false, every user must join Performance Log Users and sign out. | CRITICAL |
| `PowerSetActiveOverlayScheme` succeeds for a standard (non-admin) user. It is an **undocumented** powrprof export. | Call it as a standard user to set Best Performance; read back with `PowerGetEffectiveOverlayScheme`; confirm the change and the restore. | The power-mode optimization. If it needs admin, that optimization is gated behind elevation or dropped. | HIGH |
| `\Processor Information(*)\Processor Frequency` reports **live** frequency rather than nominal, on Intel HWP (12th gen+) and AMD PBO. | Read the counter under sustained load and at idle on both vendors; compare against a known-good tool. | CPU clock-collapse diagnosis. If nominal, `% Processor Performance` derivation is the only path. | HIGH |
| `% Processor Performance` is meaningful per-logical-processor on **hybrid P/E-core** CPUs, and what "nominal" means for E-core instances. | Read per-instance on a 12th-gen-or-later Intel part under mixed load. | Effective-clock derivation and single-thread bottleneck detection on every modern Intel CPU. | HIGH |
| Real PDH cost at our sampling rates. `\GPU Engine(*)` can enumerate hundreds of instances during a game. | Measure `PdhCollectQueryData` wall time and CPU at 1 Hz and 10 Hz for: 32 `Processor Information` instances; `\Process(*)` on a ~300-process box; `\GPU Engine(*)` with a game running. | The whole active-monitoring CPU budget (≤1.0% total). | CRITICAL |
| `PdhAddEnglishCounter` + `PdhExpandWildCardPath` works for `GPU Engine(*)` on **non-English** Windows. | Run the counter enumeration on German or Japanese Windows. | Per-process GPU attribution for every non-English user. | HIGH |
| ETW manifest-provider contention. Only 8 sessions may enable a manifest provider; DXGI/DxgKrnl/DWM are all manifest-based. | Run FrameDoctor alongside RTSS, MSI Afterburner, GeForce Experience, Xbox Game Bar and CapFrameX simultaneously; observe the failure mode and whether it is detectable. | Graceful degradation when we lose the race. Silent failure here looks like "no stutters detected". | CRITICAL |
| Anti-cheat reaction to ETW-based frame collection. | Run against EAC, BattlEye and Vanguard titles; observe whether collection fails, and whether the process is flagged. | Whether FrameDoctor works at all on competitive titles, and whether it can get a user banned. | CRITICAL |
| PawnIO device access after install: elevation needed only to install, or also to open and ioctl. | As a standard user with PawnIO already installed, open the device and read a CPU temperature via LibreHardwareMonitorLib. | Whether Tier 2 telemetry needs a per-launch elevation prompt. | MEDIUM |
| ADLX read-only `IADLXGPUMetrics` works without elevation. | Query GPU metrics as a standard user on an AMD GPU. | AMD GPU telemetry parity with NVIDIA. | MEDIUM |
| `\Thermal Zone Information(*)\Throttle Reasons` is populated on real desktop hardware. | Read the counter on desktop Intel and AMD systems under thermal load. | CPU thermal-throttle diagnosis without a kernel driver. | HIGH |
| WPF shell actually launches and renders. It compiles here but has never executed. | Launch the built shell on Windows 10 and Windows 11. | Every visual verdict made from a web-frontend screenshot rather than the real shell. | HIGH |

## Resolved

| What was unverified | How it was resolved | Date |
|---|---|---|
| WPF compiles from a Linux host | Built a scratch `net8.0-windows` WPF project with `EnableWindowsTargeting=true`; `dotnet build -c Release` succeeded, 0 warnings | 2026-08-23 |

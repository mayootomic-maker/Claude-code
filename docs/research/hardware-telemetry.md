# Windows Hardware Telemetry for FrameDoctor — Research Findings

Researched August 2026. Sources are linked inline. Claims that could not be confirmed against a
primary source are marked `[UNVERIFIED]`. Nothing here has been validated on real hardware — see
"Open questions requiring a Windows machine" at the end.

---

## 1. LibreHardwareMonitor (LHM)

### 1.1 Version, license, packaging

| Item | Value | Source |
|---|---|---|
| NuGet package id | `LibreHardwareMonitorLib` | [nuget.org](https://www.nuget.org/packages/LibreHardwareMonitorLib) |
| Latest stable | **0.9.6**, published 2026-02-14 | NuGet registration API (verified by direct query) |
| Latest prerelease | `0.9.7-pre726`, 2026-08-19 (CI publishes near-daily) | NuGet flat-container index |
| License | **MPL-2.0** (`<license type="expression">MPL-2.0</license>` in the 0.9.6 nuspec) | [repo](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) |
| TFMs in 0.9.6 package | `net472`, `netstandard2.0`, **`net8.0`**, `net9.0`, `net10.0` | verified from the 0.9.6 `.nupkg` |
| RIDs in 0.9.6 package | `win-x64`, `win-x86`, `win-arm64`, `linux-x64`, `linux-arm64` | verified from the 0.9.6 `.nupkg` |
| Transitive deps | `DiskInfoToolkit`, `HidSharp`, `RAMSPDToolkit-NDD`, `System.Management`, `System.IO.Ports`, `System.Threading.AccessControl` | 0.9.6 nuspec |

**.NET 8: fully supported.** A real `net8.0` asset ships in the 0.9.6 package. Note the master
`csproj` also enables `IsAotCompatible`/`IsTrimmable` but suppresses IL2026/IL3050 for the
`System.Management` (WMI) paths — so **AOT/trimming is nominally supported but WMI-backed code
paths are trim-unsafe**. Do not publish FrameDoctor as trimmed/AOT without testing LHM sensors.

### 1.2 MPL 2.0 — what it means for a closed-source app

MPL 2.0 is **file-level copyleft**, not project-level:

- Linking `LibreHardwareMonitorLib.dll` from a closed-source app is **allowed** — §3.3 permits
  distributing a "Larger Work" under terms of your choosing so long as MPL-covered files stay MPL.
- Obligations: keep license notices and make the covered files' source available (§3.2). Shipping
  the unmodified upstream NuGet binary + license text + repo link satisfies this.
- If we **modify** LHM sources, those files must be published under MPL 2.0. Ours are unaffected.
  Not GPL-viral into our proprietary code.
- `[UNVERIFIED]` Good-faith reading, not legal advice; get counsel sign-off.

### 1.3 The driver question — this is the critical one

**Historically:** LHM used **WinRing0** (`WinRing0x64.sys` v1.2.0.5, dated 2008) to read MSRs,
I/O ports, PCI config and SMBus. It is a **known-vulnerable driver**:

- **CVE-2020-14979** — exposes arbitrary physical-memory read/write to any local low-privilege
  caller ⇒ trivial LPE to SYSTEM, and a classic **BYOVD** payload.
- **Microsoft Defender blocks it** as `VulnerableDriver:WinNT/Winring0`. Microsoft's support
  article names the CVE, lists affected apps (MSI Afterburner, HWiNFO, EVGA Precision X1, LHM,
  FanControl, OpenRGB…), and offers only an exclusion workaround carrying the warning *"This
  workaround may make a computer or a network more vulnerable to attack."*
  ([Microsoft Support](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/microsoft-defender-antivirus-alert-vulnerabledriver-winnt-winring0))
- It **cannot be re-signed** — the signing cert expired and the driver was never updated, so the
  flaw cannot be patched in place. ([GamersNexus/Level1Techs](https://gamersnexus.net/features/insecure-code-vs-entire-rgb-industry-winring-0-driver-ft-wendell-level1-techs))

**Current state (important, and different from most 2024-era write-ups):**
LHM has **migrated off WinRing0 to [PawnIO](https://pawnio.eu/)**.

- I verified the 0.9.6 NuGet package contains **no `.sys` file and no WinRing0 binary at all**.
- Master embeds PawnIO modules as resources: `AMDFamily0F/10/17.bin`, `IntelMSR.bin`,
  `RyzenSMU.bin`, `Nvidia.bin`, `LpcIO.bin`, `LpcACPIEC.bin`, `IsaBridgeEC.bin`, `Smbus*.bin`
  ([csproj](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/LibreHardwareMonitorLib.csproj)).
  Release notes: v0.9.5 (Jan 2026) *"option to disable Ring0 driver installation"*; v0.9.6
  (Feb 2026) *"Update PawnIO modules to 2.2"*.
- PawnIO is a **separately installed, digitally signed** kernel driver embedding a sandboxed
  64-bit Pawn VM. Callers cannot request raw physical memory; they load an **RSA-signed module**
  exposing a narrow purpose-built ioctl surface — materially better than WinRing0. It is
  **GPLv2 with an IOCTL-interface linking exception**, so closed-source callers are explicitly
  permitted. ([namazso/PawnIO](https://github.com/namazso/PawnIO), [pawnio.eu](https://pawnio.eu/))

**Consequences for us:**

- **LHM does not bundle or auto-install the driver in the library.** `LibreHardwareMonitorLib` is
  a pure managed package; the driver is a separate user-visible install (MSI/winget/choco).
- **Without PawnIO, LHM gives you almost nothing on CPU/motherboard.** A maintainer:
  *"PawnIO provides the low level hardware layer. If you don't install it, LibreHardwareMonitor
  could not read or write any value (including CPU values)."*
  ([discussion #2149](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/discussions/2149))
- Installing the driver requires **admin**. `[UNVERIFIED]` whether opening the device / issuing
  ioctls afterwards also requires elevation, and `[UNVERIFIED]` whether PawnIO is EV- or
  attestation-signed. Its design should keep it off Microsoft's blocklist, but monitor that.

### 1.4 What LHM actually exposes

Sensor model: `SensorType` = `Voltage, Current, Power, Clock, Temperature, Load, Frequency, Fan,
Flow, Control, Level, Factor, Data (GB), SmallData (MB), Throughput, TimeSpan, Timing, Energy,
Noise, Conductivity, Humidity`
([ISensor.cs](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Hardware/ISensor.cs)).
Groups toggled via `Computer.IsCpuEnabled`, `IsGpuEnabled`, `IsMemoryEnabled`, `IsStorageEnabled`,
`IsMotherboardEnabled`, `IsControllerEnabled`, `IsNetworkEnabled`, `IsPsuEnabled`,
`IsBatteryEnabled`, `IsPowerMonitorEnabled`.

| Domain | Sensors | Backend | Driver needed? |
|---|---|---|---|
| Intel CPU | per-core temp, `Core Max`, `Core Average`, `CPU Package` temp, per-core `Distance to TjMax`, `Bus Speed`, per-core clocks, power (`CPU Package`/`Cores`/`Graphics`/`Memory`/`Platform` via RAPL), core voltage, per-core VID | MSR reads via `IntelMSR.bin` | **Yes** ([IntelCpu.cs](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Hardware/Cpu/IntelCpu.cs)) |
| AMD CPU | Tctl/Tdie, CCD temps, package power, per-core clocks/voltage | MSR + `RyzenSMU.bin` | **Yes** |
| CPU load | per-core / total load | `NtQuerySystemInformation` (user mode) | No |
| NVIDIA GPU | core/memory/board/power-supply temps, **GPU Hot Spot**, **GPU Memory Junction**, clocks, fan RPM + fan control %, loads, `GPU Memory Free/Used/Total`, `GPU Core Voltage`, `GPU Package` power, PCIe Rx/Tx throughput, `D3D Dedicated/Shared Memory Used`, per-D3D-node loads, 12VHPWR per-pin V/A/W | NVAPI + NVML + **`Nvidia.bin` PawnIO module** | Partly — **hot spot / memory junction / 12VHPWR pins come through PawnIO**; core temp, clocks, VRAM, power come from NVAPI/NVML with no driver ([NvidiaGpu.cs](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Hardware/Gpu/NvidiaGpu.cs)) |
| AMD GPU | core/hotspot/VRAM temps, clocks, fan, power, VRAM usage | ADL/ADLX | No |
| Intel GPU | temp, freq, power (Arc); iGPU limited | IGCL / Level Zero | No |
| Memory | used/available (`Data`), load %, plus SPD/thermal sensor readout on some DIMMs | WMI/API + `RAMSPDToolkit` over SMBus | SPD/DIMM temps: **yes** |
| Storage | SMART attributes, drive temp, used space %, read/write throughput, NVMe health | `DiskInfoToolkit`, IOCTL_STORAGE_QUERY_PROPERTY | Usually admin, not a custom driver |
| Motherboard | Super-I/O fan RPM, chassis temps, voltages, fan control | `LpcIO.bin` / EC modules | **Yes** |

### 1.5 Realistic failure modes

1. **Driver absent/blocked** → CPU temps, package power, motherboard fans silently missing.
   Sensors do not appear in the tree at all (no exception is thrown).
2. **`ISensor.Value` is `float?` and is frequently `null`** — on first poll and on unsupported
   sensors. Handle null everywhere; never render `0` for null.
3. **Unsupported Super-I/O chip / new motherboard** → no fan or board temps. New chipsets lag
   LHM support by months.
4. **Garbage values**: CPU voltage/VID on some AMD parts, "Bus Speed" reported as nominal, fan RPM
   0 under Zero-RPM (correct, but reads as failure).
5. **AV false positives** and the **install-time elevation prompt** are real support/conversion
   costs for a consumer app.
6. **Polling cost** — `Computer.Update()` walks all sensors; MSR reads are IPI-based.
   `[UNVERIFIED]` no published figure; must be measured.

### 1.6 Alternatives

| Option | Verdict |
|---|---|
| **HWiNFO shared memory** | **Licensing blocker for a commercial product.** The published terms require that *"The resulting application must be made publicly available as unconditional freeware without advertising or other monetization options"*, and open-source consumers must keep the interfacing part closed-source. Also, non-Pro HWiNFO **time-limits shared memory to 12 hours** per session. ([HWiNFO licenses](https://www.hwinfo.com/licenses/), [shared memory thread](https://www.hwinfo.com/forum/threads/shared-memory-support.18/)) |
| **OpenHardwareMonitor** | Effectively dead — LHM is its maintained fork, and OHM still carries the WinRing0 problem. Do not use. |
| **Vendor SDKs directly** (NVML/NVAPI/ADLX/IGCL) | Best answer for GPU. No driver of ours, no elevation, vendor-supported. Covers ~everything FrameDoctor needs on the GPU side except NVIDIA hotspot. |
| **Windows-native only** | Covers CPU load, effective clock, memory, disk, per-process GPU. Misses all temperatures and package power. See §2. |

---

## 2. Windows-native telemetry (no driver, no admin)

### 2.1 Performance counters (PDH)

All paths below are the English/canonical names. Verified counter sets:

| Counter path | Gives | Notes |
|---|---|---|
| `\Processor Information(*)\% Processor Utility` | work done vs. work possible at **nominal** performance, never idle | **can exceed 100%** when boosting above base clock |
| `\Processor Information(*)\% Processor Performance` | average performance while executing, as % of nominal | the frequency-scaling factor |
| `\Processor Information(*)\Processor Frequency` | current frequency in MHz | `[UNVERIFIED]` on many systems this reports the *nominal/max* frequency, not the live one — verify on hardware |
| `\Processor Information(*)\% Processor Time` | classic busy time, frequency-blind | use `% Processor Utility` instead for game diagnosis |
| `\Processor Information(*)\Parking Status`, `\% Priority Time` | core parking, priority | useful for E-core/P-core scheduling issues |
| `\Memory\Available MBytes`, `Committed Bytes`, `Commit Limit`, `% Committed Bytes In Use` | commit pressure | |
| `\Memory\Page Faults/sec` | **all** faults incl. soft | mostly noise for game diagnosis |
| `\Memory\Pages Input/sec`, `\Memory\Page Reads/sec` | **hard** faults — pages actually read from disk | **this is the one that correlates with stutter** |
| `\PhysicalDisk(*)\Avg. Disk sec/Read`, `.../Write`, `.../Transfer` | latency in seconds | the real stall indicator |
| `\PhysicalDisk(*)\% Idle Time`, `\Current Disk Queue Length`, `\Disk Bytes/sec` | saturation / depth / throughput | see NVMe caveat below |
| `\Process(*)\% Processor Time`, `Working Set - Private`, `Private Bytes`, `IO Data Bytes/sec` | per-process | instance names are ambiguous (`chrome`, `chrome#1`…) — see §2.6 |
| `\GPU Engine(*)\Utilization Percentage` | per-process, per-engine GPU busy % | see §2.2 |
| `\GPU Process Memory(*)\Local Usage`, `\Non Local Usage`, `\Dedicated Usage`, `\Shared Usage` | per-process VRAM | known accuracy bug, see §2.2 |
| `\GPU Adapter Memory(*)\Dedicated Usage`, `\Shared Usage`, `\Total Committed` | per-adapter VRAM | best driver-free "VRAM used" for the whole GPU |
| `\Thermal Zone Information(*)\Temperature`, `\High Precision Temperature`, `\% Passive Limit`, `\Throttle Reasons` | ACPI thermal zone state | see §4 |

### 2.2 GPU counters — instance-name format and process attribution

Instance names encode everything you need:

```
pid_10472_luid_0x00000000_0x0000F814_phys_0_eng_0_engtype_3D
```

| Field | Meaning |
|---|---|
| `pid_<n>` | owning process id |
| `luid_<high>_<low>` | adapter LUID (two 32-bit hex halves; matches `DXGI_ADAPTER_DESC.AdapterLuid` and `DEVPKEY_Device_LUID`) |
| `phys_<n>` | physical GPU index within a linked (SLI/CF) adapter |
| `eng_<n>` | engine ordinal |
| `engtype_<name>` | `3D`, `Copy`, `VideoDecode`, `VideoEncode`, `VideoProcessing`, `Compute`, `Security`, `Other` |

`GPU Process Memory` instances use the same `pid_/luid_` prefix without the engine fields.

**Attribution recipe:** resolve the game's pid → enumerate `\GPU Engine(*)\Utilization
Percentage` and filter on `pid_<gamepid>_` → group by `engtype` → **report the max across engines,
not the sum**. That is exactly Task Manager's rule: *"pick the percentage utilization of the
busiest engine as a representative of the overall GPU usage"*
([DirectX devblog](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/)); summing
double-counts because engines run in parallel. `engtype_3D` alone is the number gamers recognize.

For VRAM prefer `\GPU Adapter Memory(*)\Dedicated Usage` plus vendor APIs: Microsoft documents
that per-process `GPU Process Memory` / Task Manager Details "Dedicated GPU memory" **over-reports
and looks like a leak** after an app flushes GPU caches
([KB4490156](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value)).

Instances are **dynamic** — they appear/vanish as engines go idle. Re-enumerate every poll; never
cache handles across a game's engine transitions. All of this works **unelevated**.

### 2.3 Effective clock from `% Processor Performance`

```
effective_clock_MHz  =  nominal_base_clock_MHz  ×  (% Processor Performance / 100)
```

Rationale, from the counter definitions: `% Processor Performance` is *"the average performance of
the processor while it is executing, as a percentage of its nominal performance"*, and
`% Processor Utility` is *"the amount of work the processor could complete if it were running at
its nominal performance and never idle"* — hence
`% Processor Utility ≈ % Processor Time × (% Processor Performance / 100)`.
Microsoft's Windows Server power-tuning guidance says to *"scale processor utilization by
`Processor Information\% Processor Performance`"* to match Task Manager / Resource Monitor
([power-performance-tuning](https://learn.microsoft.com/en-us/windows-server/administration/performance-tuning/hardware/power/power-performance-tuning)),
and that `% of Maximum Frequency` shows *"the effective frequency compared to maximum frequency"*.
Values >100% are expected and correct under Turbo/PBO.

`[UNVERIFIED]` Microsoft has never published the exact arithmetic in a single normative page; the
formula above is the standard derivation from the counter descriptions plus the tuning guidance.
`nominal_base_clock_MHz` must come from `Win32_Processor.MaxClockSpeed` or the CPU brand string —
which is the **base**, not the boost, clock.

### 2.4 Counter-name localization — a real hazard

**Yes, counter and object names are localized.** On German Windows the object is
`Prozessorinformationen`, not `Processor Information`. Building paths from English strings and
calling `PdhAddCounter` fails on non-English installs.

Correct handling, in order of preference:

1. **`PdhAddEnglishCounter`** — *"provides a language-neutral way to add performance counters to
   the query. In contrast, the counter path that you specify in `PdhAddCounter` must be
   localized."* ([docs](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhaddenglishcountera))
   **Wildcard trap — this bites us directly on `GPU Engine(*)`:** with a wildcard in the path it
   localizes the non-wildcard parts but does **not** expand the wildcard. Documented procedure:
   `PdhAddEnglishCounter(wildcard path)` → `PdhGetCounterInfo` for the localized `szFullPath` →
   `PdhExpandWildCardPath` → `PdhAddCounter` on each expanded path.
2. `PdhLookupPerfNameByIndex` — index → localized name, backed by
   `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\<langid>\Counters` (`009` = English)
   ([docs](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhlookupperfnamebyindexw)).
   `[UNVERIFIED]` common indexes: 238 Processor, 82 Process, 4 Memory, 234 PhysicalDisk.

**.NET's `PerformanceCounter` has no English-counter equivalent** — it wraps the localized
registry path. This alone is a strong argument for P/Invoking PDH directly.

### 2.5 PDH cost

`[UNVERIFIED]` Microsoft publishes **no** documented per-query cost or recommended sampling rate.
Known qualitative facts:

- PDH transparently uses the **registry** interface for V1 providers and the V2 `PerfLib`
  consumer path for V2 providers ([Using the PDH Functions](https://learn.microsoft.com/en-us/windows/win32/perfctrs/using-the-pdh-functions-to-consume-counter-data));
  the V1 registry path is the expensive one, and `Process`/`PhysicalDisk` are V1-era objects.
- `\Process(*)\*` forces enumeration of every process each sample — that is the costly query,
  not `Processor Information`. `GPU Engine(*)` instances scale as (processes × engines) and can
  number in the hundreds during gameplay.

**Recommendation:** 1 Hz for the wildcard-heavy sets (`Process`, `GPU Engine`, `PhysicalDisk`),
and if a higher rate is needed for CPU, use a *separate* narrow query. Measure before shipping
10 Hz. Reuse one `PDH_HQUERY` and call `PdhCollectQueryData` once per tick — do **not** create a
counter object per metric per tick.

### 2.6 Native APIs vs counters

| API | Gives | Privilege | Why bother |
|---|---|---|---|
| `GetSystemTimes` | system-wide idle/kernel/user 100ns times | **none** | Cheapest possible whole-box CPU busy %. No PDH, no allocation. Frequency-blind. |
| `NtQuerySystemInformation(SystemProcessorPerformanceInformation)` | **per-logical-processor** idle/kernel/user/DPC/interrupt times in one call | **none** | Per-core load without PDH, and gives DPC/ISR time that `% Processor Time` hides — genuinely useful for "a driver is eating your frame time". Undocumented-ish/`Nt*` API: version-fragile, must be resilient to struct changes. |
| `QueryProcessCycleTime` | sum of CPU **cycles** for all threads of a process | handle needs `PROCESS_QUERY_INFORMATION` or `PROCESS_QUERY_LIMITED_INFORMATION` (obtainable for same-user processes without elevation) | Frequency-independent work measure — immune to the boost-clock distortion that breaks `% Processor Time`. ([docs](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryprocesscycletime)) Caveat: cycles are not directly comparable across cores of differing IPC (P-core vs E-core). |
| `GetProcessMemoryInfo` | WorkingSetSize, PeakWorkingSetSize, **PageFaultCount**, PrivateUsage | `PROCESS_QUERY_LIMITED_INFORMATION` + `PROCESS_VM_READ` | Per-process memory without the `\Process(*)` wildcard cost. |
| `GetProcessIoCounters` | Read/Write/Other operation and byte counts | `PROCESS_QUERY_LIMITED_INFORMATION` | Per-process I/O without PDH. |
| `GlobalMemoryStatusEx` | `ullTotalPhys`, `ullAvailPhys`, `ullTotalPageFile`, `ullAvailPageFile`, `dwMemoryLoad` | **none** | Instant, allocation-free RAM snapshot. Use this for the RAM gauge. |
| `GetPerformanceInfo` | CommitTotal, CommitLimit, CommitPeak, PhysicalTotal/Available, SystemCache, PageSize, HandleCount, ProcessCount, ThreadCount | **none** ([docs](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getperformanceinfo)) | Commit-limit headroom — the number that predicts "out of memory" stutter better than free RAM. |
| `IDXGIAdapter3::QueryVideoMemoryInfo` | `Budget`, `CurrentUsage`, `AvailableForReservation`, `CurrentReservation` per memory segment group | **none** | Documented, driver-free, vendor-neutral VRAM signal. **Per-process** ("informs the process of the current budget and process usage"), so it reports *our* process, not the game's — useful mainly to detect that the adapter is oversubscribed. Docs note processes exceeding budget *"will likely experience stuttering, as they are intermittently frozen and paged-out"* — exactly the FrameDoctor diagnosis. ([docs](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo)) |

### 2.7 .NET 8 specifics

- **`System.Diagnostics.PerformanceCounter` is supported on .NET 8** via the
  `System.Diagnostics.PerformanceCounter` NuGet package (Windows-only; `CA1416` platform
  analyzer applies). Not deprecated.
  ([API docs](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.performancecounter))
- **But it is not recommended for FrameDoctor.** Traps: no `PdhAddEnglishCounter` equivalent
  (localization bug on non-English Windows); `PerformanceCounterCategory.GetInstanceNames("GPU
  Engine")` throws `InvalidOperationException: Category does not exist` where the category is
  missing/disabled; `NextValue()` must be called twice for rate counters; per-counter object
  creation is heavy. **Use direct PDH P/Invoke.**
- `System.Diagnostics.Process` (`WorkingSet64`, `TotalProcessorTime`) works, but each refresh
  snapshots *all* processes — wasteful per-tick for one game. Open a handle once and call
  `QueryProcessCycleTime` / `GetProcessMemoryInfo`. `System.Management` (WMI) is not trim-safe and
  does not belong on hot paths.

### 2.8 Memory — which signal actually matters for games

| Signal | Source | Meaning |
|---|---|---|
| Available physical | `GlobalMemoryStatusEx.ullAvailPhys` | headroom |
| **Commit vs commit limit** | `GetPerformanceInfo` CommitTotal / CommitLimit | approaching the limit → allocation failures and aggressive trimming |
| **`\Memory\Pages Input/sec`** | PDH | **hard faults — pages read from disk. This is the paging that causes hitches.** |
| `\Memory\Page Faults/sec` | PDH | includes soft faults (satisfied from standby list) — near-useless as a stutter signal, it is high on every healthy system |
| `GetProcessMemoryInfo.PageFaultCount` | per-process | cumulative, both kinds; differentiate over time |

**Rule for FrameDoctor:** flag memory as a stutter cause only when `Pages Input/sec` is
sustained-nonzero **and** frame-time spikes correlate. Never flag on `Page Faults/sec`.

### 2.9 Storage — what indicates a stall

- **`\PhysicalDisk(*)\Avg. Disk sec/Read` / `sec/Write` is the primary signal.** Microsoft's
  storage guidance uses these for latency measurement
  ([Measuring Disk Latency with Perfmon](https://learn.microsoft.com/en-us/archive/blogs/askcore/measuring-disk-latency-with-windows-performance-monitor-perfmon)).
- **Caveat from the same source:** the measured latency *"includes all the time spent in the
  hardware layers as well as the time spent in the Microsoft Port Driver queue"* — a deep queue
  inflates it. Good for "is the disk stalling the game", not a hardware-latency measurement.
- **NVMe caveat — confirmed in principle:** `Current Disk Queue Length` was designed for
  single-queue spinning disks where queue depth ≈ contention. NVMe exposes up to 64K queues of
  64K entries and *wants* deep queues; a high value there is normal parallelism, not a stall.
  Microsoft's own guidance warns that generic thresholds ("<10ms good, >20ms bad") *"do not apply
  in all cases and may lead to incorrect conclusions."*
  `[UNVERIFIED]` I found no Microsoft page that says "ignore queue length on NVMe" in those words;
  the reasoning is sound and widely held, but treat the specific threshold advice as unverified.
- **Practical thresholds to start from** (tune on real hardware): NVMe healthy < 1 ms, concerning
  > 5 ms; SATA SSD < 2 ms; HDD < 15 ms.
- `% Idle Time` is a saturation proxy; ~0% idle **plus** elevated `Avg. Disk sec/Transfer` is the
  compound signal worth reporting. `% Idle Time` alone is misleading on NVMe.

---

## 3. Vendor GPU telemetry

### 3.1 NVIDIA NVML

- **Ships with the driver** — *"downloaded as part of the NVIDIA GPU Driver for Linux and
  Windows"* ([NVIDIA](https://developer.nvidia.com/management-library-nvml)); `nvml.dll` lands in
  `%ProgramFiles%\NVIDIA Corporation\NVSMI\` and/or `System32`. **Do not redistribute** — load
  dynamically, degrade gracefully if absent. **No admin required.**
- Exposes: `nvmlDeviceGetClockInfo` / `nvmlDeviceGetClock` (graphics/SM/mem/video domains),
  `nvmlDeviceGetTemperature`, `nvmlDeviceGetTemperatureThreshold`, `nvmlDeviceGetMemoryInfo` /
  `_v2` (total/used/free VRAM), `nvmlDeviceGetPowerUsage`, `nvmlDeviceGetFanSpeed` /
  `nvmlDeviceGetFanSpeedRPM`, `nvmlDeviceGetUtilizationRates` (GPU + memory-controller %),
  `nvmlDeviceGetEncoderUtilization` / `DecoderUtilization`, `nvmlDeviceGetPcieThroughput`
  ([Device Queries](https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html)).
- **Throttle reasons — the headline feature.** `nvmlDeviceGetCurrentClocksThrottleReasons` is the
  legacy name; **`nvmlDeviceGetCurrentClocksEventReasons` is the current one**. Multiple bits can
  be set at once. Bitmask
  ([Clocks Event Reasons](https://docs.nvidia.com/deploy/nvml-api/group__nvmlClocksEventReasons.html)):

  | Bit | Constant | Meaning |
  |---|---|---|
  | `0x0` | `nvmlClocksEventReasonNone` | not throttled |
  | `0x1` | `nvmlClocksEventReasonGpuIdle` | idle |
  | `0x2` | `nvmlClocksEventReasonApplicationsClocksSetting` | app clocks set |
  | `0x4` | `nvmlClocksEventReasonSwPowerCap` | **software power cap** |
  | `0x8` | `nvmlClocksThrottleReasonHwSlowdown` | **hardware slowdown** (thermal/power/OVP) |
  | `0x10` | `nvmlClocksEventReasonSyncBoost` | sync-boost group |
  | `0x20` | `nvmlClocksEventReasonSwThermalSlowdown` | **software thermal slowdown** |
  | `0x40` | `nvmlClocksThrottleReasonHwThermalSlowdown` | **hardware thermal slowdown** |
  | `0x80` | `nvmlClocksThrottleReasonHwPowerBrakeSlowdown` | **power-brake (EDP) slowdown** |
  | `0x100` | `nvmlClocksEventReasonDisplayClockSetting` | display clock limit |

  For FrameDoctor: `0x20 | 0x40` ⇒ "thermal throttling", `0x4 | 0x80` ⇒ "power limited",
  `0x8` ⇒ generic hardware slowdown (report as thermal-or-power).
- **GeForce caveats:** NVIDIA documents only "limited support" for GeForce; several functions
  (notably `nvmlDeviceGetPowerUsage` on older/low-end parts) return `NVML_ERROR_NOT_SUPPORTED`.
  **Treat every NVML call as fallible per-SKU.**
- **No hot-spot temperature** — `nvmlDeviceGetTemperature` returns a single scalar and no
  hotspot channel is publicly documented; on RTX 50-series the regular interfaces do not expose it
  ([Igor's Lab](https://www.igorslab.de/en/blackwell-hotspot-ibhe-estimation-register-findings-download-nvidia-question/)).
- **.NET bindings:** `[UNVERIFIED]` no first-party .NET binding. Hand-rolled P/Invoke is
  recommended (~10 functions needed); ManagedCuda and LHM's MPL-2.0 `NvidiaML` interop are
  references.

### 3.2 NVIDIA NVAPI

- Adds over NVML: **multiple thermal sensors per GPU** — `NvAPI_GPU_GetThermalSettings` reads a
  specific sensor with targets `GPU`, `Memory`, `PowerSupply`, `Board`, `VisualComputingBoard`,
  `VisualComputingInlet`, `VisualComputingOutlet` (up to 3 sensors on current parts)
  ([NVAPI thermal docs](https://archive.docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/group__gputhermal.html));
  also per-domain clock frequencies, cooler/fan enumeration and control, bus/slot IDs, and
  utilization domains.
- **Still does not officially give hot spot.** LHM gets `GPU Hot Spot` and `GPU Memory Junction`
  **through its `Nvidia.bin` PawnIO module** (direct register reads), *not* through NVAPI — verified
  in `NvidiaGpu.cs`. **So: NVIDIA hotspot temperature requires a kernel driver. There is no
  supported user-mode path.**
- **No per-process data** in NVAPI beyond what NVML/PDH already give.
- Redistribution: NVAPI is header+static-stub, shipped in the NVIDIA driver as `nvapi64.dll`;
  the SDK is under NVIDIA's proprietary SDK license. Load `nvapi64.dll` dynamically via
  `nvapi_QueryInterface`; do not redistribute.
- .NET: `NvAPIWrapper` (community, MIT `[UNVERIFIED]`) or LHM's MPL-2.0 `NvApi` interop.

### 3.3 AMD ADLX

- Current, actively maintained, and the **documented successor to the legacy ADL SDK**
  ([GPUOpen ADLX](https://gpuopen.com/adlx/)). Windows 10+, 32/64-bit.
- Ships **with the AMD Adrenalin driver** (`amdadlx64.dll`); the SDK on GitHub is headers + samples.
- Performance-monitoring domain (`IADLXGPUMetrics`, `IADLXGPUMetrics1/2`, `IADLXGPUMetricsList`,
  `IADLXGPUMetricsSupport`) exposes: **GPU usage %, GPU clock speed, VRAM clock speed, GPU
  temperature, GPU hotspot temperature, GPU power, GPU total board power, fan speed (RPM) and fan
  duty (%), VRAM usage, GPU voltage, intake temperature** — each with a `IsSupported`/`Range`
  companion so unsupported metrics are detectable, not guessed
  ([Performance Monitoring reference](https://gpuopen.com/manuals/adlx/adlx-sdk-references/adlx-interfaces/performance-monitoring/)).
- **ADLX gives hotspot officially** — a real advantage over NVIDIA.
- **.NET:** AMD publishes an official guide for generating C# bindings and ships C# samples
  ([Building C# bindings for ADLX](https://gpuopen.com/manuals/adlx/adlx-page_guide_bindcsharp/),
  [C# samples](https://gpuopen.com/manuals/adlx/adlx-page_sample_cs/)). The binding is a generated
  SWIG-style wrapper — chunky, but supported.
- **Admin:** `[UNVERIFIED]` AMD documents no elevation requirement for read-only metrics, and
  none is expected; must be confirmed on hardware. Tuning/overclock writes are a different matter.
- **Throttling:** `[UNVERIFIED]` ADLX exposes no documented "throttle reason" enum equivalent to
  NVML's bitmask. Thermal throttling must be inferred from hotspot temperature + clock collapse.

### 3.4 Intel

- **IGCL (Intel Graphics Control Library)** is the Windows-facing option
  ([repo](https://github.com/intel/drivers.gpu.control-library),
  [spec](https://intel.github.io/drivers.gpu.control-library/Control/INTRO.html)). It hosts a
  Level Zero driver instance internally and forwards telemetry to it; **oneAPI Level Zero Sysman**
  is the lower-level path and also works on Windows. Prefer IGCL on Windows.
- Surface: engine utilization, frequency (request/actual/throttle), power, temperature from
  **multiple sensors — GPU core, memory, global**, fan, memory, PCI, overclock.
- **Constraint: the performance & telemetry APIs are 64-bit only** (Level Zero limitation) —
  FrameDoctor must be x64 for Intel GPU telemetry.
- .NET: `[UNVERIFIED]` no official C# binding; hand-rolled P/Invoke over `igcl.dll`.
- **Throttle reasons:** Level Zero Sysman defines `zes_freq_throttle_reason_flags_t` (average
  power, burst power, current limit, thermal limit, PSU alert, SW/HW range). `[UNVERIFIED]` —
  confirm the exact IGCL surfacing against the header.

### 3.5 Documented throttling reasons — summary

| Vendor | Documented throttle reason? | Mechanism | Elevation |
|---|---|---|---|
| **NVIDIA** | **Yes, best-in-class** | `nvmlDeviceGetCurrentClocksEventReasons` bitmask incl. HW/SW thermal, SW power cap, power brake | none |
| **AMD** | No explicit reason enum `[UNVERIFIED]` | infer from hotspot temp + clock collapse + power vs board-power limit | none |
| **Intel** | Partially — Level Zero throttle-reason flags | `zes_freq_throttle_reason_flags_t` via Sysman/IGCL | none |
| **CPU (any)** | Yes, coarse | `\Thermal Zone Information(*)\Throttle Reasons`: `0x0` none, `0x1` thermal, `0x2` current limit | none |

---

## 4. CPU throttling detection without a driver

**Short answer: yes, you can detect it — you just cannot measure the temperature that causes it.**

| Approach | Verdict |
|---|---|
| **`% Processor Performance` collapse** | **Best driver-free signal.** Sustained load with `% Processor Performance` dropping well below 100 (or below its own steady-state baseline) while the workload is unchanged = frequency is being pulled down. Combined with a rising system fan/thermal-zone reading this is a defensible "your CPU is throttling" call. Free, unelevated, works everywhere. |
| **`\Thermal Zone Information(*)\Throttle Reasons`** | **Underused and genuinely useful.** Documented values: `0x0` = not throttled, `0x1` = throttled for **thermal** reasons, `0x2` = throttled to **limit electrical current**. Paired with `% Passive Limit` (100% = unconstrained, 0% = fully constrained). This is ACPI passive-cooling state, so it reflects **platform/OS-directed** throttling. ([windows_exporter thermalzone docs](https://github.com/prometheus-community/windows_exporter/blob/master/docs/collector.thermalzone.md)) **Caveat:** it does **not** see silicon-internal PROCHOT/thermal-velocity-boost throttling that the CPU does on its own without OS involvement — which is the common case on desktops. Availability of thermal zones on desktops is patchy. |
| **`MSAcpi_ThermalZoneTemperature` (WMI, `ROOT\WMI`)** | **Largely useless on desktops. Do not build on it.** Many desktop boards return `0x8004100C` ("The feature or operation is not supported"). Where it does return, it reports an **ACPI thermal zone on the motherboard, not the CPU die** — often a near-constant ~27-40 °C that never moves under load. Also commonly requires elevation to read. Multiple thermal zones may exist with no way to identify which is which. Use it, at most, as a weak corroborating signal, clearly labelled as "system", never as "CPU temperature". |
| **`Win32_Processor.CurrentClockSpeed`** | **Useless for real-time.** It is a WMI snapshot that on most systems returns the base/nominal clock, updates lazily, and does not reflect boost or per-core state. `Win32_Processor.MaxClockSpeed` is still the right way to get the **base** clock for the effective-clock formula in §2.3. |
| **`Processor Information\Processor Frequency`** | Better than WMI but `[UNVERIFIED]` — on several systems it also reports nominal rather than live frequency. Cross-check against the `% Processor Performance` derivation. |
| **Ring-0 MSR (`IA32_THERM_STATUS`, `IA32_PACKAGE_THERM_STATUS`)** | The only way to get true die temperature, TjMax distance, and the actual PROCHOT / thermal-throttle status bits. **Requires a kernel driver.** This is exactly what LHM+PawnIO does. |

**Recommended composite heuristic (no driver):**
throttling is *likely* when, over a ≥10 s window under sustained ≥70% `% Processor Utility`,
`% Processor Performance` falls ≥20% below its first-30-seconds baseline — and *confirmed* when
`\Thermal Zone Information(*)\Throttle Reasons` is non-zero. Report the former as "possible
thermal/power limit" and the latter as "confirmed".

---

## 5. Decision table — metric → best source → fallback → cost

| Metric | Best source | Fallback | Elevation? | Driver? |
|---|---|---|---|---|
| Total CPU load | `\Processor Information(_Total)\% Processor Utility` | `GetSystemTimes` | No | No |
| Per-core load | `\Processor Information(0,*)\% Processor Utility` | `NtQuerySystemInformation(SystemProcessorPerformanceInformation)` | No | No |
| Per-core effective clock | base MHz × `% Processor Performance`/100 | `\Processor Information(*)\Processor Frequency` | No | No |
| DPC/ISR time | `NtQuerySystemInformation` | `\Processor(*)\% DPC Time` | No | No |
| CPU package temp | LHM (PawnIO MSR) | `\Thermal Zone Information(*)\Temperature` (weak) | **Yes** | **Yes** |
| Per-core temp | LHM (PawnIO MSR) | none | **Yes** | **Yes** |
| CPU package power | LHM RAPL via PawnIO | none | **Yes** | **Yes** |
| CPU throttle state | `\Thermal Zone Information(*)\Throttle Reasons` + `% Processor Performance` collapse | LHM MSR thermal status | No | No |
| Game process CPU | `QueryProcessCycleTime` + `GetProcessTimes` | `\Process(name)\% Processor Time` | No | No |
| GPU utilization (total) | NVML/ADLX/IGCL | `\GPU Engine(*)\Utilization Percentage`, max over engines | No | No |
| GPU utilization (per-process) | `\GPU Engine(pid_N_*)\Utilization Percentage` | none | No | No |
| GPU core clock | NVML `nvmlDeviceGetClockInfo` / ADLX / IGCL | none | No | No |
| GPU memory clock | NVML (MEM domain) / ADLX | none | No | No |
| GPU core temp | NVML / NVAPI thermal settings / ADLX / IGCL | none | No | No |
| **GPU hotspot temp** | **AMD: ADLX `GetGPUHotspotTemperature`. Intel: IGCL sensors.** | **NVIDIA: only via LHM+PawnIO register reads** | NVIDIA: **Yes** | NVIDIA: **Yes** |
| VRAM used/total (adapter) | NVML `nvmlDeviceGetMemoryInfo` / ADLX / IGCL | `\GPU Adapter Memory(*)\Dedicated Usage` | No | No |
| VRAM used (per-process) | `\GPU Process Memory(pid_N_*)\Dedicated Usage` (known over-report) | `IDXGIAdapter3::QueryVideoMemoryInfo` (own process only) | No | No |
| GPU power | NVML `nvmlDeviceGetPowerUsage` / ADLX total board power | none | No | No |
| GPU fan | NVML `nvmlDeviceGetFanSpeedRPM` / ADLX / IGCL | LHM | No | No |
| **GPU throttle reason** | **NVML `nvmlDeviceGetCurrentClocksEventReasons`** | Intel: Level Zero throttle flags. AMD: infer. | No | No |
| RAM used/total | `GlobalMemoryStatusEx` | `\Memory\Available MBytes` | No | No |
| Commit / commit limit | `GetPerformanceInfo` | `\Memory\Committed Bytes`, `Commit Limit` | No | No |
| **Hard page faults** | `\Memory\Pages Input/sec` | `\Memory\Page Reads/sec` | No | No |
| DIMM temperature | LHM (SPD over SMBus) | none | **Yes** | **Yes** |
| Disk latency | `\PhysicalDisk(*)\Avg. Disk sec/Read`/`Write` | `GetProcessIoCounters` deltas | No | No |
| Disk saturation | `\PhysicalDisk(*)\% Idle Time` | `Disk Bytes/sec` vs. known max | No | No |
| Disk temp / SMART | LHM (`DiskInfoToolkit`) | `MSStorageDriver_ATAPISmartData` (WMI) | **Yes** | No |

---

## 6. Recommended tiered approach

### Tier 0 — no privilege, no driver, no install friction (ship this as the default)

Covers, honestly, most of what a frame-time diagnostician needs:

- CPU: total + per-core load (`% Processor Utility`), **effective clock** via `% Processor
  Performance`, DPC/ISR time, core parking, per-process CPU cycles.
- **CPU throttling inference** from `% Processor Performance` collapse plus
  `\Thermal Zone Information(*)\Throttle Reasons`.
- GPU: full vendor telemetry through **NVML / ADLX / IGCL** — clocks, temps, VRAM, power, fan,
  and **NVIDIA's documented throttle-reason bitmask**, which is the single highest-value signal
  in this entire document for thermal diagnosis. None of these need elevation.
- Per-process GPU utilization and VRAM via `GPU Engine` / `GPU Process Memory` counters.
- Memory: `GlobalMemoryStatusEx`, `GetPerformanceInfo` commit headroom, `Pages Input/sec` hard
  faults.
- Disk: `Avg. Disk sec/*` latency and `% Idle Time`.

**What Tier 0 cannot do:** CPU die temperature, CPU package power, NVIDIA hotspot, motherboard
fan RPM, DIMM temperature.

### Tier 1 — optional elevated helper, still no driver of ours

An out-of-process elevated helper (separate signed EXE, launched on demand) adds SMART/disk
health and temperature, some WMI thermal classes, and handle access to other users' processes.
**Small delta.** Elevation alone does not buy CPU temperature — that needs ring 0.

### Tier 2 — LibreHardwareMonitorLib + PawnIO (opt-in, user-initiated, clearly explained)

This is what buys CPU package/per-core temperature, RAPL package power, motherboard fan RPM,
DIMM temps, and NVIDIA hotspot.

**My recommendation: offer this, do not require it, and never install it silently.**

- **Do not ship WinRing0 under any circumstances** — CVE-2020-14979, documented BYOVD vector,
  blocked by Defender by name. Indefensible in a consumer app in 2026, both as security posture
  and as support burden.
- LHM has already moved to **PawnIO**: signed driver, sandboxed Pawn VM, RSA-signed modules,
  narrow ioctl surface, no raw physical-memory primitive exposed to user mode. GPLv2 **with an
  IOCTL linking exception**, so our closed-source app may talk to it.
- **We do not ship or install the driver ourselves.** Detect PawnIO via its uninstall registry key
  (exactly what `LibreHardwareMonitor.PawnIo.PawnIo`'s static constructor reads); if absent, show
  a clear opt-in explaining that CPU temperature requires a signed third-party kernel driver, with
  a link to pawnio.eu. Ship the LHM sensor layer disabled-by-default.
- **Tier 2 must be additive, never load-bearing.** Every panel renders and every diagnosis reaches
  a conclusion on Tier 0 data alone. Temperature is confirmation; `% Processor Performance`
  collapse and NVML throttle reasons are the evidence.
- **Legal:** ship the MPL-2.0 text and an offer of source for the LHM files; do not modify LHM
  sources unless prepared to publish those files.

---

## 7. Open questions requiring a Windows machine

1. **Does `\Processor Information(*)\Processor Frequency` report live or nominal frequency?**
   Test on Intel HWP (12th gen+, P/E cores) and AMD PBO. If nominal, the `% Processor
   Performance` derivation is the only option.
2. **`% Processor Performance` on hybrid CPUs** — is it per-logical-processor meaningful on
   E-cores, and is "nominal" the P-core base clock for all instances?
3. **Actual PDH cost.** Measure `PdhCollectQueryData` wall time and CPU cost at 1 Hz vs 10 Hz for:
   (a) 32 `Processor Information` instances, (b) `\Process(*)` wildcard on a ~300-process box,
   (c) `\GPU Engine(*)` during a running game (instance count can be in the hundreds).
4. **Does `PdhAddEnglishCounter` + `PdhExpandWildCardPath` actually work for `GPU Engine(*)`** on
   a non-English Windows install? Test on German or Japanese Windows specifically.
5. **Is elevation required to open the PawnIO device** and issue ioctls after the driver is
   installed, or only to install it?
6. **Does ADLX require elevation** for read-only `IADLXGPUMetrics`? Test on a clean non-admin
   session with Adrenalin installed.
7. **NVML function-by-function GeForce support matrix.** Enumerate which of
   `GetPowerUsage`, `GetFanSpeedRPM`, `GetClock(MEM)`, `GetCurrentClocksEventReasons` return
   `NVML_ERROR_NOT_SUPPORTED` on RTX 30/40/50 consumer parts.
8. **`\Thermal Zone Information` availability on desktops.** How many machines expose zones at
   all, and does `Throttle Reasons` ever go non-zero on a thermally-limited desktop CPU, or only
   on laptops?
9. **`\GPU Process Memory` over-reporting** (KB4490156) — does it still reproduce on Windows 11
   24H2/25H2, and by how much? Determines whether we can show per-process VRAM at all.
10. **LHM poll cost** — time `Computer.Update()` with CPU+GPU+memory+storage enabled; do MSR IPIs
    cause measurable frame-time impact in a running game? If so, Tier 2 must sample slower.
11. **PawnIO risk check** — does it appear on Microsoft's driver blocklist in any recent servicing
    update, and does installing it trigger Defender/SmartScreen/third-party AV warnings that would
    harm install conversion? Re-check before each release.

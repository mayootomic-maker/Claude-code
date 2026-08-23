# Frame-Time Telemetry on Windows — Engineering Reference

Research date: **2026-08-23**. Target consumer: FrameDoctor (.NET 8, Windows desktop).
Sources verified against `github.com/GameTechDev/PresentMon` @ `f57eb47` (main, 2026-08-15) and learn.microsoft.com.
Claims that could not be confirmed from a primary source are marked `[UNVERIFIED]`.

---

## 1. PresentMon

### 1.1 Version & licensing

| Item | Value |
| --- | --- |
| Latest **release** | **v2.5.1**, published 2026-06-30 ([releases.atom](https://github.com/GameTechDev/PresentMon/releases.atom), [tag](https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.1)) |
| `main` branch version | `2.6.0` (unreleased dev) — [`Version.props`](https://github.com/GameTechDev/PresentMon/blob/main/Version.props) |
| v2.5.0 status | Binaries **withdrawn**: "The download for this release (initially released April 2026) has been removed because the shared service component had caused a compatibility conflict with one of our downstream customers." → use v2.5.1 ([tag](https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.0)) |
| License | **MIT**, Copyright (C) 2017-2024 Intel Corporation ([LICENSE.txt](https://github.com/GameTechDev/PresentMon/blob/main/LICENSE.txt)) |
| Third-party | ADL (MIT), NVAPI (MIT-style), CEF (BSD) — [THIRD_PARTY.txt](https://github.com/GameTechDev/PresentMon/blob/main/THIRD_PARTY.txt). CEF only ships with the GUI Capture Application. |

**Commercial redistribution: yes.** MIT permits "use, copy, modify, merge, publish, distribute, sublicense, and/or sell". Only obligation is shipping the copyright + permission notice. If you bundle only the console app you avoid CEF entirely.

### 1.2 Architecture (four components)

Per [README.md](https://github.com/GameTechDev/PresentMon/blob/main/README.md):

| Component | Path | What it is | Needs the service? |
| --- | --- | --- | --- |
| **PresentData** (Collection & Analysis lib) | `PresentData/` | C++ static lib. Starts its own ETW realtime session, enables providers, reconstructs `PresentEvent`s. This is the actual engine. | No |
| **Console Application** | `PresentMon/` | `PresentMon-<ver>-x64.exe`. Standalone; links PresentData and starts **its own** ETW session (`MainThread.cpp` constructs `PMTraceSession` directly). Emits CSV to file or stdout. | **No** — verified in source |
| **PresentMon Service** | `IntelPresentMon/PresentMonService/` | Windows service ("Service for Intel(R) PresentMon API clients"). Owns the ETW session + vendor telemetry (NVAPI/ADL/IGCL: GPU power, temp, freq, util) and multiplexes to N clients. | n/a |
| **Capture Application** | `IntelPresentMon/AppCef/` + `Core/` | CEF/Vue GUI + overlay. A client of the service. | Yes |

Key architectural consequence: **the CLI and the service are two independent ETW consumers.** Running both means two ETW sessions.

### 1.3 The SDK / PresentMon API

From [README-Service.md](https://github.com/GameTechDev/PresentMon/blob/main/README-Service.md) and [`PresentMonAPI.h`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/PresentMonAPI2/PresentMonAPI.h):

- **Shape**: flat **C ABI** (`extern "C"`, `__declspec(dllimport)`), header `PresentMonAPI.h`. API version macros in-header: `PM_API_VERSION_MAJOR 3`, `PM_API_VERSION_MINOR 4`.
- **Transport**: client ↔ service over a **named pipe** for control (default `\\.\pipe\pm-ctrl`, see [`CliOptions.h`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/Core/source/cli/CliOptions.h)) plus **named shared memory (NSM)** for the bulk frame stream. You never touch either directly — `PresentMonAPI2.dll` does.
- **Deployment rule**: the service installs `PresentMonAPI2.dll` (v2.3.1+). Clients must **dynamically load the service's copy** — "If a client ships their own copy of PresentMonAPI2.dll, binary compatibility with the service will not be guaranteed." An optional `PresentMonAPI2Loader.dll` (+ `.lib`) does the locating/loading; SDK files land in `Program Files\Intel\PresentMon\SDK`.
- **Language bindings**: C header + a C++ RAII wrapper (`IntelPresentMon/PresentMonAPIWrapper/`). **No official C#/.NET binding, no official NuGet package** (repo contains only 3 unrelated `.csproj`: a codegen `Reflector` and a WiX installer extension).

Core call surface (verbatim from the header):

```
pmOpenSession / pmOpenSessionWithPipe(pHandle, controlPipeName) / pmCloseSession
pmStartTrackingProcess(handle, pid) / pmStopTrackingProcess(handle, pid)
pmGetIntrospectionRoot / pmFreeIntrospectionRoot        // discover metrics, devices, enums
pmRegisterDynamicQuery(session, &qh, elements, n, windowSizeMs, metricOffsetMs)
pmPollDynamicQuery(qh, pid, pBlob, &numSwapChains)      // windowed stats: avg/percentile
pmRegisterFrameQuery(session, &fh, elements, n, &blobSize)
pmConsumeFrames(fh, pid, pBlobs, &numFramesToRead)      // per-frame event stream
pmPollStaticQuery(session, &element, pid, pBlob)
pmSetTelemetryPollingPeriod(h, reserved, ms)            // 50..5000
pmSetEtwFlushPeriod(h, ms)                              // 8..1000  <-- latency knob
pmFlushFrames(h, pid) / pmGetApiVersion / pmStartEtlLogging / pmFinishEtlLogging
```

Data model is **P/Invoke-friendly**: you fill an array of

```c
struct PM_QUERY_ELEMENT { PM_METRIC metric; PM_STAT stat; uint32_t deviceId;
                          uint32_t arrayIndex; uint64_t dataOffset; uint64_t dataSize; };
```

`pmRegisterFrameQuery` writes back `dataOffset`/`dataSize` per element and a total `blobSize`; `pmConsumeFrames` fills a flat byte buffer of N blobs, and you read each field at `blob + dataOffset` (see [`SampleClient/FrameQuerySample.h`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/SampleClient/FrameQuerySample.h)). No COM, no callbacks, no structure-packing surprises — a `[StructLayout(Sequential)]` struct plus `Span<byte>` reads is sufficient.

All functions return `PM_STATUS`. Notable values for a client: `PM_STATUS_SERVICE_ERROR`, `PM_STATUS_PIPE_ERROR`, `PM_STATUS_MIDDLEWARE_VERSION_LOW/HIGH`, `PM_STATUS_MIDDLEWARE_SERVICE_MISMATCH`, `PM_STATUS_UNABLE_TO_CREATE_NSM`, `PM_STATUS_FEATURE_DISABLED`.

### 1.4 Privileges

| Actor | Requirement |
| --- | --- |
| PresentMon **CLI** / any self-hosted ETW consumer | Member of **Performance Log Users** (or Administrators). Without it: "failed to start trace session (access denied)" ([README](https://github.com/GameTechDev/PresentMon/blob/main/README.md#user-access-denied)). Admin additionally gives full process names for other-user/short-lived processes; without it they appear as `<unknown>` and cannot be targeted by `--process_name`. `--restart_as_admin` re-launches with the `runas` verb. |
| PresentMon **Service** | Installed by MSI (requires admin at install time); runs as a privileged service account so it can own the ETW session. Exact account `[UNVERIFIED]` — not expressed in the WiX source; set by an installer custom action. |
| PresentMon **API client** | **No elevation needed.** The control pipe is created with SDDL `D:P(A;;GA;;;AU)S:(ML;;NW;;;LW)` — GENERIC_ALL for *Authenticated Users*, low-IL mandatory label ([`CommonUtilities/pipe/Pipe.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/CommonUtilities/pipe/Pipe.cpp)). The shared-memory regions use `D:(A;OICI;GR;;;AU)` ([`Interprocess.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/Interprocess/source/Interprocess.cpp)). **This is the single biggest reason to prefer the service route.** |

### 1.5 Metrics — exact definitions

Authoritative list: [`IntelPresentMon/metrics.csv`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/metrics.csv) and [README-ConsoleApplication.md](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md#csv-columns). The CLI can emit three vocabularies: default (2.4+), `--v2_metrics`, `--v1_metrics`.

**Timeline metrics (the important ones):**

| Metric (`PM_METRIC_*`) | CSV column | Exact meaning |
| --- | --- | --- |
| `CPU_START_TIME` / `CPU_START_QPC` | `CPUStartTime` | Time the CPU started work on this frame. |
| `CPU_FRAME_TIME` | *(SDK only, "FrameTime-App")* | Start of this frame → start of **next** frame. |
| `CPU_BUSY` | `MsCPUBusy` | CPU time working on this frame before presenting it. |
| `CPU_WAIT` | `MsCPUWait` | CPU time spent waiting before starting the next frame. (v1/v2 name: `CPUFramePacingStall`.) |
| `GPU_LATENCY` | `MsGPULatency` | Frame start → GPU **started** work on it. (≈ v1 `msUntilRenderStart`.) |
| `GPU_TIME` | `MsGPUTime` | Total wall time the GPU was working on this frame. |
| `GPU_BUSY` | `MsGPUBusy` | Time during which **≥1 GPU engine is executing work from the target process**. (≈ v1 `msGPUActive`.) |
| `GPU_WAIT` | `MsGPUWait` | GPU idle time within the frame. `GPU_TIME − GPU_BUSY`. |
| `DISPLAY_LATENCY` | `DisplayLatency` | Frame **start** → frame **on screen**. |
| `DISPLAYED_TIME` | `DisplayedTime` | How long this frame stayed on screen; `NA` if never displayed. |
| `DISPLAYED_FRAME_TIME` | *(SDK, "FrameTime-Display")* | Previous displayed frame → this frame displayed. |
| `PRESENTED_FRAME_TIME` / `BETWEEN_PRESENTS` | `MsBetweenPresents` | This `Present()` → previous `Present()`. |
| `IN_PRESENT_API` | `MsInPresentAPI` | Wall time **inside** the `Present()` call. |
| `UNTIL_DISPLAYED` | `MsUntilDisplayed` | `Present()` call → frame displayed. |
| `RENDER_PRESENT_LATENCY` | `MsRenderPresentLatency` | `Present()` call → GPU work for the frame completed. **This is the successor to v1 `msUntilRenderComplete`.** |
| `BETWEEN_DISPLAY_CHANGE` | `MsBetweenDisplayChange` | How long the previous frame was displayed before this one was. |
| `ANIMATION_ERROR` | `MsAnimationError` | Previous frame's **CPU/sim delta minus display delta** (see §1.6). |
| `ANIMATION_TIME` | `AnimationTime` | CPU time at which animation work for this frame started. |
| `CLICK_TO_PHOTON_LATENCY` | `MsClickToPhotonLatency` | Earliest **mouse click** contributing to this frame → frame displayed. |
| `ALL_INPUT_TO_PHOTON_LATENCY` | `MsAllInputToPhotonLatency` | Earliest keyboard **or** mouse interaction contributing to this frame → displayed. |
| `INSTRUMENTED_LATENCY` | `InstrumentedLatency` | Instrumented (app-provider) frame start → displayed. Requires `--track_app_timing` + app/driver instrumentation. |
| `PC_LATENCY` | `MsPCLatency` | Input received by PC → frame sent to display. Requires NVIDIA PCL events (`--track_pc_latency`). |
| `DROPPED_FRAMES` | *(SDK only)* | Frame was **not displayed**. In source: `metrics.isDroppedFrame = !isDisplayed` ([`MetricsCalculatorDisplay.cpp:154`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/CommonUtilities/mc/MetricsCalculatorDisplay.cpp)). Underlying `PresentResult` enum is `{Unknown, Presented, Discarded}`. |
| `DISPLAYED_FPS` / `APPLICATION_FPS` / `PRESENTED_FPS` | — | SDK-only rate metrics ("FPS-Display" / "FPS-App" / "FPS-Presents"). |
| `PSO_COMPILE_COUNT` / `PSO_COMPILE_TIME` / `PSO_COMPILE_BUSY_PERCENT` | — | D3D12 pipeline-state-object compiles attributed to the frame. **Directly useful for shader-compilation stutter diagnosis.** (New on `main`; presence in v2.5.1 `[UNVERIFIED]`.) |

**Which one is "frame time"?**

- What a **gamer means** by frame time and what an FPS counter shows: `PM_METRIC_CPU_FRAME_TIME` ("FrameTime-App", frame-start to next-frame-start) is PresentMon 2.x's canonical answer and the basis of FPS-App. Historically overlays used `MsBetweenPresents`; it is nearly the same when the app is not stalling in `Present()`, and diverges under a blocking present.
- What the player **actually sees**: `DISPLAYED_FRAME_TIME` ("FrameTime-Display") / `BETWEEN_DISPLAY_CHANGE`. Use this for anything claiming to represent perceived smoothness.
- **Do not** use `MsInPresentAPI` as frame time; it only measures time inside the API call and is ~0 for flip-model non-blocking presents.

**Which one detects stutter?** Use three signals together, in this order:
1. `MsAnimationError` — the only metric that catches *pacing* stutter (even present cadence, uneven simulation-to-display mapping). This is the real "micro-stutter" detector.
2. `DROPPED_FRAMES` + variance of `DISPLAYED_FRAME_TIME` — catches frames that never reached the screen and display-side hitching.
3. `CPU_BUSY` vs `GPU_BUSY` vs `GPU_WAIT` on the outlier frames — attributes the hitch to CPU-bound, GPU-bound, or a stall (and `PSO_COMPILE_*` for shader-comp hitches).

Variance of `MsBetweenPresents` alone is the classic mistake: it misses dropped frames and display-side pacing entirely.

### 1.6 Frame pacing / animation error

`MsAnimationError = simStepMs − displayStepMs`, computed in [`AnimationErrorTracker.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/IntelPresentMon/CommonUtilities/mc/AnimationErrorTracker.cpp) (`ResolveSameSourceIntervalAndAdvanceAnchor_`), where `simStepMs` is the per-frame simulation-time step (interval between sim anchors divided evenly across the frames displayed in that interval) and `displayStepMs` is the measured screen-time delta. `0` in either term ⇒ metric reported as missing, not as 0.

The sim anchor comes from one of three sources, in priority order (`ResolveSource_`): `AppProvider` (Intel-PresentMon app instrumentation) > `PCLatency` (NVIDIA PCL) > `CpuStart` (fallback, inferred). **Accuracy degrades in that order** — with the `CpuStart` fallback you are inferring simulation timing from present timing, which is exactly what breaks on OpenGL/Vulkan (§1.8).

Related: `ANIMATION_TIME` (absolute animation timeline position) and `BETWEEN_SIMULATION_START`.

### 1.7 `PresentMode` and `Runtime` enums

`PM_PRESENT_MODE` (values from `PresentMonAPI.h`; note the deliberate gap at 6–7):

| Value | Name | Meaning ([README-ConsoleApplication.md](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md)) |
| --- | --- | --- |
| 0 | `UNKNOWN` | Not determined. |
| 1 | `HARDWARE_LEGACY_FLIP` | App owns the screen, swapping the displayed surface every frame. |
| 2 | `HARDWARE_LEGACY_COPY_TO_FRONT_BUFFER` | App owns the screen, copying into an already-on-screen surface. |
| 3 | `HARDWARE_INDEPENDENT_FLIP` | App does not own the screen but still swaps the displayed surface each frame. |
| 4 | `COMPOSED_FLIP` | Windowed, flip-model swapchain, surfaces shared with DWM for composition. |
| 5 | `COMPOSED_COPY_WITH_GPU_GDI` | Windowed, copying into a GDI-shared surface. |
| 6 | `COMPOSED_COPY_WITH_CPU_GDI` | Windowed, copying into a dedicated DX window surface; GDI composed separately by DWM. |
| **8** | `HARDWARE_COMPOSED_INDEPENDENT_FLIP` | Flip-model swapchain granted a **hardware overlay plane**. |

Practical read: 1/2/3/8 = low-latency paths (exclusive FS or independent flip). 4 = windowed flip through DWM (+~1 frame). 5/6 = legacy blit paths, worst latency. The doc's older label "Composed: Copy with GPU GSync" does not appear in current source. Also on the frame: `AllowsTearing` (1 = partial frames may reach the screen), `SyncInterval` (may be overridden by driver), `FrameType` (`APPLICATION` / `REPEATED` / `INTEL_XEFG=50` / `AMD_AFMF=100`, plus DLSS added on `main` 2026-08-15 — frame-generation frames are labelled, so you can exclude them from latency math).

`PM_GRAPHICS_RUNTIME` / `Runtime`: `UNKNOWN(0)` (a.k.a. "Other" in CSV — OpenGL, Vulkan, anything not instrumented), `DXGI(1)`, `D3D9(2)`. There is **no** Vulkan or OpenGL runtime value; those land in `Other`.

### 1.8 Known limitations

| Limitation | Detail |
| --- | --- |
| **OpenGL / Vulkan** | Report `Runtime = Other`. "Less instrumentation in the frame presentation process. As a result, *CPUFramePacingStall* will always report 0 and *CPUFrameTime* may be slightly less accurate. This inaccuracy also impacts latency calculations based off of *CPUFrameTime* (e.g., *GPUBeginLatency*, *GPUEndLatency*, and *DisplayLatency* but not *InputLatency*)." ([README](https://github.com/GameTechDev/PresentMon/blob/main/README.md)) Display-side metrics (`DISPLAYED_FRAME_TIME`, dropped frames, `PresentMode`) remain valid because they come from DxgKrnl/DWM. |
| **HW-Accelerated GPU Scheduling (HAGS)** | "*msUntilRenderStart*, *msUntilRenderComplete*, *msGPUActive*, and *msGPUVideoActive* measurements may be later/larger than they should be... ~0.5ms larger than the true GPU work duration". HAGS is on by default on many modern configs — **do not present GPU-busy as exact**. "An improved solution is WIP." |
| **UWP** | Explicitly supported: "works ... for both desktop and UWP applications" ([README](https://github.com/GameTechDev/PresentMon/blob/main/README.md)). |
| **Anti-cheat** | Some titles actively block ETW trace gathering. v2.5.0 release notes: *"Anticheat Mitigation: Above changes enable PresentMon to gather data from certain titles that otherwise block ETW trace gathering."* ([v2.5.0](https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.0)) So: **failure to collect is a real, expected outcome on protected titles.** Whether merely *running* an ETW consumer risks a ban/flag: **`[UNVERIFIED]`** — no primary statement found from Intel, EAC, BattlEye, or Riot. Mitigating context: PresentMon does **not** inject, hook, or open a handle to the game process for frame data; it reads OS-level ETW. RTSS/CapFrameX/FrameView/OCAT all ship on the same engine. |
| **Windows 7** | Force-killing PresentMon may destabilise the system; use Ctrl+C. Irrelevant for a .NET 8 target. |
| Process naming | Without admin, other-user and short-lived processes show as `<unknown>` and cannot be targeted by name. |

---

## 2. ETW (Event Tracing for Windows)

### 2.1 Providers used for present/frame data

GUIDs read directly from [`PresentData/ETW/*.h`](https://github.com/GameTechDev/PresentMon/tree/main/PresentData/ETW) (`__declspec(uuid(...))`). Microsoft does not publish manifests for most of these on learn.microsoft.com — treat these as *observed-in-source*, authoritative for interop but not officially documented.

| Provider | GUID | Used for |
| --- | --- | --- |
| `Microsoft-Windows-DXGI` | `{CA11C036-0102-4A2D-A6AD-F03CFED5D3C9}` | `Present_Start/Stop`, `PresentMultiplaneOverlay_Start/Stop`, (`SwapChain_Start`, `ResizeBuffers_Start` for hybrid presents) |
| `Microsoft-Windows-D3D9` | `{783ACA0A-790E-4D7F-8451-AA850511C6B9}` | `Present_Start/Stop` |
| `Microsoft-Windows-DxgKrnl` | `{802EC45A-1E99-4B83-9920-87C98277BA9D}` | The core: Blit, Flip, IndependentFlip, FlipMultiPlaneOverlay, MMIOFlip(+MPO), VSyncDPC / VSyncDPCMultiPlane, HSyncDPCMultiPlane, QueuePacket Start/Stop, DmaPacket, Context/Device/HwQueue Start+DCStart, PresentHistory |
| `Microsoft-Windows-DxgKrnl` (Win7 classic) | `{65cd4c8a-0848-4583-92a0-31c0fbaf00c0}` (+ per-event MOF GUIDs: BLT `{069f67f2-…}`, FLIP `{22412531-…}`, PRESENTHISTORY `{c19f763a-…}`, QUEUEPACKET `{295e0d8e-…}`, VSYNCDPC `{5ccf1378-…}`, MMIOFLIP `{547820fe-…}`) | Legacy path only |
| `Microsoft-Windows-Dwm-Core` | `{9E9BBA3C-2E38-40CB-99F4-9E8281425164}` | Composition/scheduling: `SCHEDULE_PRESENT_Start`, `SCHEDULE_SURFACEUPDATE_Info`, `FlipChain_Pending/Complete/Dirty`, `GetPresentHistory`. Only enabled when tracking display. |
| `Microsoft-Windows-Dwm-Core` (Win7) | `{8c9dd1ad-e6e5-4b07-b455-684a9d879900}` | Legacy |
| `Microsoft-Windows-Win32k` | `{8C416C79-D49B-4F01-A467-E56D3AA8234C}` | Display: `TokenCompositionSurfaceObject_Info`, `TokenStateChanged_Info`. Input: `InputDeviceRead_Stop`, `RetrieveInputMessage_Info`, `OnInputXformUpdate_Info` — **this is the click-to-photon source.** |
| `Microsoft-Windows-Kernel-Process` | `{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}` | ProcessStart/Stop/Rundown for name resolution. PresentMon **tolerates `ERROR_ACCESS_DENIED`** here and degrades gracefully; all other providers are hard failures. |
| `Microsoft-Windows-Direct3D12` | `{5D8087DD-3A9B-4F56-90DF-49196CDC4F11}` | `CreatePipelineStateObject_Start/Stop` → PSO-compile stutter attribution |
| `Microsoft-Windows-EventMetadata` | `{bbccf6c1-6cd1-48C4-80ff-839482e37671}` | Manifest rundown for ETL decoding |
| `Intel-PresentMon` | `{ECAA4712-4644-442F-B94C-A32F6CF8A499}` | Opt-in app/driver instrumentation: FrameType, AppSimulationStart/End, AppRenderSubmit, AppSleep, MeasuredInput/ScreenChange |
| NVIDIA Display Driver | `{AE4F8626-8265-40D1-A70B-11B64240E8E9}` | `FlipRequest` |
| NVIDIA PCL | `{0D216F06-82A6-4D49-BC4F-8F38AE56EFAB}` | PC Latency |
| `NT Process` (classic) | `{3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c}` | ETL-only process rundown |

PresentMon's realtime session config ([`PresentMonTraceSession.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/PresentData/PresentMonTraceSession.cpp)): `EVENT_TRACE_REAL_TIME_MODE`, `BufferSize = 64` KB, `MinimumBuffers = 256`, `MaximumBuffers = 1024` ⇒ **16–64 MB buffer pool per session**. Consumer opens with `PROCESS_TRACE_MODE_EVENT_RECORD | PROCESS_TRACE_MODE_RAW_TIMESTAMP | PROCESS_TRACE_MODE_REAL_TIME`. Providers are enabled with **event-ID filtering** (`EnableTraceEx2` + `EVENT_FILTER_TYPE_EVENT_ID`) — critical, because unfiltered DxgKrnl is a firehose.

### 2.2 Hard constraints

| Constraint | Source |
| --- | --- |
| **Max ~64 concurrent trace sessions** system-wide. Tunable via `HKLM\SYSTEM\CurrentControlSet\Control\WMI@EtwMaxLoggers` (32–256, reboot required, "must not be automatically modified by a program"). Fixed 64 before Win10 1709. Exceeding ⇒ `ERROR_NO_SYSTEM_RESOURCES`. | [StartTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew) |
| **Max 8 system loggers** (`EVENT_TRACE_SYSTEM_LOGGER_MODE`). Not relevant — PresentMon uses none. | same |
| **A manifest-based provider can be enabled by at most 8 sessions simultaneously.** DXGI/DxgKrnl/Dwm-Core/Win32k are manifest-based, so PresentMon + RTSS + FrameView + CapFrameX + you all contend for those 8 slots. Classic (MOF) providers allow only **one** session — the second silently steals it from the first. | [About Event Tracing](https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing), [Configuring and Starting a Session](https://learn.microsoft.com/en-us/windows/win32/etw/configuring-and-starting-an-event-tracing-session) |
| **A consumer can process events from only ONE realtime session** per `ProcessTrace` call (multiple *log files* are allowed). One blocking thread per session. | [Consuming Events](https://learn.microsoft.com/en-us/windows/win32/etw/consuming-events) |
| **Starting a session**: "Only users with administrative privileges, users in the **Performance Log Users** group, and services running as LocalSystem, LocalService, NetworkService can control event tracing sessions." Else `ERROR_ACCESS_DENIED`. | [StartTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew) |
| **Consuming realtime**: identical requirement — "Only users with administrative privileges, users in the Performance Log Users group, and services running as LocalSystem, LocalService, NetworkService can consume events in real time." | [OpenTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-opentracew) |
| Session names must be **unique and descriptive**; MS explicitly says do not append random digits, and clean up your own orphaned session rather than starting a second. PresentMon exposes `--session_name`, `--stop_existing_session`, `--terminate_existing_session` for exactly this. | [StartTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew) |
| MS guidance, verbatim: *"Cross-process event tracing sessions are a limited system resource. Developers should avoid starting event tracing sessions on customer machines."* | same |

**"Performance Log Users" is a real deployment cost.** Group membership is not granted by installing your app; it needs an admin action and **a sign-out/sign-in to take effect** (per PresentMon's README steps). `SeSystemProfilePrivilege` is required for *system/kernel* loggers, not for the manifest providers listed above — none of PresentMon's providers need it. `[UNVERIFIED]` that no path in the PresentMon provider set requires it on any SKU.

### 2.3 Lost-event accounting

Query the live session with `ControlTrace(EVENT_TRACE_CONTROL_QUERY)` and read from `EVENT_TRACE_PROPERTIES`. PresentMon's exact accounting ([`PresentMonTraceSession.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/PresentData/PresentMonTraceSession.cpp)):

```
mNumEventsLost  = sessionProps.EventsLost;
mNumBuffersLost = sessionProps.LogBuffersLost + sessionProps.RealTimeBuffersLost;
```

and it surfaces a full health line ([`PresentMon/MainThread.cpp`](https://github.com/GameTechDev/PresentMon/blob/main/PresentMon/MainThread.cpp)):

```
[ETW Status] BufferFillPct=%.1f%% BuffersInUse=%lu TotalBuffers=%lu
             EventsLost=%lu BuffersLost=%lu, OverflowedPresents=%lu
```

Second channel: the `BufferCallback` (`PEVENT_TRACE_BUFFER_CALLBACK`) "Receives and processes summary information about the current buffer, such as events lost" ([Consuming Events](https://learn.microsoft.com/en-us/windows/win32/etw/consuming-events)). Note PresentMon installs `BufferCallback` **only for ETL playback**, not for realtime — it polls `ControlTrace` instead.

**Copy this design.** Any FrameDoctor measurement must carry a validity flag derived from `EventsLost/BuffersLost/BufferFillPct`, or you will silently report fake stutter caused by your own dropped events. Documented loss causes ([About Event Tracing](https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing)): event > 64 KB; buffer smaller than the event; **"the real-time consumer is not consuming events fast enough"**; disk too slow (file mode).

### 2.4 Overhead

There is **no published Microsoft number** for the cost of realtime ETW consumption at gaming event rates. Any specific ms/% figure would be `[UNVERIFIED]`. What *is* documented and actionable:

- MS's own guidance is to minimise session count, scope, memory, and to "use strict event filters so you do not collect unnecessary events" ([StartTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew)).
- "For performance reasons, real-time processing is not recommended prior to Windows Vista" — i.e. it is a supported steady-state mechanism on modern Windows ([Consuming Events](https://learn.microsoft.com/en-us/windows/win32/etw/consuming-events)).
- Empirical bound from PresentMon's own choices: 16–64 MB of buffers, event-ID-filtered enables, and an ETW flush period floor of **8 ms** (`PM_ETW_FLUSH_PERIOD_MIN`) — that floor is also your **minimum end-to-end data latency** through the service.
- The cost is dominated by (a) event volume, hence filtering, and (b) whether your consumer keeps up; falling behind converts overhead into *lost events*, which is a correctness bug, not just a perf one.

### 2.5 TraceEvent (`Microsoft.Diagnostics.Tracing.TraceEvent`)

| Item | Value |
| --- | --- |
| Latest version | **3.2.6**, published **2026-08-19** ([nuget.org](https://www.nuget.org/packages/Microsoft.Diagnostics.Tracing.TraceEvent)) |
| Maintained? | **Yes, actively** — 7 releases in the last 5 months (3.2.0 → 3.2.6, 2026-03-31 → 2026-08-19). Part of [microsoft/perfview](https://github.com/microsoft/perfview). |
| .NET 8? | Yes. Targets **netstandard2.0**, listed compatible with .NET 5.0–10.0, .NET Framework 4.6.1+. |
| License | MIT |
| Downloads | 116.5M total |

What it buys you over raw P/Invoke: `TraceEventSession` (start/stop/enable/dispose, orphan cleanup, `EnableProvider(Guid, level, keywords)` for arbitrary providers), `ETWTraceEventSource` (the `ProcessTrace` pump), and — the big one — **`RegisteredTraceEventParser`, which decodes any provider registered with the OS via TDH**, so DXGI/DxgKrnl/Dwm-Core/Win32k events come back as named, typed payloads without you writing struct layouts per event per OS build ([TraceEvent Programmers Guide](https://github.com/microsoft/perfview/blob/main/documentation/TraceEvent/TraceEventProgrammersGuide.md)). It does **not** give you PresentMon's present-reconstruction state machine — that is thousands of lines of `PresentMonTraceConsumer.cpp` correlating DXGI→DxgKrnl→DWM→VSync across present modes and OS versions.

Note: the guide states enabling ETW providers "requires administrative privileges" — this is the common phrasing but the precise rule is the `StartTrace`/`OpenTrace` one above (admin **or** Performance Log Users).

---

## 3. Integration options for a .NET 8 app

| | (a) Bundle + shell out to CLI | (b) PresentMon Service via SDK | (c) Own ETW consumer (TraceEvent) | (d) `PresentMonFps` NuGet |
| --- | --- | --- | --- | --- |
| **Mechanism** | Spawn `PresentMon-x64.exe --output_stdout --qpc_time`, parse CSV | P/Invoke `PresentMonAPI2.dll`; `pmRegisterFrameQuery` + `pmConsumeFrames` | `TraceEventSession` → own session → decode DxgKrnl/DXGI/DWM → reimplement present correlation | Managed wrapper over TraceEvent ([nuget](https://www.nuget.org/packages/PresentMonFps)) |
| **Privilege** | Perf Log Users **or admin** in *your* process (child inherits token) | **None — unelevated works.** Pipe+NSM are ACL'd to Authenticated Users. Admin needed once, at service install. | Perf Log Users or admin, **in your process** | Admin (per package docs) |
| **ETW sessions consumed** | 1 per CLI instance you spawn | 0 (service owns it; shared across all clients) | 1 | 1 |
| **Licensing** | MIT, redistribute freely, no CEF | MIT; you redistribute a **service installer**, and must load *its* `PresentMonAPI2.dll`, not your own | MIT (TraceEvent) — no PresentMon code at all | MIT + TraceEvent MIT |
| **Robustness** | Good. Process isolation: a crash/hang can't take down your app. Weak points: CSV schema drift across versions (`--v1_metrics`/`--v2_metrics` help pin it), stdout backpressure, orphaned child on kill. | Best data fidelity + version-negotiated API + graceful degradation. Weak points: service must be installed & running; `PM_STATUS_MIDDLEWARE_SERVICE_MISMATCH` on version skew; v2.5.0's withdrawal shows the shared service **can conflict with other vendors' installs**. | You inherit every present-mode/OS-version edge case PresentMon has fixed since 2017. Realistically 6–12 months to match, and it silently mis-measures until then. | Only gives FPS. No frame times, no pacing, no dropped frames, no present mode. |
| **Overhead** | 1 extra process + 1 ETW session + CSV serialize/parse round-trip | Lowest marginal cost (session shared); latency floor ≈ `pmSetEtwFlushPeriod`, min 8 ms | 1 session; you control filters | 1 session |
| **Testability / isolation** | **Easiest.** `IFrameSource` over a line reader; feed recorded CSV fixtures. Zero native interop in tests. | Easy-ish. `IFrameSource` over a thin `IPresentMonApi` P/Invoke seam; fake the seam. Needs Windows + service for integration tests. | Hardest. ETW is unmockable below the parser; you'd fake at your own event layer. | Easy, but the interface is nearly empty. |
| **Verdict** | **Ship this first** | **Ship this second** | Do not build | Reject |

**(d) also includes** replaying `.etl` files: `PresentMon --etl_file path`, or `pmStartEtlLogging`/`pmFinishEtlLogging` through the SDK, plus `pmStartPlaybackTracking` for paced replay. **Use this for your test corpus** — capture ETLs from real problem sessions once, then replay them deterministically in CI on a Windows runner. This is the highest-value testing lever available and it works with both (a) and (b).

---

## 4. Recommended approach and why

1. **Define `IFrameSource` now** — an async stream of a `FrameSample` record (QPC start, CPU busy/wait, GPU latency/busy/time, display latency, displayed time, animation error, dropped flag, present mode, runtime, frame type) plus a `TelemetryHealth` struct (events lost, buffers lost, buffer fill %, source degradation flags). Every option below is a driver behind this one interface. Do this before writing any interop.

2. **v1: bundle the PresentMon console app (`--output_stdout`, `--qpc_time`).** MIT lets you ship it, it needs no installer, no service, no CEF, and it isolates all native risk in a child process. Pin the metric vocabulary explicitly with `--v2_metrics` or the default set and write a schema-version check on the header row. Prefer `--terminate_on_proc_exit` and always pass an explicit `--session_name` (e.g. `FrameDoctor`) with `--stop_existing_session` so you cannot orphan sessions or collide with RTSS/CapFrameX.

3. **v2: add a `PresentMonServiceSource` behind the same interface.** The decisive advantage is §1.4: **an unelevated client can consume the service's data.** That converts your privilege story from "ask every user to join Performance Log Users and sign out" to "one admin prompt at install". The blob/offset ABI is genuinely easy to P/Invoke. Gate it on `pmGetApiVersion` and fall back to the CLI source on any `PM_STATUS_MIDDLEWARE_*` / `PM_STATUS_SERVICE_ERROR`. Treat the v2.5.0 withdrawal as a warning: detect a pre-existing, different-version PresentMon service and degrade rather than overwrite it.

4. **Do not write your own ETW present-reconstruction consumer.** TraceEvent solves decoding, which is the easy half; the hard half is correlating DXGI → DxgKrnl → DWM → VSync-DPC across seven present modes, HAGS, MPO, flip-model, frame generation, and Win11 keyword changes. That is what PresentData *is*, and it is MIT-licensed.

5. **Frame-time semantics to hard-code into the product**: display "frame time" as `CPU_FRAME_TIME` (FrameTime-App), report perceived smoothness from `DISPLAYED_FRAME_TIME` + dropped frames, and drive the stutter detector primarily from `MsAnimationError`. Always annotate GPU-busy figures as approximate when HAGS is on.

6. **Surface telemetry health in the UI.** If `EventsLost > 0` or `BufferFillPct` is high, mark the capture degraded. Also detect `Runtime = Other` (OpenGL/Vulkan) and suppress the CPU-pacing-derived metrics, per §1.8.

---

## 5. Open questions requiring a Windows machine

1. **Does an unelevated, non-Performance-Log-Users account really get full data from the PresentMon service?** The SDDL says yes; measure it end to end (fresh standard user, service installed, `pmConsumeFrames` returning frames).
2. **What service account does the MSI create, and with what start type?** Not expressed in the WiX source (custom action). Needed to write the installer story and to know whether the service idles at zero cost.
3. **Actual CPU cost** of (a) the service with one frame-query client and (b) a standalone CLI, at 240 Hz with `--track_gpu`/`--track_input` on, measured against a controlled workload. Also measure the effect of `pmSetEtwFlushPeriod` from 8 ms to 100 ms on both CPU and end-to-end latency.
4. **How many ETW sessions and DXGI/DxgKrnl enable-slots are already in use on a typical gamer's machine?** (`logman query -ets`; count sessions and check the 8-per-manifest-provider headroom with RTSS/GeForce Experience/Game Bar/Discord running.)
5. **Anti-cheat reality check.** Run the CLI and the service against EAC, BattlEye, and Vanguard titles: does collection succeed, silently return nothing, or produce a warning from the AC? Is the outcome different for the CLI (own session) vs the service (pre-existing session)? This is a *product-viability* question, not a nice-to-have.
6. **Is `PM_METRIC_PSO_COMPILE_*` present in the v2.5.1 binary** or only on `main`? If only `main`, decide whether to build from source (BUILDING.md + vcpkg) or wait for 2.6.0.
7. **CSV schema stability** across v2.3.1 / v2.4.1 / v2.5.1 for the default column set — determines how defensive the parser in option (a) must be.
8. **Behaviour when a second PresentMon-family tool is already running** (CapFrameX, FrameView, RTSS): session-name collision, provider-slot exhaustion, or clean coexistence?

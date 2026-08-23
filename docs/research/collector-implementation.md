# Windows collector implementation reference

Research date: **2026-08-23**. Target: FrameDoctor Engine, `net10.0-windows`, x64, unelevated.
Implements ADR 0002 (PresentMon CLI first behind `IFrameSource`; Tier 0 = PDH + NVML/ADLX/IGCL).

This file exists so that each collector can be written **without further research**. Where an
exact string, signature or layout could not be confirmed from a primary source, it says so and
a row is added to `docs/WINDOWS-VALIDATION.md`.

## Evidence tags

| Tag | Meaning |
|---|---|
| `[verified]` | I read the header, generated binding or source file **this session**. The file and line are cited. |
| `[documented]` | Primary vendor documentation, **with URL**. A `[documented]` claim without a URL is a `[unverified]` claim. |
| `[unverified]` | Believed true, no primary source read. Never load-bearing without a validation row. |

Sources read this session:

| Artifact | How obtained |
|---|---|
| `GameTechDev/PresentMon` @ tag **`v2.5.1`** (`3e06c7d`) | `git clone --depth 1 --branch v2.5.1` |
| `windows-sys` **0.59.0** crate source (`src/Windows/**`) | crates.io tarball. Generated from Microsoft's official **win32metadata**, so signatures, struct layouts and constant values are the SDK's, not a human's recollection. |
| `nvml-wrapper-sys` **0.9.1** `src/bindings.rs` (bindgen output of NVIDIA `nvml.h`, `NVML_API_VERSION 12`) | crates.io tarball |
| `intel/drivers.gpu.control-library` `include/igcl_api.h` @ `master` | raw.githubusercontent |
| `GPUOpen-LibrariesAndSDKs/ADLX` `SDK/ADLXHelper/Windows/C/ADLXHelper.c` | raw.githubusercontent |
| `LibreHardwareMonitor` `LibreHardwareMonitorLib/Interop/NvidiaML.cs` @ `master` | raw.githubusercontent |

**Rule for every collector in this document:** a metric whose source call returns "not
supported", or whose counter path fails to resolve, emits `Availability.Unavailable` with a
reason. It never emits `0`. See `src/FrameDoctor.Abstractions/Telemetry/Availability.cs:20`.

---

## 0. Corrections to existing repo research

Three claims in `docs/research/frame-telemetry.md` are wrong against the v2.5.1 source, and one
in `docs/research/hardware-telemetry.md` is stale. They are corrected here because a developer
following the old text would write a parser that never matches a real header row.

1. **`docs/research/frame-telemetry.md:86-113` lists the `--v2_metrics` column names as if they
   were the default set.** They are not. In the **default** vocabulary (neither `--v1_metrics`
   nor `--v2_metrics`) the columns are `MsCPUBusy`, `MsCPUWait`, `MsGPUBusy`, `MsAnimationError`,
   `CPUStartTimeInSeconds`/`CPUStartQPC`, `MsBetweenAppStart` — the `Ms` prefix is present and
   the names differ. `FrameTime`, `CPUBusy`, `DisplayLatency`, `DisplayedTime` only appear under
   `--v2_metrics`. `[verified]` `PresentMon/CsvOutput.cpp:541-635`.
2. **`DisplayLatency` and `DisplayedTime` are not emitted at all in the default vocabulary.**
   The row writer emits that pair only inside `if (args.mUseV2Metrics)`.
   `[verified]` `PresentMon/CsvOutput.cpp:1243-1252`. Consequence for our catalog: see §1.3.
3. **`docs/research/frame-telemetry.md:216-223` implies the `[ETW Status]` health line is
   available for free.** It is gated behind a *hidden* flag `--track_etw_status`, and on the
   v2.5.1 default code path that flag adds **no CSV columns** (see §1.5).
4. `docs/research/hardware-telemetry.md:200` cites the Windows Server power-tuning page as
   saying to *"scale processor utilization by `Processor Information\% Processor Performance`"*.
   The **current** revision of that page does not contain that sentence. What it does contain,
   verbatim, is: *"view the Performance Monitor counter **% of maximum frequency** in the
   **Processor** group to see if any frequency caps were applied."* `[documented]`
   <https://learn.microsoft.com/en-us/windows-server/administration/performance-tuning/hardware/power/power-performance-tuning>.
   The effective-clock derivation in §2.7 is therefore `[unverified]` and carries a validation row.

---

## 1. PresentMon CLI output contract

### 1.1 Pinned invocation

ADR 0002 pins:

```
PresentMon-2.5.1-x64.exe --process_id <pid> --output_stdout --qpc_time
                         --session_name FrameDoctor --stop_existing_session
                         --terminate_on_proc_exit --no_track_input
```

Defaults that matter, read from `ParseCommandLine`'s initialiser block
`[verified]` `PresentMon/CommandLine.cpp:384-414`:

| Field | Default | Our flag |
|---|---|---|
| `mSessionName` | `L"PresentMon"` | overridden to `FrameDoctor` |
| `mTrackDisplay` | **`true`** | keep |
| `mTrackInput` | **`true`** | `--no_track_input` turns it **off** — polarity confirmed |
| `mTrackGPU` | **`true`** | keep |
| `mTrackGPUVideo` | `false` | leave |
| `mTrackFrameType` | `false` | consider `--track_frame_type` (see §1.7) |
| `mTrackHybridPresent` | `false` | leave |
| `mTrackAppTiming` | `false` | leave |
| `mTrackPcLatency` | `false` | leave |
| `mUseV1Metrics` / `mUseV2Metrics` | `false` / `false` | **leave both off** — see §1.3 |
| `mWriteFrameId` / `mWriteDisplayTime` | `false` | leave |
| `mTrackEtwStatus` | `false` | see §1.5 |
| `mConsoleOutput` | `Statistics` | forced to `None` by `--output_stdout` |

Two behaviours to know before writing the argument builder, both `[verified]`:

- `--output_stdout` sets `args.mConsoleOutput = ConsoleOutput::None`
  (`PresentMon/CommandLine.cpp:552-560`). The live statistics table is suppressed. It does
  **not** suppress the ETW status line (§1.5).
- `--no_track_display` is **silently ignored** while GPU tracking is on:
  *"warning: ignoring --no_track_display because display tracking is required when GPU tracking
  is enabled."* (`PresentMon/CommandLine.cpp:570-573`). We never pass it anyway.

### 1.2 The exact header row

The v2.5.1 default code path is `WriteCsvHeader<pmon::util::metrics::FrameMetrics>`
`[verified]` `PresentMon/CsvOutput.cpp:521-648`, selected by `OutputThread.cpp:523-530`. The
header is assembled by conditional `fwprintf` calls in this exact order:

```
Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags
  [if mTrackDisplay]        ,AllowsTearing,PresentMode
  [if mTrackFrameType]      ,FrameType
  [if mTrackHybridPresent]  ,HybridPresent
  [if !mUseV2Metrics]
      ,TimeInSeconds | TimeInMs | TimeInQPC | TimeInDateTime      <- one, per --qpc_time etc.
      ,MsBetweenSimulationStart
      ,MsBetweenPresents
      [if mTrackDisplay]    ,MsBetweenDisplayChange
      ,MsInPresentAPI
      ,MsRenderPresentLatency
      [if mTrackDisplay]    ,MsUntilDisplayed
      [if mTrackPcLatency]  ,MsPCLatency
  [if mUseV2Metrics]  ... (see source; we do not use this path)
  [else]
      ,CPUStartTimeInSeconds | CPUStartTimeInMs | CPUStartQPC | CPUStartQPCTimeInMs | CPUStartDateTime
      ,MsBetweenAppStart,MsCPUBusy,MsCPUWait
      [if mTrackGPU]        ,MsGPULatency,MsGPUTime,MsGPUBusy,MsGPUWait
      [if mTrackGPUVideo]   ,MsVideoBusy
      [if mTrackDisplay]    ,MsAnimationError,AnimationTime,MsFlipDelay
      [if mTrackInput]      ,MsAllInputToPhotonLatency,MsClickToPhotonLatency
      [if mTrackAppTiming]  ,MsInstrumentedLatency
  [if mWriteDisplayTime]    ,DisplayTimeAbs
  [if mWriteFrameId]        ,FrameId [,AppFrameId] [,PCLFrameId]
```

**For our pinned invocation** (`--qpc_time`, display on, GPU on, input off, frame type off) the
header row is therefore, verbatim and in order — **26 columns**:

```
Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,TimeInQPC,MsBetweenSimulationStart,MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,MsRenderPresentLatency,MsUntilDisplayed,CPUStartQPC,MsBetweenAppStart,MsCPUBusy,MsCPUWait,MsGPULatency,MsGPUTime,MsGPUBusy,MsGPUWait,MsAnimationError,AnimationTime,MsFlipDelay
```

Types, units and the exact "missing" sentinel, from the row writer
`[verified]` `PresentMon/CsvOutput.cpp:1096-1300`:

| # | Column | Type | Unit | Format | Missing value |
|---|---|---|---|---|---|
| 0 | `Application` | string | — | `%s` module name, or `<unknown>` | — |
| 1 | `ProcessID` | int32 | — | `%d` | — |
| 2 | `SwapChainAddress` | uint64 hex | — | `0x%llX` (**no zero padding** on this code path) | — |
| 3 | `PresentRuntime` | enum string | — | `DXGI` \| `D3D9` \| `Other` | — |
| 4 | `SyncInterval` | int32 | — | `%d`, may be driver-overridden | — |
| 5 | `PresentFlags` | int32 | bitfield | `%d` | — |
| 6 | `AllowsTearing` | int 0/1 | — | `%d` | — |
| 7 | `PresentMode` | enum string | — | see §1.6 | `Other` |
| 8 | `TimeInQPC` | uint64 | **QPC ticks** | `%llu` | — |
| 9 | `MsBetweenSimulationStart` | double | ms | `%.4lf` | `NA` |
| 10 | `MsBetweenPresents` | double | ms | `%.*lf` at `DBL_DIG-1` = **14 significant digits** | — |
| 11 | `MsBetweenDisplayChange` | double | ms | `%.*lf` 14 sig-digits | `NA` when value is exactly `0.0` |
| 12 | `MsInPresentAPI` | double | ms | 14 sig-digits | — |
| 13 | `MsRenderPresentLatency` | double | ms | 14 sig-digits | — |
| 14 | `MsUntilDisplayed` | double | ms | `%.4lf` | `NA` when exactly `0.0` |
| 15 | `CPUStartQPC` | uint64 | **QPC ticks** | `%llu` | — |
| 16 | `MsBetweenAppStart` | double | ms | `%.4lf` | `0` — see the trap below |
| 17 | `MsCPUBusy` | double | ms | `%.4lf` | `0` |
| 18 | `MsCPUWait` | double | ms | `%.4lf` | `0` |
| 19 | `MsGPULatency` | double | ms | `%.4lf` | — |
| 20 | `MsGPUTime` | double | ms | `%.4lf` (`msGPUBusy + msGPUWait`) | — |
| 21 | `MsGPUBusy` | double | ms | `%.4lf` | — |
| 22 | `MsGPUWait` | double | ms | `%.4lf` | — |
| 23 | `MsAnimationError` | double | ms | `%.4lf` | `NA` |
| 24 | `AnimationTime` | double | ms | `%.4lf` | `NA`, **or `0.0000`** — see below |
| 25 | `MsFlipDelay` | double | ms | `%.4lf` | `NA` |

**Trap — columns 16-18 write `0` for missing, not `NA`.** They go through
`WriteMetricOrZero`, which is literally
`fwprintf(fp, L",%.*lf", precision, HasFrameMetricValue(value) ? value : 0)`
`[verified]` `PresentMon/CsvOutput.cpp:15-19` + `:1219-1222`. So a missing app-frame-time,
CPU-busy or CPU-wait arrives as the string `0.0000` and is **indistinguishable from a real
zero**. This is exactly the failure mode invariant 9 forbids us from reproducing. Mitigation:
treat `MsCPUBusy == 0 && MsCPUWait == 0 && MsBetweenAppStart == 0` on a frame with a nonzero
`MsBetweenPresents` as `Unavailable(NotYetSampled)`, and always suppress CPU-pacing metrics
outright when `PresentRuntime == Other` (OpenGL/Vulkan), per the upstream README.

**Trap — column 24 `AnimationTime` has a three-way output.** `NA` if the value is missing *and*
(`msDisplayedTime == 0` or the frame type is generated); otherwise `0.0000` if missing;
otherwise the value. `[verified]` `PresentMon/CsvOutput.cpp:1254-1263`.

**Trap — `MsBetweenDisplayChange` and `MsUntilDisplayed` test `== 0.0` exactly**, not the
missing-value sentinel. `[verified]` `PresentMon/CsvOutput.cpp:1157-1165`, `:1174-1181`.

### 1.3 Column → `MetricId` mapping

Against `src/FrameDoctor.Abstractions/Telemetry/MetricId.cs:19-38`:

| `MetricId` | Column | Conversion |
|---|---|---|
| `FrameTime` (100) | **`MsBetweenAppStart`** | direct, ms. This is PresentMon's `CPU_FRAME_TIME` / "FrameTime-App": frame start → next frame start. It is `msCPUBusy + msCPUWait` in source (`CsvOutput.cpp:1219`). |
| `FrameAnimationError` (111) | `MsAnimationError` | direct, ms. `NA` ⇒ `Unavailable(NoSensor)` — **never 0**. |
| `FrameDisplayedTime` (112) | **`MsBetweenDisplayChange`** | direct, ms. See the note below. |
| `FrameDropped` (113) | **derived** | there is **no `Dropped` column** in the default vocabulary. See below. |
| sample `timestamp` | `CPUStartQPC` | §1.4 |

**`FrameDisplayedTime` from the default vocabulary.** `DisplayedTime` (the `--v2_metrics`
column) does not exist here. `MsBetweenDisplayChange` is defined by the upstream README as
*"How long the previous frame was displayed before this Present() was displayed"* — i.e. the
display-side interval, which is precisely what `docs/architecture/telemetry-model.md:99`
specifies (*"Display-side interval; what the eye actually receives"*). Use it, tag
`Quality.Exact`, and set `Availability.Unavailable(NoSensor)` on `NA`.
Do **not** switch to `--v2_metrics` to get the nominally better-named column: that vocabulary
drops `MsBetweenPresents`, `MsInPresentAPI`, `MsRenderPresentLatency`,
`MsBetweenSimulationStart` and `MsUntilDisplayed` from the row entirely
(`CsvOutput.cpp:541-565`), which costs more than it buys.

**`FrameDropped` has no column and must be derived.** In v1 the CSV had a `Dropped` column
computed as `FinalStateToDroppedString(p.finalState)` → `"0"` for `PresentResult::Presented`,
`"1"` otherwise `[verified]` `PresentMon/CsvOutput.cpp:71-77`. The default/v2 vocabulary
dropped it; upstream's SDK metric is `metrics.isDroppedFrame = !isDisplayed`. The exactly
equivalent CSV-side predicate on our column set is:

```
frameDropped  ==  (MsUntilDisplayed is "NA")           // never reached the screen
```

because the row writer prints `NA` for `MsUntilDisplayed` iff `metrics.msUntilDisplayed == 0.0`
`[verified]` `PresentMon/CsvOutput.cpp:1174-1181`, and a frame that was displayed always has a
nonzero present→screen delta. Emit `FrameDropped` as a `Count` of 1 per dropped frame.
`REQUIRES-WINDOWS-VALIDATION`: confirm against an ETL where drops are known.
Cross-check available for free: on a dropped frame `MsBetweenDisplayChange` is also `NA`.

Not in our catalog but worth carrying on the internal `FrameSample` for the diagnostic engine:
`MsCPUBusy`, `MsGPUBusy`, `MsGPUWait`, `MsGPULatency`, `PresentMode`, `PresentRuntime`,
`AllowsTearing`, `SyncInterval`.

### 1.4 `--qpc_time` semantics and the monotonic session clock

`--qpc_time` sets `TimeUnit::QPC`, which changes two columns to raw counter values:
`fwprintf(fp, L",%llu", metrics.cpuStartQpc)` `[verified]` `PresentMon/CsvOutput.cpp:1201-1203`.

- **Units: raw `QueryPerformanceCounter` ticks**, on the same timebase as our own process's
  `QueryPerformanceCounter`. PresentMon starts its session with
  `sessionProps.Wnode.ClientContext = mTimestampType` where `mTimestampType` defaults to
  `TIMESTAMP_TYPE_QPC = 1`, opens the trace with `PROCESS_TRACE_MODE_RAW_TIMESTAMP`, and takes
  `mTimestampFrequency = traceProps.LogfileHeader.PerfFreq`
  `[verified]` `PresentData/PresentMonTraceSession.cpp:486-560`.
  QPC is documented to be system-wide and consistent across processes
  `[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/profileapi/nf-profileapi-queryperformancecounter>.
- **The tick frequency is ours to read, not PresentMon's to tell us.** Call
  `QueryPerformanceFrequency` once at Engine start; it is fixed at boot.

Conversion into `MonotonicTimestamp` (100 ns ticks, `src/FrameDoctor.Abstractions/Time/MonotonicTimestamp.cs:22`):

```
sessionEpochQpc = QueryPerformanceCounter()   // once, at session start
qpcFreq         = QueryPerformanceFrequency() // once, at process start

delta  = frameQpc - sessionEpochQpc           // long, may be negative for frames that
                                              // started before we spawned the child
ticks  = Math.BigMul(delta, 10_000_000L, out long low) ... // 128-bit multiply then divide
       = (long)((Int128)delta * 10_000_000 / qpcFreq)
```

Use `Int128` (or `Math.BigMul` + `Math.DivRem`), **not** `delta * 10_000_000 / freq` in `long`:
at a 10 MHz QPC, `delta * 10_000_000` overflows `Int64` after ~29 seconds of session time.
Do not use `double`: at 10 MHz, `double` loses sub-100 ns exactness after ~2.5 hours, and the
disk budget's second-difference encoding
(`docs/architecture/performance-budget.md:113-130`) assumes integer round-tripping.

Frames arriving with `frameQpc < sessionEpochQpc` are legitimate — the trace session can be
started before our epoch, or PresentMon may flush a frame that began earlier. Clamp to zero and
count the occurrence rather than dropping the frame silently.

### 1.5 The `[ETW Status]` health line

Format string, verbatim `[verified]` `PresentMon/MainThread.cpp:92-97`:

```c
wprintf(L"[ETW Status] BufferFillPct=%.1f%% BuffersInUse=%lu TotalBuffers=%lu EventsLost=%lu BuffersLost=%lu, OverflowedPresents=%lu\n", ...)
```

A real line therefore looks exactly like:

```
[ETW Status] BufferFillPct=3.5% BuffersInUse=9 TotalBuffers=256 EventsLost=0 BuffersLost=0, OverflowedPresents=0
```

Note the **comma before `OverflowedPresents`** and nowhere else — that is upstream's typo, not
ours, and a naive `split(' ')` parser survives it while a `split(',')` parser does not.

Facts that decide the design, all `[verified]`:

| Fact | Source |
|---|---|
| It is written with `wprintf` ⇒ **stdout**, interleaved with CSV rows | `MainThread.cpp:92` |
| Emitted on a `SetTimer` at `ETW_STATUS_INTERVAL_MS = 1000` ⇒ once per second | `MainThread.cpp:17`, `:411` |
| Only when `--track_etw_status` is passed **and** it is a realtime (non-ETL) session | `MainThread.cpp:408` |
| It is **not** gated on `mConsoleOutput`, so `--output_stdout` and `--no_console_stats` do **not** suppress it | `MainThread.cpp:84-99` |
| `--track_etw_status` is a **hidden** option, not in `PrintUsage` | `CommandLine.cpp:483` (under `// Hidden options:`) |
| **On the v2.5.1 default code path it adds no CSV columns.** `WriteCsvHeader<pmon::util::metrics::FrameMetrics>` and its row writer contain no `mTrackEtwStatus` branch; only the `FrameMetrics1` (`--v1_metrics`) and legacy `FrameMetrics` writers do | header `CsvOutput.cpp:521-648` vs. `:195-202` and `:506-513` |

**Decision: pass `--track_etw_status` and parse the stdout line.** The alternative (per-row
`EtwEventsLost` columns) is unavailable to us without `--v1_metrics`, which would cost the whole
v2 metric set.

Parsing rule for the stdout reader:

```
A line that does not start with a digit and is not the header row is not a CSV row.
If it starts with "[ETW Status] " -> parse health.  Otherwise -> log verbatim, ignore.
```

Field extraction, all from one `ReadOnlySpan<char>` with no allocation:

| Key | Type | Meaning | Source of the value |
|---|---|---|---|
| `BufferFillPct=` … `%` | double | `100.0 * (NumberOfBuffers - FreeBuffers) / NumberOfBuffers` | `PresentMonTraceSession.cpp:695-704` |
| `BuffersInUse=` | uint32 | `NumberOfBuffers - FreeBuffers` | same |
| `TotalBuffers=` | uint32 | `EVENT_TRACE_PROPERTIES.NumberOfBuffers` | same |
| `EventsLost=` | uint32 | `EVENT_TRACE_PROPERTIES.EventsLost` | same |
| `BuffersLost=` | uint32 | `LogBuffersLost + RealTimeBuffersLost` | same |
| `OverflowedPresents=` (note leading `, `) | uint32 | PresentMon's own ring-buffer overflow count, **not** an ETW figure | `mPMConsumer->mNumOverflowedPresents` |

Mapping to `TelemetryHealth` / `Quality`:

- Any monotonic increase in `EventsLost`, `BuffersLost` or `OverflowedPresents` between two
  status lines ⇒ every frame sample in that one-second window is `Quality.Degraded`, and the
  UI says so. A lost DxgKrnl event manufactures a fake stutter; reporting it as real is the
  single most damaging thing this collector can do.
- `BufferFillPct` sustained above ~50 % is a leading indicator, not a fault. Surface it, do not
  degrade on it.
- `OverflowedPresents > 0` also carries an actionable remedy upstream prints at shutdown:
  raise `--set_circular_buffer_size` above the 2048 default (must be a power of two,
  `CommandLine.cpp:518-523`).

### 1.6 `PresentMode` strings

Exact strings from `PresentModeToString` `[verified]` `PresentMon/CsvOutput.cpp:25-36`:

`Hardware: Legacy Flip` · `Hardware: Legacy Copy to front buffer` ·
`Hardware: Independent Flip` · `Composed: Flip` · `Composed: Copy with GPU GDI` ·
`Composed: Copy with CPU GDI` · `Hardware Composed: Independent Flip` · `Other`

Note the mixed capitalisation ("Copy to front buffer") and that the fallback is `Other`, so a
parser must use ordinal string comparison and map anything unknown to `Unknown`, not throw.

`RuntimeToString` `[verified]` `:38-45`: `DXGI` · `D3D9` · `Other`.
`FrameTypeToString` `[verified]` `:52-68` (only present with `--track_frame_type`):
`Application` · `Intel XeSS-FG` · `AMD AFMF` · `Unknown`. In the shipping (non-`DEBUG_FRAME_TYPE`)
build, `NotSet` and `Repeated` both fall through to `Application` — so **generated/repeated
frames are labelled `Application` unless the build defines `DEBUG_FRAME_TYPE`**. Do not build a
frame-generation exclusion on this column without validating it.

### 1.7 Exit codes

Every `return` from `wmain` `[verified]` `PresentMon/MainThread.cpp` and `Privilege.cpp`:

| Code | Meaning | Where |
|---|---|---|
| **0** | Clean shutdown: `WM_QUIT` from Ctrl-C, `--timed` expiry, or **`--terminate_on_proc_exit` firing** | `MainThread.cpp:474`; also `:248` for a successful `--terminate_existing_session` |
| **1** | NVIDIA display-driver manifest failed to load, **or** command-line parse error / `--help` | `:230`, `:239` |
| **2** | `--restart_as_admin` elevation path: the initial value of `DWORD code = 2` returned when `ShellExecuteEx(runas)` fails; otherwise the **elevated child's** exit code is returned | `Privilege.cpp:120-152` |
| **3** | `RegisterClassExW` failed | `:285` |
| **4** | `CreateWindowExW` failed | `:292` |
| **5** | `RegisterHotKey` failed (we never pass `--hotkey`) | `:300` |
| **6** | **Session start failed** — either `ERROR_ALREADY_EXISTS` without `--stop_existing_session`, or any other `StartTraceW`/`EnableTraceEx2`/`OpenTraceW` failure | `:352`, `:382` |
| **7** | `--terminate_existing_session` failed | `:252` |

`PrintError` and `PrintWarning` both write to **stderr** via `vfwprintf(stderr, …)`
`[verified]` `PresentMon/Console.cpp:340`, `:352-368`. They also call
`SetConsoleTextAttribute` on `STD_ERROR_HANDLE`; when stderr is a pipe that call fails
harmlessly and the text is unchanged, so a redirected stderr is clean.

**Exact stderr text for the four cases asked about**, all `[verified]`:

*Not in Performance Log Users* — `StartTraceW` returns `ERROR_ACCESS_DENIED` (5); exit 6:
```
error: failed to start trace session: access denied.
       PresentMon requires either administrative privileges or to be run by a user in the
       "Performance Log Users" user group.  View the readme for more details.
```
The second paragraph is printed only if `InPerfLogUsersGroup()` is false — i.e. an
access-denied *with* group membership prints only the first line, which is a different
diagnosis (`MainThread.cpp:369-376`; the membership check is `CheckTokenMembership` against
`S-1-5-32-559`, `Privilege.cpp:8-25`).

*Provider slots exhausted* — `EnableTraceEx2` returns `ERROR_NO_SYSTEM_RESOURCES` (1450), which
`PMTraceSession::Start` propagates after calling `Stop()` (`PresentMonTraceSession.cpp:504-510`);
it hits the `default:` arm; exit 6:
```
error: failed to start trace session: error code 1450.
```
There is **no distinguishing text**. Map `1450` from this exact string to
`UnavailableReason.EtwProviderSlotsExhausted`
(`src/FrameDoctor.Abstractions/Telemetry/Availability.cs:78`). ADR 0002 requires a pre-flight
`EnumerateTraceGuidsEx` check so this is explained rather than mysterious.

*Session name collision* — exit 6:
```
error: a trace session named "FrameDoctor" is already running. Use --stop_existing_session
       to stop the existing session, or use --session_name with a different name to
       start a new session.
```
With `--stop_existing_session` (which we pass) this becomes a **warning** and the session is
restarted:
```
warning: a trace session named "FrameDoctor" is already running and it will be stopped.
         Use --session_name with a different name to start a new session.
```

*Always printed unelevated, harmless* — emitted when `EnableDebugPrivilege()` fails
(`MainThread.cpp:272-277`). Expect it on every normal run and do not treat it as an error:
```
warning: PresentMon requires elevated privilege in order to query processes that are
         short-running or started on another account.  Without it, those processes will
         be listed as '<unknown>' and they can't be targeted by --process_name nor trigger
         --terminate_on_proc_exit.
```

*Target process exited* — no stderr output at all. `HandleTerminatedProcess` decrements
`gTargetProcessCount`; at zero with `--terminate_on_proc_exit` it calls `ExitMainThread()`
which posts `WM_QUIT` ⇒ **exit code 0** `[verified]` `PresentMon/OutputThread.cpp:146-161`,
`MainThread.cpp:215-218`. Possible trailing warnings on shutdown, in order
(`MainThread.cpp:456-467`): `warning: N ETW buffers were lost.`,
`warning: N ETW events were lost.`, `warning: N overflowed present events detected. …`.

### 1.8 Target-process exit vs. PresentMon crash

| Observation | Verdict |
|---|---|
| stdout reaches EOF **and** `ExitCode == 0` **and** the game PID is gone | Target exited normally. Finalize the session. |
| stdout EOF, `ExitCode == 0`, game PID still alive | PresentMon exited for another reason (Ctrl-C-equivalent, `--timed`). Treat as source fault; **do not** silently restart in a loop. |
| stdout EOF, `ExitCode ∈ {3,4,5,6,7}` | Startup/session fault. Map per §1.7 and render `Unavailable`. |
| `ExitCode == 1` | Bad arguments or manifest failure. This is our bug; log loudly. |
| Process terminated by an unhandled exception | Windows returns the exception code as the exit code, e.g. `0xC0000005`. Any exit code `≥ 0xC0000000` ⇒ crash. |
| No CSV rows and no EOF for > 10 s while the game is presenting | Anti-cheat blocking, or provider enabled but events filtered. `Unavailable(TargetProcessProtected)` after a bounded timeout; **never** an empty-but-healthy chart. |

The **authoritative** exit signal is the game PID, not PresentMon: we already hold a
`PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE` handle for game detection (§5), so wait on it
directly and treat PresentMon's exit as corroboration. PresentMon's own detection depends on
`Microsoft-Windows-Kernel-Process` `ProcessStop` events, and that provider's enable is the one
whose `ERROR_ACCESS_DENIED` PresentMon deliberately tolerates
(`PresentData/PresentMonTraceSession.cpp:806-808`) — so on a locked-down machine
`--terminate_on_proc_exit` may simply never fire.

### 1.9 Overhead

| Item | Budget | Basis |
|---|---|---|
| PresentMon child process CPU | **≤ 60 core-ms/s** of the 120 | half the monitoring budget, because it owns the ETW consumer thread. **NOT MEASURED** — `docs/architecture/performance-budget.md:259-272` notes the ETW logger thread's kernel CPU is attributed to the session, not to any process, so even this number is a lower bound. |
| CSV parse in the Engine | **≤ 3 core-ms/s** at 1000 fps | 26 columns × `Utf8Parser`/`double.TryParse` over spans, zero per-row allocation, pooled `FrameSample[]` batches |
| stdout transport | 59.5 KB/s at 240 fps, 248 KB/s at 1000 fps | `performance-budget.md:225` |
| ETW kernel non-paged pool | 16 MB floor, 64 MB ceiling, **not tunable by us** | `BufferSize = 64` KB, `MinimumBuffers = 256`, `MaximumBuffers = 1024` `[verified]` `PresentData/PresentMonTraceSession.cpp:492-494` |
| Child working set | ≤ 40 MB | `performance-budget.md:75`, unmeasured |

Self-limiting guard: if the reader thread's stdout dequeue falls behind such that the child
blocks on `fflush` (it flushes **per row** when `--output_stdout`, `CsvOutput.cpp:1298-1300`),
the pipe backpressures into the ETW consumer and turns into `EventsLost`. The reader must
therefore be a dedicated thread doing nothing but `ReadLine`-into-ring-buffer, with drop-oldest
and a counted drop, per `performance-budget.md:232-235`.

---

## 2. PDH interop

### 2.1 P/Invoke signatures

All signatures below are `[verified]` from `windows-sys` 0.59.0
`src/Windows/Win32/System/Performance/mod.rs`, which is generated from Microsoft's
win32metadata; the prose semantics are `[documented]` from Microsoft Learn (URLs inline).
`PDH_HQUERY` and `PDH_HCOUNTER` are `isize` (`HANDLE`-shaped); every function returns `u32`
(`PDH_STATUS`, `ERROR_SUCCESS == 0`).

```csharp
// Target .NET 10: use [LibraryImport] everywhere. All of these are blittable except the
// string parameters, which are UTF-16 and take StringMarshalling.Utf16.
internal static partial class Pdh
{
    private const string Lib = "pdh.dll";

    // PdhOpenQueryW(szdatasource: PCWSTR, dwuserdata: usize, phquery: *mut isize) -> u32
    [LibraryImport(Lib, StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint PdhOpenQueryW(string? szDataSource, nuint dwUserData, out nint phQuery);

    // PdhAddEnglishCounterW(hquery: isize, szfullcounterpath: PCWSTR, dwuserdata: usize,
    //                       phcounter: *mut isize) -> u32
    [LibraryImport(Lib, StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint PdhAddEnglishCounterW(nint hQuery, string szFullCounterPath,
                                                      nuint dwUserData, out nint phCounter);

    // PdhAddCounterW(hquery: isize, szfullcounterpath: PCWSTR, dwuserdata: usize,
    //                phcounter: *mut isize) -> u32
    [LibraryImport(Lib, StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint PdhAddCounterW(nint hQuery, string szFullCounterPath,
                                               nuint dwUserData, out nint phCounter);

    // PdhCollectQueryData(hquery: isize) -> u32
    [LibraryImport(Lib)]
    internal static partial uint PdhCollectQueryData(nint hQuery);

    // PdhCollectQueryDataWithTime(hquery: isize, plltimestamp: *mut i64) -> u32
    [LibraryImport(Lib)]
    internal static partial uint PdhCollectQueryDataWithTime(nint hQuery, out long pllTimeStamp);

    // PdhGetFormattedCounterValue(hcounter: isize, dwformat: PDH_FMT, lpdwtype: *mut u32,
    //                             pvalue: *mut PDH_FMT_COUNTERVALUE) -> u32
    [LibraryImport(Lib)]
    internal static unsafe partial uint PdhGetFormattedCounterValue(nint hCounter, uint dwFormat,
                                                                   uint* lpdwType,
                                                                   out PDH_FMT_COUNTERVALUE pValue);

    // PdhGetFormattedCounterArrayW(hcounter: isize, dwformat: PDH_FMT, lpdwbuffersize: *mut u32,
    //                              lpdwitemcount: *mut u32,
    //                              itembuffer: *mut PDH_FMT_COUNTERVALUE_ITEM_W) -> u32
    [LibraryImport(Lib)]
    internal static unsafe partial uint PdhGetFormattedCounterArrayW(nint hCounter, uint dwFormat,
                                                                    ref uint lpdwBufferSize,
                                                                    out uint lpdwItemCount,
                                                                    PDH_FMT_COUNTERVALUE_ITEM_W* itemBuffer);

    // PdhExpandWildCardPathW(szdatasource: PCWSTR, szwildcardpath: PCWSTR,
    //                        mszexpandedpathlist: PWSTR, pcchpathlistlength: *mut u32,
    //                        dwflags: u32) -> u32
    [LibraryImport(Lib, StringMarshalling = StringMarshalling.Utf16)]
    internal static unsafe partial uint PdhExpandWildCardPathW(string? szDataSource,
                                                              string szWildCardPath,
                                                              char* mszExpandedPathList,
                                                              ref uint pcchPathListLength,
                                                              uint dwFlags);

    // PdhGetCounterInfoW(hcounter: isize, bretrieveexplaintext: BOOLEAN /* 1 byte! */,
    //                    pdwbuffersize: *mut u32, lpbuffer: *mut PDH_COUNTER_INFO_W) -> u32
    [LibraryImport(Lib)]
    internal static unsafe partial uint PdhGetCounterInfoW(nint hCounter,
                                                          [MarshalAs(UnmanagedType.U1)] bool bRetrieveExplainText,
                                                          ref uint pdwBufferSize,
                                                          byte* lpBuffer);

    // PdhCloseQuery(hquery: isize) -> u32
    [LibraryImport(Lib)]
    internal static partial uint PdhCloseQuery(nint hQuery);

    // PdhRemoveCounter(hcounter: isize) -> u32
    [LibraryImport(Lib)]
    internal static partial uint PdhRemoveCounter(nint hCounter);
}
```

Marshalling notes that will bite in .NET 10 if ignored:

1. **`PdhGetCounterInfoW`'s second parameter is `BOOLEAN` (1 byte), not `BOOL` (4 bytes).**
   `[verified]` `windows-sys` declares `bretrieveexplaintext : BOOLEAN`. Default `bool`
   marshalling in `LibraryImport` is 4-byte Win32 `BOOL`; you must write
   `[MarshalAs(UnmanagedType.U1)]` or take a `byte`. Getting this wrong corrupts the next
   argument on some ABIs and is silent.
2. `LibraryImport` requires the source-generated marshalling to be blittable. `string`
   parameters need an explicit `StringMarshalling`; there is no `CharSet` in `LibraryImport`.
   Never use `DllImport(..., CharSet = CharSet.Auto)` here — always the explicit `…W` entry
   point, because the `A`/`W` alias is a C preprocessor artefact with no .NET equivalent.
3. `PDH_FMT_COUNTERVALUE` contains a C union ⇒ `[StructLayout(LayoutKind.Explicit)]`. It is
   blittable so `LibraryImport` accepts it by ref.
4. `PdhGetFormattedCounterArrayW` and `PdhExpandWildCardPathW` are **two-call** APIs and must be
   called from `unsafe` code with a rented buffer, not with a managed array parameter, so the
   steady-state path allocates nothing. `[documented]`
   <https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcounterarrayw>
5. `PdhGetCounterInfoW`'s output strings (`szFullPath`, `szObjectName`, …) are pointers **into
   the caller's buffer**. Keep the buffer pinned and alive while reading them; copy out before
   returning it to the pool.
6. `dwUserData` is `DWORD_PTR` ⇒ `nuint`, not `uint`. On x64 a `uint` parameter here shifts the
   subsequent pointer argument.

### 2.2 Structures

```csharp
// PDH_FMT_COUNTERVALUE — 16 bytes on x64 (u32 + 4 pad + 8-byte union).
[StructLayout(LayoutKind.Explicit, Size = 16)]
internal struct PDH_FMT_COUNTERVALUE
{
    [FieldOffset(0)] public uint   CStatus;
    [FieldOffset(8)] public int    longValue;
    [FieldOffset(8)] public double doubleValue;
    [FieldOffset(8)] public long   largeValue;
    [FieldOffset(8)] public nint   AnsiStringValue;   // PSTR
    [FieldOffset(8)] public nint   WideStringValue;   // PWSTR
}

// PDH_FMT_COUNTERVALUE_ITEM_W — 24 bytes on x64.
[StructLayout(LayoutKind.Sequential)]
internal struct PDH_FMT_COUNTERVALUE_ITEM_W
{
    public nint                 szName;    // PWSTR, points INTO the ItemBuffer you supplied
    public PDH_FMT_COUNTERVALUE FmtValue;
}

// PDH_COUNTER_INFO_W. The union member is only needed for szFullPath-adjacent parsing;
// declaring the full union is unnecessary if you read szFullPath and stop.
[StructLayout(LayoutKind.Sequential)]
internal struct PDH_COUNTER_INFO_W_Head
{
    public uint  dwLength;
    public uint  dwType;
    public uint  CVersion;
    public uint  CStatus;
    public int   lScale;
    public int   lDefaultScale;
    public nuint dwUserData;        // DWORD_PTR
    public nuint dwQueryUserData;   // DWORD_PTR
    public nint  szFullPath;        // PWSTR -> into your buffer
    // union { PDH_DATA_ITEM_PATH_ELEMENTS_W; PDH_COUNTER_PATH_ELEMENTS_W;
    //         struct { PWSTR szMachineName, szObjectName, szInstanceName,
    //                  szParentInstance; DWORD dwInstanceIndex; PWSTR szCounterName; } }
    public nint  szMachineName;
    public nint  szObjectName;
    public nint  szInstanceName;
    public nint  szParentInstance;
    public uint  dwInstanceIndex;
    public nint  szCounterName;
    public nint  szExplainText;     // PWSTR
    // ULONG DataBuffer[1] follows
}
```
`[verified]` layouts: `windows-sys` `Performance/mod.rs:605-635` (`PDH_COUNTER_INFO_W`),
`:674-698` (`PDH_FMT_COUNTERVALUE`, `PDH_FMT_COUNTERVALUE_ITEM_W`).

Because `szName` in each array item points into the buffer you supplied, **the array walk is
pointer arithmetic on 24-byte strides**, and the instance names must be decoded before the
buffer is recycled.

### 2.3 Constants

| Constant | Value | Source |
|---|---|---|
| `PDH_FMT_LONG` | `0x00000100` (256) | `[verified]` `Performance/mod.rs:182` |
| `PDH_FMT_DOUBLE` | `0x00000200` (512) | `[verified]` `:180` |
| `PDH_FMT_LARGE` | `0x00000400` (1024) | `[verified]` `:181` |
| `PDH_FMT_NOSCALE` | `0x00001000` | `[unverified]` — described but not valued on Learn, and **not present in win32metadata**. Do not hard-code without checking `pdh.h` on a Windows box. |
| `PDH_FMT_1000` | `0x00002000` | `[unverified]`, same caveat |
| `PDH_FMT_NOCAP100` | `0x00008000` | `[unverified]`, same caveat. **This one is load-bearing** — `% Processor Utility` legitimately exceeds 100 under turbo, and without `NOCAP100` PDH caps it: *"counter values greater than 100 … will not be reset to 100. The default behavior is that counter values are capped at a value of 100."* `[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcountervalue> |
| `PDH_NOEXPANDCOUNTERS` | `1` | `[verified]` `:222` |
| `PDH_NOEXPANDINSTANCES` | `2` | `[verified]` `:223` |
| `PDH_REFRESHCOUNTERS` | `4` | `[verified]` `:247` |
| `PDH_MAX_COUNTER_PATH` | `2048` | `[verified]` `:215` |
| `PDH_MAX_COUNTER_NAME` | `1024` | `[verified]` `:214` |
| `PDH_MORE_DATA` | `0x800007D2` (2147485650) | `[verified]` `:221` |
| `PDH_CSTATUS_NO_INSTANCE` | `0x800007D1` (2147485649) | `[verified]` `:166` |
| `PDH_INVALID_DATA` | `0xC0000BC6` (3221228486) | `[verified]` `:188` |
| `PDH_CSTATUS_INVALID_DATA` | `0xC0000BBA` (3221228474) | `[verified]` `:161` |
| `PDH_CALC_NEGATIVE_VALUE` | `0x800007D8` | `[verified]` `:154` |
| `PDH_CALC_NEGATIVE_DENOMINATOR` | `0x800007D6` | `[verified]` `:152` |

`PDH_CALC_NEGATIVE_*` matter: they are what a counter returns when its raw values went
backwards (instance recycled, counter reset). Map them to `Availability.Failed`, never to a
number.

### 2.4 The three-query design

Reuse **exactly three** `PDH_HQUERY` handles for the whole process lifetime, and call
`PdhCollectQueryData` once per tick per query. Never create a counter per metric per tick.

| Query | Rate | Contents |
|---|---|---|
| **Fast** | 2 Hz (4 Hz on ≥ 8 logical processors) | `Processor Information` counters, explicit per-instance paths |
| **Slow** | 1 Hz | `Memory`, `PhysicalDisk`, `GPU Adapter Memory` |
| **Discovery** | 0.2 Hz | the one wildcard query — `GPU Engine` — plus explicit per-pid `GPU Engine`/`GPU Process Memory` paths once a pid is known |

Rate counters need **two** collects before a value exists: *"you must call PdhCollectQueryData
twice before calling PdhGetFormattedCounterValue"* `[documented]`
<https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcountervalue>.
Until the second collect, every metric in that query is
`Unavailable(NotYetSampled)` — not 0.

### 2.5 Localization: the mandatory sequence

`PdhAddEnglishCounterW` *"provides a language-neutral way to add performance counters"* but
**"if the counter path contains a wildcard character, the non-wildcard portions of the path
will be localized, but wildcards will not be expanded"** `[documented]`
<https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhaddenglishcounterw>.
The documented five-step procedure, which we must follow for every wildcard path:

1. `PdhOpenQueryW`
2. `PdhAddEnglishCounterW(wildcardPath)` → `hCounter`
3. `PdhGetCounterInfoW(hCounter, …)` → read `szFullPath` (localized, still wildcarded)
4. `PdhExpandWildCardPathW(null, localizedPath, …)` → `MULTI_SZ` of concrete localized paths
5. `PdhAddCounterW` on each expanded path

For **non-wildcard** paths, step 2 alone is sufficient and steps 3-5 are skipped. That is why
the steady-state design binds explicit instance paths.

Second trap, same page: *"If a counter instance is specified that does not yet exist,
PdhAddEnglishCounter does not report an error condition. Instead, it returns ERROR_SUCCESS."*
So **`PdhAddEnglishCounterW` succeeding proves nothing about the counter existing.** The only
existence proof is a successful `PdhGetFormattedCounterValue` after two collects. Every path in
§2.6 must therefore be probed at startup and demoted to `Unavailable(NoSensor)` on failure —
which is also what protects us from the `[unverified]` counter-name strings below.

### 2.6 Counter paths per catalog metric

**Honesty note.** Microsoft publishes no normative list of counter *names*; they live in the
`Perflib\009\Counters` registry MULTI_SZ on each machine. Every path string below is
`[unverified]` unless marked otherwise, and none may be hard-coded as an assumption. The
startup probe in §2.5 is not defensive style — it is the only thing that makes this table safe.

| `MetricId` | Counter path | Format flags | Notes |
|---|---|---|---|
| `CpuLoadTotal` (200) | `\Processor Information(_Total)\% Processor Utility` | `PDH_FMT_DOUBLE \| PDH_FMT_NOCAP100` | May exceed 100 under turbo — that is correct, not a bug. If the path fails, fall back to `\Processor Information(_Total)\% Processor Time`, and **change the emitted `SourceId`** so the substitution is visible in stored data (`SourceId.cs:14-25`). |
| `CpuLoadCore` (201) | `\Processor Information(<group>,<cpu>)\% Processor Utility`, `instance = "<group>,<cpu>"` | same | `Processor Information` instance names are `group,cpu` (e.g. `0,0`), unlike the legacy `Processor` object whose instances are bare indices. `[unverified]` — enumerate at startup via step 4 of §2.5 rather than constructing them. |
| `CpuClockEffective` (203) | **derived**, see §2.7 | — | `Quality.Derived` |
| `CpuClock` (202) | `\Processor Information(<inst>)\Processor Frequency` | `PDH_FMT_LONG` | Existing HIGH-severity validation row: may report nominal, not live. Prefer `CallNtPowerInformation` (§2.8). |
| `CpuParked` (210) | `\Processor Information(<inst>)\Parking Status` | `PDH_FMT_LONG` | 1 = parked. `[unverified]` name. |
| `CpuActiveCoreCount` (209) | **derived** | — | See §2.9. There is **no counter for this.** |
| `CpuDpcTime` (207) / `CpuIsrTime` (208) | `\Processor Information(<inst>)\% DPC Time` / `% Interrupt Time` | `PDH_FMT_DOUBLE` | **Use §3 instead** as the primary; keep these only as the cross-check that validates §3's `Reserved1` mapping. |
| `GpuUtilization` (300) | see below | — | **No whole-adapter GPU utilization counter exists.** |
| `ProcessGpuUtilization` (603) | `\GPU Engine(pid_<pid>_luid_<hi>_<lo>_phys_<n>_eng_<n>_engtype_3D)\Utilization Percentage` | `PDH_FMT_DOUBLE` | §2.10 |
| `GpuVramUsed` (303) | `\GPU Adapter Memory(luid_<hi>_<lo>_phys_<n>)\Dedicated Usage` | `PDH_FMT_LARGE` | bytes → MB. Prefer NVML/ADLX/IGCL when the vendor path is live; this is the vendor-neutral fallback. Instance grammar `[unverified]`. |
| `MemoryAvailable` (402) | `\Memory\Available MBytes` | `PDH_FMT_LARGE` | already MB. Prefer `GlobalMemoryStatusEx` (§5) — one call, no PDH. |
| `MemoryCommitted` (403) | `\Memory\Committed Bytes` | `PDH_FMT_LARGE` | Prefer `GetPerformanceInfo` (§5). |
| `MemoryCommitLimit` (404) | `\Memory\Commit Limit` | `PDH_FMT_LARGE` | Prefer `GetPerformanceInfo`. |
| `MemoryHardFaults` (405) | `\Memory\Pages Input/sec` | `PDH_FMT_DOUBLE` | **The one memory counter with diagnostic weight.** Never `Page Faults/sec` — `telemetry-model.md:175`. |
| `DiskActive` (500) | `100 − \PhysicalDisk(<inst>)\% Idle Time` | `PDH_FMT_DOUBLE` | **No `% Active Time` counter exists** on `PhysicalDisk`; Task Manager's "Active time" is this subtraction. `Quality.Derived`. Instance names look like `0 C:` / `1 D: E:`. |
| `DiskRead` (501) | `\PhysicalDisk(<inst>)\Disk Read Bytes/sec` | `PDH_FMT_DOUBLE` | B/s |
| `DiskWrite` (502) | `\PhysicalDisk(<inst>)\Disk Write Bytes/sec` | `PDH_FMT_DOUBLE` | B/s |
| `DiskLatency` (503) | `\PhysicalDisk(<inst>)\Avg. Disk sec/Transfer` | `PDH_FMT_DOUBLE` | **seconds** → ×1000 for ms. Read and Write variants also exist. Includes port-driver queue time `[documented]` <https://learn.microsoft.com/en-us/archive/blogs/askcore/measuring-disk-latency-with-windows-performance-monitor-perfmon> |
| `DiskQueue` (504) | `\PhysicalDisk(<inst>)\Current Disk Queue Length` | `PDH_FMT_LONG` | Meaningless as a stall signal on NVMe. Collect, do not diagnose on. |
| `CpuTemperature` (204) | — | — | **No counter.** Tier 0 = `Unavailable(RequiresSensorDriver)`, per ADR 0002. |
| `CpuPower` (205) | — | — | **No counter.** `Unavailable(RequiresSensorDriver)`. |
| `CpuThrottleState` (206) | `\Thermal Zone Information(<inst>)\Throttle Reasons` | `PDH_FMT_LONG` | ADR 0002 pins Tier 0 to `Unavailable(NoThermalSensor)`. Collect the counter for evidence; **do not** let it produce the word "thermal" for a CPU verdict. |
| `MemoryTotal` (400) / `MemoryUsed` (401) | — | — | Use `GlobalMemoryStatusEx` (§5), not PDH. |

Metrics with **no PDH counter at all**, needing a different API:

| Metric | Correct source |
|---|---|
| `GpuUtilization` (whole adapter) | NVML `nvmlDeviceGetUtilizationRates` / ADLX / IGCL. PDH fallback = **max over engines** of `\GPU Engine(*)\Utilization Percentage`, never the sum, because engines run in parallel — Task Manager *"opted to pick the percentage utilization of the busiest engine as a representative of the overall GPU usage"* `[documented]` <https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/> |
| `CpuActiveCoreCount` | derived, §2.9 |
| `CpuClockEffective` | derived, §2.7 |
| `GpuClockCore` / `GpuClockMemory` / `GpuTemperature` / `GpuPower` / `GpuThrottleReason` / `GpuVramTotal` | vendor APIs only (§4) |
| `CpuTemperature` / `CpuPower` / `GpuTemperatureHotspot` | Tier 2 only |
| `ProcessCpu`, `ProcessWorkingSet`, `ProcessDiskBytes` | §5 process APIs — ADR 0002 explicitly rejects continuous `\Process(*)` polling |

### 2.7 `cpu.clock.effective` derivation

```
effectiveMHz(instance) = baseClockMHz × (%ProcessorPerformance(instance) / 100.0)
```

Requires **two** counters and one constant:

| Input | Where from |
|---|---|
| `\Processor Information(<inst>)\% Processor Performance` | PDH, `PDH_FMT_DOUBLE \| PDH_FMT_NOCAP100` (values > 100 under turbo are correct). `[unverified]` path name. |
| `\Processor Information(<inst>)\% Processor Utility` | PDH, same flags. Needed to gate the derivation: `% Processor Performance` is *"the average performance of the processor while it is executing"*, so it is meaningless at near-zero utility. Below ~5 % utility emit `Unavailable(NotMeaningfulInCurrentState)`. |
| `baseClockMHz` | `CallNtPowerInformation(ProcessorInformation)` → `PROCESSOR_POWER_INFORMATION.MaxMhz` (§2.8). Preferable to `Win32_Processor.MaxClockSpeed` because it is per-logical-processor, needs no WMI, and WMI is not trim-safe. |

Emit with `Quality.Derived`, never `Exact`. The formula is a standard derivation from the two
counter descriptions, **not** a Microsoft-published identity — see §0 correction 4. Validation
row added.

### 2.8 `CallNtPowerInformation` — the better clock source

```csharp
// CallNtPowerInformation(informationlevel: POWER_INFORMATION_LEVEL /* i32 */,
//                        inputbuffer: *const c_void, inputbufferlength: u32,
//                        outputbuffer: *mut c_void, outputbufferlength: u32) -> NTSTATUS
[LibraryImport("powrprof.dll")]
internal static unsafe partial int CallNtPowerInformation(int informationLevel,
                                                          void* inputBuffer, uint inputBufferLength,
                                                          void* outputBuffer, uint outputBufferLength);

internal const int ProcessorInformation = 11;   // POWER_INFORMATION_LEVEL

[StructLayout(LayoutKind.Sequential)]
internal struct PROCESSOR_POWER_INFORMATION   // 24 bytes
{
    public uint Number, MaxMhz, CurrentMhz, MhzLimit, MaxIdleState, CurrentIdleState;
}
```
`[verified]` `windows-sys` `Win32/System/Power/mod.rs:1` (signature), `:538`
(`ProcessorInformation = 11`), `:1177-1184` (struct).

Pass `inputBuffer = null, inputBufferLength = 0`; the output buffer is
`sizeof(PROCESSOR_POWER_INFORMATION) × Environment.ProcessorCount`. `MaxMhz` is the base clock
for §2.7. `CurrentMhz` is a candidate for `CpuClock` — but it is widely reported to return the
nominal value on HWP/PBO parts, which is the same open question as
`\Processor Information(*)\Processor Frequency`. Validation row already open
(`docs/WINDOWS-VALIDATION.md:36`); extended to cover this API.

Cost: one call returns all logical processors. No PDH, no WMI, no allocation beyond a pooled
buffer.

### 2.9 `cpu.active_core_count` derivation

No counter exists. Derive per interval from the §3 snapshot pair, which we already take:

```
activeCores = count of logical processors i where
                  busyFraction(i) = 1 - dIdle(i)/dTotal(i)  >  0.05
              and (parkingStatus(i) == 0 or parking is unavailable)
```

The 5 % floor is a threshold, so this metric is `Quality.Derived`, and the threshold belongs in
one named constant that the detector reads — not scattered in the collector. Its purpose is
narrow and stated in `MetricId.cs:61-67`: it is the confounder channel that separates a normal
all-core boost-bin drop from throttling. If it is ever used as a *display* metric, that is a
misuse.

### 2.10 `\GPU Engine` instance grammar

Believed grammar (`[unverified]`, no Microsoft documentation found — the DirectX devblog
describes the semantics but not the string):

```
pid_<pid>_luid_0x<hi8>_0x<lo8>_phys_<n>_eng_<n>_engtype_<Name>
```
e.g. `pid_10472_luid_0x00000000_0x0000F814_phys_0_eng_0_engtype_3D`

| Field | Meaning |
|---|---|
| `pid_<n>` | owning process id, decimal |
| `luid_0x<hi>_0x<lo>` | adapter LUID, two 8-digit uppercase hex halves; matches `DXGI_ADAPTER_DESC.AdapterLuid` |
| `phys_<n>` | physical GPU within a linked adapter |
| `eng_<n>` | engine ordinal |
| `engtype_<Name>` | engine class |

Engine-type names believed in use: `3D`, `Copy`, `VideoDecode`, `VideoEncode`,
`VideoProcessing`, `Compute`, `Security`, `Other`, `VideoCodec`. `[unverified]`.

**Which matter for us:**

| `engtype` | Use |
|---|---|
| `3D` | **The one that matters.** Sustained non-zero `engtype_3D` attributable to the foreground pid is the primary positive signal in game detection, and is `ProcessGpuUtilization`. |
| `Compute` | Include in the max — a DX12 game may do meaningful work here, and some vendors map graphics queues onto it. |
| `Copy` | Collect for asset-streaming diagnosis; exclude from `ProcessGpuUtilization`. |
| `VideoDecode` / `VideoEncode` / `VideoProcessing` | **Exclude from `ProcessGpuUtilization`.** A capture/streaming overlay lights these up and would fake GPU-bound. Collect separately as evidence for "you are encoding while you play". |
| everything else | ignore |

`ProcessGpuUtilization` = **max** over `{3D, Compute}` engines matching the pid, across all
LUIDs. Never the sum.

`GPU Process Memory` instances use the same `pid_/luid_/phys_` prefix without the engine fields.
Microsoft documents that the per-process dedicated figure over-reports after an app flushes GPU
caches (KB4490156) `[documented]`
<https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value>,
so per-process VRAM is not admissible as evidence.

`[verified]` this session only that no Microsoft page documents the grammar. Two existing
validation rows already cover it (`docs/WINDOWS-VALIDATION.md:52`, `:66`).

### 2.11 Overhead

| Query | Rate | Budget | Guard |
|---|---|---|---|
| Fast (`Processor Information`, ~3 counters × N instances via 3 array counters) | 2 Hz | **≤ 12 core-ms/s** | p95 collect > 5 ms ⇒ halve to 1 Hz, mark `Degraded` |
| Slow (`Memory`, `PhysicalDisk`, `GPU Adapter Memory`) | 1 Hz | **≤ 5 core-ms/s** | same |
| Discovery (`GPU Engine(*)` expansion) | 0.2 Hz | **≤ 8 core-ms/s** amortized, i.e. one expansion ≤ 40 ms every 5 s | if a single expansion exceeds 40 ms, drop to 0.1 Hz and mark process-attribution `Degraded` |
| Bound per-pid `GPU Engine` explicit paths | 1 Hz | ≤ 3 core-ms/s | same |

All four figures are **NOT MEASURED**. The existing CRITICAL validation row
(`docs/WINDOWS-VALIDATION.md:38`) is the one that resolves them. The self-limiting guard in
`performance-budget.md:60-66` is what makes shipping without those measurements defensible:
every `PdhCollectQueryData` is timed and the query demotes itself.

Allocation: three pooled `byte[]` buffers (one per query) sized on first success and reused;
instance-name decoding into a pre-interned dictionary keyed by the UTF-16 span hash, so a
steady-state tick allocates nothing.

---

## 3. `NtQuerySystemInformation` for DPC/ISR

### 3.1 Signature

```csharp
// NtQuerySystemInformation(systeminformationclass: SYSTEM_INFORMATION_CLASS /* i32 */,
//                          systeminformation: *mut c_void, systeminformationlength: u32,
//                          returnlength: *mut u32) -> NTSTATUS /* i32 */
[LibraryImport("ntdll.dll")]
internal static unsafe partial int NtQuerySystemInformation(int systemInformationClass,
                                                            void* systemInformation,
                                                            uint systemInformationLength,
                                                            uint* returnLength);

internal const int SystemProcessorPerformanceInformation = 8;
```
`[verified]` signature and class value: `windows-sys`
`src/Windows/Wdk/System/SystemInformation/mod.rs:1` and `:16`.
`[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation>

Microsoft's own instruction, verbatim: *"If you do use NtQuerySystemInformation, access the
function through run-time dynamic linking. This gives your code an opportunity to respond
gracefully if the function has been changed or removed."* Use `NativeLibrary.TryLoad("ntdll.dll")`
+ `NativeLibrary.TryGetExport` and a function pointer, not a static `[LibraryImport]` — a
missing export must degrade to `Unavailable(NoSensor)`, not crash the Engine.

### 3.2 Structure

```csharp
// Documented layout, verbatim from Learn:
//   LARGE_INTEGER IdleTime; KernelTime; UserTime; Reserved1[2]; ULONG Reserved2;
// Size = 48 bytes on x64 (44 + 4 tail padding to 8-byte alignment).
[StructLayout(LayoutKind.Sequential)]
internal struct SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION
{
    public long IdleTime;        // 100 ns
    public long KernelTime;      // 100 ns, INCLUDES IdleTime
    public long UserTime;        // 100 ns
    public long DpcTime;         // Reserved1[0]  -- see the caveat
    public long InterruptTime;   // Reserved1[1]  -- see the caveat
    public uint InterruptCount;  // Reserved2
    private uint _padding;       // make sizeof == 48 explicit rather than implicit
}
```

- `[verified]` field order and the `Reserved1[2]` / `Reserved2` shape: `windows-sys`
  `Win32/System/WindowsProgramming/mod.rs:1446-1452`, which matches the Learn page exactly.
- `[documented]` semantics of the first three fields, verbatim: *"The **IdleTime** member
  contains the amount of time that the system has been idle, in 100-nanosecond intervals. The
  **KernelTime** member contains the amount of time that the system has spent executing in
  Kernel mode (including all threads in all processes, on all processors)."*
- **`[unverified]`: that `Reserved1[0] == DpcTime` and `Reserved1[1] == InterruptTime`.**
  Microsoft names these `Reserved1` and documents nothing about them. This mapping is
  long-standing folklore-with-good-provenance (Process Hacker's `phnt`, Windows Internals), and
  every tool that reports per-core DPC time without a driver uses it — but I did not read a
  primary source this session and I am not going to pretend otherwise. **Validation row added,
  HIGH.** The mitigation is cheap and belongs in the shipped code, not just in a test: run
  `\Processor Information(_Total)\% DPC Time` alongside for the first 30 s of a session, and if
  the derived value disagrees by more than 2 percentage points, mark `CpuDpcTime` and
  `CpuIsrTime` `Unavailable(NoSensor)` for the whole session. Structure drift then degrades
  loudly instead of producing a confident, wrong "a driver is eating your frame time".
- `[unverified]`: that `KernelTime` includes `DpcTime` and `InterruptTime` (perfmon treats
  `% DPC Time` and `% Interrupt Time` as subsets of `% Privileged Time`). The arithmetic below
  does not depend on it, because DPC/ISR are expressed against total elapsed time, not against
  kernel time.

### 3.3 Call pattern

```csharp
int n = Environment.ProcessorCount;              // see the >64-processor caveat below
int size = 48 * n;
// Buffer is rented once at collector construction and reused. Two of them: prev and cur.
int status = NtQuerySystemInformation(SystemProcessorPerformanceInformation, buf, (uint)size, &returned);
// STATUS_SUCCESS == 0.  STATUS_INFO_LENGTH_MISMATCH == unchecked((int)0xC0000004)
//   -> re-read `returned` and grow.  Do this rather than trusting sizeof × count.
```

Always honour `ReturnLength` rather than assuming `48 × ProcessorCount`: it is the only
structure-size check available, and a future struct growth shows up here first.

**Processor-group caveat.** This class returns one entry per processor *in the caller's
group* on machines with more than 64 logical processors. `[unverified]`. On such machines
(threadripper/xeon workstations do exist among the target audience) either accept
group-0-only coverage and label it, or use `SystemProcessorPerformanceDistribution`. For v1,
detect `GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) > 64` and mark per-core CPU metrics
`Degraded` with the reason. Validation row added, MEDIUM.

### 3.4 The exact arithmetic

Given snapshots `A` (older) and `B` (newer) for logical processor `i`, all values in
100 ns units:

```
dIdle      = B[i].IdleTime      - A[i].IdleTime
dKernel    = B[i].KernelTime    - A[i].KernelTime      // includes idle
dUser      = B[i].UserTime      - A[i].UserTime
dDpc       = B[i].DpcTime       - A[i].DpcTime
dInterrupt = B[i].InterruptTime - A[i].InterruptTime

dTotal     = dKernel + dUser                           // NOT dKernel + dUser + dIdle
dBusy      = dTotal - dIdle

cpu.load.core[i] = 100.0 * dBusy      / dTotal
cpu.dpc.time[i]  = 100.0 * dDpc       / dTotal
cpu.isr.time[i]  = 100.0 * dInterrupt / dTotal
```

`dTotal = dKernel + dUser` **and not** `+ dIdle`, because `KernelTime` already contains
`IdleTime` — this is the single most common error in code that uses this API, and it produces
a load figure that is roughly half the real one on an idle machine and looks plausible.
The same relationship is documented for `GetSystemTimes`: *"lpKernelTime … this time value
also includes the amount of time the system has been idle"* `[documented]`
<https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes>

Totals:

```
cpu.load.total   = 100.0 * Σi dBusy      / Σi dTotal
cpu.dpc.time     = 100.0 * Σi dDpc       / Σi dTotal      // instance = null
cpu.isr.time     = 100.0 * Σi dInterrupt / Σi dTotal
```

Guards, each of which is a real failure mode rather than paranoia:

| Condition | Action |
|---|---|
| `dTotal <= 0` | `Unavailable(NotYetSampled)` on the first tick; `Failed` afterwards |
| any delta `< 0` | counter reset or CPU hot-plug ⇒ discard the pair, re-baseline, emit `Failed` for one tick |
| a clock discontinuity was recorded between A and B (§6) | `Unavailable(ClockDiscontinuity)` — a suspend makes `dTotal` meaningless |
| result `> 100.5` | clamp to 100 **and** log; do not silently clamp without a counter |

Note that this API is the right place to compute per-core load even though PDH also offers it:
one call, no wildcard expansion, no localization, and it is the only Tier 0 source of DPC/ISR.
`% Processor Utility` remains worth having in parallel because it is frequency-scaled and this
API is not.

### 3.5 Overhead

| Item | Budget |
|---|---|
| 2 Hz × 1 call, 48 B × N copy + N-element arithmetic | **≤ 0.5 core-ms/s** on a 32-thread machine. **NOT MEASURED**; expected sub-100 µs per call. |
| Allocation | zero — two pinned buffers rented once |
| On-demand burst around a detected stutter | 2 extra calls 250 ms apart, per ADR 0002's event-driven nomination. ≤ 1 core-ms per event. |

---

## 4. Vendor GPU telemetry

### 4.1 NVML — loading

Load strategy, copied from a shipping implementation `[verified]`
LibreHardwareMonitor `LibreHardwareMonitorLib/Interop/NvidiaML.cs:170-190`:

1. `LoadLibrary("nvml.dll")` — bare name, standard search order. This finds the driver's copy in
   `%SystemRoot%\System32` and lets an installation that provides its own copy win.
2. If that fails, `LoadLibrary(Path.Combine(Environment.ExpandEnvironmentVariables("%ProgramW6432%"), @"NVIDIA Corporation\NVSMI", "nvml.dll"))` — the location used by driver
   versions that stopped copying to System32.
3. If both fail ⇒ every `gpu.*` NVML metric is `Unavailable(NotExposedByVendor)`. Not an error.

Intel's PresentMon service uses a stricter variant worth adopting:
`LoadLibraryExA("nvml.dll", NULL, LOAD_LIBRARY_SEARCH_SYSTEM32)` `[verified]`
`IntelPresentMon/ControlLib/DllModule.h:25` and `NvmlWrapper.h:49`. `LOAD_LIBRARY_SEARCH_SYSTEM32`
removes the DLL-planting surface entirely. **Recommendation: try `LOAD_LIBRARY_SEARCH_SYSTEM32`
first, then the explicit `%ProgramW6432%\NVIDIA Corporation\NVSMI` absolute path, and never a
bare-name search.** We are a consumer app that will be flagged by AV heuristics; loading an
unqualified DLL name is a gift we do not need to give.

`[documented]` NVML *"is downloaded as part of the NVIDIA GPU Driver for Linux and Windows"*
<https://developer.nvidia.com/management-library-nvml>. **Do not redistribute `nvml.dll`.**

**Elevation: none required.** `[unverified]` — NVIDIA documents `NVML_ERROR_NO_PERMISSION` for
*write* operations (setting clocks, persistence mode), and every read used here is a query.
No primary statement that reads are unprivileged was found. Validation row already open for the
adjacent GeForce support matrix (`docs/WINDOWS-VALIDATION.md:  NVML function-by-function`);
extended to cover the unelevated read case.

Resolve every function by `GetProcAddress` and tolerate a null: PresentMon resolves
`nvmlInit_v2` and fails the whole subsystem if it is absent, but resolves the rest
individually `[verified]` `ControlLib/NvmlWrapper.cpp:11-28`.

### 4.2 NVML — signatures

All `[verified]` from `nvml-wrapper-sys` 0.9.1 `src/bindings.rs` (bindgen output of NVIDIA's
`nvml.h` at `NVML_API_VERSION 12`). The **exported symbol name is the versioned one** — this is
the detail that breaks naive P/Invoke, because the unversioned names are C macros in the header
and several are not exported at all on current drivers.

| Purpose | Exported symbol | C signature |
|---|---|---|
| init | `nvmlInit_v2` | `nvmlReturn_t nvmlInit_v2(void)` |
| shutdown | `nvmlShutdown` | `nvmlReturn_t nvmlShutdown(void)` |
| error text | `nvmlErrorString` | `const char* nvmlErrorString(nvmlReturn_t)` |
| device count | `nvmlDeviceGetCount_v2` | `nvmlReturn_t (unsigned int* deviceCount)` |
| device handle | `nvmlDeviceGetHandleByIndex_v2` | `nvmlReturn_t (unsigned int index, nvmlDevice_t* device)` |
| name | `nvmlDeviceGetName` | `nvmlReturn_t (nvmlDevice_t, char* name, unsigned int length)` |
| temperature | `nvmlDeviceGetTemperature` | `nvmlReturn_t (nvmlDevice_t, nvmlTemperatureSensors_t sensorType, unsigned int* temp)` |
| clock | `nvmlDeviceGetClockInfo` | `nvmlReturn_t (nvmlDevice_t, nvmlClockType_t type, unsigned int* clockMHz)` |
| clock (explicit id) | `nvmlDeviceGetClock` | `nvmlReturn_t (nvmlDevice_t, nvmlClockType_t, nvmlClockId_t, unsigned int* clockMHz)` |
| memory | `nvmlDeviceGetMemoryInfo` | `nvmlReturn_t (nvmlDevice_t, nvmlMemory_t* memory)` |
| memory v2 | `nvmlDeviceGetMemoryInfo_v2` | `nvmlReturn_t (nvmlDevice_t, nvmlMemory_v2_t* memory)` |
| power | `nvmlDeviceGetPowerUsage` | `nvmlReturn_t (nvmlDevice_t, unsigned int* power)` — **milliwatts** |
| power limit | `nvmlDeviceGetEnforcedPowerLimit` | `nvmlReturn_t (nvmlDevice_t, unsigned int* limit)` — milliwatts |
| utilization | `nvmlDeviceGetUtilizationRates` | `nvmlReturn_t (nvmlDevice_t, nvmlUtilization_t* utilization)` |
| fan | `nvmlDeviceGetFanSpeed` | `nvmlReturn_t (nvmlDevice_t, unsigned int* speed)` — percent |
| **throttle reasons** | **`nvmlDeviceGetCurrentClocksEventReasons`** | `nvmlReturn_t (nvmlDevice_t, unsigned long long* clocksEventReasons)` |
| driver version | `nvmlSystemGetDriverVersion` | `nvmlReturn_t (char* version, unsigned int length)` |

**Name confirmed:** `nvmlDeviceGetCurrentClocksEventReasons` is the current symbol.
`[verified]` `bindings.rs:2838` (declaration) and `:4984-4985`
(`__library.get(b"nvmlDeviceGetCurrentClocksEventReasons\0")`). The old
`nvmlDeviceGetCurrentClocksThrottleReasons` remains as a deprecated alias. Resolve the new name
first, fall back to the old, and if neither resolves emit
`GpuThrottleReason = Unavailable(NotExposedByVendor)`.

Types and constants, all `[verified]` from `bindings.rs`:

```csharp
// nvmlDevice_t is an opaque pointer -> nint.

[StructLayout(LayoutKind.Sequential)]  // bindings.rs:585-591
internal struct nvmlMemory_t { public ulong total, free, used; }   // BYTES

[StructLayout(LayoutKind.Sequential)]  // bindings.rs:593-601
internal struct nvmlMemory_v2_t { public uint version; public ulong total, reserved, free, used; }

[StructLayout(LayoutKind.Sequential)]  // bindings.rs:579-583
internal struct nvmlUtilization_t { public uint gpu, memory; }     // PERCENT

// nvmlClockType_t                bindings.rs:1030-1034
internal const uint NVML_CLOCK_GRAPHICS = 0, NVML_CLOCK_SM = 1,
                    NVML_CLOCK_MEM = 2, NVML_CLOCK_VIDEO = 3;
// nvmlClockId_t                  bindings.rs:1037-1040
internal const uint NVML_CLOCK_ID_CURRENT = 0;
// nvmlTemperatureSensors_t       bindings.rs:977
internal const uint NVML_TEMPERATURE_GPU = 0;
// Buffer sizes                   bindings.rs:476-479
internal const int NVML_DEVICE_NAME_V2_BUFFER_SIZE = 96,
                   NVML_SYSTEM_DRIVER_VERSION_BUFFER_SIZE = 80;
// nvmlReturn_t                   bindings.rs:1113-1143
internal const uint NVML_SUCCESS = 0, NVML_ERROR_UNINITIALIZED = 1,
                    NVML_ERROR_NOT_SUPPORTED = 3, NVML_ERROR_NO_PERMISSION = 4,
                    NVML_ERROR_INSUFFICIENT_SIZE = 7, NVML_ERROR_DRIVER_NOT_LOADED = 9,
                    NVML_ERROR_LIBRARY_NOT_FOUND = 12, NVML_ERROR_FUNCTION_NOT_FOUND = 13,
                    NVML_ERROR_GPU_IS_LOST = 15, NVML_ERROR_UNKNOWN = 999;
```

`nvmlMemory_v2_t.version` must be set by the caller before the call. It is
`NVML_STRUCT_VERSION(Memory, 2)`, a function-like macro bindgen does not emit; the pattern is
`sizeof(struct) | (version << 24)`. Compute it at runtime as
`(uint)(Marshal.SizeOf<nvmlMemory_v2_t>() | (2 << 24))` rather than hard-coding.
`[unverified]` — validation row added. **For v1, just use `nvmlDeviceGetMemoryInfo` (v1),** whose
three-`ulong` layout needs no version field and whose `used` is what `GpuVramUsed` wants.

Unit conversions for the catalog (`MetricCatalog.cs:75-83`):

| Metric | NVML source | Conversion |
|---|---|---|
| `GpuUtilization` (%) | `nvmlUtilization_t.gpu` | direct |
| `GpuClockCore` (MHz) | `nvmlDeviceGetClockInfo(NVML_CLOCK_GRAPHICS)` | direct |
| `GpuClockMemory` (MHz) | `nvmlDeviceGetClockInfo(NVML_CLOCK_MEM)` | direct |
| `GpuVramUsed` (MB) | `nvmlMemory_t.used` | `/ 1048576.0` |
| `GpuVramTotal` (MB) | `nvmlMemory_t.total` | `/ 1048576.0`, sampled on change only |
| `GpuTemperature` (°C) | `nvmlDeviceGetTemperature(NVML_TEMPERATURE_GPU)` | direct |
| `GpuPower` (W) | `nvmlDeviceGetPowerUsage` | **`/ 1000.0` — the API returns milliwatts** |
| `GpuThrottleReason` (flags) | `nvmlDeviceGetCurrentClocksEventReasons` | direct, `ulong` |
| `GpuTemperatureHotspot` | — | `Unavailable(RequiresSensorDriver)`. NVML exposes no hotspot channel. |

**Every call is fallible per SKU.** `NVML_ERROR_NOT_SUPPORTED` is the normal answer for
`nvmlDeviceGetPowerUsage` on some GeForce parts. Probe each function once at startup, cache the
supported set, and stop calling the unsupported ones — both for overhead and so the log does not
fill with expected failures.

### 4.3 NVML throttle-reason bitmask — complete

`[verified]` values from `nvml-wrapper-sys` `bindings.rs:395-412`;
`[documented]` descriptions from
<https://docs.nvidia.com/deploy/nvml-api/group__nvmlClocksEventReasons.html>

| Bit | Current name | Deprecated alias | Meaning (NVIDIA's words) |
|---|---|---|---|
| `0x0000000000000000` | `nvmlClocksEventReasonNone` | `…ThrottleReasonNone` | No clock throttling; clocks operate at maximum capability. |
| `0x0000000000000001` | `nvmlClocksEventReasonGpuIdle` | `…ThrottleReasonGpuIdle` | GPU is idle; clocks drop to idle state. |
| `0x0000000000000002` | `nvmlClocksEventReasonApplicationsClocksSetting` | `…ThrottleReasonApplicationsClocksSetting`, `…ThrottleReasonUserDefinedClocks` | Clocks are set to application-specific values. |
| `0x0000000000000004` | `nvmlClocksEventReasonSwPowerCap` | `…ThrottleReasonSwPowerCap` | **Software power cap activated.** Clocks optimized to stay within power limits. |
| `0x0000000000000008` | `nvmlClocksEventReasonHwSlowdown` | `…ThrottleReasonHwSlowdown` | **Hardware slowdown activated.** Core clocks reduced by a factor of 2 or more; indicates over-temperature, external power brake, or excessive power draw. |
| `0x0000000000000010` | `nvmlClocksEventReasonSyncBoost` | `…ThrottleReasonSyncBoost` | Sync-boost group; all GPUs boost to the minimum clock across the group. |
| `0x0000000000000020` | `nvmlClocksEventReasonSwThermalSlowdown` | `…ThrottleReasonSwThermalSlowdown` | **Software thermal slowdown.** Clocks optimized to prevent GPU or memory over-temperature. |
| `0x0000000000000040` | `nvmlClocksThrottleReasonHwThermalSlowdown` | — | **Hardware thermal slowdown.** Core clocks reduced by 2× or more due to excessive temperature. |
| `0x0000000000000080` | `nvmlClocksThrottleReasonHwPowerBrakeSlowdown` | — | **Hardware power-brake slowdown.** Core clocks reduced by 2× or more; external power brake asserted. |
| `0x0000000000000100` | `nvmlClocksEventReasonDisplayClockSetting` | `…ThrottleReasonDisplayClockSetting` | GPU clocks constrained by display clock configuration. |

Interpretation for the diagnostic engine, which must be written **once, here, and not
re-derived per rule**:

| Bits set | Verdict |
|---|---|
| `0x20` or `0x40` | **thermal** — say "thermal" |
| `0x04` or `0x80` | **power limit** — say "power limit", not "thermal" |
| `0x08` alone | **hardware slowdown, cause not separable** — NVIDIA's own description enumerates three possible causes. Report as "thermal or power"; do not pick one. |
| `0x01`, `0x02`, `0x10`, `0x100` | not a fault. `0x01` while frames are being presented is itself interesting (the GPU thinks it is idle ⇒ CPU-bound). |

Multiple bits can be set simultaneously. Store the raw `ulong` as `GpuThrottleReason`
(`Unit.Flags`) so a stored session can be re-interpreted if our mapping improves.

### 4.4 AMD — ADLX (stub)

Enough to write the stub behind the same interface:

- DLL: `amdadlx64.dll` (x64) / `amdadlx32.dll`, shipped with the Adrenalin driver. `[unverified]` —
  the SDK hides it behind an `ADLX_DLL_NAME` macro I could not locate in the public tree; the
  loader call is `adlx_load_library(ADLX_DLL_NAME)` `[verified]`
  `SDK/ADLXHelper/Windows/C/ADLXHelper.c:135`.
- Exported entry points, resolved by `GetProcAddress` `[verified]`
  `SDK/ADLXHelper/Windows/C/ADLXHelper.c:138-149`:
  `ADLXQueryFullVersion`, `ADLXQueryVersion`, `ADLXInitializeWithCallerAdl`,
  `ADLXInitialize2` (+ its "with incompatible driver" variant), `ADLXInitialize`
  (+ its "with incompatible driver" variant), `ADLXTerminate`. The helper tries
  `ADLXInitialize2` first and falls back to `ADLXInitialize`.
- Surface: `IADLXGPUMetrics` / `IADLXGPUMetricsSupport` give GPU usage %, GPU clock, VRAM clock,
  GPU temperature, **GPU hotspot temperature**, GPU power, total board power, fan RPM and duty,
  VRAM usage, voltage. Each has an `Is…Supported` companion, so unsupported metrics are
  *detectable* rather than guessed — which maps cleanly onto our `Availability`.
- **No documented throttle-reason enum.** `GpuThrottleReason` is `Unavailable(NotExposedByVendor)`
  on AMD. Do not infer it from hotspot temperature and call it the same metric.
- The interface is COM-like (`IADLX*` with `Acquire`/`Release`), not a flat C ABI. Budget real
  effort; it is not a P/Invoke afternoon like NVML.

### 4.5 Intel — IGCL (stub)

`[verified]` from `intel/drivers.gpu.control-library` `include/igcl_api.h` read this session:

| Entry point | Signature |
|---|---|
| `ctlInit` | `ctl_result_t ctlInit(ctl_init_args_t* pInitDesc, ctl_api_handle_t* phAPIHandle)` (`igcl_api.h:644`) |
| `ctlClose` | `ctl_result_t ctlClose(ctl_api_handle_t hAPIHandle)` (`:663`) |
| `ctlEnumerateDevices` | `ctl_result_t ctlEnumerateDevices(ctl_api_handle_t, uint32_t* pCount, ctl_device_adapter_handle_t* phDevices)` (`:2087`) — two-call pattern |
| `ctlPowerTelemetryGet` | `ctl_result_t ctlPowerTelemetryGet(ctl_device_adapter_handle_t hDeviceHandle, ctl_power_telemetry_t* pTelemetryInfo)` (`:7307`) |
| `ctlPowerTelemetryGetV2` | same shape with `ctl_power_telemetry_v2_t` (`:7431`) |

Loader DLL name is built at runtime as `ControlLib.dll` / `ControlLib<major>.dll`
(`CTL_DLL_NAME L"ControlLib"`, `CTL_DLL_NAME L"ControlLib32"` for x86)
`[verified]` `IntelPresentMon/ControlLib/cApiWrapper.cpp:46-70`.
The telemetry APIs are **64-bit only** (Level Zero limitation) — a non-issue, we are x64.

**Finding that closes an open question in `hardware-telemetry.md:408-410`:**
`ctl_power_telemetry_t` carries explicit boolean limit indicators, so Intel *does* have a
throttle-reason surface, just not as a bitmask `[verified]` `igcl_api.h:6699-6760`:

| Field | Meaning (Intel's words, abridged) |
|---|---|
| `gpuPowerLimited` | desired GPU frequency throttled because the chip is exceeding maximum power limits |
| `gpuTemperatureLimited` | throttled because the chip is exceeding temperature limits |
| `gpuCurrentLimited` | throttled because the chip exceeded power-supply current limits |
| `gpuVoltageLimited` | frequency cannot increase because voltage limits are reached |
| `gpuUtilizationLimited` | frequency lowered because utilization is low (**not a fault**) |

Map these onto the same `GpuThrottleReason` flags vocabulary as NVML, with
`gpuTemperatureLimited → thermal`, `gpuPowerLimited|gpuCurrentLimited → power limit`, and
`gpuUtilizationLimited` explicitly **not** a throttle. Also present:
`gpuCurrentTemperature` (*"read from the sensor reporting the highest value"* — i.e. Intel's
scalar is already hotspot-like), `gpuCurrentClockFrequency`, `gpuEffectiveClock`,
`vramCurrentTemperature`, and monotonic **counters** (`gpuEnergyCounter`,
`globalActivityCounter`, `renderComputeActivityCounter`) that require differencing two
snapshots — utilization and power are deltas, not instantaneous reads. That is a different
collector shape from NVML's and must not be papered over.

### 4.6 Overhead

| Item | Rate | Budget |
|---|---|---|
| NVML: 6-8 calls (util, 2 clocks, temp, memory, power, event reasons) | 1 Hz | **≤ 3 core-ms/s**. **NOT MEASURED**; NVML queries are driver IOCTLs, not MSR reads, and are not expected to IPI. |
| Vendor init | once | ≤ 200 ms one-off, off the hot path, on a background thread |
| Allocation | zero steady state | fixed structs, no marshalling of strings after init |

Self-limiting guard: time each vendor poll; if p95 exceeds 5 ms, halve to 0.5 Hz and mark all
`gpu.*` `Degraded`. Same rule as PDH — one guard, one code path.

---

## 5. Process and system APIs

All signatures `[verified]` from `windows-sys` 0.59.0.

```csharp
// OpenProcess(dwdesiredaccess: PROCESS_ACCESS_RIGHTS /* u32 */, binherithandle: BOOL,
//             dwprocessid: u32) -> HANDLE
[LibraryImport("kernel32.dll", SetLastError = true)]
internal static partial nint OpenProcess(uint dwDesiredAccess,
                                         [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
                                         uint dwProcessId);

// QueryProcessCycleTime(processhandle: HANDLE, cycletime: *mut u64) -> BOOL
[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool QueryProcessCycleTime(nint processHandle, out ulong cycleTime);

// GetProcessMemoryInfo(process: HANDLE, ppsmemcounters: *mut PROCESS_MEMORY_COUNTERS,
//                      cb: u32) -> BOOL      [psapi.dll]
[LibraryImport("psapi.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool GetProcessMemoryInfo(nint process,
                                                  ref PROCESS_MEMORY_COUNTERS_EX ppsmemCounters,
                                                  uint cb);

// GetProcessIoCounters(hprocess: HANDLE, lpiocounters: *mut IO_COUNTERS) -> BOOL
[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool GetProcessIoCounters(nint hProcess, out IO_COUNTERS lpIoCounters);

// GlobalMemoryStatusEx(lpbuffer: *mut MEMORYSTATUSEX) -> BOOL
[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

// GetPerformanceInfo(pperformanceinformation: *mut PERFORMANCE_INFORMATION, cb: u32) -> BOOL
[LibraryImport("psapi.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool GetPerformanceInfo(ref PERFORMANCE_INFORMATION pPerformanceInformation,
                                                uint cb);

// QueryFullProcessImageNameW(hprocess: HANDLE, dwflags: PROCESS_NAME_FORMAT /* u32 */,
//                            lpexename: PWSTR, lpdwsize: *mut u32) -> BOOL
[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static unsafe partial bool QueryFullProcessImageNameW(nint hProcess, uint dwFlags,
                                                               char* lpExeName, ref uint lpdwSize);

// GetProcessTimes(...) -> BOOL   [kernel32.dll]
[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool GetProcessTimes(nint hProcess, out long lpCreationTime,
                                             out long lpExitTime, out long lpKernelTime,
                                             out long lpUserTime);

[LibraryImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool CloseHandle(nint hObject);
```

### 5.1 Structures

```csharp
[StructLayout(LayoutKind.Sequential)]   // windows-sys Threading/mod.rs, IO_COUNTERS
internal struct IO_COUNTERS
{
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount,  WriteTransferCount,  OtherTransferCount;
}

[StructLayout(LayoutKind.Sequential)]   // psapi PROCESS_MEMORY_COUNTERS_EX
internal struct PROCESS_MEMORY_COUNTERS_EX
{
    public uint  cb;                    // set to sizeof(this) BEFORE the call
    public uint  PageFaultCount;
    public nuint PeakWorkingSetSize, WorkingSetSize;
    public nuint QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage;
    public nuint QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage;
    public nuint PagefileUsage, PeakPagefileUsage;
    public nuint PrivateUsage;          // the _EX field
}

[StructLayout(LayoutKind.Sequential)]
internal struct MEMORYSTATUSEX
{
    public uint  dwLength;              // set to sizeof(this) BEFORE the call
    public uint  dwMemoryLoad;          // 0..100
    public ulong ullTotalPhys, ullAvailPhys;
    public ulong ullTotalPageFile, ullAvailPageFile;
    public ulong ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
}

[StructLayout(LayoutKind.Sequential)]
internal struct PERFORMANCE_INFORMATION
{
    public uint  cb;                    // set to sizeof(this) BEFORE the call
    public nuint CommitTotal, CommitLimit, CommitPeak;
    public nuint PhysicalTotal, PhysicalAvailable, SystemCache;
    public nuint KernelTotal, KernelPaged, KernelNonpaged;
    public nuint PageSize;
    public uint  HandleCount, ProcessCount, ThreadCount;
}
```
`[verified]` layouts: `windows-sys` `Win32/System/Threading/mod.rs` (`IO_COUNTERS`),
`Win32/System/ProcessStatus/mod.rs` (`PROCESS_MEMORY_COUNTERS_EX`,
`PERFORMANCE_INFORMATION`), `Win32/System/SystemInformation/mod.rs` (`MEMORYSTATUSEX`).

**All three `cb`/`dwLength` fields are inputs.** `GetPerformanceInfo`'s `CommitTotal`,
`CommitLimit` and `PageSize` are in **pages**, not bytes — multiply by `PageSize` before
converting to MB, or the commit-headroom diagnosis is wrong by a factor of 4096.
`[unverified]` that these are pages; the Learn page for `PERFORMANCE_INFORMATION` states the
unit. **Validation row added, HIGH** — this one silently produces a plausible-looking wrong
number, which is the worst class of bug we can ship.

### 5.2 Access rights

| Call | Minimum access | Notes |
|---|---|---|
| `QueryProcessCycleTime` | `PROCESS_QUERY_INFORMATION` **or** `PROCESS_QUERY_LIMITED_INFORMATION` | `[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryprocesscycletime> |
| `GetProcessIoCounters` | `PROCESS_QUERY_INFORMATION` or `PROCESS_QUERY_LIMITED_INFORMATION` | `[unverified]` for the LIMITED variant |
| `QueryFullProcessImageNameW` | `PROCESS_QUERY_LIMITED_INFORMATION` | this is the whole reason it exists rather than `GetModuleFileNameEx` |
| `GetProcessTimes` | `PROCESS_QUERY_LIMITED_INFORMATION` | |
| `GetProcessMemoryInfo` | `PROCESS_QUERY_INFORMATION \| PROCESS_VM_READ`, **or** `PROCESS_QUERY_LIMITED_INFORMATION` on Win7+ | the `PROCESS_VM_READ` form is the one anti-cheat refuses |
| waiting on process exit | `SYNCHRONIZE` | |

Constant values `[verified]` `windows-sys` `Win32/System/Threading/mod.rs`:
`PROCESS_QUERY_INFORMATION = 0x0400`, `PROCESS_QUERY_LIMITED_INFORMATION = 0x1000`,
`PROCESS_VM_READ = 0x0010`, `PROCESS_SET_INFORMATION = 0x0200`;
`SYNCHRONIZE = 0x00100000` (`Win32/Storage/FileSystem/mod.rs:1261`).
`PROCESS_NAME_WIN32 = 0`, `PROCESS_NAME_NATIVE = 1` (`Threading/mod.rs:525-526`).

**Open the game handle exactly once, with exactly
`PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`, and hold it.** That is the minimum that
covers cycle time, image name, I/O counters and exit-wait. Do **not** request `PROCESS_VM_READ`
for a game: it is the flag most likely to be denied by anti-cheat and the one most likely to
make us look like a cheat tool. If `GetProcessMemoryInfo` then fails,
`ProcessWorkingSet` is `Unavailable(TargetProcessProtected)` — which is a more honest answer
than a number obtained by asking for read access to a game's address space.

`OpenProcess` failing with `ERROR_ACCESS_DENIED` (5) ⇒ `Availability.Denied`.
Failing with `ERROR_INVALID_PARAMETER` (87) ⇒ the process is already gone.

### 5.3 Cycle time → CPU percentage

Cycle time is **frequency-independent work**, which is exactly why it is worth using: it does
not move when the CPU boosts, whereas `% Processor Time` does. But cycles are not seconds, so
converting to a percentage requires a denominator, and the denominator is the trap.

```
dCycles  = cycles(B) - cycles(A)                 // QueryProcessCycleTime, both snapshots
dWall    = monotonic elapsed between A and B     // seconds, from QPC (§6)
```

There is no supported API that gives "cycles available in that interval". Two admissible
denominators, and the honest answer is that we use the first:

**(a) System cycle sum — preferred.** Take `QueryIdleProcessorCycleTime` /
`QueryProcessorCycleTime`… — **not available to us**: those are per-processor kernel-ish APIs
with their own caveats and I did not verify them this session. Instead:

**(b) Time-based denominator with an explicit frequency assumption — what we ship.**

```
procCpuPercent = 100.0 * (dCycles / effectiveHz) / (dWall * logicalProcessorCount)
```

where `effectiveHz = cpu.clock.effective × 1e6` from §2.7. This is `Quality.Estimated`, not
`Derived`, because it compounds two derivations, and it must be labelled as such so
confidence scoring discounts it (`telemetry-model.md:43-46`).

**Simpler and more defensible for v1:** derive `ProcessCpu` from `GetProcessTimes` instead —

```
dKernel + dUser  (100 ns units)
procCpuPercent = 100.0 * (dKernel + dUser) / (dWall100ns * logicalProcessorCount)
```

— which is `Quality.Exact` for "share of available CPU time", needs no frequency, and is what
Task Manager shows. Then keep `QueryProcessCycleTime` as a **second, independent series** whose
job is to detect the disagreement: if process CPU% is flat while cycles/second collapses, the
CPU downclocked without the process changing behaviour. That comparison is worth more to the
diagnostic engine than either number alone, and it costs one extra call.

Caveat to carry in the metric's provenance: on hybrid P/E-core parts a cycle on an E-core is not
the same amount of work as a cycle on a P-core, so cycle deltas across a scheduler migration are
not comparable. Mark `Quality.Degraded` when `CpuActiveCoreCount` changed within the interval on
a hybrid part.

### 5.4 Overhead

| Item | Rate | Budget |
|---|---|---|
| Game process: 4 calls (`QueryProcessCycleTime`, `GetProcessTimes`, `GetProcessMemoryInfo`, `GetProcessIoCounters`) | 1 Hz | **≤ 0.5 core-ms/s** |
| Self-instrumentation: same 4 on our own process + the PresentMon child | 1 Hz | ≤ 0.5 core-ms/s |
| `GlobalMemoryStatusEx` + `GetPerformanceInfo` | 1 Hz | ≤ 0.2 core-ms/s |
| Event-driven widening: `NtQuerySystemInformation(SystemProcessInformation)` twice, 250 ms apart | ~20/hour | ≤ 1 core-ms per event, ~0.006 core-ms/s amortized. This is ADR 0002's replacement for continuous `\Process(*)` polling: ~20 ×/hour instead of 3600 ×/hour. |
| Allocation | — | zero; handles opened once, structs on the stack |

`SystemProcessInformation` is the one genuinely expensive call here (it walks every process and
thread). It is confined to the event path and must never appear on a timer.

---

## 6. Clocks

```csharp
// QueryPerformanceCounter(lpperformancecount: *mut i64) -> BOOL
[LibraryImport("kernel32.dll")]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool QueryPerformanceCounter(out long lpPerformanceCount);

// QueryPerformanceFrequency(lpfrequency: *mut i64) -> BOOL
[LibraryImport("kernel32.dll")]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool QueryPerformanceFrequency(out long lpFrequency);

// QueryInterruptTime(lpinterrupttime: *mut u64)   -- returns void, NOT BOOL
[LibraryImport("kernel32.dll")]
internal static partial void QueryInterruptTime(out ulong lpInterruptTime);

// QueryUnbiasedInterruptTime(unbiasedtime: *mut u64) -> BOOL
[LibraryImport("kernel32.dll")]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool QueryUnbiasedInterruptTime(out ulong unbiasedTime);

// GetSystemTimePreciseAsFileTime(lpsystemtimeasfiletime: *mut FILETIME)  -- returns void
[LibraryImport("kernel32.dll")]
internal static partial void GetSystemTimePreciseAsFileTime(out long lpSystemTimeAsFileTime);
```
`[verified]` all five from `windows-sys`. Note the asymmetry that will silently corrupt a naive
binding: **`QueryInterruptTime` returns `void`** while `QueryUnbiasedInterruptTime` returns
`BOOL`, and **`GetSystemTimePreciseAsFileTime` returns `void`**. Declaring either as returning
`bool` is undefined behaviour on the managed side.
`QueryInterruptTime` lives in the `api-ms-win-core-realtime-l1-1-1` API set; importing it from
`kernel32.dll` works on Windows 8+ and is what the metadata's alternate `api_location` list
implies. `[unverified]` for Windows 10 1809 specifically — if a `TypeLoadException` is possible,
resolve it with `NativeLibrary.TryGetExport` and degrade sleep detection rather than the process.

### 6.1 The monotonic session clock

```
// Once, at Engine start:
QueryPerformanceFrequency(out qpcFreq);            // fixed at boot, never re-read

// Once, per session, as a tightly-bracketed anchor pair:
QueryPerformanceCounter(out qpc1);
GetSystemTimePreciseAsFileTime(out fileTime);      // UTC, 100 ns since 1601-01-01
QueryPerformanceCounter(out qpc2);
epochQpc  = (qpc1 + qpc2) / 2;                     // midpoint bounds the sampling error
epochUtc  = DateTimeOffset.FromFileTime(fileTime);
```

The bracket-and-midpoint is not decoration: it bounds the anchor error to half the elapsed time
between the two QPC reads, which is the only thing that makes the wall-clock anchor honest.
PresentMon does exactly this for its own session anchor `[verified]`
`PresentData/PresentMonTraceSession.cpp:565-573`.

`MonotonicTimestamp.Ticks` (100 ns, `MonotonicTimestamp.cs:22`) from any QPC value:

```
ticks = (long)((Int128)(qpc - epochQpc) * 10_000_000 / qpcFreq)
```

`epochUtc` is stored **once per session** and used only for display, per
`telemetry-model.md:52-54`. `IMonotonicClock.EpochUtc` re-anchors on resume and on a system
time change (`IMonotonicClock.cs:16-22`) — re-anchoring writes a **new** anchor pair and records
a `Discontinuity`; it never rewrites stored timestamps.

QPC properties we rely on, `[documented]`
<https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps>:
system-wide consistent across processes and cores, never runs backwards, unaffected by NTP or
DST, and **continues counting through sleep** on modern Windows. That last property is what
makes the sleep computation below necessary rather than automatic.

### 6.2 Sleep duration and the discontinuity

Both interrupt-time clocks are in **100 ns units** and both start at zero at boot.
`QueryUnbiasedInterruptTime` *"does not include time the system spends in sleep or hibernation …
the interrupt-time count is not 'biased' by time the system spends in sleep or hibernation"*
`[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryunbiasedinterrupttime>.
`QueryInterruptTime` is the biased one and does include it.

```
sleepTicks(now) = interruptTime(now) - unbiasedInterruptTime(now)     // 100 ns, monotonic
```

Sample both on the same 1 Hz tick as everything else, adjacently:

```
QueryInterruptTime(out biased);
QueryUnbiasedInterruptTime(out unbiased);
sleepNow = (long)(biased - unbiased);

if (sleepNow - sleepAtPreviousTick > SleepThresholdTicks)   // e.g. 1 second
    RecordDiscontinuity(kind: Suspend,
                        start: lastTrustworthySample,
                        resume: currentSample);
sleepAtPreviousTick = sleepNow;
```

The **increase** in the difference is the sleep that happened between the two ticks. Rolling
windows, percentiles and baselines reset across it
(`src/FrameDoctor.Abstractions/Time/IMonotonicClock.cs:28-40`), because averaging a frame-time
window that spans a three-hour sleep reports a stutter that never happened.

Read the two clocks **adjacently and in that order**; a preemption between them injects the
scheduling delay into `sleepNow`. The 1-second threshold absorbs that; sub-threshold jitter is
not a suspend.

`[unverified]` that this works on Modern Standby / connected standby as it does on S3. Existing
validation row (`docs/WINDOWS-VALIDATION.md:64`) covers exactly this, HIGH severity.

Second, independent suspend signal for corroboration: a `WM_POWERBROADCAST` /
`PBT_APMRESUMEAUTOMATIC` on the Engine's message-only window. Belt and braces, because a missed
discontinuity corrupts every statistic that spans it.

### 6.3 Overhead

| Item | Rate | Budget |
|---|---|---|
| `QueryPerformanceCounter` on the frame path | per frame, ≤ 1000 Hz | **≤ 1 core-ms/s.** QPC is normally a `rdtscp`-backed user-mode read with no kernel transition; `NtQuerySystemInformation(SystemQueryPerformanceCounterInformation)` reports whether a kernel transition is required on this machine `[documented]` (see §3's Learn page). Read it once at startup and, if a transition **is** required, stop timestamping per-frame and use the CSV's own `CPUStartQPC` exclusively. |
| Interrupt-time pair | 1 Hz | ≤ 0.05 core-ms/s |
| Anchor pair | once per session + on resume | negligible |

---

## 7. Game detection

### 7.1 Foreground-window hook

```csharp
// SetWinEventHook(eventmin: u32, eventmax: u32, hmodwineventproc: HMODULE,
//                 pfnwineventproc: WINEVENTPROC, idprocess: u32, idthread: u32,
//                 dwflags: u32) -> HWINEVENTHOOK
[LibraryImport("user32.dll")]
internal static partial nint SetWinEventHook(uint eventMin, uint eventMax, nint hmodWinEventProc,
                                             nint pfnWinEventProc, uint idProcess, uint idThread,
                                             uint dwFlags);

// UnhookWinEvent(hwineventhook: HWINEVENTHOOK) -> BOOL
[LibraryImport("user32.dll")]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool UnhookWinEvent(nint hWinEventHook);

// The callback. windows-sys: Option<unsafe extern "system" fn(HWINEVENTHOOK, u32, HWND,
//                                                             i32, i32, u32, u32)>
[UnmanagedFunctionPointer(CallingConvention.Winapi)]
internal delegate void WinEventProc(nint hWinEventHook, uint eventType, nint hwnd,
                                    int idObject, int idChild,
                                    uint idEventThread, uint dwmsEventTime);
```
`[verified]` signature and delegate shape: `windows-sys`
`Win32/UI/Accessibility/mod.rs` (`SetWinEventHook`, `WINEVENTPROC`).

Constants `[verified]` `windows-sys` `Win32/UI/WindowsAndMessaging/mod.rs`:

| Constant | Value |
|---|---|
| `EVENT_SYSTEM_FOREGROUND` | `3` (`:838`) |
| `EVENT_SYSTEM_MINIMIZESTART` | `22` (`:845`) |
| `EVENT_SYSTEM_MINIMIZEEND` | `23` (`:844`) |
| `EVENT_OBJECT_LOCATIONCHANGE` | `32779` = `0x800B` (`:810`) |
| `WINEVENT_OUTOFCONTEXT` | `0` (`:2334`) |
| `WINEVENT_SKIPOWNTHREAD` | `1` (`:2336`) |
| `WINEVENT_SKIPOWNPROCESS` | `2` (`:2335`) |
| `WINEVENT_INCONTEXT` | `4` (`:2333`) |

Our call:

```
SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, callbackPtr, 0, 0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
```

**Threading requirements — three of them, all mandatory, all `[documented]`**
<https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook>:

1. *"The client thread that calls SetWinEventHook must have a message loop in order to receive
   events."* A `Task.Run` without a pump receives nothing, silently.
2. *"For out-of-context events, the event is delivered on the same thread that called
   SetWinEventHook."* So the hook thread **is** the callback thread; the callback must do
   nothing but post the HWND to a queue.
3. *"When you use SetWinEventHook to set a callback in managed code, you should use the GCHandle
   structure to avoid exceptions. This tells the garbage collector not to move the callback."*
   Keep a `GCHandle` (or a static field holding the delegate) alive for the hook's lifetime.
   A collected delegate is a hard crash in `user32`, not an exception.

`docs/WINDOWS-VALIDATION.md:75` already commits the Engine to a message-only window
(`CreateWindowEx(HWND_MESSAGE)`) for `WM_POWERBROADCAST` / `WM_WTSSESSION_CHANGE` /
`WM_QUERYENDSESSION`. **Install the WinEvent hook on that same thread.** One STA-ish message
pump, one thread, one lifetime — a second pump for the hook would be pure cost.

Also: *"While a hook function processes an event, additional events may be triggered, which may
cause the hook function to reenter."* The callback must be reentrancy-safe, i.e. a single
non-blocking enqueue and nothing else.

The hook is an **edge** signal only. ADR-level design (`performance-budget.md:50`) pairs it with
a **2 s foreground reconcile** using `GetForegroundWindow`, because focus can change without an
event we see (UAC, session switch, a missed queue entry).

### 7.2 Foreground window → pid → image path

```csharp
// GetForegroundWindow() -> HWND
[LibraryImport("user32.dll")]
internal static partial nint GetForegroundWindow();

// GetWindowThreadProcessId(hwnd: HWND, lpdwprocessid: *mut u32) -> u32  (returns thread id)
[LibraryImport("user32.dll")]
internal static partial uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);
```
`[verified]` `windows-sys` `Win32/UI/WindowsAndMessaging/mod.rs`.

`GetForegroundWindow` returns `IntPtr.Zero` when no window has focus (lock screen, secure
desktop) — that is a normal state, not a failure: emit `Unavailable(NotMeaningfulInCurrentState)`
rather than treating the last known game as still foreground.

Then:

```
uint tid = GetWindowThreadProcessId(hwnd, out uint pid);   // tid == 0 => hwnd invalid
hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid);
uint cch = 260;
QueryFullProcessImageNameW(hProc, PROCESS_NAME_WIN32 /* 0 */, buf, ref cch);
```

`QueryFullProcessImageNameW` returns `false` with `ERROR_INSUFFICIENT_BUFFER` (122) if `cch` is
too small; retry once at 32767. Use `PROCESS_NAME_WIN32` (0) so the result is a DOS path
comparable to what the user sees, not `\Device\HarddiskVolume3\...`.

### 7.3 Fullscreen state

```csharp
// SHQueryUserNotificationState(pquns: *mut QUERY_USER_NOTIFICATION_STATE /* i32 */) -> HRESULT
[LibraryImport("shell32.dll")]
internal static partial int SHQueryUserNotificationState(out int pquns);
```
`[verified]` `windows-sys` `Win32/UI/Shell/mod.rs`.
`[documented]` <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate>

Enum values `[verified]` `windows-sys` `Win32/UI/Shell/mod.rs`:

| Value | Name | Meaning for us |
|---|---|---|
| `1` | `QUNS_NOT_PRESENT` | machine locked / screensaver / user not present |
| `2` | `QUNS_BUSY` | a full-screen app that is **not** D3D is running |
| `3` | `QUNS_RUNNING_D3D_FULL_SCREEN` | **exclusive-fullscreen D3D** — the strongest positive signal |
| `4` | `QUNS_PRESENTATION_MODE` | presentation mode |
| `5` | `QUNS_ACCEPTS_NOTIFICATIONS` | normal desktop; nothing fullscreen |
| `6` | `QUNS_QUIET_TIME` | quiet hours |
| `7` | `QUNS_APP` | a Windows Store app is running fullscreen |

Two limits stated on the same page: it is a **whole-session** state with no process attribution,
and *"there are no notifications sent when the user starts or stops a full-screen application"*
— so it must be **polled**, at the 2 s reconcile tick, not awaited.

**Borderless fullscreen (the common case for modern games) is the unknown.** Whether a
flip-model borderless-fullscreen title reports `QUNS_BUSY` or `QUNS_ACCEPTS_NOTIFICATIONS` on
Win11 24H2+ is already an open MEDIUM validation row (`docs/WINDOWS-VALIDATION.md:68`). Until it
resolves, treat the geometry fallback as **mandatory, not optional**:

```
GetWindowRect(hwnd) == GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)).rcMonitor
```

and treat `SHQueryUserNotificationState` as corroboration. The authoritative fullscreen signal
we actually have is not this API at all — it is PresentMon's `PresentMode` column
(`Hardware: Independent Flip` / `Hardware Composed: Independent Flip` vs. `Composed: Flip`),
which is measured rather than inferred. Prefer it whenever a frame source is live.

### 7.4 Signer subject via Authenticode

Purpose: distinguish a real game from a renamed process, and to display "published by" in the
UI. It is **evidence, never a gate** — an unsigned indie game is not a threat, and we must not
refuse to measure one.

```csharp
// WinVerifyTrust(hwnd: HWND, pgactionid: *mut GUID, pwvtdata: *mut c_void) -> i32 (LONG)
[LibraryImport("wintrust.dll")]
internal static unsafe partial int WinVerifyTrust(nint hwnd, Guid* pgActionID, void* pWVTData);

// WTHelperProvDataFromStateData(hstatedata: HANDLE) -> *mut CRYPT_PROVIDER_DATA
[LibraryImport("wintrust.dll")]
internal static unsafe partial void* WTHelperProvDataFromStateData(nint hStateData);

// WTHelperGetProvSignerFromChain(pprovdata: *mut CRYPT_PROVIDER_DATA, idxsigner: u32,
//                                fcountersigner: BOOL, idxcountersigner: u32)
//                               -> *mut CRYPT_PROVIDER_SGNR
[LibraryImport("wintrust.dll")]
internal static unsafe partial void* WTHelperGetProvSignerFromChain(void* pProvData, uint idxSigner,
                                                                    [MarshalAs(UnmanagedType.Bool)] bool fCounterSigner,
                                                                    uint idxCounterSigner);

// WTHelperGetProvCertFromChain(psgnr: *mut CRYPT_PROVIDER_SGNR, idxcert: u32)
//                             -> *mut CRYPT_PROVIDER_CERT
[LibraryImport("wintrust.dll")]
internal static unsafe partial CRYPT_PROVIDER_CERT* WTHelperGetProvCertFromChain(void* pSgnr, uint idxCert);

// CertGetNameStringW(pcertcontext: *const CERT_CONTEXT, dwtype: u32, dwflags: u32,
//                    pvtypepara: *const c_void, psznamestring: PWSTR, cchnamestring: u32) -> u32
[LibraryImport("crypt32.dll")]
internal static unsafe partial uint CertGetNameStringW(nint pCertContext, uint dwType, uint dwFlags,
                                                       void* pvTypePara, char* pszNameString,
                                                       uint cchNameString);
```
`[verified]` all five from `windows-sys` `Win32/Security/WinTrust/mod.rs` and
`Win32/Security/Cryptography/mod.rs`.

Structures and constants, all `[verified]`:

```csharp
[StructLayout(LayoutKind.Sequential)]   // WinTrust/mod.rs:712-717
internal unsafe struct WINTRUST_FILE_INFO
{
    public uint  cbStruct;              // = sizeof(WINTRUST_FILE_INFO)
    public char* pcwszFilePath;
    public nint  hFile;                 // may be NULL
    public Guid* pgKnownSubject;        // NULL
}

[StructLayout(LayoutKind.Sequential)]   // WinTrust/mod.rs:685-699
internal unsafe struct WINTRUST_DATA
{
    public uint  cbStruct;
    public void* pPolicyCallbackData;
    public void* pSIPClientData;
    public uint  dwUIChoice;            // WTD_UI_NONE = 2
    public uint  fdwRevocationChecks;   // WTD_REVOKE_NONE = 0
    public uint  dwUnionChoice;         // WTD_CHOICE_FILE = 1
    public void* pFile;                 // -> WINTRUST_FILE_INFO
    public uint  dwStateAction;         // WTD_STATEACTION_VERIFY = 1, then _CLOSE = 2
    public nint  hWVTStateData;
    public char* pwszURLReference;      // NULL
    public uint  dwProvFlags;           // WTD_CACHE_ONLY_URL_RETRIEVAL(0x1000)
                                        // | WTD_REVOCATION_CHECK_NONE(0x10)
                                        // | WTD_SAFER_FLAG(0x100)
    public uint  dwUIContext;           // 0
    public void* pSignatureSettings;    // NULL
}

// WinTrust/mod.rs:316-332  -- we only need the first two fields
[StructLayout(LayoutKind.Sequential)]
internal unsafe struct CRYPT_PROVIDER_CERT
{
    public uint cbStruct;
    public nint pCert;                  // PCCERT_CONTEXT
    // ... remaining fields not needed
}
```

| Constant | Value | Source |
|---|---|---|
| `WINTRUST_ACTION_GENERIC_VERIFY_V2` | `{00AAC56B-CD44-11D0-8CC2-00C04FC295EE}` | `[verified]` `WinTrust/mod.rs:153` |
| `WTD_UI_NONE` | `2` | `[verified]` `:223` |
| `WTD_REVOKE_NONE` | `0` | `[verified]` `:210` |
| `WTD_CHOICE_FILE` | `1` | `[verified]` `:196` |
| `WTD_STATEACTION_VERIFY` | `1` | `[verified]` `:217` |
| `WTD_STATEACTION_CLOSE` | `2` | `[verified]` `:215` |
| `WTD_REVOCATION_CHECK_NONE` | `0x10` | `[verified]` `:209` |
| `WTD_SAFER_FLAG` | `0x100` | `[verified]` `:212` |
| `WTD_CACHE_ONLY_URL_RETRIEVAL` | `0x1000` | `[verified]` `:192` |
| `CERT_NAME_SIMPLE_DISPLAY_TYPE` | `4` | `[verified]` `Cryptography/mod.rs:1370` |
| `CERT_NAME_ISSUER_FLAG` | `1` | `[verified]` `:1367` |

Sequence:

1. Fill `WINTRUST_FILE_INFO` with the image path from §7.2.
2. Fill `WINTRUST_DATA` with `dwStateAction = WTD_STATEACTION_VERIFY` and
   `dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE | WTD_SAFER_FLAG`.
   **`WTD_CACHE_ONLY_URL_RETRIEVAL` and `WTD_REVOCATION_CHECK_NONE` together are what keep this
   offline.** Invariant 7 is local-only: a default `WinVerifyTrust` will attempt a CRL/OCSP
   fetch, which is a network call we are not permitted to make and which can block for seconds.
3. `WinVerifyTrust(IntPtr.Zero /* no UI */, &action, &wtd)` → `LONG`.
4. On success, `WTHelperProvDataFromStateData(wtd.hWVTStateData)` →
   `WTHelperGetProvSignerFromChain(pProvData, 0, false, 0)` →
   `WTHelperGetProvCertFromChain(pSgnr, 0)` → `pCert`.
5. `CertGetNameStringW(pCert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, null, null, 0)` for the length,
   then again with the buffer. `dwFlags = 0` (omitting `CERT_NAME_ISSUER_FLAG`) gives the
   **subject**, i.e. the publisher.
6. **Always** re-call `WinVerifyTrust` with `dwStateAction = WTD_STATEACTION_CLOSE` in a
   `finally`. Skipping it leaks the state data on every check.

Return-value mapping `[verified]` `windows-sys` `Win32/Foundation/mod.rs`:

| Value | Constant | Our verdict |
|---|---|---|
| `0` | `ERROR_SUCCESS` | signed and trusted |
| `0x800B0100` | `TRUST_E_NOSIGNATURE` (`:9639`) | unsigned — **normal**, not suspicious |
| `0x800B0109` | `CERT_E_UNTRUSTEDROOT` (`:143`) | self-signed |
| `0x800B0111` | `TRUST_E_EXPLICIT_DISTRUST` (`:9635`) | explicitly distrusted |
| `0x800B0004` | `TRUST_E_SUBJECT_NOT_TRUSTED` (`:9643`) | not trusted |
| `0x80096010` | `TRUST_E_BAD_DIGEST` (`:9631`) | file modified after signing |
| `0x80092026` | `CRYPT_E_SECURITY_SETTINGS` (`:531`) | policy blocked the check |

Do this **once per unique image path**, cached by `(path, fileSize, lastWriteTimeUtc)`, on a
background thread, never on the detection hot path. `WinVerifyTrust` on a 200 MB game
executable hashes the whole file: hundreds of milliseconds, and disk I/O we are otherwise not
doing. If it has not completed, the publisher field renders `Unavailable(NotYetSampled)`.

### 7.5 The actual detection rule

Signature and window state are supporting evidence. The primary positive signal, per
`docs/WINDOWS-VALIDATION.md:66`, is **sustained non-zero `engtype_3D` GPU utilization
attributable to the foreground pid** — a measurement, not a heuristic, and consistent with
invariant 1. The hook, `SHQueryUserNotificationState` and the signer check exist to *narrow the
candidate set cheaply* so that the GPU-engine query is bound to one pid instead of wildcarded.

### 7.6 Overhead

| Item | Rate | Budget |
|---|---|---|
| WinEvent hook, idle | event-driven, ~0-5/min | **≤ 0.1 core-ms/s** |
| Foreground reconcile (`GetForegroundWindow` + `GetWindowThreadProcessId` + `SHQueryUserNotificationState`) | 0.5 Hz | **≤ 0.5 core-ms/s** |
| `QueryFullProcessImageNameW` | on foreground change only | negligible |
| `WinVerifyTrust` | once per unique image, cached on disk across sessions | **≤ 500 ms one-off**, background thread, excluded from the steady-state budget and declared as such |
| Message pump | shared with the Engine's existing message-only window | already counted |

Total against `performance-budget.md:50` (**idle, no game detected: ≤ 35 core-ms/s**): game
detection is budgeted at **≤ 1 core-ms/s**, leaving the idle budget dominated by the 5 s
GPU-engine discovery tick — which is exactly the intent of that line.

---

## 8. Consolidated overhead budget

Against `docs/architecture/performance-budget.md:51` — **monitoring, UI hidden: ≤ 120
core-ms/s, summed over FrameDoctor and the PresentMon child.**

| Collector | Rate | Budget (core-ms/s) | Measured? |
|---|---|---|---|
| PresentMon child process (§1.9) | — | 60 | **NO** |
| CSV parse + normalization (§1.9) | ≤ 1000 Hz | 3 | NO |
| PDH fast query (§2.11) | 2 Hz | 12 | **NO** |
| PDH slow query (§2.11) | 1 Hz | 5 | NO |
| PDH GPU-engine discovery (§2.11) | 0.2 Hz | 8 | **NO** |
| PDH bound per-pid GPU paths (§2.11) | 1 Hz | 3 | NO |
| `NtQuerySystemInformation` DPC/ISR (§3.5) | 2 Hz | 0.5 | NO |
| Vendor GPU (NVML) (§4.6) | 1 Hz | 3 | NO |
| Process + system APIs (§5.4) | 1 Hz | 1.2 | NO |
| Clocks (§6.3) | per frame + 1 Hz | 1 | NO |
| Game detection (§7.6) | 0.5 Hz + events | 1 | NO |
| Storage writer | ≤ 240 writes/min | 2 | Linux-measured proxy only |
| IPC to Shell | ≤ 10 msg/s | 1 | Linux-measured proxy only |
| **Total** | | **100.7** | |

**Headroom: 19.3 core-ms/s (16 %).** That is thinner than it looks, because eleven of thirteen
lines are unmeasured and the largest single line is a guess about someone else's process. Two
consequences that belong in the code, not in a follow-up:

1. **The self-limiting guard is not optional and is not per-collector.** Every timed source
   (PDH queries, NVML poll, `NtQuerySystemInformation`) shares one guard implementation: p95
   over a rolling window > 5 ms ⇒ halve the rate, mark every metric it feeds `Degraded`, surface
   it. `performance-budget.md:60-66`.
2. **A global budget governor above the per-source guards.** Sum our own measured CPU (§5,
   `GetProcessTimes` on the Engine + the PresentMon child) every 5 s; if the 30 s mean exceeds
   120 core-ms/s, shed load in a fixed, declared order — GPU-engine discovery to 0.1 Hz, then
   PDH fast query to 1 Hz, then vendor GPU to 0.5 Hz — and say so in the UI. Shedding silently
   would make the budget a fiction exactly when it is being violated.

Machines with ≤ 8 logical processors run the reduced-fidelity profile
(`performance-budget.md:57-58`): PDH fast query at 1 Hz, no per-core series, discovery at
0.1 Hz — **and are told so**.

---

## 9. Implementation order

1. `IFrameSource` + the PresentMon CLI driver (§1). Everything else is a chart; this is the
   product. The ETL-replay driver lands in the same commit so the parser has a deterministic
   test corpus.
2. Clocks (§6). Every other collector timestamps against it, and the discontinuity rule must
   exist before there is any series to corrupt.
3. `NtQuerySystemInformation` (§3) — one call, highest explanatory power per core-ms, and it
   supplies per-core load, DPC/ISR and active-core count together.
4. PDH infrastructure (§2.1-2.5) with the startup probe. No metric paths yet — just the query
   lifecycle, the English-counter sequence, the self-limiting guard, and the probe that turns
   every `[unverified]` string in §2.6 into a runtime-checked capability.
5. Memory + process APIs (§5). Cheap, no PDH, immediately useful.
6. PDH metric paths (§2.6), disk and memory first, `GPU Engine` last.
7. NVML (§4.1-4.3). This is what makes the GPU thermal diagnosis real.
8. Game detection (§7).
9. ADLX / IGCL stubs behind the same interface, returning `Unavailable(NotExposedByVendor)`
   until implemented — which is the invariant-9-compliant way to ship a partial vendor matrix.

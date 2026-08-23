# Windows Internals for FrameDoctor — Game Detection, Safe Optimization, Privilege Model

Research date: 2026-08-23. Primary sources are learn.microsoft.com unless noted.
`[UNVERIFIED]` = could not be confirmed from a primary source; needs a Windows machine or further digging.

---

## 1. Game detection

### 1.1 Foreground window

| API | Header / lib | Notes |
|---|---|---|
| `GetForegroundWindow()` | winuser.h / User32 | Returns HWND of the foreground window; can return NULL (e.g. during window switches, secure desktop). Polling only. |
| `GetWindowThreadProcessId(hwnd, &pid)` | winuser.h / User32 | Maps HWND → owning thread + PID. |
| `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, NULL, proc, 0, 0, WINEVENT_OUTOFCONTEXT \| WINEVENT_SKIPOWNPROCESS)` | winuser.h / User32 | Event-driven. ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)) |

**Threading requirements of the WinEvent hook (documented, exact):**
- *"The client thread that calls **SetWinEventHook** must have a message loop in order to receive events."*
- *"For out-of-context events, the event is delivered on the same thread that called SetWinEventHook."*
- Use `WINEVENT_OUTOFCONTEXT` — `WINEVENT_INCONTEXT` requires the callback to live in a DLL injected into every target process. Non-starter for a monitoring app (anti-cheat will hate it, and cross-bitness/console processes silently fall back to out-of-context anyway).
- Managed callers must pin the delegate with `GCHandle` — the docs call this out explicitly.
- Hook callbacks can re-enter; guard state.
- `UnhookWinEvent` on shutdown.

**Verdict for FrameDoctor:** use the WinEvent hook as the primary edge-trigger (near-zero idle cost, no polling jitter), on a dedicated STA-ish thread with its own message pump. Keep a low-frequency `GetForegroundWindow` poll (e.g. 2 s) as a reconciliation safety net, because the hook can miss transitions if the pump stalls and because it delivers no initial state.

### 1.2 Is the process doing graphics work? — GPU Engine counters

Confirmed: the PDH counter set `\GPU Engine(<instance>)\Utilization Percentage` exists with instance names of the form
`pid_<PID>_luid_0x<HI>_0x<LO>_phys_<N>_eng_<N>_engtype_<TYPE>`
(e.g. `pid_9524_luid_0x00000000_0x000095CA_phys_0_eng_0_engtype_3D`). Confirmed via Microsoft Q&A on PDH GPU usage and the oshi PR that implements it ([MS Q&A](https://learn.microsoft.com/en-us/answers/questions/5641645/how-to-get-the-special-process-gpu-usage-with-the), [oshi PR #2114](https://github.com/oshi/oshi/pull/2114)). The counter set itself is **not** formally documented on learn.microsoft.com — treat the instance-name grammar as `[UNVERIFIED]` in the strict sense, but it is stable across Win10 1709 → Win11 in practice.

Engine types come from `DXGK_ENGINE_TYPE` (d3dkmdt.h, [docs](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmdt/ne-d3dkmdt-dxgk_engine_type)) — the counter suffix is the enum name with the `DXGK_ENGINE_TYPE_` prefix stripped and underscores removed:

| engtype | Meaning | Indicates real rendering? |
|---|---|---|
| `3D` | The adapter's 3-D engine. **Exactly one per adapter**, and all non-display-only adapters have one. | **Yes — primary signal.** |
| `Copy` | Data movement / paging / `UpdateSubresource`. Note: D3D copy work "must appear on either the copy engine or the 3-D engine". | Weak — a supporting signal, not sufficient. |
| `Compute` | *(not in the DDI enum; appears in the counter set on some vendors)* | Weak. `[UNVERIFIED]` |
| `VideoDecode` | Video decompression. | No — this is video playback (browser, Netflix, OBS). |
| `VideoEncode` | Video compression. | No — this is streaming/recording (OBS, Game Bar). |
| `VideoProcessing` | Post-decode colour conversion / deinterlace. | No. |
| `SceneAssembly`, `Overlay`, `Crypto`, `VideoCodec`, `Other` | Rare / vendor-specific / virtual. | No. |

**Practical rule:** sustained `engtype_3D` utilisation attributable to the foreground PID is the strongest positive graphics signal. `VideoEncode` on a *different* PID while the foreground is a game is the classic "OBS is recording you" diagnostic — worth surfacing, not worth treating as game evidence.

**Cost caveat:** enumerating `\GPU Engine(*)` instances is expensive — instance count scales with (processes × adapters × engines) and instance names churn as processes come and go. Enumerate the instance list at a low rate (≥ 1 s) or resolve the specific `pid_*` instances once per detected foreground process and re-query only those.

### 1.3 Fullscreen: exclusive vs borderless vs windowed

There is **no** documented Win32 API that reports another process's fullscreen mode. Findings:

- `QueryFullscreenMode` and `IsShellManagedWindow` — **could not be confirmed to exist** in any documented shell32 surface. `[UNVERIFIED]` — do not build on them.
- `IDXGISwapChain::GetFullscreenState` is documented but is an *in-process* API on your own swap chain. Useless for observing another process.
- `ITaskbarList2::MarkFullscreenWindow` is documented but is something the *game* calls to tell the shell; you cannot read it back.
- Shell hook messages (`RegisterShellHookWindow` + `HSHELL_*`) reportedly carry undocumented values 53/54 for enter/leave fullscreen. `[UNVERIFIED]` — undocumented, do not ship.

**The one directly relevant documented API — `SHQueryUserNotificationState`** ([function](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate), [enum](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state)):

```c
// shellapi.h, Shell32.dll, Windows Vista+; no elevation
HRESULT SHQueryUserNotificationState(QUERY_USER_NOTIFICATION_STATE *pquns);
```

| Value | # | Documented meaning |
|---|---|---|
| `QUNS_NOT_PRESENT` | 1 | Screen saver, machine locked, or inactive Fast User Switching session. |
| `QUNS_BUSY` | 2 | **A full-screen application is running** or Presentation Settings are applied. |
| `QUNS_RUNNING_D3D_FULL_SCREEN` | 3 | **A full-screen (exclusive mode) Direct3D application is running.** |
| `QUNS_PRESENTATION_MODE` | 4 | User activated presentation settings. |
| `QUNS_ACCEPTS_NOTIFICATIONS` | 5 | None of the above. |
| `QUNS_QUIET_TIME` | 6 | First hour after a new user's first logon / after OS upgrade. Win7+. |
| `QUNS_APP` | 7 | A Windows Store app is running. Win8+. |

This gives us exactly the discrimination we want: `QUNS_RUNNING_D3D_FULL_SCREEN` ⇒ exclusive fullscreen; `QUNS_BUSY` ⇒ fullscreen-but-not-exclusive-D3D (borderless fullscreen typically lands here). Two documented caveats that matter:

1. *"there are no notifications sent when the user starts or stops a full-screen application"* — **this API is poll-only.** No event. `WM_SETTINGCHANGE` fires for presentation settings and lock/unlock only.
2. It is a **machine-wide** state, not per-process. It tells you "something is fullscreen", not "this PID is fullscreen". Correlate with `GetForegroundWindow` yourself.

**Fallback geometry check (documented primitives, our own logic):** `GetWindowRect(hwnd)` vs `MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)` + `GetMonitorInfo(...).rcMonitor`. Equal rect + `GetWindowLong(GWL_STYLE)` lacking `WS_OVERLAPPEDWINDOW`/`WS_THICKFRAME`/`WS_CAPTION` ⇒ borderless fullscreen. This is reliable and cheap; combine with `SHQueryUserNotificationState` to separate borderless from exclusive.

### 1.4 Process metadata signals

- **`GetFileVersionInfoSizeExW` / `GetFileVersionInfoExW` / `VerQueryValueW`** (version.h, Version.lib). Gives `CompanyName`, `ProductName`, `FileDescription`, `OriginalFilename`. Useful for launcher/game naming and for excluding Microsoft-signed system binaries. Requires the image path (`QueryFullProcessImageNameW`, PROCESS_QUERY_LIMITED_INFORMATION).
- **Loaded module list**: `EnumProcessModulesEx` (psapi) or a `CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid)` walk. Presence of `d3d11.dll`/`d3d12.dll`/`dxgi.dll`/`vulkan-1.dll`/`opengl32.dll`/`nvapi64.dll` is a decent positive. **Caveats:** requires `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ` (fails against protected/anti-cheat processes and elevated processes from a non-elevated app); bitness mismatch complicates 32-bit targets; Electron apps load `d3d11.dll` too. Cost is moderate (hundreds of µs to ms per process). Use as a **corroborating** signal, not a primary one.
- **Install-path heuristics** (all `[UNVERIFIED]` against primary docs — these are vendor/community-documented, verify on a real machine):
  - Steam: `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath` (or `HKCU\Software\Valve\Steam\SteamPath`); then parse `<Steam>\steamapps\libraryfolders.vdf` for additional library roots, and `<library>\steamapps\appmanifest_*.acf` for installed app IDs and `installdir`.
  - Epic: manifests under `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON with `InstallLocation`, `LaunchExecutable`, `DisplayName`). Registry override key `HKLM\SOFTWARE\...\Epic Games\EpicGamesLauncher` exists but the value name varies.
  - GOG: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>\path`.
  - Xbox/MS Store: packaged apps under `%ProgramFiles%\WindowsApps` and per-drive `\XboxGames`; enumerate properly via the `PackageManager` WinRT API rather than path sniffing.

### 1.5 How Windows itself decides something is a game

Mostly opaque, but three surfaces are documented:

1. **Game Mode PPM profile** — [Processor power management options](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/configure-processor-power-management-options) documents a `GameMode` power profile: *"GameMode profile is enabled when the 'Game Mode' setting toggle is turned on and the user is playing a game."* OEM-configurable via provisioning (their example sets `MinPerformance` to 100 for GameMode). No public API to set it; **it is read-indirectly observable** (next item).
2. **`PowerRegisterForEffectivePowerModeNotifications`** ([docs](https://learn.microsoft.com/en-us/windows/win32/api/powersetting/nf-powersetting-powerregisterforeffectivepowermodenotifications), powersetting.h / Powrprof.lib, Win10 1809+). With `EFFECTIVE_POWER_MODE_V2` (Win10 1903+) the callback can report `EffectivePowerModeGameMode`. **This is a fully documented way to observe that Windows believes a game is running.** Callback fires once at registration with the current value. Excellent, cheap, no elevation.
3. **The deprecated Game Mode API** — `HasExpandedResources`, `GetExpandedResourceExclusiveCpuCount`, `ReleaseExclusiveCpuSets` in `expandedresources.h`. [Explicitly deprecated in Windows 10 1809+](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/gamemode/game-mode-portal) and gated behind the `expandedResources` restricted capability. Do not use. It does document the mechanism though: Game Mode grants *"exclusive or priority access to hardware resources"*, only *"when the app is in the foreground and has focus"*, and *"the performance increase … is directly related to the number and impact of other activities running on the device."*

**Registry surfaces (reverse-engineered / community, NOT documented API):**
- `HKCU\System\GameConfigStore` — per-title `Children\<GUID>` entries written by Game Bar when it recognises a title; contains `MatchedExeFullPath`, `Title`, etc. This is the closest thing to "Windows' game list". **Undocumented.** Reading it is low-risk; writing it is not supported. `[UNVERIFIED]` on exact schema.
- `HKCU\System\GameConfigStore\GameDVR_Enabled`, `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR\AppCaptureEnabled` — Game DVR toggles. Only the **policy** form `HKLM\SOFTWARE\Policies\Microsoft\Windows\GameDVR\AllowGameDVR` has an official (Group Policy / MDM) counterpart.

### 1.6 Launcher vs game

No single signal. The reliable discriminator is a **conjunction**:

| Signal | Launcher (Steam/Epic/EA) | Actual game |
|---|---|---|
| Sustained `engtype_3D` utilisation | Near zero (CEF/Chromium compositing spikes only) | Sustained, correlated with foreground |
| Fullscreen state | Windowed | Often `QUNS_BUSY` / `QUNS_RUNNING_D3D_FULL_SCREEN` |
| Process tree | Is a **parent**; long-lived across many sessions | Usually a **child** of the launcher, short-lived |
| Module list | `libcef.dll`, `chrome_elf.dll`, `Qt*.dll` | `d3d12.dll`/`vulkan-1.dll` + engine DLLs, anti-cheat (`EasyAntiCheat`, `BEService`) |
| Executable name | Known allow-list: `steam.exe`, `steamwebhelper.exe`, `EpicGamesLauncher.exe`, `EADesktop.exe`, `Battle.net.exe`, `GalaxyClient.exe`, `RiotClientServices.exe` | Everything else |
| Install path | Launcher's own program dir | Under a *library* root (`steamapps\common\...`) |

Practical rule: **explicit deny-list of known launcher executables + require sustained 3D engine work + foreground focus.** The deny-list is the highest-value 20 lines of code in the detector.

### 1.7 Game detection signal table

| Signal | API / mechanism | Reliability | Cost | Privilege |
|---|---|---|---|---|
| Foreground window changed | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, …, WINEVENT_OUTOFCONTEXT)` + msg loop | High (edge-accurate) | ~0 idle; needs a pumped thread | None |
| Foreground PID (poll/reconcile) | `GetForegroundWindow` + `GetWindowThreadProcessId` | High | Trivial | None |
| Sustained 3D rendering | PDH `\GPU Engine(pid_*_engtype_3D)\Utilization Percentage` | **High — best positive signal** | Medium-high (instance enumeration) | None |
| Video encode active elsewhere (OBS) | same counter set, `engtype_VideoEncode` | High | shares cost above | None |
| Exclusive fullscreen present | `SHQueryUserNotificationState` == `QUNS_RUNNING_D3D_FULL_SCREEN` | High, but **machine-wide, poll-only** | Trivial | None |
| Fullscreen (incl. borderless) present | same, == `QUNS_BUSY` | Medium (also fires for Presentation Mode) | Trivial | None |
| Borderless-fullscreen geometry | `GetWindowRect` vs `GetMonitorInfo().rcMonitor` + style bits | Medium-high, per-HWND | Trivial | None |
| Windows itself thinks a game is running | `PowerRegisterForEffectivePowerModeNotifications` (V2) → `EffectivePowerModeGameMode` | Medium-high (needs Game Mode on) | ~0 (callback) | None |
| Graphics runtime loaded | `EnumProcessModulesEx` for `d3d1*.dll` / `vulkan-1.dll` | Medium (false positives: Electron) | Medium | `PROCESS_QUERY_INFORMATION\|VM_READ`; **fails on protected/anti-cheat processes** |
| Publisher / product name | `GetFileVersionInfoExW` + `VerQueryValueW` | Medium (naming only) | Low, cacheable | Read on image path |
| Installed under a game library | Steam `libraryfolders.vdf`, Epic `*.item` manifests, GOG registry | Medium | Low, cache at startup | None (HKLM read) |
| Known-launcher deny-list | image filename + publisher | **High for exclusion** | Trivial | None |
| Game Bar's own opinion | `HKCU\System\GameConfigStore\Children\*` | Medium; **undocumented** | Low | None |

---

## 2. Power management

### 2.1 Power scheme APIs (all in `powersetting.h`, PowrProf.lib / PowrProf.dll)

| Function | Signature notes | Docs |
|---|---|---|
| `PowerGetActiveScheme(NULL, &pGuid)` | Caller frees with `LocalFree`. | learn |
| `PowerSetActiveScheme(NULL, &guid)` | First param reserved, must be NULL. Returns `ERROR_SUCCESS`. | [link](https://learn.microsoft.com/en-us/windows/win32/api/powersetting/nf-powersetting-powersetactivescheme) |
| `PowerWriteACValueIndex(NULL, &scheme, &subgroup, &setting, value)` | **Remark: "Changes to the settings for the active power scheme do not take effect until you call `PowerSetActiveScheme`."** | [link](https://learn.microsoft.com/en-us/windows/win32/api/powersetting/nf-powersetting-powerwriteacvalueindex) |
| `PowerWriteDCValueIndex(...)` | DC (battery) twin. | learn |
| `PowerReadACValue` / `PowerReadACValueIndex` | Read back. | learn |

Documented subgroup GUIDs (winnt.h): `NO_SUBGROUP_GUID` `fea3413e-7e05-4911-9a71-700331f1c294`, `GUID_PROCESSOR_SETTINGS_SUBGROUP` `54533251-82be-4824-96c1-47b60b740d00`, `GUID_VIDEO_SUBGROUP` `7516b95f-f776-4464-8c53-06167f40cc99`, `GUID_SLEEP_SUBGROUP` `238C9FA8-0AAD-41ED-83F4-97BE242C8F20`, `GUID_DISK_SUBGROUP` `0012ee47-9041-4b5d-9b77-535fba8b1442`, `GUID_BATTERY_SUBGROUP` `e73a048d-bf27-4f12-9731-8b2076e8891f`, `GUID_PCIEXPRESS_SETTINGS_SUBGROUP` `501a4d13-42af-4429-9fd1-a8218c268e20`, `GUID_SYSTEM_BUTTON_SUBGROUP` `4f971e89-eebd-4455-a8de-9e59040e7347`.

**Elevation:** none of these pages state an elevation requirement. Empirically `powercfg /setactive` and `/setacvalueindex` work for a standard user on their own schemes, but the store is under HKLM and a Group Policy ("Specify a custom active power plan") can lock it. `[UNVERIFIED — must test on a real machine, both standard-user and domain-managed.]`

### 2.2 Windows 11 Power Mode (the overlay) — the prime candidate

**Status: the concept and the GUIDs are documented; the three APIs are not.**

Documented on [Customize the Windows performance power slider](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/customize-power-slider):

| Slider mode | Overlay GUID (from the provisioning table) |
|---|---|
| Better Battery / "Best power efficiency" | `961cc777-2547-4f9d-8174-7d86181b8a7a` |
| Better Performance (Balanced) | `3af9B8d9-7c97-431d-ad78-34a8bfea439f` |
| Best Performance | `ded574b5-45a0-4f42-8737-46345c09c238` |

⚠️ The same page's INF table gives Better Performance as `{381B4222-F694-41F0-9685-FF5BB260DF2E}` — which is the *Balanced power scheme* GUID, not an overlay. The two tables disagree. In practice `PowerGetEffectiveOverlayScheme` is widely reported to return `GUID_NULL` (all-zero) for the default/Balanced overlay. `[UNVERIFIED — resolve empirically.]`

The three functions are **exported from powrprof.dll but absent from learn.microsoft.com** — undocumented, must be resolved via `GetProcAddress`:
```c
DWORD PowerSetActiveOverlayScheme(GUID overlaySchemeGuid);          // by value
DWORD PowerGetActualOverlayScheme(GUID *actualOverlayGuid);
DWORD PowerGetEffectiveOverlayScheme(GUID *effectiveOverlayGuid);   // prefer this for reads
```
All return 0 on success. Elevation: **not documented anywhere**; multiple tray utilities call them from a non-elevated process and community reports say no admin is needed. `[UNVERIFIED — must test.]`

**Why this is nonetheless the best power candidate — a documented mechanism, not folklore.** From the same MS page:

> *"Power throttling is always engaged, unless the slider is set to **Best Performance**. In this case, **all applications will be opted out of power throttling**."*

And: *"The slider will appear on a device only when the Balanced power plan, or any plan that is derived from Balanced, is selected."* — so on a machine set to High Performance the overlay is a no-op and FrameDoctor must detect and say so.

**Read side is fully documented:** use `PowerRegisterForEffectivePowerModeNotifications` (V2) → `EFFECTIVE_POWER_MODE` (`EffectivePowerModeBatterySaver`, `…BetterBattery`, `…Balanced`, `…HighPerformance` *(legacy overlay only)*, `…MaxPerformance`, `…GameMode`, `…MixedReality`). Do the reading with the documented API and only the *write* with the undocumented one.

### 2.3 Processor subgroup: min/max processor state

- `PROCTHROTTLEMIN` = `893dee8e-2bef-41e0-89c6-b55d0929964c` — "Minimum processor state", 0–100 %.
- `PROCTHROTTLEMAX` = `bc5038f7-23e0-4960-96da-33abaf5935ec` — "Maximum processor state", 0–100 %.
Both under `GUID_PROCESSOR_SETTINGS_SUBGROUP`. These GUIDs come from `powercfg /qh` output, not from a learn.microsoft.com constant table. `[UNVERIFIED as documented constants; the values are stable and universally used.]`

**Risk of touching them: high, reject as a shipped optimization.**
- Forcing `PROCTHROTTLEMIN=100` pins the CPU at max P-state: on a desktop this mostly converts headroom into heat and fan noise; on a laptop it will *reduce* sustained clocks once the thermal/power budget is hit. The Microsoft PPM page's own warning applies: *"PPM profiles are tuned by silicon vendors… Please reach out to your silicon vendor for tuning guidance before modifying processor power management settings."*
- Writes mutate the user's power scheme persistently — if we crash before restoring, the machine is left pinned. Rollback becomes a correctness problem (see §5.5).
- Microsoft's *own* recommended vehicle for exactly this is the `GameMode` PPM profile (their example sets `MinPerformance` 100 there), which is OEM/provisioning territory, not app territory.

**FrameDoctor should *read* these and report "your Minimum processor state is 100% on battery, which is hurting you", not write them.**

### 2.4 The documented, supported way to request a performance-oriented power state

`PowerCreateRequest(&REASON_CONTEXT)` → `PowerSetRequest(h, type)` → `PowerClearRequest(h, type)` (winbase.h, Kernel32). [Docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest).

| Request type | What it **does** |
|---|---|
| `PowerRequestDisplayRequired` | Display stays on despite idle. *Must be paired with `PowerRequestSystemRequired` to also stop sleep.* |
| `PowerRequestSystemRequired` | System doesn't sleep after user-inactivity timeout. |
| `PowerRequestExecutionRequired` | The **calling process** keeps running instead of being suspended/terminated by process lifetime management. On S3 systems it implies `SystemRequired`. |
| `PowerRequestAwayModeRequired` | S3-only; audio/video off but system running. |

**What they do NOT do — state this plainly in the product:** none of these raise CPU/GPU frequency, change the power scheme, change the overlay, change QoS, or affect frame rate. They are *idle-suppression* primitives. Additional documented limits: on Modern Standby + DC, system/execution requests are killed 5 minutes after the sleep timeout; all except away-mode are terminated on *user-initiated* sleep (power button, lid, Start→Sleep).

The legitimate FrameDoctor use is narrow and real: hold `PowerRequestSystemRequired` + `PowerRequestDisplayRequired` **while a gamepad-only session is in progress** so the display doesn't blank mid-game, and always supply a localised `REASON_CONTEXT` string (documented best practice) so the user can see it in `powercfg /requests`.

### 2.5 Does any of this help frame rate on a desktop? Honest answer

**Mostly a laptop/handheld concern.** The documented mechanisms — power throttling opt-out, EPP (`PerfEnergyPreference`), efficient-core steering — are all about *choosing to spend less power*. On a desktop with a discrete GPU and no thermal/power budget pressure, the CPU is already running at boost clocks under a game load, and the GPU's power state is driven by the vendor driver, not by the Windows power scheme.

Two desktop-relevant exceptions worth measuring rather than assuming:
1. If the machine is on **Better Battery** or **Battery Saver** overlay (some OEM desktops and all-in-ones ship this way, and Battery Saver can engage on a UPS), moving to Balanced/Best Performance is a real change.
2. `HKLM\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling\DisableUserPresenceQos` — the [QoS page](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) documents that *"By default, Windows may lower the QoS policy of a foreground application to Medium QoS after a period of user inactivity where no input is detected"* (battery only; the page tells benchmarkers to disable it). Whether *gamepad* input counts as "input detected" is `[UNVERIFIED]` and is exactly the kind of thing FrameDoctor should detect and report on a handheld/laptop.

**No primary measured evidence was found that changing power settings improves desktop frame rate.** Classify as NEEDS-EVIDENCE and instrument it: FrameDoctor is a diagnostics app, so the right move is to A/B it with its own frame-time capture rather than assert it.

---

## 3. Process priority and QoS

### 3.1 `SetPriorityClass` (processthreadsapi.h, Kernel32)

Handle needs **`PROCESS_SET_INFORMATION`**. Classes and values: `IDLE` 0x40, `BELOW_NORMAL` 0x4000, `NORMAL` 0x20, `ABOVE_NORMAL` 0x8000, `HIGH` 0x80, `REALTIME` 0x100, plus `PROCESS_MODE_BACKGROUND_BEGIN` 0x100000 / `_END` 0x200000 (**current process only**).

Base priorities ([Scheduling Priorities](https://learn.microsoft.com/en-us/windows/win32/procthread/scheduling-priorities)): NORMAL→8, ABOVE_NORMAL→10, HIGH→13, REALTIME→24 (thread-normal).

Documented warnings, verbatim:
- HIGH: *"Use extreme care when using the high-priority class, because a high-priority class application can use nearly all available CPU time."* … *"The high-priority class should be reserved for threads that must respond to time-critical events."*
- REALTIME: *"You should almost never use REALTIME_PRIORITY_CLASS, because this interrupts system threads that manage mouse input, keyboard input, and background disk flushing."* A realtime process running >"a very brief interval" *"can cause disk caches not to flush or cause the mouse to be unresponsive."*

**Privilege:** neither the `SetPriorityClass` nor the `Scheduling Priorities` page states a privilege requirement for any class. The commonly-cited requirement is `SE_INC_BASE_PRIORITY_NAME` for REALTIME (granted to Administrators by default; a non-elevated caller silently gets HIGH instead). **`[UNVERIFIED]` on primary sources — do not assert it in product copy without testing.** ABOVE_NORMAL and HIGH on a process you own require no special privilege.

**Verdict: REJECT REALTIME outright. ABOVE_NORMAL is NEEDS-EVIDENCE (§3.4).**

### 3.2 EcoQoS via `SetProcessInformation` + `ProcessPowerThrottling` — CONFIRMED

```c
// processthreadsapi.h, Kernel32.dll, Win8+ (EcoQoS semantics: Win11)
BOOL SetProcessInformation(HANDLE hProcess, PROCESS_INFORMATION_CLASS cls,
                           LPVOID info, DWORD cb);   // hProcess needs PROCESS_SET_INFORMATION

typedef struct _PROCESS_POWER_THROTTLING_STATE {
  ULONG Version;      // PROCESS_POWER_THROTTLING_CURRENT_VERSION
  ULONG ControlMask;  // which mechanism you're taking control of
  ULONG StateMask;    // on/off for the mechanisms in ControlMask
} PROCESS_POWER_THROTTLING_STATE;
```
Flags: `PROCESS_POWER_THROTTLING_EXECUTION_SPEED`, `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION`. `cb` must be `sizeof(PROCESS_POWER_THROTTLING_STATE)`.

Three documented states ([SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)):
- **EcoQoS**: `ControlMask = EXECUTION_SPEED; StateMask = EXECUTION_SPEED`. *"The system will try to increase power efficiency through strategies such as reducing CPU frequency or using more power efficient cores."* Explicitly: *"EcoQoS should not be used for performance critical or foreground user experiences."*
- **HighQoS (opt *out* of throttling)**: `ControlMask = EXECUTION_SPEED; StateMask = 0`. **Yes — an app can opt itself out.**
- **System-managed (reset)**: `ControlMask = 0; StateMask = 0`. ← this is the correct *rollback* value.

Also documented: *"By default in Windows 11 if a window owning process becomes fully occluded, minimized, or otherwise non-visible to the end user, and non-audible, Windows may automatically ignore the timer resolution request."*

**Can it change another process?** Yes — the API takes any `HANDLE`. The requirement is only **`PROCESS_SET_INFORMATION`** on the target handle. Practically: same-user, same-or-lower integrity → works non-elevated. Elevated/protected/other-user targets → need admin (and PPL targets refuse regardless). **No named privilege beyond ordinary handle access is documented.**

**This is the single most defensible optimization in the whole list**: documented, symmetric, per-process, instantly reversible, and it maps 1:1 onto "restrain a background offender without lying to the scheduler".

QoS levels the system already assigns without any help ([QoS page](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service)): focused window → **High**, visible-not-focused → **Medium**, minimised/occluded → **Low**, background services → **Utility**, MMCSS-tagged multimedia → **Media**/**Deadline**. Note that Windows already does most of the work — which is a strong argument for *reporting* rather than *meddling*.

### 3.3 Job objects / CPU rate control — the safer restraint

`SetInformationJobObject(hJob, JobObjectCpuRateControlInformation, &info, sizeof info)` with [`JOBOBJECT_CPU_RATE_CONTROL_INFORMATION`](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information) (winnt.h, Win8+):

- `JOB_OBJECT_CPU_RATE_CONTROL_ENABLE` 0x1 (required with any other flag)
- `…_WEIGHT_BASED` 0x2 → `Weight` 1–9 (default 5) — *relative* share, degrades gracefully.
- `…_HARD_CAP` 0x4 → `CpuRate` = percent × 100 (20 % = 2000). After the cap is hit in a scheduling interval, no thread in the job runs until the next interval.
- `…_MIN_MAX_RATE` 0x10 → `MinRate`/`MaxRate`, percent × 100; mutually exclusive with WEIGHT_BASED and HARD_CAP. Sum of all MinRates system-wide must be ≤ 10000.
- `…_NOTIFY` 0x8.

**Is it safer than lowering priority?** For restraining a *known offender*, yes in one respect and no in another:
- **Safer**: it is a bounded resource cap, not a scheduling-order change, so it cannot cause priority inversion in the offender's own lock hierarchy the way IDLE_PRIORITY_CLASS can.
- **Riskier operationally**: assigning an *already-running* third-party process into your job object can break it (it inherits the job's other limits, and nested-job semantics apply), and the process may already be in a job you can't nest under. A hard cap also produces visible stalls (that is literally its design).
- **Also**: CPU rate control does not apply under RDS Dynamic Fair Share Scheduling (documented).

**Recommendation:** prefer EcoQoS (`ProcessPowerThrottling`) as the first-line restraint; keep weight-based job CPU rate control (Weight 1–3, never HARD_CAP) as a second-line option behind an explicit user action. `SetProcessPriorityBoost(hProc, FALSE)` disables the scheduler's dynamic boost — **do not touch it**, it removes a mechanism that helps interactive responsiveness; there is no evidence it helps games.

### 3.4 Is there real evidence that Above Normal improves frame times?

**No.** Searching for measured data returns only forum posts, "optimization guide" blogs and SEO content. What was found:

- A widely-cited 2018 measurement writeup ([chefkochblog](https://chefkochblog.wordpress.com/2018/02/27/does-changing-process-priority-have-any-effect-on-game-or-application-performance/)) concludes the effect is essentially nil on an otherwise-idle system.
- Sites claiming gains (e.g. "Above Normal boosted Valorant's worst-case FPS") publish no methodology, no run counts, no confidence intervals — these are not evidence.
- The mechanism argument is the honest one and it is *conditional*: raising priority only matters when there is **CPU contention**. On a modern 8–16 thread desktop running a game plus a browser, contention is usually absent, and the scheduler's existing foreground boost + High QoS already handles the focused window.

**Finding to report to the team plainly: the evidence for priority-raising is absent, not merely weak.** The defensible product behaviour is: *detect contention* (a background process consuming meaningful CPU while the game is CPU-bound), *report the offender*, and offer to restrain **the offender** (EcoQoS) rather than to promote the game. That is a claim we can back with a before/after frame-time capture.

### 3.5 What Game Mode actually does (Windows 11)

Documented behaviour only:
- Grants the game *"exclusive or priority access to hardware resources"*, and **only while it is foreground with focus** ([deprecated Game Mode portal](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/gamemode/game-mode-portal)).
- Engages the `GameMode` **PPM power profile** ([PPM options](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/configure-processor-power-management-options)), which OEMs tune.
- Surfaces as `EffectivePowerModeGameMode` through the documented effective-power-mode API.
- Microsoft's support material adds: suppresses Windows Update driver installs and restart prompts during play.
- Operates **independently of the power slider** and can be engaged in any slider mode (stated on the power-slider page).
- Microsoft's own framing: the gain *"is directly related to the number and impact of other activities running on the device"* — i.e. it does nothing on a quiet machine.

**Supported API to query or set per-app: none.** The UWP Game Mode APIs are deprecated; the toggle lives in Settings and in undocumented `GameConfigStore` keys. FrameDoctor can *observe* Game Mode via `EffectivePowerModeGameMode` and can *tell the user to turn it on*, but must not write the registry to do it.

---

## 4. Candidate optimization table

| Optimization | API / mechanism | Reversible? | Privilege | Evidence | Verdict |
|---|---|---|---|---|---|
| Throttle a background CPU offender to EcoQoS | `SetProcessInformation(ProcessPowerThrottling)`, `ControlMask=StateMask=EXECUTION_SPEED`; reset with both = 0 | **Yes, exactly** (documented reset) | `PROCESS_SET_INFORMATION` on target; none extra for same-user, non-elevated targets | STRONG (documented mechanism; effect directly measurable by our own frame-time capture) | **CANDIDATE — ship first** |
| Opt the game process out of power throttling (HighQoS) | same API, `ControlMask=EXECUTION_SPEED, StateMask=0` | Yes | as above | STRONG mechanism, WEAK outcome data (mostly matters on battery/hetero CPUs) | **CANDIDATE (battery/handheld), NEEDS-EVIDENCE on desktop** |
| Set power overlay to Best Performance during a session | undocumented `PowerSetActiveOverlayScheme`; read back with documented `PowerRegisterForEffectivePowerModeNotifications` | Yes — capture prior overlay, restore | `[UNVERIFIED]`, believed none | MEDIUM: documented that Best Performance opts *all* apps out of power throttling; no measured FPS data | **CANDIDATE, gated** — undocumented write API, must degrade gracefully if it fails or if slider is absent (non-Balanced scheme) |
| Keep display awake during gamepad-only play | `PowerCreateRequest` + `PowerSetRequest(Display\|SystemRequired)` + `PowerClearRequest` | Yes (refcounted) | None | STRONG (does exactly what it says) — but it is a *UX* fix, not a perf fix | **CANDIDATE** |
| Weight-based CPU rate cap on an offender | `SetInformationJobObject` + `JOBOBJECT_CPU_RATE_CONTROL_INFORMATION`, `ENABLE\|WEIGHT_BASED`, Weight 1–3 | Yes (revoke job / close handle) | `PROCESS_SET_QUOTA` + `PROCESS_TERMINATE` to assign | MEDIUM | **CANDIDATE, second-line, behind explicit user action** |
| Raise game to `ABOVE_NORMAL_PRIORITY_CLASS` | `SetPriorityClass` | Yes | None (same-user) | **NONE** — no methodologically sound measurement found | **NEEDS-EVIDENCE — do not ship as a default; if shipped, only as an experiment with our own A/B measurement** |
| Raise game to `HIGH_PRIORITY_CLASS` | `SetPriorityClass` | Yes | None | NONE, plus documented warning about starving the system | **REJECT** |
| `REALTIME_PRIORITY_CLASS` | `SetPriorityClass` | Yes | admin in practice | NONE; documented to break mouse/keyboard/disk-flush | **REJECT** |
| `SetProcessPriorityBoost(FALSE)` on anything | processthreadsapi | Yes | none | NONE | **REJECT** |
| Set min/max processor state (`PROCTHROTTLEMIN/MAX`) | `PowerWriteACValueIndex` + `PowerSetActiveScheme` | Yes but **persists across crash** | `[UNVERIFIED]` | WEAK; MS says defer to silicon vendor | **REJECT for writes; READ and report** |
| Switch the whole power *plan* (e.g. to High Performance) | `PowerSetActiveScheme` | Yes | `[UNVERIFIED]` | WEAK; also **hides the Win11 power slider** (documented) | **REJECT** — the overlay is the modern, less destructive lever |
| Timer resolution 0.5 ms | `timeBeginPeriod` / `NtSetTimerResolution` | Partially | none | STRONG evidence it is now useless-to-harmful (§5.1) | **REJECT** |
| "RAM cleaning" | `EmptyWorkingSet` / `SetProcessWorkingSetSize(-1,-1)` | No (damage is done) | `PROCESS_QUERY_(LIMITED_)INFORMATION` + `PROCESS_SET_QUOTA` | STRONG evidence of harm | **REJECT** |
| Disable SysMain / Windows Search / Xbox services | SCM | Yes-ish (needs admin, persists) | Admin | WEAK/NONE | **REJECT** |
| Force HAGS on | `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode` + reboot | Yes + reboot | Admin | WEAK, within-noise, mixed | **REJECT for auto-apply; surface as an informational read** |
| `SystemResponsiveness` / MMCSS `GPU Priority` / `NetworkThrottlingIndex` | MMCSS registry | Yes | Admin | Documented to be **clamped or unused** (§5.5) | **REJECT** |
| Turn Game Mode on for the user | no supported API | — | — | Documented but no API | **REJECT the write; recommend it in UI, observe via `EffectivePowerModeGameMode`** |

---

## 5. Rejected tweaks — the evidence

### 5.1 Timer resolution (`timeBeginPeriod` / `NtSetTimerResolution`)

The [timeBeginPeriod docs](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod) say it exactly:

> *"Prior to Windows 10, version 2004, this function affects a global Windows setting… **Starting with Windows 10, version 2004, this function no longer affects global timer resolution.** For processes which call this function, Windows uses the lowest value… requested by any process. For processes which have not called this function, Windows does not guarantee a higher resolution than the default system resolution."*

> *"Starting with Windows 11, if a window-owning process becomes fully occluded, minimized, or otherwise invisible or inaudible to the end user, Windows does not guarantee a higher resolution than the default system resolution."*

> *"Setting a higher resolution … can also **reduce overall system performance**, because the thread scheduler switches tasks more often. High resolutions can also prevent the CPU power management system from entering power-saving modes. **Setting a higher resolution does not improve the accuracy of the high-resolution performance counter.**"*

Bruce Dawson's [Windows Timer Resolution: The Great Rule Change](https://randomascii.wordpress.com/2020/10/04/windows-timer-resolution-the-great-rule-change/) (403s to fetchers; [mirror](https://symmetricaldatasecurity.blogspot.com/2020/10/windows-timer-resolution-great-rule.html)) documents the consequence: a third-party "timer resolution tool" setting 0.5 ms **cannot** confer that resolution on a game that has not itself called `timeBeginPeriod`. Chromium limits itself to 125 Hz on battery specifically because of the power cost.

`NtSetTimerResolution` is undocumented, and Dawson notes it is *"rarely used and never needed."*

**Conclusion: a 0.5 ms timer-resolution "hack" applied from an external tool is a no-op for the game on Win10 2004+ and a battery/thermal cost for everything else. REJECT, and add a diagnostic that *detects* such a tool running and warns about it.** The supported inverse — `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION` — exists to *ignore* a process's timer requests, which tells you which direction Microsoft considers healthy.

### 5.2 "RAM cleaning" (`EmptyWorkingSet` / `SetProcessWorkingSetSize(h, -1, -1)`)

[`EmptyWorkingSet`](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-emptyworkingset) *"Removes as many pages as possible from the working set of the specified process."* That is the whole story: it evicts resident pages to the standby list / pagefile. It does not free memory that was in use; it converts warm memory into **future hard page faults**. For a game this is the precise opposite of what you want — a mid-frame page fault is a stutter.

Windows' own guidance points the other way: the same `SetProcessInformation` page recommends `ProcessMemoryPriority` / `MEMORY_PRIORITY_LOW` so that the memory manager *trims low-priority pages first* — i.e. influence trim **order**, never force a trim.

Also note: the free-RAM number that "RAM cleaners" show improving is meaningless — unused RAM is wasted RAM, and the standby list is cache, not leak.

**REJECT. Additionally, treat another tool doing this on the machine as a stutter *cause* worth detecting.**

### 5.3 Disabling services (SysMain/Superfetch, Windows Search, Xbox)

No primary evidence in either direction. Microsoft publishes no recommendation to disable SysMain. What exists is user anecdote ("less stuttering after disabling SysMain on a budget SSD / HDD"), and the mechanism argument that Superfetch's benefit shrinks to milliseconds on SSD + ≥8 GB RAM. Against it: SysMain also drives memory compression and prefetch, and disabling it is a persistent machine-wide change requiring admin.

Windows Search: indexing is genuinely I/O- and CPU-visible, **but** it is already throttled and already scheduled at low priority, and modern Windows backs it off under load. Disabling the service breaks Start-menu and Outlook search — a large, permanent, non-obvious user cost for an unmeasured gain.

Xbox services: gating Game Bar also gates Game Mode (§3.5) and the documented `GameMode` PPM profile. Actively counterproductive.

**REJECT all three as actions. The defensible product behaviour is transient, attributable detection: "SearchIndexer.exe consumed 14 % CPU and 40 MB/s of disk during your last session's three worst frame-time spikes."** That is a diagnosis, requires no admin, and is falsifiable.

### 5.4 HAGS (Hardware-accelerated GPU Scheduling)

- **No API.** It is `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode` (REG_DWORD: 1 = off, 2 = on) **plus a reboot**, and it only takes effect if the GPU + WDDM 2.7+ driver actually expose the capability — writing the value on unsupported hardware sets a preference that does nothing.
- **Evidence is within noise and mixed.** Aggregated third-party benchmarking reports average FPS changes of roughly −2 % to +3 % across titles, i.e. margin of error; some report modest 1 %-low improvements, others report frame-pacing regressions. No primary/first-party measurement.
- Requires admin + reboot, and the effect is driver-version-dependent.

**REJECT auto-apply.** Read `HwSchMode` and the adapter's WDDM version and report the current state; leave the toggle to Windows Settings.

### 5.5 MMCSS registry "tweaks" — the strongest rejection in this document

From the [Multimedia Class Scheduler Service](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service) page (`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile`):

- **`SystemResponsiveness`**: *"values that are not evenly divisible by 10 are rounded down to the nearest multiple of 10. **Values below 10 and above 100 are clamped to 20.** A value of 100 disables MMCSS."*
  ⇒ **The famous `SystemResponsiveness = 0` "gaming tweak" is clamped straight back to the default of 20. It is a literal no-op.** Every guide that recommends it is wrong on the documentation's own terms.
- **`Tasks\Games\GPU Priority`**: *"The range of values is 0-31. **This priority is not yet used.**"* ⇒ the ubiquitous "set GPU Priority to 8" tweak changes nothing.
- **`Tasks\*\SFIO Priority`**: *"This value is not used."*
- `Tasks\*\Priority` (1–8) and `Scheduling Category` (High/Medium/Low) *are* real — but they only affect threads that have called `AvSetMmThreadCharacteristics("Games", …)`. Most games never do.
- **`NetworkThrottlingIndex`** lives in the same key. It is a real MMCSS mechanism (throttling non-multimedia network processing while a multimedia stream is active) and Microsoft did expose the registry switch, but there is no learn.microsoft.com page documenting the value semantics, and no measured gaming evidence. `[UNVERIFIED]` — and irrelevant on a machine that isn't simultaneously saturating the NIC.

**REJECT the whole family. This is the cleanest "we can prove the internet is wrong" story FrameDoctor has, and it's worth surfacing in the product as an educational finding.**

---

## 6. Elevation and the privilege model

### 6.1 The four patterns

| Pattern | Install requires | Use requires | Attack surface | Caller authentication |
|---|---|---|---|---|
| **(a) Elevated helper via `ShellExecuteEx` + `runas`** | Nothing | **A UAC prompt every time** | Smallest — helper exists only for the duration of one operation; no persistent listener | N/A — the OS authenticates the human at the consent prompt |
| **(b) Windows service + IPC** | Admin at setup (SCM registration) | Nothing (standard user talks to the pipe) | **Largest** — a permanently-running privileged endpoint reachable by any local code | You must do it: named-pipe ACL + verify the client (§6.2) |
| **(c) Scheduled task, "Run with highest privileges", triggerable by a standard user** | Admin at setup | Nothing | Medium — no listener, but the task's action is fixed at registration; arguments are the risk | Task Scheduler runs your fixed command line; **never** accept caller-supplied arguments |
| **(d) COM elevation moniker** (`Elevation:Administrator!new:{CLSID}`) | Admin at setup (COM registration **must** be in HKLM — MS states this explicitly, to stop users elevating classes they couldn't register) | **A UAC prompt** | Small-medium; a real COM interface is a real attack surface | OS consent prompt + your own checks |

Sources: [The COM Elevation Moniker](https://learn.microsoft.com/en-us/windows/win32/com/the-com-elevation-moniker), [ShellExecuteEx](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexa), [Run and RunOnce keys](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys).

**Recommendation for FrameDoctor: do not install a service, and do not install anything privileged, because §4 says nothing we want to ship needs admin.**
- EcoQoS on same-user processes: no admin.
- Power overlay: believed no admin (`[UNVERIFIED]` — test).
- Power requests: no admin.
- Reading everything (GPU counters, power settings, registry state): no admin.

If a genuinely admin-requiring feature appears later, use **(a)**: a small, signed, single-purpose helper launched with `runas`, taking a constrained verb (not a free-form command), doing one thing, exiting. It has the smallest permanent footprint and gives the user a visible, per-action consent moment — which is the right social contract for an app that modifies system settings.

### 6.2 If you do use a service + named pipe: verifying the caller

Confirmed APIs:
- [`GetNamedPipeClientProcessId(HANDLE Pipe, PULONG ClientProcessId)`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid) — winbase.h, Kernel32, Vista+. Handle must come from `CreateNamedPipe`. Siblings: `GetNamedPipeClientSessionId`, `GetNamedPipeServerProcessId`, `GetNamedPipeServerSessionId`.
- `ImpersonateNamedPipeClient` / `RevertToSelf` — to act as the caller and get their token/SID.
- `QueryFullProcessImageNameW` — image path from the PID.
- `WinVerifyTrust` + `CertGetNameString` — Authenticode signature and subject verification of that image.

**Order matters, and the naive version has a TOCTOU hole:** PID → path → verify signature is racy (the PID can be recycled between the check and the use). The hardening is:
1. `GetNamedPipeClientProcessId`.
2. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)` **and hold that handle** — this pins the PID for the lifetime of the connection.
3. `QueryFullProcessImageNameW` on **that handle**.
4. `WinVerifyTrust` the file, and check the signer subject equals your publisher CN (not just "signed").
5. `ImpersonateNamedPipeClient` and check the SID is the interactive user you expect.
6. Treat the pipe payload as untrusted regardless — authenticate the caller *and* validate the request.

Note honestly: **this is defence in depth, not a security boundary.** A local attacker running as the same user can inject into your signed UI process. Design the service's verbs so that the worst case is acceptable.

### 6.3 Named pipe security

- `PIPE_REJECT_REMOTE_CLIENTS` = **0x00000008**, passed in `dwPipeMode` of `CreateNamedPipe` — *"Connections from remote clients are automatically rejected."* (default is `PIPE_ACCEPT_REMOTE_CLIENTS` = 0). **Always set it.** ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea))
- Also set `FILE_FLAG_FIRST_PIPE_INSTANCE` (0x00080000) in `dwOpenMode` so a squatter can't pre-create your pipe name; a second creator gets `ERROR_ACCESS_DENIED`.
- **Never pass `lpSecurityAttributes = NULL`.** Documented default: *"The ACLs in the default security descriptor for a named pipe grant full control to the LocalSystem account, administrators, and the creator owner. They also grant **read access to members of the Everyone group and the anonymous account**."*

**SDDL.** SDDL SID strings are documented in [SID Strings](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-strings): `IU` = *"Interactively logged-on user"* (SECURITY_INTERACTIVE_RID), `NU` = network logon, `AN` = anonymous, `WD` = Everyone, `SY` = Local System, `BA` = built-in Administrators, `CO` = creator owner, `AC` = all app packages, `RC` = restricted code.

A reasonable "local interactive user only" pipe DACL:
```
D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x0012019b;;;IU)(D;;GA;;;NU)(D;;GA;;;AN)(D;;GA;;;AC)(D;;GA;;;RC)
```
- `P` = protected (blocks inherited ACEs).
- `GA` to `SY`/`BA` so the service and admins can manage it.
- `0x0012019b` ≈ `FILE_GENERIC_READ | FILE_GENERIC_WRITE | SYNCHRONIZE` for interactive users — grant this, **not** `GA`, so callers can't rewrite the DACL (`WRITE_DAC`).
- Explicit deny ACEs for `NU`/`AN`/`AC`/`RC` belt-and-braces on top of `PIPE_REJECT_REMOTE_CLIENTS`.
- Add `S:(ML;;NW;;;ME)` if you want a medium-integrity write-up barrier against low-IL callers.

**Stronger still, and simpler:** replace `IU` with the *specific* logon SID or user SID from your UI process's token, so the pipe is scoped to one session and one user rather than "anyone interactive". `[UNVERIFIED]` — verify the exact access mask constant on a machine; it is easy to over-grant here.

### 6.4 Risks of installing a service, and the minimum-privilege account

Documented risks and guidance ([LocalService Account](https://learn.microsoft.com/en-us/windows/win32/services/localservice-account), [LocalSystem Account](https://learn.microsoft.com/en-us/windows/win32/services/localsystem-account)):

- **LocalSystem** — *"has extensive privileges on the local computer, and acts as the computer on the network. Its token includes the NT AUTHORITY\SYSTEM and BUILTIN\Administrators SIDs."* Microsoft: *"Most services do not need such a high privilege level."*
- **NetworkService** — minimum privileges locally, but presents the **machine account** on the network. Only pick this if you need authenticated outbound network identity. FrameDoctor does not.
- **LocalService** — *"minimum privileges on the local computer and presents anonymous credentials on the network."* **This is the correct choice** if a service is unavoidable.

Additional risks worth writing down for the team: an always-running privileged process is an always-present local-privilege-escalation target; it must be patched independently of the UI; unquoted service paths and writable install directories are classic LPE bugs; the installer needs admin, which raises the bar for every install; and uninstall must reliably remove it. Combined with §4 (nothing we want needs admin), the recommendation is unchanged: **no service.**

---

## 7. Startup, sleep/resume, and lifecycle

### 7.1 Launch with Windows

| Mechanism | Admin to install? | Notes |
|---|---|---|
| `HKCU\…\CurrentVersion\Run` | **No** | Per-user, ≤260-char command line, order among entries *indeterminate*, ignored in Safe Mode. Documented: *"the system may choose to delay the execution of programs in the Run key and in the Startup group to a time when they are less likely to interfere with the foreground user experience."* |
| Startup folder (`shell:startup`) | No | Same delay behaviour; user-visible and user-removable (a virtue). |
| `HKLM\…\Run` | Yes | Machine-wide. Avoid. |
| Task Scheduler (logon trigger) | No for a per-user task; **yes** for "highest privileges" | Only mechanism that can survive the Run-key delay, add conditions, or run elevated without a prompt. |
| Service | Yes | See §6.4. |

**Recommendation: `HKCU\…\Run` (or the Startup folder).** No admin, user-discoverable, user-removable in Task Manager → Startup, and the "system may delay it" behaviour is *desirable* for a diagnostics app — we are not needed in the first two seconds of logon. Note the 260-char limit and quote the path.

### 7.2 Suspend / resume

- **`WM_POWERBROADCAST`** (0x0218), `wParam` ∈ { `PBT_APMSUSPEND` (0x04), `PBT_APMRESUMEAUTOMATIC` (0x12), `PBT_APMRESUMESUSPEND` (0x07), `PBT_APMPOWERSTATUSCHANGE` (0x0A), `PBT_POWERSETTINGCHANGE` (0x8013) }. ([events index](https://learn.microsoft.com/en-us/windows/win32/power/power-management-events))
- **`PBT_APMRESUMEAUTOMATIC` is the one to key on:** *"delivered every time the system resumes and does not indicate whether a user is present."* `PBT_APMRESUMESUSPEND` is only broadcast *afterwards*, if user activity is detected. Documented Win10 1507+ caveat: if the system resumes only to immediately hibernate, **no `WM_POWERBROADCAST` is sent at all** — so never rely on resume notification for correctness, only for promptness. ([PBT_APMRESUMEAUTOMATIC](https://learn.microsoft.com/en-us/windows/win32/power/pbt-apmresumeautomatic))
- **`PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK, &DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, &hReg)`** — powerbase.h, Powrprof.lib, Win8+. Callback `DeviceNotifyCallbackRoutine` receives `PBT_APMSUSPEND` / `PBT_APMRESUMESUSPEND` / `PBT_APMRESUMEAUTOMATIC`. **This is the right choice for a windowless/service component** and avoids needing a hidden HWND. Unregister with `PowerUnregisterSuspendResumeNotification`. ([docs](https://learn.microsoft.com/en-us/windows/win32/api/powerbase/nf-powerbase-powerregistersuspendresumenotification))
- `Microsoft.Win32.SystemEvents.PowerModeChanged` (.NET) is a wrapper over the message pump and requires a running message loop / `SystemEvents` pump thread; it has a long history of being unreliable in console/service hosts. Prefer the native registration in .NET too. `[UNVERIFIED]` on current .NET 8/9 behaviour.

### 7.3 Clocks — the correct one for telemetry timestamps

| Clock | Monotonic? | Behaviour across suspend | Affected by NTP / user clock change? |
|---|---|---|---|
| `QueryPerformanceCounter` (and .NET `Stopwatch` / `Stopwatch.GetTimestamp`, which are documented to use QPC) | **Yes** — *"QPC does not go backward"* | **Keeps counting.** Documented: *"returns the total number of ticks that have occurred since the Windows operating system was started, **including the time when the machine was in a sleep state** such as standby, hibernate, or connected standby."* | **No** — *"QPC is completely independent of the system time and UTC."* Unaffected by DST, leap seconds, time zones, admin clock changes, CPU frequency/Turbo. |
| `GetTickCount64` | Yes | Milliseconds since boot, based on *biased* interrupt time ⇒ includes sleep. Resolution only 10–16 ms. | No |
| `QueryUnbiasedInterruptTime` | Yes | **Excludes** sleep/hibernation — *"reflects only the time that the system is in the working state."* | No |
| `DateTime.UtcNow` / `GetSystemTimeAsFileTime` | **No — can jump forward or backward** | Reflects wall clock | **Yes** |
| `GetSystemTimePreciseAsFileTime` | No (same as above) | Wall clock, µs-class resolution | Yes |

**Recommendation for FrameDoctor:**
1. **All intervals, all frame times, all event ordering: QPC / `Stopwatch.GetTimestamp`.** Cache `QueryPerformanceFrequency` once at startup (documented: fixed at boot). Never convert to `double` until the last moment; multiply before dividing.
2. **Wall-clock correlation: store an anchor pair `(qpcTicks, GetSystemTimePreciseAsFileTime)` at session start**, and re-anchor on every `PBT_APMRESUMEAUTOMATIC` and on `WM_TIMECHANGE`. Derive display timestamps as `anchorUtc + (qpc - anchorQpc)/freq`. This gives monotonic ordering *and* correct wall-clock labels, and it makes a clock adjustment a visible, single re-anchor event rather than a silent corruption of the series.
3. **Never** timestamp telemetry samples with `DateTime.UtcNow` — an NTP step or a user clock change will produce out-of-order or negative-duration samples that look like real stutter.
4. Because QPC keeps counting through suspend, a suspend shows up as one enormous inter-sample delta. Use `QueryUnbiasedInterruptTime` alongside it to *distinguish* "the machine was asleep for 3 hours" from "we were starved for 3 hours" — the difference between biased and unbiased time over the gap **is** the sleep duration. That is the cleanest available suspend detector and it works even in the documented case where no `WM_POWERBROADCAST` is delivered.

### 7.4 Session change notifications

`WTSRegisterSessionNotification(hWnd, NOTIFY_FOR_THIS_SESSION)` (wtsapi32.h / Wtsapi32.lib, Vista+) → `WM_WTSSESSION_CHANGE` with `wParam` ∈ `WTS_CONSOLE_CONNECT/DISCONNECT`, `WTS_REMOTE_CONNECT/DISCONNECT`, `WTS_SESSION_LOGON/LOGOFF`, `WTS_SESSION_LOCK/UNLOCK`, `WTS_SESSION_REMOTE_CONTROL`. Must call `WTSUnRegisterSessionNotification` before destroying the window; every register needs a matching unregister. Documented gotcha: can return `RPC_S_INVALID_BINDING` if called before Terminal Services dependencies start — wait on `Global\TermSrvReadyEvent`. Services use `HandlerEx` instead. ([docs](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsregistersessionnotification))

**Why a monitoring app cares:** (1) lock/disconnect means measurements are no longer meaningful — stop sampling and mark the gap rather than recording a fake stall; (2) a session switch or RDP connect radically changes GPU/compositor behaviour (RDP has no real GPU present) and would otherwise be logged as a catastrophic performance regression; (3) **logoff is the last reliable point at which we can roll back any applied optimization** (§7.5).

### 7.5 Guaranteeing rollback if we are killed

Nothing survives `TerminateProcess` or power loss. Design accordingly, in this order:

1. **Prefer optimizations that die with the process.** A job object's limits vanish when the last handle closes; power requests are released when the process exits. Anything with this property needs no rollback machinery at all — a strong argument for preferring EcoQoS + job objects over registry/power-scheme writes.
2. **Write-ahead intent journal.** Before applying any change that *does* persist (power overlay, another process's QoS), write `{what, previousValue, appliedAtUtc, pid}` to a durable file (`%LOCALAPPDATA%\FrameDoctor\pending.json`, `FlushFileBuffers`) *before* applying it, and delete the entry after clean revert. On every startup, replay and revert any leftover entries. This is a sentinel file done properly — it records the *previous value*, not merely "something was changed".
3. **Multiple revert triggers:** normal shutdown, `WM_QUERYENDSESSION`/`WM_ENDSESSION`, `WTS_SESSION_LOGOFF`/`WTS_SESSION_LOCK`, `PBT_APMSUSPEND`, and an `AppDomain`/`SIGTERM`-equivalent handler. Cheap, and covers everything except hard kill and power loss.
4. **Startup reconciliation is the backstop for hard kill**, using (2). Because journal replay runs before anything else, the window of a stale change is "until next launch" — which is why a launch-at-logon entry (§7.1) is a *safety* feature, not just convenience.
5. **Bound the blast radius by construction:** make every persistent change idempotent and self-limiting. For the power overlay specifically, prefer to re-assert the desired overlay periodically while a session is live rather than assuming it stays — and always store the pre-session overlay in the journal.
6. **Do not** solve this with a service or a run-once scheduled task. Both require admin at install, and (2)+(4) achieve the same reliability with none of the privilege.

---

## 8. Open questions requiring a Windows machine

1. **Does `PowerSetActiveOverlayScheme` succeed from a non-elevated, standard-user process?** And does it succeed for a *standard* (non-admin) user account, not merely a non-elevated admin? This gates the whole overlay optimization.
2. **What does `PowerGetEffectiveOverlayScheme` actually return for "Balanced"/"Recommended"** — `GUID_NULL`, `3af9b8d9-…`, or `381B4222-…`? The MS page's two tables contradict each other.
3. **Do `PowerSetActiveScheme` / `PowerWriteACValueIndex` require elevation** for the current user's own scheme? Test on a clean standard-user account and on a domain-joined machine with power Group Policy applied.
4. **Exact `\GPU Engine` instance-name grammar on AMD, Intel Arc and hybrid laptops** — does `engtype_Compute` appear? How does the `luid`/`phys` pair behave with an iGPU + dGPU pair? What is the actual enumeration cost with ~200 processes?
5. **Does `SHQueryUserNotificationState` return `QUNS_BUSY` or `QUNS_ACCEPTS_NOTIFICATIONS` for a borderless-fullscreen DXGI flip-model game** on Win11 24H2+? This determines whether we can distinguish borderless from windowed without the geometry fallback.
6. **Does gamepad/controller input count as "input detected" for the user-presence QoS downgrade** (`DisableUserPresenceQos`)? If not, this is a real, previously-unreported cause of frame-rate decay in controller-only laptop/handheld sessions — potentially FrameDoctor's most valuable finding.
7. **Which real-world game processes reject `OpenProcess(PROCESS_QUERY_INFORMATION|VM_READ)`** from a non-elevated peer (EAC, BattlEye, Denuvo, Vanguard)? This determines how much of the module-list signal we can actually use, and whether we degrade gracefully.
8. **Does `SetProcessInformation(ProcessPowerThrottling)` on *another* same-user process succeed non-elevated in practice**, and does the target visibly change QoS class in Task Manager's "Power usage" column?
9. **`SE_INC_BASE_PRIORITY_NAME`** — confirm empirically which priority classes actually fail without it for a standard user.
10. **Verify the pipe SDDL and the `0x0012019b` access mask** grant exactly read+write+synchronize and *not* `WRITE_DAC`/`WRITE_OWNER`, and that a remote SMB client is rejected with `PIPE_REJECT_REMOTE_CLIENTS`.
11. **Confirm Steam/Epic/GOG registry values and manifest schemas** on a machine with multiple library drives — all install-path heuristics in §1.4 are currently `[UNVERIFIED]`.
12. **Measure the baseline**: capture frame times with and without each CANDIDATE optimization on both a desktop and a laptop, with and without synthetic background CPU load. Everything in §4 marked NEEDS-EVIDENCE resolves here, and so does the honest answer to "does this app actually help?"

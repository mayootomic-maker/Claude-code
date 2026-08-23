using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FrameDoctor.Platform.Windows.Gpu;

/// <summary>
/// NVML return codes FrameDoctor distinguishes.
/// </summary>
/// <remarks>
/// <see cref="NotSupported"/> is the one that matters most: it is the routine answer for several
/// calls on consumer parts, and it means the sensor does not exist rather than that anything
/// went wrong. Logging it as an error would fill the log with expected failures, and treating it
/// as a fault would report a working GPU as broken.
/// </remarks>
public static class NvmlReturn
{
    public const uint Success = 0;
    public const uint Uninitialized = 1;
    public const uint InvalidArgument = 2;
    public const uint NotSupported = 3;
    public const uint NoPermission = 4;
    public const uint NotFound = 6;
    public const uint InsufficientSize = 7;
    public const uint DriverNotLoaded = 9;
    public const uint LibraryNotFound = 12;
    public const uint FunctionNotFound = 13;
    public const uint GpuIsLost = 15;
    public const uint Unknown = 999;
}

/// <summary>
/// The NVIDIA Management Library entry points FrameDoctor uses.
/// </summary>
/// <remarks>
/// <para>
/// <c>nvml.dll</c> ships with the display driver. Its absence is the normal state on a machine
/// with an AMD or Intel GPU, so a failed load is an answer rather than an error, and the source
/// reports itself unavailable with a reason the System view can show.
/// </para>
/// <para>
/// Every function is versioned in NVML's own header through macros that rename them — the
/// <c>_v2</c> suffixes below are the actual exported names, not a convention of ours. Calling
/// the unsuffixed name gets a older-ABI function whose struct layout differs.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: these signatures are transcribed from the published NVML
/// ABI and cannot be executed on the Linux container this repository is developed in.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal static partial class NvmlNative
{
    private const string Nvml = "nvml.dll";

    internal const uint ClockGraphics = 0;
    internal const uint ClockMemory = 2;
    internal const uint TemperatureGpu = 0;
    internal const int DeviceNameBufferSize = 96;

    [LibraryImport(Nvml, EntryPoint = "nvmlInit_v2")]
    internal static partial uint Init();

    [LibraryImport(Nvml, EntryPoint = "nvmlShutdown")]
    internal static partial uint Shutdown();

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetCount_v2")]
    internal static partial uint GetDeviceCount(out uint count);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetHandleByIndex_v2")]
    internal static partial uint GetDeviceHandle(uint index, out nint device);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetName")]
    internal static partial uint GetName(nint device, Span<byte> name, uint length);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetUtilizationRates")]
    internal static partial uint GetUtilizationRates(nint device, out NvmlUtilization utilization);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetClockInfo")]
    internal static partial uint GetClockInfo(nint device, uint type, out uint clockMhz);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetTemperature")]
    internal static partial uint GetTemperature(nint device, uint sensor, out uint celsius);

    /// <summary>Board power draw. Returns milliwatts, not watts.</summary>
    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetPowerUsage")]
    internal static partial uint GetPowerUsage(nint device, out uint milliwatts);

    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetMemoryInfo")]
    internal static partial uint GetMemoryInfo(nint device, out NvmlMemory memory);

    /// <summary>
    /// The reasons the GPU is currently limiting its clocks.
    /// </summary>
    /// <remarks>
    /// The single most valuable call in this file. It turns a correlation — the clock fell while
    /// the card was hot — into the hardware's own statement of cause, which is the difference
    /// between "probably thermal" and a diagnosis.
    /// </remarks>
    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetCurrentClocksEventReasons")]
    internal static partial uint GetCurrentClocksEventReasons(nint device, out ulong reasons);

    /// <summary>Deprecated alias, present on drivers predating the rename.</summary>
    [LibraryImport(Nvml, EntryPoint = "nvmlDeviceGetCurrentClocksThrottleReasons")]
    internal static partial uint GetCurrentClocksThrottleReasons(nint device, out ulong reasons);

    [StructLayout(LayoutKind.Sequential)]
    internal struct NvmlUtilization
    {
        /// <summary>Percent of the sample period during which any kernel was executing.</summary>
        public uint Gpu;

        /// <summary>Percent of the sample period during which memory was being read or written.</summary>
        public uint Memory;
    }

    /// <summary>
    /// The v1 memory layout: three plain 64-bit values, in bytes.
    /// </summary>
    /// <remarks>
    /// v1 deliberately. <c>nvmlMemory_v2_t</c> requires the caller to stamp a version word
    /// computed from a macro NVML's headers do not export, and its extra field is a reserved
    /// count FrameDoctor has no use for.
    /// </remarks>
    [StructLayout(LayoutKind.Sequential)]
    internal struct NvmlMemory
    {
        public ulong Total;
        public ulong Free;
        public ulong Used;
    }
}

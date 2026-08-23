using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// Per-logical-processor clock information from the power management API.
/// </summary>
/// <remarks>
/// Preferred over WMI's <c>Win32_Processor.MaxClockSpeed</c>: it is per logical processor rather
/// than per socket, it needs no WMI (which is not trim-safe and can hang for tens of seconds on
/// a machine with a sick provider), and one call returns every processor.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static partial class PowerNative
{
    /// <summary>POWER_INFORMATION_LEVEL.ProcessorInformation.</summary>
    private const int ProcessorInformation = 11;

    private const int StatusSuccess = 0;

    [LibraryImport("powrprof.dll")]
    private static unsafe partial int CallNtPowerInformation(
        int informationLevel,
        void* inputBuffer,
        uint inputBufferLength,
        void* outputBuffer,
        uint outputBufferLength);

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessorPowerInformation
    {
        public uint Number;
        public uint MaxMhz;
        public uint CurrentMhz;
        public uint MhzLimit;
        public uint MaxIdleState;
        public uint CurrentIdleState;
    }

    /// <summary>
    /// Reads the base clock of every logical processor, in MHz.
    /// </summary>
    /// <returns>
    /// An empty array when the call fails. Callers publish the dependent metrics as unavailable
    /// rather than substituting a nominal clock, because a wrong base clock scales every derived
    /// effective clock and would turn a healthy CPU into a permanent false frequency collapse.
    /// </returns>
    internal static unsafe uint[] ReadBaseClocksMhz()
    {
        var count = Environment.ProcessorCount;
        var buffer = new ProcessorPowerInformation[count];

        fixed (ProcessorPowerInformation* p = buffer)
        {
            var bytes = (uint)(sizeof(ProcessorPowerInformation) * count);
            if (CallNtPowerInformation(ProcessorInformation, null, 0, p, bytes) != StatusSuccess)
                return [];
        }

        var result = new uint[count];
        for (var i = 0; i < count; i++) result[i] = buffer[i].MaxMhz;
        return result;
    }
}

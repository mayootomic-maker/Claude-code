using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// The Performance Data Helper entry points FrameDoctor uses.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="LibraryImportAttribute"/> throughout, so the marshalling is generated at compile
/// time and the assembly stays trim- and AOT-safe. Every signature was checked against the
/// win32metadata projection rather than transcribed from documentation, because the two disagree
/// in the places that matter — <c>PdhGetFormattedCounterValue</c>'s status is a <c>u32</c> and
/// its <c>lpdwType</c> is optional.
/// </para>
/// <para>
/// The English-named entry points are used deliberately. Counter names are localized on the
/// machine, and building a path from English strings on a German Windows silently produces a
/// counter that does not exist — which PDH reports at read time, not at add time.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal static partial class PdhNative
{
    private const string Pdh = "pdh.dll";

    /// <summary>Value is a double.</summary>
    internal const uint PdhFmtDouble = 0x0000_0200;

    /// <summary>Value is a 64-bit integer.</summary>
    internal const uint PdhFmtLarge = 0x0000_0400;

    /// <summary>Value is a 32-bit integer.</summary>
    internal const uint PdhFmtLong = 0x0000_0100;

    /// <summary>
    /// Do not cap the value at 100.
    /// </summary>
    /// <remarks>
    /// Load-bearing. <c>% Processor Utility</c> legitimately exceeds 100 under turbo, and PDH
    /// caps it by default — which would flatten exactly the readings that distinguish a boosting
    /// CPU from a throttled one.
    /// </remarks>
    internal const uint PdhFmtNoCap100 = 0x0000_8000;

    [LibraryImport(Pdh, EntryPoint = "PdhOpenQueryW", StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint PdhOpenQuery(string? dataSource, nuint userData, out nint query);

    [LibraryImport(Pdh, EntryPoint = "PdhCloseQuery")]
    internal static partial uint PdhCloseQuery(nint query);

    /// <summary>
    /// Adds a counter by its language-neutral English name.
    /// </summary>
    /// <remarks>
    /// Returns success for a counter instance that does not exist, by documented design. A
    /// successful add therefore proves nothing; the only existence proof is a formatted read
    /// after two collects. This is why every path is probed at start-up.
    /// </remarks>
    [LibraryImport(Pdh, EntryPoint = "PdhAddEnglishCounterW", StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint PdhAddEnglishCounter(
        nint query, string fullCounterPath, nuint userData, out nint counter);

    [LibraryImport(Pdh, EntryPoint = "PdhCollectQueryData")]
    internal static partial uint PdhCollectQueryData(nint query);

    [LibraryImport(Pdh, EntryPoint = "PdhGetFormattedCounterValue")]
    internal static partial uint PdhGetFormattedCounterValue(
        nint counter, uint format, nint counterType, out PdhFmtCounterValue value);

    /// <summary>
    /// A formatted counter reading.
    /// </summary>
    /// <remarks>
    /// The value is a union in C. Only the double member is declared, because every counter
    /// FrameDoctor reads is requested as <see cref="PdhFmtDouble"/> or
    /// <see cref="PdhFmtLarge"/> and both occupy the full eight bytes. Declaring the smaller
    /// members would invite a read of the wrong one.
    /// </remarks>
    [StructLayout(LayoutKind.Explicit)]
    internal struct PdhFmtCounterValue
    {
        /// <summary>Per-counter status. Nonzero means the value field is meaningless.</summary>
        [FieldOffset(0)]
        internal uint CStatus;

        [FieldOffset(8)]
        internal double DoubleValue;

        [FieldOffset(8)]
        internal long LargeValue;
    }
}

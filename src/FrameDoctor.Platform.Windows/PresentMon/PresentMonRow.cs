using System.Globalization;

namespace FrameDoctor.Platform.Windows.PresentMon;

/// <summary>
/// How a PresentMon CSV field arrived.
/// </summary>
/// <remarks>
/// Three states rather than two, because PresentMon has three. Some columns print <c>NA</c> when
/// they have nothing; others print <c>0.0000</c> through <c>WriteMetricOrZero</c> and are then
/// indistinguishable from a real zero at the character level. Collapsing those into one
/// "missing" state would be the whole reason this product exists, implemented backwards.
/// </remarks>
public enum FieldState : byte
{
    /// <summary>A real reading.</summary>
    Present = 0,

    /// <summary>The column printed <c>NA</c>.</summary>
    NotApplicable = 1,

    /// <summary>The column printed a zero that may or may not be a measurement.</summary>
    /// <remarks>
    /// Only reachable for the <c>WriteMetricOrZero</c> columns. The caller decides, using the
    /// rest of the row, whether this is a genuine zero or an absent metric; the parser refuses
    /// to guess, because guessing wrong in either direction is a fabricated measurement.
    /// </remarks>
    AmbiguousZero = 2,
}

/// <summary>A double read from a PresentMon CSV column, with how it arrived.</summary>
public readonly record struct CsvDouble(double Value, FieldState State)
{
    public static readonly CsvDouble NotApplicable = new(double.NaN, FieldState.NotApplicable);

    public bool IsPresent => State is FieldState.Present;

    /// <summary>The reading, when there certainly is one.</summary>
    public bool TryGetValue(out double value)
    {
        if (State is FieldState.Present)
        {
            value = Value;
            return true;
        }

        value = default;
        return false;
    }
}

/// <summary>
/// One parsed row of PresentMon 2.5.1 CSV output, on the pinned invocation.
/// </summary>
/// <remarks>
/// <para>
/// Only the columns FrameDoctor uses are retained. The full 26-column contract, the exact
/// missing-value sentinel per column and the source lines they were verified against are in
/// <c>docs/research/collector-implementation.md</c> §1.2.
/// </para>
/// <para>
/// This is a <see langword="struct"/> and the parser writes into it from a span without
/// allocating. At 1000 fps a per-row allocation is a megabyte a minute of garbage in the
/// collector path, which is the thing invariant 8 forbids.
/// </para>
/// </remarks>
public readonly record struct PresentMonRow
{
    public int ProcessId { get; init; }

    /// <summary>Presentation API, as reported: <c>DXGI</c>, <c>D3D9</c> or <c>Other</c>.</summary>
    /// <remarks>
    /// <c>Other</c> covers OpenGL and Vulkan, where upstream documents the CPU-pacing metrics as
    /// not meaningful. Carried so the collector can suppress them rather than publish numbers
    /// the source itself does not stand behind.
    /// </remarks>
    public PresentRuntime Runtime { get; init; }

    /// <summary>Raw <c>QueryPerformanceCounter</c> ticks at the start of this frame's CPU work.</summary>
    public ulong CpuStartQpc { get; init; }

    /// <summary>Interval between successive Present calls.</summary>
    public CsvDouble MsBetweenPresents { get; init; }

    /// <summary>Frame start to next frame start. This is the frame time FrameDoctor measures.</summary>
    public CsvDouble MsBetweenAppStart { get; init; }

    /// <summary>CPU work for this frame, excluding waiting.</summary>
    public CsvDouble MsCpuBusy { get; init; }

    /// <summary>CPU time spent waiting on the GPU or the present queue.</summary>
    public CsvDouble MsCpuWait { get; init; }

    /// <summary>GPU work for this frame.</summary>
    public CsvDouble MsGpuBusy { get; init; }

    /// <summary>Display-side interval: how long the previous frame was on screen.</summary>
    public CsvDouble MsBetweenDisplayChange { get; init; }

    /// <summary>Present call to scanout. <c>NA</c> exactly when the frame never reached the screen.</summary>
    public CsvDouble MsUntilDisplayed { get; init; }

    /// <summary>
    /// Whether this frame was presented but never displayed.
    /// </summary>
    /// <remarks>
    /// Derived, because the default metric vocabulary has no <c>Dropped</c> column. Upstream
    /// prints <c>NA</c> for <c>MsUntilDisplayed</c> exactly when <c>msUntilDisplayed == 0.0</c>,
    /// and a frame that reached the screen always has a nonzero present-to-scanout delta.
    /// <c>REQUIRES-WINDOWS-VALIDATION</c>: confirm against a capture with known drops.
    /// </remarks>
    public bool WasDropped => MsUntilDisplayed.State is FieldState.NotApplicable;

    /// <summary>
    /// Whether the CPU-pacing columns carry anything trustworthy.
    /// </summary>
    /// <remarks>
    /// Two independent reasons they may not. <c>MsBetweenAppStart</c>, <c>MsCPUBusy</c> and
    /// <c>MsCPUWait</c> are written by <c>WriteMetricOrZero</c>, so an absent value arrives as
    /// the string <c>0.0000</c>; three simultaneous zeroes on a frame that plainly took time is
    /// the signature of an absent measurement rather than of a frame that took no time. And on
    /// the <c>Other</c> runtime — OpenGL and Vulkan — upstream documents them as not meaningful
    /// at all.
    /// </remarks>
    public bool HasTrustworthyCpuPacing
    {
        get
        {
            if (Runtime is PresentRuntime.Other) return false;

            var allZero =
                MsBetweenAppStart.State is FieldState.AmbiguousZero &&
                MsCpuBusy.State is FieldState.AmbiguousZero &&
                MsCpuWait.State is FieldState.AmbiguousZero;

            return !allZero;
        }
    }
}

/// <summary>Presentation API a frame came through.</summary>
public enum PresentRuntime : byte
{
    Unknown = 0,
    Dxgi = 1,
    D3D9 = 2,

    /// <summary>Anything else, in practice OpenGL and Vulkan.</summary>
    Other = 3,
}

/// <summary>
/// Parses PresentMon 2.5.1 CSV rows without allocating.
/// </summary>
/// <remarks>
/// The column layout is not discovered from the header by position alone — it is validated
/// against the header, and a mismatch is a hard failure. Silently reading column 16 as the frame
/// time because a future PresentMon inserted a column would produce a plausible-looking chart of
/// the wrong metric, which is worse than not running.
/// </remarks>
public static class PresentMonCsvParser
{
    /// <summary>
    /// The header FrameDoctor pins, verbatim.
    /// </summary>
    /// <remarks>
    /// Produced by <c>--qpc_time</c> with display and GPU tracking on and input, frame-type and
    /// hybrid-present tracking off. Verified against <c>PresentMon/CsvOutput.cpp:521-648</c>.
    /// </remarks>
    public const string PinnedHeader =
        "Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags," +
        "AllowsTearing,PresentMode,TimeInQPC,MsBetweenSimulationStart,MsBetweenPresents," +
        "MsBetweenDisplayChange,MsInPresentAPI,MsRenderPresentLatency,MsUntilDisplayed," +
        "CPUStartQPC,MsBetweenAppStart,MsCPUBusy,MsCPUWait,MsGPULatency,MsGPUTime,MsGPUBusy," +
        "MsGPUWait,MsAnimationError,AnimationTime,MsFlipDelay";

    private const int ColProcessId = 1;
    private const int ColPresentRuntime = 3;
    private const int ColMsBetweenPresents = 10;
    private const int ColMsBetweenDisplayChange = 11;
    private const int ColMsUntilDisplayed = 14;
    private const int ColCpuStartQpc = 15;
    private const int ColMsBetweenAppStart = 16;
    private const int ColMsCpuBusy = 17;
    private const int ColMsCpuWait = 18;
    private const int ColMsGpuBusy = 21;
    private const int ColumnCount = 26;

    /// <summary>Columns written by <c>WriteMetricOrZero</c>, whose zeroes are ambiguous.</summary>
    private static bool IsWriteMetricOrZeroColumn(int column) =>
        column is ColMsBetweenAppStart or ColMsCpuBusy or ColMsCpuWait;

    /// <summary>
    /// Whether a line is the header row FrameDoctor expects.
    /// </summary>
    /// <returns>
    /// <see langword="true"/> only for an exact match. A near-match is treated as unknown, not
    /// as close enough.
    /// </returns>
    public static bool IsPinnedHeader(ReadOnlySpan<char> line) =>
        line.Trim().SequenceEqual(PinnedHeader);

    /// <summary>Whether a line could be a data row at all.</summary>
    /// <remarks>
    /// PresentMon writes warnings and the ETW-status line to the same stdout the CSV goes to, so
    /// the reader cannot assume every line is a row. A data row starts with the application name
    /// and its second field is a process id; a warning line does not survive that.
    /// </remarks>
    public static bool LooksLikeDataRow(ReadOnlySpan<char> line) =>
        !line.IsEmpty && !IsPinnedHeader(line) && line.Count(',') == ColumnCount - 1;

    /// <summary>Parses one data row.</summary>
    /// <returns><see langword="false"/> if the line is not a well-formed row.</returns>
    public static bool TryParse(ReadOnlySpan<char> line, out PresentMonRow row)
    {
        row = default;

        var processId = 0;
        var runtime = PresentRuntime.Unknown;
        ulong cpuStartQpc = 0;
        var betweenPresents = CsvDouble.NotApplicable;
        var betweenDisplayChange = CsvDouble.NotApplicable;
        var untilDisplayed = CsvDouble.NotApplicable;
        var betweenAppStart = CsvDouble.NotApplicable;
        var cpuBusy = CsvDouble.NotApplicable;
        var cpuWait = CsvDouble.NotApplicable;
        var gpuBusy = CsvDouble.NotApplicable;

        var column = 0;
        var rest = line;

        while (true)
        {
            var comma = rest.IndexOf(',');
            var field = comma < 0 ? rest : rest[..comma];

            switch (column)
            {
                case ColProcessId:
                    if (!int.TryParse(field, NumberStyles.Integer, CultureInfo.InvariantCulture, out processId))
                        return false;
                    break;
                case ColPresentRuntime:
                    runtime = ParseRuntime(field);
                    break;
                case ColCpuStartQpc:
                    if (!ulong.TryParse(field, NumberStyles.Integer, CultureInfo.InvariantCulture, out cpuStartQpc))
                        return false;
                    break;
                case ColMsBetweenPresents:
                    betweenPresents = ParseField(field, column);
                    break;
                case ColMsBetweenDisplayChange:
                    betweenDisplayChange = ParseField(field, column);
                    break;
                case ColMsUntilDisplayed:
                    untilDisplayed = ParseField(field, column);
                    break;
                case ColMsBetweenAppStart:
                    betweenAppStart = ParseField(field, column);
                    break;
                case ColMsCpuBusy:
                    cpuBusy = ParseField(field, column);
                    break;
                case ColMsCpuWait:
                    cpuWait = ParseField(field, column);
                    break;
                case ColMsGpuBusy:
                    gpuBusy = ParseField(field, column);
                    break;
                default:
                    break;
            }

            column++;
            if (comma < 0) break;
            rest = rest[(comma + 1)..];
        }

        if (column != ColumnCount) return false;

        row = new PresentMonRow
        {
            ProcessId = processId,
            Runtime = runtime,
            CpuStartQpc = cpuStartQpc,
            MsBetweenPresents = betweenPresents,
            MsBetweenAppStart = betweenAppStart,
            MsCpuBusy = cpuBusy,
            MsCpuWait = cpuWait,
            MsGpuBusy = gpuBusy,
            MsBetweenDisplayChange = betweenDisplayChange,
            MsUntilDisplayed = untilDisplayed,
        };
        return true;
    }

    private static PresentRuntime ParseRuntime(ReadOnlySpan<char> field) => field switch
    {
        "DXGI" => PresentRuntime.Dxgi,
        "D3D9" => PresentRuntime.D3D9,
        "Other" => PresentRuntime.Other,
        _ => PresentRuntime.Unknown,
    };

    private static CsvDouble ParseField(ReadOnlySpan<char> field, int column)
    {
        if (field.SequenceEqual("NA")) return CsvDouble.NotApplicable;

        if (!double.TryParse(field, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            return CsvDouble.NotApplicable;

        // A zero is only ambiguous in the columns that print one for a missing value. Elsewhere
        // a zero is a measurement and must be kept as one.
        if (value == 0 && IsWriteMetricOrZeroColumn(column))
            return new CsvDouble(0, FieldState.AmbiguousZero);

        return new CsvDouble(value, FieldState.Present);
    }
}

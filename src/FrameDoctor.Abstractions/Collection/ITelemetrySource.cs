using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Abstractions.Collection;

/// <summary>
/// A source of telemetry. Implemented once per measurement mechanism, never per metric.
/// </summary>
/// <remarks>
/// <para>
/// This is the seam that keeps the product testable. Everything Windows-specific — a CSV parser
/// reading PresentMon's stdout, a PDH query, an NVML P/Invoke — lives behind this interface, and
/// nothing above it knows which. The portable core is exercised on Linux against simulation and
/// replay implementations of the same contract.
/// </para>
/// <para>
/// <b>Collectors contain no diagnostic logic</b> (invariant 2). A collector converts a
/// measurement mechanism into <see cref="TelemetrySample"/> values and stops there. It does not
/// smooth, threshold, classify, or decide that a reading is implausible — the last of those is
/// the most tempting and the most damaging, because a collector that quietly discards outliers
/// is discarding exactly the stutters this product exists to find.
/// </para>
/// </remarks>
public interface ITelemetrySource : IAsyncDisposable
{
    /// <summary>Provenance stamped onto every sample this source produces.</summary>
    SourceId Id { get; }

    /// <summary>Name for the System view, resolved after probing where hardware allows.</summary>
    string DisplayName { get; }

    /// <summary>Metrics this source attempts. What it actually delivers comes from the probe.</summary>
    IReadOnlyList<MetricId> DeclaredMetrics { get; }

    /// <summary>
    /// Determines what this source can measure here, without committing to collect anything.
    /// </summary>
    /// <remarks>
    /// Must not throw for an absent sensor, a missing driver or a denied privilege: those are
    /// answers, and returning them as a probe result is the entire point. Exceptions are for a
    /// source that is broken rather than unavailable.
    /// </remarks>
    ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken);

    /// <summary>Begins collection. Only called after a probe reported the source available.</summary>
    ValueTask StartAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Where in the graphics pipeline a frame time is measured.
/// </summary>
/// <remarks>
/// Carried into diagnosis because it changes what a smooth trace means. A present-to-present
/// series can look perfectly even while the display shows a stutter the user can see, because
/// the stall happened after the present call returned. Reporting both as "frame time" without
/// distinction would let FrameDoctor give a confident all-clear on a visible problem.
/// </remarks>
public enum FrameTimeBasis : byte
{
    Unknown = 0,

    /// <summary>Interval between successive Present calls. The common case.</summary>
    PresentToPresent = 1,

    /// <summary>Interval between successive scanouts. Closest to what the user sees.</summary>
    DisplayedToDisplayed = 2,

    /// <summary>Interval between successive CPU-side frame submissions.</summary>
    CpuSubmitToSubmit = 3,
}

/// <summary>One presented frame.</summary>
/// <param name="Timestamp">When the frame was presented, on the monotonic clock.</param>
/// <param name="FrameTimeMs">
/// Interval since the previous frame, in the source's <see cref="FrameTimeBasis"/>. Always a
/// real measurement: a source with nothing to report emits no frame rather than a zero.
/// </param>
/// <param name="DisplayedTimeMs">
/// Interval between scanouts, when the source can measure it. <see langword="null"/> means this
/// source cannot measure it — never zero, which would read as a dropped frame.
/// </param>
/// <param name="Dropped">
/// The frame was presented but never scanned out. Distinct from a long frame: a dropped frame
/// is invisible in a present-to-present series and visible to the user.
/// </param>
/// <param name="ProcessId">The presenting process, for attributing frames to the right game.</param>
public readonly record struct FramePresent(
    MonotonicTimestamp Timestamp,
    double FrameTimeMs,
    double? DisplayedTimeMs,
    bool Dropped,
    int ProcessId);

/// <summary>A source of per-frame timing.</summary>
/// <remarks>
/// Separate from <see cref="ISensorSource"/> because the shapes genuinely differ: frames arrive
/// when the game presents them, at hundreds per second, and are pushed; sensors are read on a
/// schedule and are pulled. Forcing both through one interface would make one of them lie about
/// its cadence.
/// </remarks>
public interface IFrameSource : ITelemetrySource
{
    /// <summary>What the frame times actually measure.</summary>
    FrameTimeBasis Basis { get; }

    /// <summary>
    /// The stream of presented frames, ending when collection stops or the token is cancelled.
    /// </summary>
    IAsyncEnumerable<FramePresent> ReadFramesAsync(CancellationToken cancellationToken);
}

/// <summary>A source read on a fixed schedule.</summary>
public interface ISensorSource : ITelemetrySource
{
    /// <summary>How often <see cref="Poll"/> should be called.</summary>
    /// <remarks>
    /// Declared by the source rather than imposed, because the underlying mechanisms have real
    /// minimum intervals — a PDH rate counter sampled faster than its update period returns the
    /// same value twice, which would read as a perfectly stable metric rather than as no new
    /// information.
    /// </remarks>
    TimeSpan Interval { get; }

    /// <summary>Upper bound on samples one <see cref="Poll"/> can write.</summary>
    int MaxSamplesPerPoll { get; }

    /// <summary>
    /// Reads the source into a caller-owned span, returning how many samples were written.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The span is the reason this is not <c>IEnumerable&lt;TelemetrySample&gt;</c>. Collection
    /// runs for the entire length of a gaming session; an enumerable would allocate on every
    /// poll of every source, and allocation in the collector path becomes GC pressure becomes a
    /// stutter — the exact thing this product exists to prevent (invariant 8).
    /// </para>
    /// <para>
    /// A source that cannot read a metric this poll writes an unavailable sample for it rather
    /// than writing nothing, so a metric disappearing is distinguishable from a metric that was
    /// never attempted.
    /// </para>
    /// </remarks>
    /// <param name="now">Timestamp to stamp the samples with.</param>
    /// <param name="destination">
    /// At least <see cref="MaxSamplesPerPoll"/> long. Implementations throw rather than
    /// truncate: a silently short read would drop metrics without anything noticing.
    /// </param>
    int Poll(MonotonicTimestamp now, Span<TelemetrySample> destination);
}

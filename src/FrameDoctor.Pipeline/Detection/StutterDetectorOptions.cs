namespace FrameDoctor.Pipeline.Detection;

/// <summary>
/// Tuning constants for <see cref="StutterDetector"/>.
/// </summary>
/// <remarks>
/// These are deliberately <b>not</b> user settings. A sensitivity slider is a way of avoiding a
/// decision, and it makes every session incomparable with every other. They are options only so
/// that tests can pin them and so the values are named rather than scattered as literals.
/// </remarks>
public sealed record StutterDetectorOptions
{
    /// <summary>
    /// Multiplier on the robust scale.
    /// </summary>
    /// <remarks>
    /// Chosen by sweep: false positives reach zero at 5 on both hard regimes (vsync-locked and
    /// unstable 25–40 fps), and 6 takes one step of margin.
    /// </remarks>
    public double ScaleMultiplier { get; init; } = 6.0;

    /// <summary>Absolute floor on the threshold, whatever the scale says.</summary>
    /// <remarks>
    /// On a vsync-locked series the scale is ~0.03 ms, so six sigma is 0.18 ms and every
    /// rounding wobble would register as a stutter. The floor is what makes near-zero-variance
    /// series behave.
    /// </remarks>
    public double AbsoluteFloorMs { get; init; } = 3.0;

    /// <summary>Threshold floor as a fraction of the display's refresh interval.</summary>
    public double RefreshIntervalFloorFraction { get; init; } = 0.5;

    /// <summary>Threshold floor as a fraction of the baseline median.</summary>
    public double MedianFloorFraction { get; init; } = 0.5;

    /// <summary>Threshold ceiling as a multiple of the baseline median.</summary>
    /// <remarks>Stops a pathological window from raising the threshold until nothing can fire.</remarks>
    public double MedianCeilingMultiple { get; init; } = 3.0;

    /// <summary>Fraction of the threshold below which frames count toward closing an event.</summary>
    public double CloseHysteresisFraction { get; init; } = 0.5;

    /// <summary>Consecutive recovered frames required to close an event.</summary>
    public int MinimumCloseFrames { get; init; } = 4;

    /// <summary>Recovery duration required to close an event.</summary>
    public TimeSpan CloseDuration { get; init; } = TimeSpan.FromMilliseconds(250);

    /// <summary>A new excursion within this window merges into the previous event.</summary>
    /// <remarks>
    /// Without it, a compound hitch that decays over a dozen frames is reported as a dozen
    /// separate stutters, and a burst of micro-hitches becomes an unreadable train of markers.
    /// </remarks>
    public TimeSpan MergeWindow { get; init; } = TimeSpan.FromMilliseconds(500);

    /// <summary>An event open longer than this is force-closed.</summary>
    /// <remarks>
    /// The baseline is frozen while an event is open. Without a timeout, a pathological event
    /// that never recovers would freeze the baseline permanently and blind the detector for the
    /// rest of the session.
    /// </remarks>
    public TimeSpan MaximumEventDuration { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>Frames required before detection is trusted.</summary>
    public int WarmUpFrames { get; init; } = 300;

    /// <summary>Elapsed time required before detection is trusted.</summary>
    public TimeSpan WarmUpDuration { get; init; } = TimeSpan.FromSeconds(3);

    /// <summary>Successive differences required before the scale estimate is trusted.</summary>
    public int WarmUpDifferences { get; init; } = 50;

    /// <summary>Rolling window length for level and scale.</summary>
    public TimeSpan WindowDuration { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>How often level and scale are recomputed.</summary>
    /// <remarks>
    /// A ten-second rolling median cannot move meaningfully in 100 ms, and recomputing it per
    /// frame at 1000 Hz would be a real overhead defect. Between refreshes the threshold is a
    /// held constant and the per-frame test is a single comparison.
    /// </remarks>
    public TimeSpan RefreshInterval { get; init; } = TimeSpan.FromMilliseconds(100);

    /// <summary>Micro-stutter ceiling, as a multiple of the refresh interval.</summary>
    public double MicroStutterRefreshMultiple { get; init; } = 2.0;

    /// <summary>Micro-stutter ceiling, absolute floor.</summary>
    public double MicroStutterFloorMs { get; init; } = 8.0;

    /// <summary>Stutter ceiling, as a multiple of the refresh interval.</summary>
    public double StutterRefreshMultiple { get; init; } = 6.0;

    /// <summary>Stutter ceiling, absolute floor. Above this it is a severe hitch.</summary>
    public double StutterFloorMs { get; init; } = 40.0;

    public static StutterDetectorOptions Default { get; } = new();
}

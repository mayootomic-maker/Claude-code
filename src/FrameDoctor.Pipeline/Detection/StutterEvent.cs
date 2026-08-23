using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Pipeline.Detection;

/// <summary>
/// A detected frame-timing anomaly, with the baseline it was judged against.
/// </summary>
/// <param name="Class">What kind of anomaly.</param>
/// <param name="Start">When the event opened.</param>
/// <param name="End">When it closed.</param>
/// <param name="PeakFrameTimeMs">Worst single frame time within the event.</param>
/// <param name="ExcessMs">Peak frame time minus the baseline median.</param>
/// <param name="ThresholdMs">The threshold in force when it opened.</param>
/// <param name="BaselineMedianMs">Rolling median at the moment of detection.</param>
/// <param name="BaselineScaleMs">Robust scale at the moment of detection.</param>
/// <param name="FrameCount">Frames inside the event.</param>
/// <param name="MergedCount">How many separate excursions were merged into this event.</param>
/// <param name="DuringWarmUp">
/// Whether this occurred before the baseline was trusted. Shader compilation and level loading
/// produce real hitches during warm-up that are of little diagnostic use, so they are recorded
/// and flagged rather than counted alongside steady-state events.
/// </param>
/// <param name="ForceClosed">
/// Whether the event was closed by timeout rather than by recovery, meaning frame times never
/// returned to baseline.
/// </param>
/// <remarks>
/// The baseline is carried on the event rather than looked up later, because it is the thing
/// that makes the event meaningful: "142 ms" means nothing without "against a 6.9 ms median".
/// It also makes the detection reproducible after the fact, which a stored threshold does not.
/// </remarks>
public sealed record StutterEvent(
    StutterClass Class,
    MonotonicTimestamp Start,
    MonotonicTimestamp End,
    double PeakFrameTimeMs,
    double ExcessMs,
    double ThresholdMs,
    double BaselineMedianMs,
    double BaselineScaleMs,
    int FrameCount,
    int MergedCount,
    bool DuringWarmUp,
    bool ForceClosed)
{
    public TimeSpan Duration => End - Start;

    /// <summary>Whether this event should count toward the session's headline stutter tally.</summary>
    /// <remarks>
    /// Warm-up events and regime changes are real observations but are not what a user means by
    /// "my game stuttered", so counting them would inflate the number that matters most.
    /// </remarks>
    public bool CountsTowardTally =>
        !DuringWarmUp && Class is StutterClass.MicroStutter or StutterClass.Stutter
            or StutterClass.SevereHitch or StutterClass.PacingMicroStutter
            or StutterClass.DroppedFrameBurst;

    public bool IsSevere => Class == StutterClass.SevereHitch;
}

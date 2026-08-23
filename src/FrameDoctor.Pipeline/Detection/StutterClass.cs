namespace FrameDoctor.Pipeline.Detection;

/// <summary>
/// Severity and kind of a detected frame-timing anomaly.
/// </summary>
/// <remarks>
/// The adaptive threshold decides <i>whether</i> something is an outlier; these classes decide
/// <i>what kind</i>, on absolute perceptual grounds relative to the display's refresh interval.
/// A 20 ms excess is a different experience at 60 Hz than at 240 Hz.
/// </remarks>
public enum StutterClass : byte
{
    /// <summary>Within normal variance for the current regime.</summary>
    Normal = 0,

    /// <summary>Perceptible unevenness, under roughly two refresh intervals.</summary>
    MicroStutter = 1,

    /// <summary>A clear hitch.</summary>
    Stutter = 2,

    /// <summary>A large hitch, well beyond several refresh intervals.</summary>
    SevereHitch = 3,

    /// <summary>
    /// Frame times are evenly paced but the simulation timestep does not match them.
    /// </summary>
    /// <remarks>
    /// Detected from animation error, not frame time. A game can present at a metronomically
    /// even cadence and still look juddery; a frame-time-only detector reports "healthy"
    /// through this entire category.
    /// </remarks>
    PacingMicroStutter = 4,

    /// <summary>Frames were presented but never displayed.</summary>
    DroppedFrameBurst = 5,

    /// <summary>
    /// Performance is uniformly degraded rather than spiky.
    /// </summary>
    /// <remarks>
    /// A window state, not an outlier — no individual frame need exceed the threshold. Without
    /// this class a slow thermal ramp produces zero events and looks like a clean session.
    /// </remarks>
    SustainedLowPerformance = 6,

    /// <summary>
    /// The baseline itself shifted, e.g. a scene transition or a settings change.
    /// </summary>
    /// <remarks>
    /// Not a stutter. A rolling median lags an abrupt regime change by its window length, which
    /// would otherwise produce exactly one false event per scene transition.
    /// </remarks>
    RegimeChange = 7,
}

using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Abstractions.Collection;

/// <summary>
/// What one metric of one source can actually provide on this machine, right now.
/// </summary>
/// <param name="Metric">The metric.</param>
/// <param name="State">
/// <see cref="Availability.Available"/> when the source produced a real reading during the
/// probe. Anything else means the System view must render the metric as absent.
/// </param>
/// <param name="Reason">Why, when <paramref name="State"/> is not available.</param>
/// <param name="Detail">
/// One sentence a user can act on, in their words rather than the API's. "GeForce RTX 4070 does
/// not report a hotspot temperature" beats "NVML_ERROR_NOT_SUPPORTED".
/// </param>
public readonly record struct MetricAvailability(
    MetricId Metric,
    Availability State,
    UnavailableReason Reason,
    string Detail)
{
    public bool IsAvailable => State is Availability.Available;

    public static MetricAvailability Available(MetricId metric) =>
        new(metric, Availability.Available, UnavailableReason.None, string.Empty);

    public static MetricAvailability Missing(MetricId metric, UnavailableReason reason, string detail) =>
        new(metric, Availability.Unavailable, reason, detail);

    public static MetricAvailability Denied(MetricId metric, string detail) =>
        new(metric, Availability.Denied, UnavailableReason.InsufficientPrivilege, detail);
}

/// <summary>
/// The result of asking a source what it can do, before anything depends on the answer.
/// </summary>
/// <remarks>
/// <para>
/// Probing is separate from starting for a reason that is a product requirement rather than a
/// design nicety: the System view has to be able to tell the user, per metric, what is being
/// measured and what is not and why. A source that discovers its own limitations only once it
/// is running cannot answer that, and the UI would have to fall back on a shrug.
/// </para>
/// <para>
/// A probe is also the only honest place to establish a metric's absence. A source that returns
/// nothing for a metric during a poll is ambiguous — it may have failed this once. A source
/// that reported at probe time that the hardware has no such sensor is not.
/// </para>
/// </remarks>
/// <param name="Source">Which collector this describes.</param>
/// <param name="DisplayName">Name for the System view, e.g. "NVIDIA NVML (RTX 4070)".</param>
/// <param name="IsAvailable">Whether the source can run at all.</param>
/// <param name="Reason">Why not, when it cannot.</param>
/// <param name="Detail">One sentence explaining the state, actionable where possible.</param>
/// <param name="Metrics">Per-metric availability. Empty when the source itself is unavailable.</param>
public sealed record SourceProbe(
    SourceId Source,
    string DisplayName,
    bool IsAvailable,
    UnavailableReason Reason,
    string Detail,
    IReadOnlyList<MetricAvailability> Metrics)
{
    public static SourceProbe Working(
        SourceId source,
        string displayName,
        IReadOnlyList<MetricAvailability> metrics) =>
        new(source, displayName, true, UnavailableReason.None, string.Empty, metrics);

    public static SourceProbe NotWorking(
        SourceId source,
        string displayName,
        UnavailableReason reason,
        string detail) =>
        new(source, displayName, false, reason, detail, []);

    /// <summary>Metrics this source will genuinely produce, for wiring up the pipeline.</summary>
    public IEnumerable<MetricId> WorkingMetrics =>
        IsAvailable ? Metrics.Where(m => m.IsAvailable).Select(m => m.Metric) : [];
}

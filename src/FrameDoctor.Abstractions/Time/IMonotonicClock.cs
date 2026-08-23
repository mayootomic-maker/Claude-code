namespace FrameDoctor.Abstractions.Time;

/// <summary>
/// The session clock. Monotonic, independent of wall-clock time.
/// </summary>
/// <remarks>
/// On Windows this is backed by <c>QueryPerformanceCounter</c>, which is documented not to go
/// backward, to be independent of system time, and to keep counting through sleep.
/// </remarks>
public interface IMonotonicClock
{
    /// <summary>Time elapsed since the session epoch.</summary>
    MonotonicTimestamp Now { get; }

    /// <summary>
    /// Wall-clock time corresponding to the session epoch, for display only.
    /// </summary>
    /// <remarks>
    /// Re-anchored on resume and on a system time change, so a clock correction is a single
    /// visible event rather than a silent corruption of every stored interval.
    /// </remarks>
    DateTimeOffset EpochUtc { get; }

    /// <summary>Converts a session timestamp to wall clock, for display only.</summary>
    DateTimeOffset ToUtc(MonotonicTimestamp timestamp);
}

/// <summary>
/// A break in the telemetry series across which statistics must not be computed.
/// </summary>
/// <param name="Start">Last trustworthy sample before the break.</param>
/// <param name="Resume">First trustworthy sample after it.</param>
/// <param name="Kind">What caused the break.</param>
/// <remarks>
/// Rolling windows, percentiles and baselines all reset across a discontinuity. Averaging a
/// frame-time window that spans a three-hour sleep would report a stutter that never happened.
/// </remarks>
public readonly record struct Discontinuity(
    MonotonicTimestamp Start,
    MonotonicTimestamp Resume,
    DiscontinuityKind Kind)
{
    public TimeSpan Gap => Resume - Start;
}

/// <summary>What caused a break in the telemetry series.</summary>
public enum DiscontinuityKind : byte
{
    /// <summary>The machine slept or hibernated.</summary>
    /// <remarks>
    /// Detected from the difference between biased and unbiased interrupt time, because the
    /// documented resume notification is not guaranteed to arrive.
    /// </remarks>
    Suspend = 1,

    /// <summary>The session was locked or disconnected; measurement is not meaningful.</summary>
    SessionInactive = 2,

    /// <summary>
    /// The collector was starved: real time passed but the machine did not sleep.
    /// </summary>
    /// <remarks>
    /// Detected when elapsed monotonic time greatly exceeds elapsed sleep-excluded time.
    /// This is FrameDoctor's own tripwire for invariant 8 — if we were starved, our samples
    /// around the gap are suspect and are marked <see cref="Telemetry.Quality.Degraded"/> rather than
    /// silently trusted.
    /// </remarks>
    CollectorStarved = 3,

    /// <summary>Wall-clock time was stepped; the display anchor was rebuilt.</summary>
    ClockStepped = 4,

    /// <summary>The telemetry source restarted.</summary>
    SourceRestarted = 5,
}

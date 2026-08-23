namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// How the value was obtained, and therefore how much diagnostic weight it may carry.
/// </summary>
/// <remarks>
/// Quality propagates into confidence scoring rather than being advisory. A diagnosis built
/// on <see cref="Estimated"/> or <see cref="Degraded"/> evidence cannot reach the same
/// confidence as one built on <see cref="Exact"/> evidence, and that ceiling is enforced in
/// the scoring code rather than left to whoever reads the output.
/// </remarks>
public enum Quality : byte
{
    /// <summary>Directly measured.</summary>
    Exact = 0,

    /// <summary>Computed from other measurements, e.g. effective clock from a performance ratio.</summary>
    Derived = 1,

    /// <summary>Modelled or interpolated. Carries reduced diagnostic weight.</summary>
    Estimated = 2,

    /// <summary>Measured, but the source reported dropped events or missed intervals.</summary>
    Degraded = 3,
}

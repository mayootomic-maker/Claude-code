namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Physical unit of a metric value.
/// </summary>
/// <remarks>
/// Carried on every sample so the UI never has to infer a unit from a metric name, and so a
/// unit mismatch between a collector and a consumer is detectable rather than silent.
/// </remarks>
public enum Unit : byte
{
    None = 0,
    Milliseconds = 1,
    MillisecondsSquared = 2,
    FramesPerSecond = 3,
    Percent = 4,
    Megahertz = 5,
    Celsius = 6,
    Watts = 7,
    Megabytes = 8,
    BytesPerSecond = 9,
    Count = 10,
    PerSecond = 11,
    /// <summary>A bitmask or enumerated state, not a scalar quantity.</summary>
    Flags = 12,
}

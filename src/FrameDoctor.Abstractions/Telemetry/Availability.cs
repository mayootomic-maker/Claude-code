namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Whether a sample carries a real reading.
/// </summary>
/// <remarks>
/// <para>
/// The rule this type exists to enforce: <b>a missing metric is never zero.</b>
/// </para>
/// <para>
/// Reading an absent temperature sensor as 0 °C and concluding the CPU is cold, or an absent
/// GPU utilization as 0 % and concluding GPU starvation, is the most damaging class of false
/// diagnosis available to this product. Making unavailability a distinct state — rather than
/// a sentinel value someone forgets to check — is what prevents it.
/// </para>
/// </remarks>
public enum Availability : byte
{
    /// <summary>A real reading.</summary>
    Available = 0,

    /// <summary>No sensor, or this source cannot provide the metric on this hardware.</summary>
    Unavailable = 1,

    /// <summary>The metric exists but we lack the privilege to read it.</summary>
    /// <remarks>Distinct from <see cref="Unavailable"/> because the user can act on it.</remarks>
    Denied = 2,

    /// <summary>The source errored. May recover.</summary>
    Failed = 3,

    /// <summary>Last known value, older than its expected interval.</summary>
    /// <remarks>Carries a usable value, but the UI must show its age.</remarks>
    Stale = 4,
}

/// <summary>
/// Why a metric is not <see cref="Availability.Available"/>.
/// </summary>
/// <remarks>
/// Exists so the UI can tell the user something actionable instead of a bare dash. "GPU
/// temperature unavailable" is a shrug; "requires a kernel-mode sensor driver" is a decision
/// the user can make.
/// </remarks>
public enum UnavailableReason : byte
{
    None = 0,

    /// <summary>The hardware exposes no such sensor.</summary>
    NoSensor = 1,

    /// <summary>The metric requires a kernel-mode sensor driver that is not installed.</summary>
    RequiresSensorDriver = 2,

    /// <summary>The caller lacks the privilege or group membership required.</summary>
    InsufficientPrivilege = 3,

    /// <summary>The vendor API for this device does not expose the metric.</summary>
    NotExposedByVendor = 4,

    /// <summary>Fewer samples than the metric's documented minimum.</summary>
    /// <remarks>
    /// A 0.1 % low computed from 300 frames describes a single frame. Reporting it as a
    /// stable metric would be dishonest, and comparing two such values across sessions would
    /// manufacture regressions that do not exist.
    /// </remarks>
    InsufficientData = 5,

    /// <summary>The source is running but has not yet produced a first reading.</summary>
    NotYetSampled = 6,

    /// <summary>The source crashed or stopped responding.</summary>
    SourceFaulted = 7,

    /// <summary>All ETW slots for a required provider are in use by other processes.</summary>
    /// <remarks>
    /// Windows permits only a limited number of concurrent sessions per manifest provider.
    /// Overlay and capture tools commonly hold them. Rendering this as zero would produce a
    /// clean frame-time chart and a confidently wrong all-clear.
    /// </remarks>
    EtwProviderSlotsExhausted = 8,

    /// <summary>The target process denied inspection, commonly anti-cheat or DRM.</summary>
    TargetProcessProtected = 9,

    /// <summary>Measurement is meaningless in the current state, e.g. a locked session.</summary>
    NotMeaningfulInCurrentState = 10,

    /// <summary>Sampling spans a clock discontinuity, so the interval cannot be trusted.</summary>
    ClockDiscontinuity = 11,
}

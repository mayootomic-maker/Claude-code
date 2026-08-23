namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Why a GPU reduced its clocks, as the vendor reports it.
/// </summary>
/// <remarks>
/// <para>
/// Values are NVIDIA's clocks-event-reason bitmask, stored raw on the
/// <see cref="MetricId.GpuThrottleReason"/> metric so that a session recorded today can be
/// reinterpreted if this mapping improves. Several bits can be set at once.
/// </para>
/// <para>
/// This lives in the shared vocabulary rather than in the collector because the diagnostic
/// engine reads it, and a bitmask interpreted in two places will eventually be interpreted two
/// ways. AMD and Intel report a comparable set; their collectors translate into these bits at
/// the collector boundary rather than each introducing a vocabulary of their own.
/// </para>
/// </remarks>
[Flags]
public enum GpuThrottleReason : ulong
{
    /// <summary>Clocks are at their maximum capability.</summary>
    None = 0,

    /// <summary>
    /// The GPU considers itself idle and has dropped to idle clocks.
    /// </summary>
    /// <remarks>
    /// Not a fault, and interesting anyway: a GPU that thinks it is idle while frames are being
    /// presented is a GPU waiting on the CPU.
    /// </remarks>
    GpuIdle = 0x1,

    /// <summary>Clocks are pinned to an application-specified value.</summary>
    ApplicationClocksSetting = 0x2,

    /// <summary>Software power cap: clocks reduced to stay inside a power limit.</summary>
    SoftwarePowerCap = 0x4,

    /// <summary>
    /// Hardware slowdown: clocks cut by at least half.
    /// </summary>
    /// <remarks>
    /// The vendor's own description gives three possible causes — over-temperature, an external
    /// power brake, or excessive power draw — and does not say which applies. This bit alone is
    /// therefore not evidence of thermal throttling, however tempting it is to read it that way.
    /// </remarks>
    HardwareSlowdown = 0x8,

    /// <summary>Clocks held down to match the slowest GPU in a sync-boost group.</summary>
    SyncBoost = 0x10,

    /// <summary>Software thermal slowdown: clocks reduced to avoid over-temperature.</summary>
    SoftwareThermalSlowdown = 0x20,

    /// <summary>Hardware thermal slowdown: clocks cut by at least half, from temperature.</summary>
    HardwareThermalSlowdown = 0x40,

    /// <summary>Hardware power brake: clocks cut by at least half, external brake asserted.</summary>
    HardwarePowerBrake = 0x80,

    /// <summary>Clocks constrained by the display clock configuration.</summary>
    DisplayClockSetting = 0x100,
}

/// <summary>What a throttle bitmask licenses FrameDoctor to say.</summary>
public enum GpuThrottleVerdict : byte
{
    /// <summary>No reason bits, or only bits that are not faults.</summary>
    NotThrottled = 0,

    /// <summary>The vendor named temperature. FrameDoctor may say "thermal".</summary>
    Thermal = 1,

    /// <summary>The vendor named a power limit. FrameDoctor may say "power limit", not "thermal".</summary>
    PowerLimit = 2,

    /// <summary>
    /// The vendor reported a hardware slowdown without naming a cause.
    /// </summary>
    /// <remarks>
    /// Reported as "thermal or power" and never resolved to one of them. Picking is the kind of
    /// small confident guess that makes a user replace a power supply over a dusty heatsink.
    /// </remarks>
    ThermalOrPower = 3,

    /// <summary>
    /// The GPU is at idle clocks while frames are being presented.
    /// </summary>
    /// <remarks>Evidence of a CPU-bound frame, not of a GPU problem.</remarks>
    Idle = 4,

    /// <summary>Clocks constrained by configuration rather than by a limit being hit.</summary>
    Configured = 5,
}

/// <summary>Reading the throttle bitmask, in exactly one place.</summary>
public static class GpuThrottleReasons
{
    /// <summary>Bits that name temperature as the cause.</summary>
    public const GpuThrottleReason ThermalMask =
        GpuThrottleReason.SoftwareThermalSlowdown | GpuThrottleReason.HardwareThermalSlowdown;

    /// <summary>Bits that name a power limit as the cause.</summary>
    public const GpuThrottleReason PowerMask =
        GpuThrottleReason.SoftwarePowerCap | GpuThrottleReason.HardwarePowerBrake;

    /// <summary>Bits that mean clocks are reduced but do not say why.</summary>
    public const GpuThrottleReason AmbiguousMask = GpuThrottleReason.HardwareSlowdown;

    /// <summary>Bits that reduce clocks by configuration rather than by hitting a limit.</summary>
    public const GpuThrottleReason ConfiguredMask =
        GpuThrottleReason.ApplicationClocksSetting |
        GpuThrottleReason.SyncBoost |
        GpuThrottleReason.DisplayClockSetting;

    /// <summary>
    /// Turns a raw bitmask into the strongest claim the evidence supports.
    /// </summary>
    /// <remarks>
    /// Ordered by specificity, not by bit position. A mask carrying both a named thermal bit and
    /// the unnamed hardware-slowdown bit is a thermal throttle: the specific bit is the evidence
    /// and the general one adds nothing. The reverse — reading an unnamed slowdown as thermal
    /// because thermal is the common case — is the mistake this function exists to prevent.
    /// </remarks>
    public static GpuThrottleVerdict Classify(GpuThrottleReason reasons)
    {
        if ((reasons & ThermalMask) != 0) return GpuThrottleVerdict.Thermal;
        if ((reasons & PowerMask) != 0) return GpuThrottleVerdict.PowerLimit;
        if ((reasons & AmbiguousMask) != 0) return GpuThrottleVerdict.ThermalOrPower;
        if ((reasons & GpuThrottleReason.GpuIdle) != 0) return GpuThrottleVerdict.Idle;
        if ((reasons & ConfiguredMask) != 0) return GpuThrottleVerdict.Configured;

        return GpuThrottleVerdict.NotThrottled;
    }

    /// <summary>Convenience for reading a stored sample's raw double.</summary>
    public static GpuThrottleVerdict Classify(double rawBits) =>
        rawBits is >= 0 and <= ulong.MaxValue
            ? Classify((GpuThrottleReason)(ulong)rawBits)
            : GpuThrottleVerdict.NotThrottled;

    /// <summary>
    /// How the verdict is allowed to be worded to a user.
    /// </summary>
    /// <remarks>
    /// Kept next to the classification so the wording cannot drift away from what the bits
    /// actually justify — the whole risk with this metric is a UI that says "overheating"
    /// because a number was nonzero.
    /// </remarks>
    public static string Describe(GpuThrottleVerdict verdict) => verdict switch
    {
        GpuThrottleVerdict.Thermal => "a thermal limit",
        GpuThrottleVerdict.PowerLimit => "a power limit",
        GpuThrottleVerdict.ThermalOrPower => "a hardware limit it did not identify further",
        GpuThrottleVerdict.Idle => "having no work to do",
        GpuThrottleVerdict.Configured => "a configured clock limit",
        _ => "nothing",
    };
}

namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Stable identifier for a metric in the catalog.
/// </summary>
/// <remarks>
/// Values are wire-format and are written to disk. They are never reused for a different
/// meaning and never renumbered: a stored session recorded by an older build must still be
/// readable, and silently reinterpreting metric 42 as something else would corrupt history
/// that cannot be recomputed.
/// </remarks>
public enum MetricId : ushort
{
    None = 0,

    // ---- Frame ---------------------------------------------------------------
    // The base series is FrameTime. Everything else here is derived from it.

    FrameTime = 100,
    FrameFpsInstant = 101,
    FrameFpsRolling = 102,
    FrameTimeMedian = 103,
    FrameTimeP95 = 104,
    FrameTimeP99 = 105,
    FrameLow1Pct = 106,
    FrameLow01Pct = 107,
    FrameTimeVariance = 108,
    FrameStutterCount = 109,
    FrameSevereStutterCount = 110,

    /// <summary>Simulation timestep minus display interval.</summary>
    /// <remarks>
    /// Catches pacing failures that present-to-present variance is blind to: a game can
    /// present at a metronomically even 6.9 ms and still look juddery.
    /// </remarks>
    FrameAnimationError = 111,

    FrameDisplayedTime = 112,
    FrameDropped = 113,

    // ---- CPU -----------------------------------------------------------------

    CpuLoadTotal = 200,
    CpuLoadCore = 201,
    CpuClock = 202,
    CpuClockEffective = 203,
    CpuTemperature = 204,
    CpuPower = 205,
    CpuThrottleState = 206,

    /// <summary>Time in deferred procedure calls.</summary>
    /// <remarks>
    /// A misbehaving kernel-mode driver steals time from the whole machine without appearing
    /// as any process's CPU usage. Without this, "everything got laggy and nothing looks
    /// busy" is undiagnosable.
    /// </remarks>
    CpuDpcTime = 207,

    /// <summary>Time in interrupt service routines. See <see cref="CpuDpcTime"/>.</summary>
    CpuIsrTime = 208,

    /// <summary>Count of logical processors currently above an activity floor.</summary>
    /// <remarks>
    /// Confounder channel, not a display metric. An all-core boost-bin drop looks identical
    /// to thermal throttling in a frequency series alone; active-core count is what separates
    /// them.
    /// </remarks>
    CpuActiveCoreCount = 209,

    /// <summary>Whether a logical processor is parked.</summary>
    CpuParked = 210,

    // ---- GPU -----------------------------------------------------------------

    GpuUtilization = 300,
    GpuClockCore = 301,
    GpuClockMemory = 302,
    GpuVramUsed = 303,
    GpuVramTotal = 304,
    GpuTemperature = 305,
    GpuTemperatureHotspot = 306,
    GpuPower = 307,

    /// <summary>Vendor throttle-reason bitmask.</summary>
    /// <remarks>
    /// The strongest thermal evidence available without a kernel driver, where the vendor
    /// supplies it. Absence is normal and must not be read as "not throttling".
    /// </remarks>
    GpuThrottleReason = 308,

    // ---- Memory --------------------------------------------------------------

    MemoryTotal = 400,
    MemoryUsed = 401,
    MemoryAvailable = 402,
    MemoryCommitted = 403,
    MemoryCommitLimit = 404,

    /// <summary>Hard page faults per second.</summary>
    /// <remarks>Soft faults are normal and carry no diagnostic weight.</remarks>
    MemoryHardFaults = 405,

    // ---- Storage -------------------------------------------------------------

    DiskActive = 500,
    DiskRead = 501,
    DiskWrite = 502,
    DiskLatency = 503,
    DiskQueue = 504,

    // ---- Process -------------------------------------------------------------
    // Instance carries the process id. Collected narrowly, and widened only around events.

    ProcessCpu = 600,
    ProcessWorkingSet = 601,
    ProcessDiskBytes = 602,
    ProcessGpuUtilization = 603,

    // ---- FrameDoctor's own cost ----------------------------------------------
    // Invariant 8: our overhead is a feature, so it is a measured metric like any other.

    SelfCpu = 700,
    SelfWorkingSet = 701,
    SelfDiskWriteRate = 702,
    SelfTelemetryLatency = 703,
    SelfDroppedSamples = 704,
}

namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Which collector produced a sample.
/// </summary>
/// <remarks>
/// <para>Provenance is carried on every sample so that:</para>
/// <list type="bullet">
///   <item>the System view can show what is actually providing each metric,</item>
///   <item>a diagnosis can state <i>how</i> it knows something,</item>
///   <item>a source that starts producing garbage can be identified rather than guessed at,</item>
///   <item>and swapping one source for another is visible in the data rather than silent.</item>
/// </list>
/// <para>
/// That last point is why this is not optional. Replacing a counter-derived GPU clock with a
/// vendor-API clock changes what the number means; without provenance the change is invisible
/// and every stored comparison silently spans two different measurements.
/// </para>
/// </remarks>
public enum SourceId : ushort
{
    None = 0,

    /// <summary>Deterministic synthetic telemetry.</summary>
    /// <remarks>
    /// The single sanctioned transport for synthetic data. Invariant 9 makes randomness
    /// outside this source greppably illegal, which is only enforceable because there is
    /// exactly one such source and it is named.
    /// </remarks>
    Simulation = 1,

    /// <summary>Replay of a previously recorded telemetry capture.</summary>
    Replay = 2,

    PresentMonCli = 10,
    PresentMonService = 11,

    PerformanceCounters = 20,
    NtSystemInformation = 21,
    Win32ProcessApi = 22,
    Win32MemoryApi = 23,

    NvidiaNvml = 30,
    AmdAdlx = 31,
    IntelIgcl = 32,

    /// <summary>LibreHardwareMonitor, which requires a third-party kernel driver.</summary>
    /// <remarks>Opt-in and additive. No diagnosis may depend on it.</remarks>
    LibreHardwareMonitor = 40,

    /// <summary>Computed downstream rather than measured.</summary>
    /// <remarks>Samples from here are never <see cref="Quality.Exact"/>.</remarks>
    Derived = 100,

    /// <summary>FrameDoctor measuring itself.</summary>
    SelfInstrumentation = 101,
}

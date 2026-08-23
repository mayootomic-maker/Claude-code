using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Platform.Windows.Gpu;
using FrameDoctor.Platform.Windows.Memory;
using FrameDoctor.Platform.Windows.Pdh;
using FrameDoctor.Platform.Windows.Processes;

namespace FrameDoctor.Engine;

/// <summary>
/// The sources that are actually going to run, and an account of the ones that are not.
/// </summary>
/// <param name="Sensors">Sources that probed working.</param>
/// <param name="Attribution">Process attribution, when available.</param>
/// <param name="Probes">Every probe result, including the failures.</param>
/// <remarks>
/// The failures are kept deliberately. They are what the System view renders, and they are what
/// caps confidence honestly: a diagnosis made on a machine with no GPU temperature sensor is a
/// different claim from the same diagnosis made on a machine that has one, and the product has
/// to be able to tell the user which it is looking at.
/// </remarks>
public sealed record SourceSet(
    IReadOnlyList<ISensorSource> Sensors,
    IProcessAttributionSource? Attribution,
    IReadOnlyList<SourceProbe> Probes) : IAsyncDisposable
{
    /// <summary>Metrics at least one working source claims to provide.</summary>
    public IReadOnlySet<MetricId> AvailableMetrics =>
        Probes.SelectMany(p => p.WorkingMetrics).ToHashSet();

    /// <summary>
    /// Probes every source this platform offers and keeps the ones that work.
    /// </summary>
    /// <remarks>
    /// A source that fails to probe is not an error and does not stop the session. An AMD
    /// machine has no NVML; a locked-down machine has no process table; neither is a reason to
    /// refuse to measure frames.
    /// </remarks>
    public static async ValueTask<SourceSet> ProbeAllAsync(
        IMonotonicClock clock,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(clock);

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return new SourceSet([], null, [NotOnThisPlatform()]);

        return await ProbeWindowsAsync(clock, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// What a non-Windows host reports.
    /// </summary>
    /// <remarks>
    /// FrameDoctor measures Windows gaming performance and does not pretend otherwise elsewhere.
    /// The engine still runs — simulation and replay need no collectors — which is what makes
    /// the whole pipeline testable on the Linux container this repository is developed in.
    /// </remarks>
    private static SourceProbe NotOnThisPlatform() =>
        SourceProbe.NotWorking(
            SourceId.None,
            "System telemetry",
            UnavailableReason.NoSensor,
            "FrameDoctor collects live telemetry on Windows only. Simulation and replay work " +
            "everywhere.");

    [SupportedOSPlatform("windows")]
    private static async ValueTask<SourceSet> ProbeWindowsAsync(
        IMonotonicClock clock,
        CancellationToken cancellationToken)
    {
        var candidates = new ISensorSource[]
        {
            new PdhSensorSource(),
            new NvmlGpuSensorSource(),
            new MemorySensorSource(),
        };

        var working = new List<ISensorSource>();
        var probes = new List<SourceProbe>();

        foreach (var source in candidates)
        {
            var probe = await source.ProbeAsync(cancellationToken).ConfigureAwait(false);
            probes.Add(probe);

            if (probe.IsAvailable) working.Add(source);
            else await source.DisposeAsync().ConfigureAwait(false);
        }

        var attribution = new NtProcessAttributionSource(clock);
        var attributionProbe = await attribution.ProbeAsync(cancellationToken).ConfigureAwait(false);
        probes.Add(attributionProbe);

        if (!attributionProbe.IsAvailable)
        {
            await attribution.DisposeAsync().ConfigureAwait(false);
            return new SourceSet(working, null, probes);
        }

        return new SourceSet(working, attribution, probes);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var sensor in Sensors) await sensor.DisposeAsync().ConfigureAwait(false);
        if (Attribution is not null) await Attribution.DisposeAsync().ConfigureAwait(false);
    }
}

using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>Outcome of a derivation that may legitimately have no answer.</summary>
/// <param name="HasValue">Whether <paramref name="Value"/> means anything.</param>
/// <param name="Value">The derived reading.</param>
/// <param name="Reason">Why there is none, when there is none.</param>
public readonly record struct Derived(bool HasValue, double Value, UnavailableReason Reason)
{
    public static Derived From(double value) => new(true, value, UnavailableReason.None);

    public static Derived None(UnavailableReason reason) => new(false, double.NaN, reason);
}

/// <summary>
/// The metrics Windows does not publish, computed from ones it does.
/// </summary>
/// <remarks>
/// <para>
/// Kept separate from the P/Invoke layer because these are the arithmetic that carries
/// diagnostic weight, and they need to be tested on a machine with no counters at all. Each one
/// is a derivation and is published as <see cref="Quality.Derived"/>, never
/// <see cref="Quality.Exact"/> — the distinction is what stops a diagnosis from claiming a
/// measurement it computed.
/// </para>
/// </remarks>
public static class CounterDerivations
{
    /// <summary>
    /// Below this utility, <c>% Processor Performance</c> describes almost no execution.
    /// </summary>
    /// <remarks>
    /// The counter is defined as the average performance of the processor <i>while it is
    /// executing</i>. On an idle core that average is taken over a vanishing sample and swings
    /// wildly. Publishing it anyway is how a tool reports a dramatic clock collapse on a machine
    /// that was simply doing nothing — the exact false positive that would destroy trust in a
    /// CPU-frequency diagnosis.
    /// </remarks>
    public const double MinimumUtilityForClockDerivation = 5.0;

    /// <summary>
    /// Effective clock: what the core actually ran at, as opposed to what it is rated for.
    /// </summary>
    /// <remarks>
    /// <c>baseMHz × (%ProcessorPerformance / 100)</c>. This is a standard derivation from the
    /// two counter definitions rather than a Microsoft-published identity, and it is the number
    /// the CPU-frequency-collapse diagnosis rests on.
    /// <c>REQUIRES-WINDOWS-VALIDATION</c>: confirm against a known-good reading under load.
    /// </remarks>
    /// <param name="baseMhz">Base clock, from <c>CallNtPowerInformation</c>.</param>
    /// <param name="processorPerformancePercent">
    /// <c>% Processor Performance</c>. Legitimately exceeds 100 under turbo, which is why the
    /// counter must be read with <c>PDH_FMT_NOCAP100</c>.
    /// </param>
    /// <param name="utilityPercent"><c>% Processor Utility</c>, used only to gate the result.</param>
    public static Derived EffectiveClockMhz(
        double baseMhz,
        double processorPerformancePercent,
        double utilityPercent)
    {
        if (!(baseMhz > 0)) return Derived.None(UnavailableReason.NoSensor);
        if (double.IsNaN(processorPerformancePercent) || double.IsNaN(utilityPercent))
            return Derived.None(UnavailableReason.NotYetSampled);

        if (utilityPercent < MinimumUtilityForClockDerivation)
            return Derived.None(UnavailableReason.NotMeaningfulInCurrentState);

        if (processorPerformancePercent < 0) return Derived.None(UnavailableReason.SourceFaulted);

        return Derived.From(baseMhz * processorPerformancePercent / 100.0);
    }

    /// <summary>
    /// Disk activity, which Windows exposes only as its complement.
    /// </summary>
    /// <remarks>
    /// There is no <c>% Active Time</c> counter on <c>PhysicalDisk</c>. Task Manager's "Active
    /// time" is this same subtraction from <c>% Idle Time</c>.
    /// </remarks>
    public static Derived DiskActivePercent(double idlePercent)
    {
        if (double.IsNaN(idlePercent)) return Derived.None(UnavailableReason.NotYetSampled);

        // Idle time is a rate counter and can overshoot slightly across an interval boundary.
        // Clamping is right here — the overshoot is a sampling artefact, not a measurement —
        // but it is clamped only into the range the metric can occupy, never onto a default.
        return Derived.From(Math.Clamp(100.0 - idlePercent, 0.0, 100.0));
    }

    /// <summary>
    /// Whole-adapter GPU utilization from the per-engine counters.
    /// </summary>
    /// <remarks>
    /// The maximum, never the sum. GPU engines run in parallel, so summing them produces
    /// percentages far above 100 and a permanent false "GPU saturated" reading. Task Manager
    /// takes the busiest engine as representative for the same reason.
    /// </remarks>
    public static Derived AdapterUtilizationPercent(ReadOnlySpan<double> engineUtilizations)
    {
        var best = double.NaN;

        foreach (var utilization in engineUtilizations)
        {
            if (double.IsNaN(utilization)) continue;
            if (double.IsNaN(best) || utilization > best) best = utilization;
        }

        return double.IsNaN(best)
            ? Derived.None(UnavailableReason.NotYetSampled)
            : Derived.From(Math.Clamp(best, 0.0, 100.0));
    }

    /// <summary>
    /// Disk latency in milliseconds from the counter's seconds.
    /// </summary>
    /// <remarks>
    /// <c>Avg. Disk sec/Transfer</c> is in seconds and includes port-driver queue time, so it is
    /// a response time rather than a device service time. That is the number a stalled frame
    /// actually waited, which is why it is the one used.
    /// </remarks>
    public static Derived DiskLatencyMs(double secondsPerTransfer)
    {
        if (double.IsNaN(secondsPerTransfer)) return Derived.None(UnavailableReason.NotYetSampled);
        if (secondsPerTransfer < 0) return Derived.None(UnavailableReason.SourceFaulted);

        return Derived.From(secondsPerTransfer * 1000.0);
    }

    /// <summary>
    /// How many logical processors were doing real work, from their individual utilities.
    /// </summary>
    /// <remarks>
    /// <para>
    /// There is no counter for this. It exists because total CPU load answers the wrong
    /// question: 25 % on a sixteen-thread machine is four saturated cores, and a game whose
    /// render thread is pinned to a saturated core is CPU-bound at 25 % "usage". A diagnosis
    /// that reads only the total will confidently rule CPU contention out.
    /// </para>
    /// <para>
    /// The threshold is deliberately high. A core ticking over on background work is not doing
    /// the kind of work that delays a frame.
    /// </para>
    /// </remarks>
    public static Derived ActiveCoreCount(ReadOnlySpan<double> perCoreUtility, double busyPercent = 60.0)
    {
        if (perCoreUtility.IsEmpty) return Derived.None(UnavailableReason.NotYetSampled);

        var counted = 0;
        var active = 0;

        foreach (var utility in perCoreUtility)
        {
            if (double.IsNaN(utility)) continue;
            counted++;
            if (utility >= busyPercent) active++;
        }

        // A partial reading would understate the count, and understating it is what produces
        // the false "the CPU was not busy" conclusion this metric exists to prevent.
        return counted == perCoreUtility.Length
            ? Derived.From(active)
            : Derived.None(UnavailableReason.NotYetSampled);
    }
}

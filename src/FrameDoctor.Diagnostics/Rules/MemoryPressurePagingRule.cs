using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// The machine ran short of memory and stalled fetching pages from disk.
/// </summary>
/// <remarks>
/// Keyed on <b>hard</b> faults only. Soft faults are routine on every healthy machine — a rule
/// watching total page faults would fire constantly and mean nothing.
/// </remarks>
public sealed class MemoryPressurePagingRule : IDiagnosticRule
{
    /// <summary>Hard faults per second above which paging is materially hurting.</summary>
    private const double HardFaultThreshold = 100.0;

    /// <summary>Available memory below which pressure is plausible.</summary>
    private const double LowMemoryMegabytes = 1024.0;

    public string Id => "memory-pressure-paging";
    public string Title => "Memory pressure and paging";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var faults = window.Get(MetricId.MemoryHardFaults);
        if (faults is not { Availability: Availability.Available } || faults.ReadableCount == 0)
            return RuleEvaluation.NotCheckable("mem.pagefault.hard");

        var peakFaults = faults.Max();
        if (double.IsNaN(peakFaults) || peakFaults < HardFaultThreshold)
        {
            return RuleEvaluation.Rejected(
                $"Hard page faults peaked at {(double.IsNaN(peakFaults) ? 0 : peakFaults):F0}/s.");
        }

        var evidence = new List<EvidenceItem>
        {
            new(faults.Key,
                $"Hard page faults reached {peakFaults:F0}/s",
                LikelihoodRatio: 14.0,
                EvidenceClass.Memory,
                EvidenceRole.Cause,
                faults.ReadableCount, faults.NativeRateHz, faults.CanEstablishOrdering, faults.Quality),
        };

        var missing = new List<string>();

        var available = window.Get(MetricId.MemoryAvailable);
        if (available is { Availability: Availability.Available } && available.ReadableCount > 0)
        {
            var low = available.Min();
            if (low < LowMemoryMegabytes)
            {
                evidence.Add(new EvidenceItem(
                    available.Key,
                    $"Available memory fell to {low:F0} MB",
                    LikelihoodRatio: 7.0,
                    EvidenceClass.Memory,
                    EvidenceRole.Cause,
                    available.ReadableCount, available.NativeRateHz,
                    available.CanEstablishOrdering, available.Quality));
            }
        }
        else
        {
            missing.Add("mem.available");
        }

        // Disk latency here is a consequence of the paging, not an independent disk fault.
        var latency = window.Get(MetricId.DiskLatency);
        if (latency is { Availability: Availability.Available } && latency.Max() > 5)
        {
            evidence.Add(new EvidenceItem(
                latency.Key,
                $"Disk response time rose to {latency.Max():F1} ms serving those faults",
                LikelihoodRatio: 3.0,
                EvidenceClass.Storage,
                EvidenceRole.Consequence,
                latency.ReadableCount, latency.NativeRateHz,
                latency.CanEstablishOrdering, latency.Quality));
        }

        return new RuleEvaluation(
            evidence, missing,
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while the machine was " +
                $"fetching {peakFaults:F0} memory pages per second from disk.",
            Mechanism:
                "The game needed memory that had been paged out to disk. Each miss stalls the " +
                "thread until the page is read back, and disk reads are thousands of times " +
                "slower than memory.",
            RecommendedAction:
                "Close memory-heavy applications before playing, or reduce texture and streaming " +
                "settings. More RAM is the durable fix if this recurs.");
    }
}

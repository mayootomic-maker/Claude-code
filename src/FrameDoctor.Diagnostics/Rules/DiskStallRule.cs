using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// Storage was slow to respond and the game waited on it.
/// </summary>
/// <remarks>
/// Distinct from memory-pressure paging, which also raises disk latency. This rule requires the
/// stall <i>without</i> a hard-fault storm: the game is streaming assets, not thrashing the page
/// file, and the remedy is different.
/// </remarks>
public sealed class DiskStallRule : IDiagnosticRule
{
    /// <summary>Response time above which storage is a plausible stall source.</summary>
    private const double SlowResponseMs = 8.0;

    /// <summary>Hard faults above this mean paging explains it better.</summary>
    private const double PagingHardFaultThreshold = 100.0;

    public string Id => "disk-stall";
    public string Title => "Storage stall";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var latency = window.Get(MetricId.DiskLatency);
        if (latency is not { Availability: Availability.Available } || latency.ReadableCount == 0)
            return RuleEvaluation.NotCheckable("disk.latency");

        var peak = latency.Max();
        if (double.IsNaN(peak) || peak < SlowResponseMs)
        {
            return RuleEvaluation.Rejected(
                $"Disk response time stayed at {(double.IsNaN(peak) ? 0 : peak):F1} ms.");
        }

        // Paging raises disk latency too, and explains the frame stall more completely.
        var faults = window.Get(MetricId.MemoryHardFaults);
        if (faults is { Availability: Availability.Available } &&
            faults.Max() >= PagingHardFaultThreshold)
        {
            return RuleEvaluation.Rejected(
                $"Disk was slow, but {faults.Max():F0} hard faults/s indicate memory paging " +
                "rather than a storage fault.");
        }

        var evidence = new List<EvidenceItem>
        {
            new(latency.Key,
                $"Disk response time rose to {peak:F1} ms",
                LikelihoodRatio: 10.0,
                EvidenceClass.Storage,
                EvidenceRole.Cause,
                latency.ReadableCount, latency.NativeRateHz,
                latency.CanEstablishOrdering, latency.Quality),
        };

        var active = window.Get(MetricId.DiskActive);
        if (active is { Availability: Availability.Available } && active.Max() > 80)
        {
            evidence.Add(new EvidenceItem(
                active.Key,
                $"Disk was busy {active.Max():F0}% of the time",
                LikelihoodRatio: 3.0,
                EvidenceClass.Storage,
                EvidenceRole.Cause,
                active.ReadableCount, active.NativeRateHz,
                active.CanEstablishOrdering, active.Quality));
        }

        var gpu = window.Get(MetricId.GpuUtilization);
        if (gpu is { Availability: Availability.Available } && gpu.RelativeDelta() < -0.2)
        {
            evidence.Add(new EvidenceItem(
                gpu.Key,
                $"GPU utilization fell to {gpu.MedianAfter():F0}% while waiting (follows the stall)",
                LikelihoodRatio: 1.8,
                EvidenceClass.Frame,
                EvidenceRole.Consequence,
                gpu.ReadableCount, gpu.NativeRateHz, gpu.CanEstablishOrdering, gpu.Quality));
        }

        return new RuleEvaluation(
            evidence, [],
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while storage was " +
                $"taking {peak:F1} ms to respond.",
            Mechanism:
                "The game asked for data from disk and the drive was slow to return it, so the " +
                "frame could not complete until the read finished.",
            RecommendedAction:
                "Check what else is using the drive, and whether the game is installed on the " +
                "slowest one in the machine.");
    }
}

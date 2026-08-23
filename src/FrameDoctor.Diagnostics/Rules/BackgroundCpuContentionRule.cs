using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// Another process took the CPU the game needed.
/// </summary>
/// <remarks>
/// The distinguishing signal against CPU frequency collapse is that <b>clocks stay high</b>.
/// The machine did not slow down; something else took a share of it. Both produce a frame-time
/// spike and a GPU utilization drop, so without the clock check the two are indistinguishable —
/// and they have completely different remedies.
/// </remarks>
public sealed class BackgroundCpuContentionRule : IDiagnosticRule
{
    /// <summary>Per-core load above this is treated as saturation.</summary>
    private const double SaturatedCorePercent = 90.0;

    /// <summary>A process using more than this share of a core is a candidate offender.</summary>
    private const double OffenderProcessPercent = 25.0;

    /// <summary>Clock drop beyond this means the frequency-collapse hypothesis fits better.</summary>
    private const double ClockStabilityTolerance = 0.10;

    public string Id => "background-cpu-contention";
    public string Title => "Background CPU contention";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        if (!window.IsReadable(MetricId.CpuLoadTotal))
            return RuleEvaluation.NotCheckable("cpu.load.total");

        var evidence = new List<EvidenceItem>();
        var missing = new List<string>();

        // A clock collapse means this is a different problem wearing the same symptoms.
        var clock = window.Get(MetricId.CpuClockEffective);
        if (clock is { Availability: Availability.Available })
        {
            var relative = clock.RelativeDelta();
            if (!double.IsNaN(relative) && relative < -ClockStabilityTolerance)
            {
                return RuleEvaluation.Rejected(
                    $"CPU effective clock fell {Math.Abs(relative) * 100:F0}% during the event, " +
                    "so the machine slowed rather than being shared.");
            }

            if (!double.IsNaN(relative))
            {
                evidence.Add(new EvidenceItem(
                    clock.Key,
                    $"CPU effective clock held near {clock.MedianAfter() / 1000.0:F2} GHz throughout",
                    LikelihoodRatio: 2.2,
                    EvidenceClass.Power,
                    EvidenceRole.Cause,
                    clock.ReadableCount, clock.NativeRateHz, clock.CanEstablishOrdering, clock.Quality));
            }
        }
        else
        {
            missing.Add("cpu.clock.effective");
        }

        // A named process is the difference between an explanation and an observation.
        //
        // Peak rise, not delta: contention is a transient. The correlation window extends two
        // seconds past the event, so a process that spikes and falls quiet has its post-event
        // median dominated by the recovery, and a delta comparison reports it as idle. That
        // silently downgrades "close OneDrive" to "close something".
        //
        // OrderByDescending + FirstOrDefault rather than MaxBy: MaxBy throws on an empty
        // sequence for value tuples, and "no offending process" is a normal outcome.
        var offender = window.AllInstancesOf(MetricId.ProcessCpu)
            .Where(s => s.ReadableCount > 0)
            .Select(s => (Series: (MetricSeries?)s, Rise: s.PeakRise(), Peak: s.Max()))
            .Where(x => !double.IsNaN(x.Rise) && x.Rise > OffenderProcessPercent)
            .OrderByDescending(x => x.Rise)
            .FirstOrDefault();

        var totalLoad = window.Get(MetricId.CpuLoadTotal)!;
        var loadRise = totalLoad.PeakRise();

        var saturatedCore = window.AllInstancesOf(MetricId.CpuLoadCore)
            .Where(s => s.ReadableCount > 0 && s.Max() >= SaturatedCorePercent)
            .MaxBy(s => s.Max());

        if (offender.Series is not null)
        {
            evidence.Add(new EvidenceItem(
                offender.Series.Key,
                $"Process {offender.Series.Key.Instance} rose from " +
                $"{offender.Series.MedianBefore():F0}% to {offender.Peak:F0}% CPU",
                LikelihoodRatio: 9.0,
                EvidenceClass.Contention,
                EvidenceRole.Cause,
                offender.Series.ReadableCount, offender.Series.NativeRateHz,
                offender.Series.CanEstablishOrdering, offender.Series.Quality));
        }

        if (saturatedCore is not null)
        {
            evidence.Add(new EvidenceItem(
                saturatedCore.Key,
                $"Core {saturatedCore.Key.Instance} reached {saturatedCore.Max():F0}%",
                LikelihoodRatio: 3.5,
                EvidenceClass.Contention,
                EvidenceRole.Cause,
                saturatedCore.ReadableCount, saturatedCore.NativeRateHz,
                saturatedCore.CanEstablishOrdering, saturatedCore.Quality));
        }

        if (!double.IsNaN(loadRise) && loadRise > 15)
        {
            evidence.Add(new EvidenceItem(
                totalLoad.Key,
                $"Total CPU load rose {loadRise:F0} points to {totalLoad.Max():F0}%",
                LikelihoodRatio: 2.8,
                EvidenceClass.Contention,
                EvidenceRole.Cause,
                totalLoad.ReadableCount, totalLoad.NativeRateHz,
                totalLoad.CanEstablishOrdering, totalLoad.Quality));
        }

        if (evidence.Count == 0 || evidence.All(e => e.Class != EvidenceClass.Contention))
        {
            var peak = window.AllInstancesOf(MetricId.ProcessCpu)
                .Where(s => s.ReadableCount > 0).Select(s => s.Max())
                .DefaultIfEmpty(double.NaN).Max();

            return RuleEvaluation.Rejected(double.IsNaN(peak)
                ? $"Total CPU load did not rise materially (peak {totalLoad.Max():F0}%)."
                : $"No process exceeded {peak:F0}% CPU during the event.");
        }

        // GPU falling is corroboration, not cause: it is idle because it is waiting for work.
        var gpu = window.Get(MetricId.GpuUtilization);
        if (gpu is { Availability: Availability.Available })
        {
            var gpuDelta = gpu.RelativeDelta();
            if (!double.IsNaN(gpuDelta) && gpuDelta < -0.2)
            {
                evidence.Add(new EvidenceItem(
                    gpu.Key,
                    $"GPU utilization fell {gpu.MedianBefore():F0}% to {gpu.MedianAfter():F0}% " +
                    "(follows the stall, does not cause it)",
                    LikelihoodRatio: 2.0,
                    EvidenceClass.Frame,
                    EvidenceRole.Consequence,
                    gpu.ReadableCount, gpu.NativeRateHz, gpu.CanEstablishOrdering, gpu.Quality));
            }
        }

        var offenderName = offender.Series is not null
            ? $"the process with id {offender.Series.Key.Instance}"
            : "whichever background process was active";

        return new RuleEvaluation(
            evidence,
            missing,
            RejectionReason: null,
            WhatHappened:
                $"One frame took {window.Event.PeakFrameTimeMs:F0} ms against a " +
                $"{window.Event.BaselineMedianMs:F1} ms baseline.",
            Mechanism:
                "The render thread was ready to submit work but had to wait for CPU time that " +
                "another process was using. Clock speeds stayed high, so the machine was shared " +
                "rather than slowed.",
            RecommendedAction:
                $"Close or postpone {offenderName} while playing.");
    }
}

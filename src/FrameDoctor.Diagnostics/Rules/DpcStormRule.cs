using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// A kernel-mode driver spent too long in deferred procedure calls or interrupts.
/// </summary>
/// <remarks>
/// <para>
/// This is the diagnosis for the complaint that looks impossible: <i>"everything got laggy,
/// including lightweight games, and nothing in Task Manager looks busy."</i>
/// </para>
/// <para>
/// A misbehaving driver steals time at a privilege level above every user-mode process, so it
/// appears in no process's CPU usage. Without this rule, that entire failure class is
/// undiagnosable — every process looks idle, the GPU looks idle, the clocks look fine, and the
/// only honest answer available would be "unexplained".
/// </para>
/// </remarks>
public sealed class DpcStormRule : IDiagnosticRule
{
    /// <summary>Combined DPC and ISR time above which kernel work is materially hurting.</summary>
    private const double KernelTimeThreshold = 5.0;

    public string Id => "dpc-storm";
    public string Title => "Driver interrupt latency";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var dpc = window.Get(MetricId.CpuDpcTime);
        var isr = window.Get(MetricId.CpuIsrTime);

        var haveDpc = dpc is { Availability: Availability.Available } && dpc.ReadableCount > 0;
        var haveIsr = isr is { Availability: Availability.Available } && isr.ReadableCount > 0;

        if (!haveDpc && !haveIsr) return RuleEvaluation.NotCheckable("cpu.dpc.time", "cpu.isr.time");

        var peakDpc = haveDpc ? dpc!.Max() : 0.0;
        var peakIsr = haveIsr ? isr!.Max() : 0.0;
        var combined = peakDpc + peakIsr;

        if (combined < KernelTimeThreshold)
        {
            return RuleEvaluation.Rejected(
                $"Kernel-mode time stayed at {combined:F1}% (deferred calls and interrupts).");
        }

        var evidence = new List<EvidenceItem>();
        var missing = new List<string>();

        if (haveDpc)
        {
            evidence.Add(new EvidenceItem(
                dpc!.Key,
                $"Time in deferred procedure calls reached {peakDpc:F1}%",
                LikelihoodRatio: 16.0,
                EvidenceClass.Driver,
                EvidenceRole.Cause,
                dpc.ReadableCount, dpc.NativeRateHz, dpc.CanEstablishOrdering, dpc.Quality));
        }
        else
        {
            missing.Add("cpu.dpc.time");
        }

        if (haveIsr && peakIsr > 1.0)
        {
            evidence.Add(new EvidenceItem(
                isr!.Key,
                $"Time in interrupt service routines reached {peakIsr:F1}%",
                LikelihoodRatio: 6.0,
                EvidenceClass.Driver,
                EvidenceRole.Cause,
                isr.ReadableCount, isr.NativeRateHz, isr.CanEstablishOrdering, isr.Quality));
        }

        // The signature that makes this distinctive: no user-mode process is busy.
        var busiest = window.AllInstancesOf(MetricId.ProcessCpu)
            .Where(s => s.ReadableCount > 0).Select(s => s.Max())
            .DefaultIfEmpty(double.NaN).Max();

        if (!double.IsNaN(busiest) && busiest < 20)
        {
            evidence.Add(new EvidenceItem(
                new MetricKey(MetricId.ProcessCpu),
                $"No user-mode process exceeded {busiest:F0}% CPU, so the time was spent in kernel mode",
                LikelihoodRatio: 4.0,
                EvidenceClass.Contention,
                EvidenceRole.Cause,
                1, double.NaN, false, Quality.Derived));
        }

        return new RuleEvaluation(
            evidence, missing,
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while {combined:F1}% of " +
                "CPU time was spent handling driver work.",
            Mechanism:
                "A kernel-mode driver held the processor handling deferred calls or interrupts. " +
                "That work runs above every application, so it delays the game without appearing " +
                "as any process's CPU usage.",
            RecommendedAction:
                "Update or roll back recently changed drivers, particularly network, audio and " +
                "storage. If this started recently, the last driver or Windows update is the " +
                "first thing to check.");
    }
}

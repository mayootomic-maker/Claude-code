using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// The CPU's effective clock fell while the work did not change.
/// </summary>
/// <remarks>
/// <para>
/// This rule reports <b>what</b> happened and deliberately refuses to say <b>why</b> unless the
/// evidence genuinely supports it.
/// </para>
/// <para>
/// A drop in effective clock has many possible causes: a thermal limit, a power limit, a current
/// limit, an OS power-policy change, core parking, a hybrid scheduler moving a thread from a
/// performance core to an efficiency core, an unplugged laptop — and, most awkwardly, a normal
/// all-core boost-bin change, which drops per-core frequency 15–25 % with nothing wrong at all.
/// </para>
/// <para>
/// Without a die temperature there is no way to separate them, so the honest output names the
/// collapse, states that the reason is undetermined, and says what would settle it. Saying
/// "thermal throttling" here would be wrong on a real desktop a large fraction of the time.
/// </para>
/// </remarks>
public sealed class CpuFrequencyCollapseRule : IDiagnosticRule
{
    /// <summary>Relative clock drop that counts as a collapse.</summary>
    private const double CollapseThreshold = 0.15;

    /// <summary>Load change beyond this means the workload changed, not the machine.</summary>
    private const double LoadStabilityTolerance = 12.0;

    /// <summary>Extra active cores beyond this suggest a boost-bin change rather than a fault.</summary>
    private const double BoostBinCoreDelta = 2.0;

    public string Id => "cpu-frequency-collapse";
    public string Title => "CPU frequency collapse";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var clock = window.Get(MetricId.CpuClockEffective);
        if (clock is not { Availability: Availability.Available } || clock.ReadableCount < 2)
            return RuleEvaluation.NotCheckable("cpu.clock.effective");

        var relative = clock.RelativeDelta();
        if (double.IsNaN(relative) || relative > -CollapseThreshold)
        {
            return RuleEvaluation.Rejected(
                $"CPU effective clock stayed near {clock.MedianBefore() / 1000.0:F2} GHz.");
        }

        var evidence = new List<EvidenceItem>();
        var missing = new List<string>();

        evidence.Add(new EvidenceItem(
            clock.Key,
            $"CPU effective clock fell {clock.MedianBefore() / 1000.0:F2} GHz to " +
            $"{clock.MedianAfter() / 1000.0:F2} GHz",
            LikelihoodRatio: 12.0,
            EvidenceClass.Power,
            EvidenceRole.Cause,
            clock.ReadableCount, clock.NativeRateHz, clock.CanEstablishOrdering, clock.Quality));

        // Unchanged load is what makes this a machine problem rather than a workload change.
        var load = window.Get(MetricId.CpuLoadTotal);
        if (load is { Availability: Availability.Available })
        {
            var loadDelta = load.Delta();
            if (!double.IsNaN(loadDelta) && loadDelta > LoadStabilityTolerance)
            {
                return RuleEvaluation.Rejected(
                    $"CPU load rose {loadDelta:F0} points at the same time, so the workload " +
                    "changed rather than the machine slowing.");
            }

            evidence.Add(new EvidenceItem(
                load.Key,
                $"CPU load was unchanged at about {load.MedianAfter():F0}%",
                LikelihoodRatio: 3.0,
                EvidenceClass.Contention,
                EvidenceRole.Cause,
                load.ReadableCount, load.NativeRateHz, load.CanEstablishOrdering, load.Quality));
        }
        else
        {
            missing.Add("cpu.load.total");
        }

        // The confounder that matters most: more cores waking legitimately lowers per-core clock.
        var activeCores = window.Get(MetricId.CpuActiveCoreCount);
        if (activeCores is { Availability: Availability.Available })
        {
            var coreDelta = activeCores.Delta();
            if (!double.IsNaN(coreDelta) && coreDelta > BoostBinCoreDelta)
            {
                return RuleEvaluation.Rejected(
                    $"Active core count rose by {coreDelta:F0} at the same time, which lowers " +
                    "per-core boost clock normally and is not a fault.");
            }
        }

        // Temperature is what would let us name heat as the cause. Usually it is absent.
        var temperature = window.Get(MetricId.CpuTemperature);
        var hasTemperature = temperature is { Availability: Availability.Available } t && t.ReadableCount > 0;

        if (!hasTemperature) missing.Add("cpu.temperature");

        var mechanism = hasTemperature
            ? "The CPU reduced its clock speed. Temperature data is available and is included in " +
              "the evidence below."
            : "The CPU reduced its clock speed while the workload was unchanged. Why it did so " +
              "cannot be determined here: a thermal limit, a power or current limit, and an " +
              "operating-system power policy change all look identical without a CPU temperature " +
              "sensor, which requires a kernel-mode driver this machine does not have.";

        var action = hasTemperature
            ? "Check the evidence below for whether temperature accompanied the drop."
            : "If this recurs, check cooling and the Windows power mode. A CPU temperature " +
              "sensor would distinguish the two.";

        return new RuleEvaluation(
            evidence, missing,
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while CPU effective " +
                $"clock fell {Math.Abs(relative) * 100:F0}%.",
            Mechanism: mechanism,
            RecommendedAction: action);
    }
}

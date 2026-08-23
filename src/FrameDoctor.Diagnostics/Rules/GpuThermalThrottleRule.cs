using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// The GPU reached a thermal limit and reduced its clock.
/// </summary>
/// <remarks>
/// The strongest diagnosis available without any kernel driver, because the vendor reports the
/// reason directly. Three independent things agreeing — a rising temperature, a falling clock,
/// and the hardware itself setting a thermal bit — is what justifies high confidence, and the
/// throttle-reason bit is what makes this a statement about cause rather than coincidence.
/// </remarks>
public sealed class GpuThermalThrottleRule : IDiagnosticRule
{
    /// <summary>Vendor bitmask bits indicating a thermal slowdown.</summary>
    private const int ThermalReasonMask = 0x60;   // software (0x20) or hardware (0x40) thermal

    /// <summary>Temperature above which throttling is plausible even without a reason bit.</summary>
    private const double HotCelsius = 83.0;

    private const double ClockDropThreshold = 0.08;

    public string Id => "gpu-thermal-throttle";
    public string Title => "GPU thermal throttling";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var temperature = window.Get(MetricId.GpuTemperature);
        var clock = window.Get(MetricId.GpuClockCore);
        var reason = window.Get(MetricId.GpuThrottleReason);

        if (temperature is not { Availability: Availability.Available } &&
            reason is not { Availability: Availability.Available })
        {
            return RuleEvaluation.NotCheckable("gpu.temperature", "gpu.throttle.reason");
        }

        var reasonSet = reason?.AnyFlagSet(ThermalReasonMask) ?? false;
        var peakTemp = temperature?.Max() ?? double.NaN;
        var hot = !double.IsNaN(peakTemp) && peakTemp >= HotCelsius;

        var clockDrop = clock?.RelativeDelta() ?? double.NaN;
        var clockFell = !double.IsNaN(clockDrop) && clockDrop < -ClockDropThreshold;

        if (!reasonSet && !hot)
        {
            return RuleEvaluation.Rejected(double.IsNaN(peakTemp)
                ? "The GPU reported no thermal limit."
                : $"GPU peaked at {peakTemp:F0} C with no thermal limit reported.");
        }

        var evidence = new List<EvidenceItem>();
        var missing = new List<string>();

        if (reasonSet)
        {
            evidence.Add(new EvidenceItem(
                reason!.Key,
                "The GPU reported a thermal limit as the reason for reducing clocks",
                LikelihoodRatio: 30.0,
                EvidenceClass.Thermal,
                EvidenceRole.Cause,
                reason.ReadableCount, reason.NativeRateHz, reason.CanEstablishOrdering, reason.Quality));
        }

        if (temperature is { Availability: Availability.Available })
        {
            evidence.Add(new EvidenceItem(
                temperature.Key,
                $"GPU temperature reached {peakTemp:F0} C",
                LikelihoodRatio: hot ? 6.0 : 1.5,
                EvidenceClass.Thermal,
                EvidenceRole.Cause,
                temperature.ReadableCount, temperature.NativeRateHz,
                temperature.CanEstablishOrdering, temperature.Quality));
        }
        else
        {
            missing.Add("gpu.temperature");
        }

        if (clockFell)
        {
            evidence.Add(new EvidenceItem(
                clock!.Key,
                $"GPU core clock fell {clock.MedianBefore():F0} MHz to {clock.MedianAfter():F0} MHz",
                LikelihoodRatio: 8.0,
                EvidenceClass.Power,
                EvidenceRole.Cause,
                clock.ReadableCount, clock.NativeRateHz, clock.CanEstablishOrdering, clock.Quality));
        }
        else if (clock is not { Availability: Availability.Available })
        {
            missing.Add("gpu.clock.core");
        }

        var hotspot = window.Get(MetricId.GpuTemperatureHotspot);
        if (hotspot is { Availability: Availability.Available } && hotspot.ReadableCount > 0)
        {
            evidence.Add(new EvidenceItem(
                hotspot.Key,
                $"GPU hotspot reached {hotspot.Max():F0} C",
                LikelihoodRatio: 4.0,
                EvidenceClass.Thermal,
                EvidenceRole.Cause,
                hotspot.ReadableCount, hotspot.NativeRateHz,
                hotspot.CanEstablishOrdering, hotspot.Quality));
        }

        return new RuleEvaluation(
            evidence, missing,
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while the GPU ran at " +
                $"{peakTemp:F0} C.",
            Mechanism:
                "The GPU reached its temperature limit and reduced clock speed to stay within it. " +
                "Less clock means less work per second, so frames take longer.",
            RecommendedAction:
                "Improve case airflow or clean the GPU cooler. Lowering the power limit slightly " +
                "often costs little performance and drops temperature substantially.");
    }
}

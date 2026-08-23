using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// The GPU hit a power limit and reduced its clock.
/// </summary>
/// <remarks>
/// <para>
/// A separate hypothesis from thermal throttling because the fix is different and the two are
/// routinely confused. A card at 68 °C pulling its full board power and dropping 400 MHz is not
/// overheating, and telling its owner to clean the cooler wastes an afternoon. Raising the power
/// limit, or accepting the clock, is the actual answer.
/// </para>
/// <para>
/// The vendor names the cause directly, which is what makes this a statement about cause rather
/// than a correlation. Where the vendor reports a hardware slowdown without naming a cause, this
/// rule takes it as partial support and says so, rather than resolving the ambiguity in its own
/// favour.
/// </para>
/// </remarks>
public sealed class GpuPowerLimitRule : IDiagnosticRule
{
    /// <summary>Clock drop, relative to the pre-event median, that counts as a reduction.</summary>
    private const double ClockDropThreshold = 0.08;

    public string Id => "gpu-power-limit";
    public string Title => "GPU power limit";

    public RuleEvaluation Evaluate(CorrelationWindow window)
    {
        var reason = window.Get(MetricId.GpuThrottleReason);
        var clock = window.Get(MetricId.GpuClockCore);
        var power = window.Get(MetricId.GpuPower);

        if (reason is not { Availability: Availability.Available })
            return RuleEvaluation.NotCheckable("gpu.throttle.reason");

        var verdict = GpuThrottleReasons.Classify(reason.ThrottleReasons());

        if (verdict is not (GpuThrottleVerdict.PowerLimit or GpuThrottleVerdict.ThermalOrPower))
        {
            return RuleEvaluation.Rejected(
                $"The GPU reported {GpuThrottleReasons.Describe(verdict)} as the reason for its clocks.");
        }

        var evidence = new List<EvidenceItem>();
        var missing = new List<string>();

        var named = verdict is GpuThrottleVerdict.PowerLimit;

        evidence.Add(new EvidenceItem(
            reason.Key,
            named
                ? "The GPU reported a power limit as the reason for reducing clocks"
                : "The GPU reported a hardware slowdown without naming the cause, which is either "
                  + "temperature or power",
            // A named power bit is direct vendor testimony. The unnamed hardware-slowdown bit is
            // consistent with this hypothesis and with thermal throttling equally, so it is worth
            // far less — enough to raise the hypothesis, not enough to conclude it.
            LikelihoodRatio: named ? 30.0 : 2.5,
            EvidenceClass.Power,
            EvidenceRole.Cause,
            reason.ReadableCount, reason.NativeRateHz, reason.CanEstablishOrdering, reason.Quality));

        var clockDrop = clock?.RelativeDelta() ?? double.NaN;
        if (!double.IsNaN(clockDrop) && clockDrop < -ClockDropThreshold)
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

        if (power is { Availability: Availability.Available } && power.ReadableCount > 0)
        {
            evidence.Add(new EvidenceItem(
                power.Key,
                $"GPU board power reached {power.Max():F0} W",
                LikelihoodRatio: 4.0,
                EvidenceClass.Power,
                EvidenceRole.Cause,
                power.ReadableCount, power.NativeRateHz,
                power.CanEstablishOrdering, power.Quality));
        }
        else
        {
            // Named separately from the clock, because board power is what would distinguish a
            // power limit from a thermal one when the vendor declines to say.
            missing.Add("gpu.power");
        }

        // The GPU temperature is a contradiction check, not support: a card that is also very hot
        // makes the unnamed-slowdown case ambiguous rather than settled.
        var temperature = window.Get(MetricId.GpuTemperature);
        if (!named && temperature is { Availability: Availability.Available } && temperature.Max() >= 83.0)
        {
            evidence.Add(new EvidenceItem(
                temperature.Key,
                $"The GPU was also at {temperature.Max():F0} C, so temperature cannot be excluded",
                LikelihoodRatio: 0.4,
                EvidenceClass.Thermal,
                EvidenceRole.Contradicting,
                temperature.ReadableCount, temperature.NativeRateHz,
                temperature.CanEstablishOrdering, temperature.Quality));
        }

        return new RuleEvaluation(
            evidence, missing,
            RejectionReason: null,
            WhatHappened:
                $"Frame time rose to {window.Event.PeakFrameTimeMs:F0} ms while the GPU was "
                + $"limited by {GpuThrottleReasons.Describe(verdict)}.",
            Mechanism:
                "The GPU was drawing as much power as it is allowed to and reduced its clock to "
                + "stay inside that budget. Less clock means less work per second, so frames take "
                + "longer. This is the card behaving as designed, not a fault.",
            RecommendedAction:
                named
                    ? "This is normal behaviour at stock settings. If the card's power limit is "
                      + "adjustable, raising it trades power and heat for clock. Lowering the "
                      + "graphics settings that drive power draw is the alternative."
                    : "The GPU did not say whether temperature or power caused this. A power "
                      + "reading would separate them; without one, treat both as open.");
    }
}

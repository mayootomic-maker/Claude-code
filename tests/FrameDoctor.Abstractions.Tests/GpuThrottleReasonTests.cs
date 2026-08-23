using Xunit;
using FrameDoctor.Abstractions.Telemetry;
using Shouldly;

namespace FrameDoctor.Abstractions.Tests;

/// <summary>
/// The bitmask that decides whether FrameDoctor is allowed to say "overheating".
/// </summary>
/// <remarks>
/// Interpreted in exactly one place because a bitmask read in two places will eventually be read
/// two ways, and the two readings differ on the case that matters most.
/// </remarks>
public sealed class GpuThrottleReasonTests
{
    [Fact]
    public void No_bits_set_is_not_throttling()
    {
        GpuThrottleReasons.Classify(GpuThrottleReason.None)
            .ShouldBe(GpuThrottleVerdict.NotThrottled);
    }

    [Fact]
    public void A_named_thermal_bit_licenses_the_word_thermal()
    {
        GpuThrottleReasons.Classify(GpuThrottleReason.SoftwareThermalSlowdown)
            .ShouldBe(GpuThrottleVerdict.Thermal);
        GpuThrottleReasons.Classify(GpuThrottleReason.HardwareThermalSlowdown)
            .ShouldBe(GpuThrottleVerdict.Thermal);
    }

    [Fact]
    public void A_power_bit_is_a_power_limit_and_never_a_thermal_one()
    {
        // The distinction that saves a user an afternoon: a card at 68 C pinned to its power
        // limit is not overheating, and telling them to clean the cooler is wrong advice.
        GpuThrottleReasons.Classify(GpuThrottleReason.SoftwarePowerCap)
            .ShouldBe(GpuThrottleVerdict.PowerLimit);
        GpuThrottleReasons.Classify(GpuThrottleReason.HardwarePowerBrake)
            .ShouldBe(GpuThrottleVerdict.PowerLimit);
    }

    [Fact]
    public void An_unnamed_hardware_slowdown_is_left_unresolved()
    {
        // The vendor's own description gives three possible causes and does not say which. This
        // bit alone is the easiest way to write a confidently wrong thermal diagnosis.
        GpuThrottleReasons.Classify(GpuThrottleReason.HardwareSlowdown)
            .ShouldBe(GpuThrottleVerdict.ThermalOrPower);
    }

    [Fact]
    public void A_named_bit_beside_the_unnamed_one_resolves_to_the_named_cause()
    {
        // Specificity, not bit order. The specific bit is the evidence; the general one adds
        // nothing to it.
        GpuThrottleReasons
            .Classify(GpuThrottleReason.HardwareSlowdown | GpuThrottleReason.HardwareThermalSlowdown)
            .ShouldBe(GpuThrottleVerdict.Thermal);

        GpuThrottleReasons
            .Classify(GpuThrottleReason.HardwareSlowdown | GpuThrottleReason.SoftwarePowerCap)
            .ShouldBe(GpuThrottleVerdict.PowerLimit);
    }

    [Fact]
    public void Thermal_outranks_power_when_the_vendor_reports_both()
    {
        // Both limits can bind at once. Thermal is reported because it is the one with a
        // physical remedy the user can act on.
        GpuThrottleReasons
            .Classify(GpuThrottleReason.SoftwarePowerCap | GpuThrottleReason.HardwareThermalSlowdown)
            .ShouldBe(GpuThrottleVerdict.Thermal);
    }

    [Fact]
    public void An_idle_GPU_is_reported_as_idle_rather_than_as_throttled()
    {
        // Not a fault, and worth knowing: a GPU at idle clocks while frames are being presented
        // is a GPU waiting on the CPU.
        GpuThrottleReasons.Classify(GpuThrottleReason.GpuIdle).ShouldBe(GpuThrottleVerdict.Idle);
    }

    [Fact]
    public void Configuration_bits_are_not_a_limit_being_hit()
    {
        GpuThrottleReasons.Classify(GpuThrottleReason.ApplicationClocksSetting)
            .ShouldBe(GpuThrottleVerdict.Configured);
        GpuThrottleReasons.Classify(GpuThrottleReason.DisplayClockSetting)
            .ShouldBe(GpuThrottleVerdict.Configured);
        GpuThrottleReasons.Classify(GpuThrottleReason.SyncBoost)
            .ShouldBe(GpuThrottleVerdict.Configured);
    }

    [Fact]
    public void An_idle_bit_never_masks_a_real_limit()
    {
        // A GPU can report idle clocks and a power cap in the same window as load comes and
        // goes. Reporting "idle" there would discard the finding.
        GpuThrottleReasons.Classify(GpuThrottleReason.GpuIdle | GpuThrottleReason.SoftwarePowerCap)
            .ShouldBe(GpuThrottleVerdict.PowerLimit);
    }

    [Fact]
    public void A_stored_samples_raw_double_classifies_the_same_as_the_flags()
    {
        // Samples carry the bitmask as a double, and it must survive the round trip: the point
        // of storing it raw is that an old session can be reinterpreted later.
        GpuThrottleReasons.Classify(64.0).ShouldBe(GpuThrottleVerdict.Thermal);
        GpuThrottleReasons.Classify(4.0).ShouldBe(GpuThrottleVerdict.PowerLimit);
        GpuThrottleReasons.Classify(0.0).ShouldBe(GpuThrottleVerdict.NotThrottled);
    }

    [Fact]
    public void A_nonsensical_stored_value_does_not_invent_a_throttle()
    {
        GpuThrottleReasons.Classify(-1.0).ShouldBe(GpuThrottleVerdict.NotThrottled);
        GpuThrottleReasons.Classify(double.NaN).ShouldBe(GpuThrottleVerdict.NotThrottled);
    }

    [Fact]
    public void An_unknown_future_bit_is_not_read_as_a_throttle()
    {
        // Vendors add bits. A bit we have never seen is not evidence of anything, and guessing
        // would put a confident cause on a mask we do not understand.
        GpuThrottleReasons.Classify((GpuThrottleReason)0x8000)
            .ShouldBe(GpuThrottleVerdict.NotThrottled);
    }

    [Fact]
    public void Every_verdict_has_wording_that_reads_as_a_sentence()
    {
        foreach (var verdict in Enum.GetValues<GpuThrottleVerdict>())
        {
            var description = GpuThrottleReasons.Describe(verdict);

            description.ShouldNotBeNullOrWhiteSpace();
            description.ShouldNotContain("Verdict");
        }
    }
}

using Xunit;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Platform.Windows.Pdh;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// The metrics Windows does not publish, and the false diagnoses a careless derivation produces.
/// </summary>
public sealed class CounterDerivationTests
{
    [Fact]
    public void Effective_clock_scales_the_base_clock_by_measured_performance()
    {
        var derived = CounterDerivations.EffectiveClockMhz(
            baseMhz: 3600, processorPerformancePercent: 50, utilityPercent: 80);

        derived.HasValue.ShouldBeTrue();
        derived.Value.ShouldBe(1800, 1e-9);
    }

    [Fact]
    public void Turbo_above_the_base_clock_is_reported_rather_than_capped()
    {
        // % Processor Performance legitimately exceeds 100 under turbo. Capping it would flatten
        // exactly the readings that distinguish a boosting CPU from a throttled one.
        var derived = CounterDerivations.EffectiveClockMhz(3600, 128, 90);

        derived.HasValue.ShouldBeTrue();
        derived.Value.ShouldBe(4608, 1e-9);
    }

    [Fact]
    public void An_idle_processor_reports_no_effective_clock_rather_than_a_collapse()
    {
        // The regression this gate exists for. % Processor Performance is the average
        // performance while executing, so on an idle core it is an average over nothing and
        // swings wildly. Publishing it would report a dramatic clock collapse on a machine that
        // was doing nothing at all.
        var derived = CounterDerivations.EffectiveClockMhz(3600, 22, utilityPercent: 1.0);

        derived.HasValue.ShouldBeFalse();
        derived.Reason.ShouldBe(UnavailableReason.NotMeaningfulInCurrentState);
    }

    [Fact]
    public void A_missing_base_clock_yields_no_effective_clock_rather_than_a_guess()
    {
        // A wrong base clock scales every derived reading, turning a healthy CPU into a
        // permanent false frequency collapse.
        var derived = CounterDerivations.EffectiveClockMhz(baseMhz: 0, 90, 80);

        derived.HasValue.ShouldBeFalse();
        derived.Reason.ShouldBe(UnavailableReason.NoSensor);
    }

    [Fact]
    public void An_unread_counter_yields_not_yet_sampled_rather_than_zero_megahertz()
    {
        CounterDerivations.EffectiveClockMhz(3600, double.NaN, 80).Reason
            .ShouldBe(UnavailableReason.NotYetSampled);
        CounterDerivations.EffectiveClockMhz(3600, 90, double.NaN).Reason
            .ShouldBe(UnavailableReason.NotYetSampled);
    }

    [Fact]
    public void Disk_activity_is_the_complement_of_idle_time()
    {
        // Windows publishes no % Active Time on PhysicalDisk; this subtraction is what Task
        // Manager shows as "Active time".
        CounterDerivations.DiskActivePercent(93.0).Value.ShouldBe(7.0, 1e-9);
    }

    [Fact]
    public void A_rate_counter_overshooting_its_range_is_clamped_into_it_not_onto_a_default()
    {
        CounterDerivations.DiskActivePercent(-0.4).Value.ShouldBe(100.0);
        CounterDerivations.DiskActivePercent(100.6).Value.ShouldBe(0.0);
    }

    [Fact]
    public void An_unread_idle_counter_does_not_report_a_perfectly_idle_disk()
    {
        var derived = CounterDerivations.DiskActivePercent(double.NaN);

        derived.HasValue.ShouldBeFalse();
        derived.Reason.ShouldBe(UnavailableReason.NotYetSampled);
    }

    [Fact]
    public void Adapter_GPU_utilization_is_the_busiest_engine_not_the_sum()
    {
        // Engines run in parallel. Summing them produces percentages far above 100 and a
        // permanent false "GPU saturated" reading.
        double[] engines = [82, 14, 3, 41];

        CounterDerivations.AdapterUtilizationPercent(engines).Value.ShouldBe(82, 1e-9);
    }

    [Fact]
    public void Engines_that_did_not_read_are_skipped_rather_than_counted_as_idle()
    {
        double[] engines = [double.NaN, 63, double.NaN];

        CounterDerivations.AdapterUtilizationPercent(engines).Value.ShouldBe(63, 1e-9);
    }

    [Fact]
    public void No_engine_reading_at_all_is_absence_not_an_idle_GPU()
    {
        double[] engines = [double.NaN, double.NaN];

        CounterDerivations.AdapterUtilizationPercent(engines).HasValue.ShouldBeFalse();
        CounterDerivations.AdapterUtilizationPercent([]).HasValue.ShouldBeFalse();
    }

    [Fact]
    public void Disk_latency_converts_the_counters_seconds_to_milliseconds()
    {
        CounterDerivations.DiskLatencyMs(0.0125).Value.ShouldBe(12.5, 1e-9);
    }

    [Fact]
    public void Active_cores_counts_the_saturated_ones_not_the_average()
    {
        // The metric exists because total CPU load answers the wrong question: 25 % on sixteen
        // threads is four saturated cores, and a game pinned to a saturated core is CPU-bound at
        // 25 % "usage". A diagnosis reading only the total would rule CPU contention out.
        double[] cores = [99, 97, 2, 1, 3, 0, 1, 2];

        CounterDerivations.ActiveCoreCount(cores).Value.ShouldBe(2);
    }

    [Fact]
    public void A_core_merely_ticking_over_is_not_counted_as_active()
    {
        double[] cores = [30, 25, 40, 12];

        CounterDerivations.ActiveCoreCount(cores).Value.ShouldBe(0);
    }

    [Fact]
    public void A_partial_reading_reports_absence_rather_than_an_undercount()
    {
        // An undercount is what produces the false "the CPU was not busy" conclusion this metric
        // exists to prevent, so a reading that is missing a core is no reading at all.
        double[] cores = [99, double.NaN, 98, 97];

        var derived = CounterDerivations.ActiveCoreCount(cores);

        derived.HasValue.ShouldBeFalse();
        derived.Reason.ShouldBe(UnavailableReason.NotYetSampled);
    }
}

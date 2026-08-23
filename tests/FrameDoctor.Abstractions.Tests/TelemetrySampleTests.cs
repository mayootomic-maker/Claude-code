using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using Shouldly;
using Xunit;

namespace FrameDoctor.Abstractions.Tests;

/// <summary>
/// The "a missing metric is never zero" invariant, tested at the type level.
/// </summary>
/// <remarks>
/// These tests exist because reading an absent sensor as a real zero is the most damaging
/// false diagnosis this product can produce: an absent CPU temperature read as 0 °C says the
/// CPU is cold, and an absent GPU utilization read as 0 % says the GPU is starved. Both are
/// confident, plausible, and wrong.
/// </remarks>
public sealed class TelemetrySampleTests
{
    private static readonly MonotonicTimestamp T = MonotonicTimestamp.FromMilliseconds(1000);

    [Fact]
    public void Measured_sample_yields_its_value()
    {
        var s = TelemetrySample.Measured(T, MetricId.CpuTemperature, SourceId.LibreHardwareMonitor,
            96.0, Unit.Celsius);

        s.TryGetValue(out var v).ShouldBeTrue();
        v.ShouldBe(96.0);
        s.Availability.ShouldBe(Availability.Available);
    }

    [Theory]
    [InlineData(Availability.Unavailable)]
    [InlineData(Availability.Denied)]
    [InlineData(Availability.Failed)]
    public void Sample_without_a_reading_refuses_to_yield_a_value(Availability availability)
    {
        var s = availability switch
        {
            Availability.Unavailable => TelemetrySample.Unavailable(
                T, MetricId.CpuTemperature, SourceId.PerformanceCounters, UnavailableReason.NoSensor),
            Availability.Denied => TelemetrySample.Denied(
                T, MetricId.CpuTemperature, SourceId.PerformanceCounters),
            _ => TelemetrySample.Failed(
                T, MetricId.CpuTemperature, SourceId.PerformanceCounters),
        };

        s.TryGetValue(out var v).ShouldBeFalse();

        // The out value is untouched, not a plausible-looking zero the caller might use anyway.
        v.ShouldBe(default);
        s.Availability.ShouldBe(availability);
    }

    [Fact]
    public void Unavailable_sample_does_not_read_as_a_cold_cpu()
    {
        // The exact bug this design prevents: an absent temperature sensor must not
        // let a thermal detector conclude the CPU is comfortably cool.
        var s = TelemetrySample.Unavailable(T, MetricId.CpuTemperature,
            SourceId.PerformanceCounters, UnavailableReason.RequiresSensorDriver);

        s.TryGetValue(out _).ShouldBeFalse();
        s.Reason.ShouldBe(UnavailableReason.RequiresSensorDriver);
    }

    [Fact]
    public void Stale_sample_still_yields_its_value_but_says_it_is_stale()
    {
        var fresh = TelemetrySample.Measured(T, MetricId.GpuTemperature, SourceId.NvidiaNvml,
            71.0, Unit.Celsius);
        var stale = fresh.AsStaleAt(T + TimeSpan.FromSeconds(5));

        stale.TryGetValue(out var v).ShouldBeTrue();
        v.ShouldBe(71.0);
        stale.Availability.ShouldBe(Availability.Stale);
        stale.Quality.ShouldBe(Quality.Degraded);
        stale.Timestamp.ShouldBe(T + TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void Quality_only_ever_degrades()
    {
        var degraded = TelemetrySample
            .Measured(T, MetricId.GpuUtilization, SourceId.NvidiaNvml, 42.0, Unit.Percent)
            .WithQuality(Quality.Degraded);

        // Attempting to launder a known measurement problem back to Exact is a no-op.
        degraded.WithQuality(Quality.Exact).Quality.ShouldBe(Quality.Degraded);
        degraded.WithQuality(Quality.Derived).Quality.ShouldBe(Quality.Degraded);
    }

    [Fact]
    public void Sample_is_blittable_so_batches_cross_ipc_without_allocating()
    {
        // If this ever becomes false, the zero-allocation IPC path silently starts boxing.
        RuntimeHelpers.IsReferenceOrContainsReferences<TelemetrySample>().ShouldBeFalse();

        var samples = new TelemetrySample[4];
        var bytes = MemoryMarshal.AsBytes<TelemetrySample>(samples);
        bytes.Length.ShouldBe(4 * Marshal.SizeOf<TelemetrySample>());
    }

    [Fact]
    public void Sample_round_trips_through_raw_bytes()
    {
        var original = TelemetrySample.Measured(T, MetricId.FrameTime, SourceId.PresentMonCli,
            6.94, Unit.Milliseconds, Quality.Exact, instance: 4242);

        Span<byte> buffer = stackalloc byte[Marshal.SizeOf<TelemetrySample>()];
        MemoryMarshal.Write(buffer, in original);
        var decoded = MemoryMarshal.Read<TelemetrySample>(buffer);

        decoded.Metric.ShouldBe(MetricId.FrameTime);
        decoded.Source.ShouldBe(SourceId.PresentMonCli);
        decoded.Instance.ShouldBe(4242);
        decoded.TryGetValue(out var v).ShouldBeTrue();
        v.ShouldBe(6.94);
    }

    [Fact]
    public void Machine_wide_metric_reports_no_instance()
    {
        var s = TelemetrySample.Measured(T, MetricId.CpuLoadTotal, SourceId.PerformanceCounters,
            37.0, Unit.Percent);

        s.HasInstance.ShouldBeFalse();
        s.Instance.ShouldBe(TelemetrySample.NoInstance);
    }
}

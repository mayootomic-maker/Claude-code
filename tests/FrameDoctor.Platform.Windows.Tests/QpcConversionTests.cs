using Xunit;
using FrameDoctor.Platform.Windows.Time;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// The counter arithmetic, held against the overflow that only appears after the session has
/// been running long enough to pass a quick manual test.
/// </summary>
public sealed class QpcConversionTests
{
    /// <summary>What modern Windows reports on essentially every machine.</summary>
    private const long TenMegahertz = 10_000_000;

    [Fact]
    public void A_second_of_counter_ticks_is_a_second_of_session_time()
    {
        QpcConversion.DeltaToTicks(TenMegahertz, TenMegahertz).ShouldBe(TimeSpan.TicksPerSecond);
    }

    [Fact]
    public void A_session_longer_than_thirty_seconds_does_not_overflow()
    {
        // The regression this arithmetic exists for. delta * 10_000_000 in Int64 overflows at
        // about 29 seconds on a 10 MHz counter, and the result goes negative rather than
        // throwing — so every frame time after the half-minute mark becomes nonsense.
        var thirtySeconds = 30 * TenMegahertz;

        QpcConversion.DeltaToTicks(thirtySeconds, TenMegahertz)
            .ShouldBe(30 * TimeSpan.TicksPerSecond);
    }

    [Fact]
    public void An_eight_hour_session_stays_exact()
    {
        var eightHours = 8L * 3600 * TenMegahertz;

        QpcConversion.DeltaToTicks(eightHours, TenMegahertz)
            .ShouldBe(8L * 3600 * TimeSpan.TicksPerSecond);
    }

    [Fact]
    public void Sub_microsecond_intervals_round_trip_at_the_counter_resolution()
    {
        // A 10 MHz counter tick is exactly 100 ns, which is exactly one MonotonicTimestamp tick.
        // The frame codec encodes second differences of these integers; a value that fails to
        // round-trip corrupts every later timestamp in the segment, not only its own.
        for (long ticks = 1; ticks <= 1000; ticks++)
            QpcConversion.DeltaToTicks(ticks, TenMegahertz).ShouldBe(ticks);
    }

    [Fact]
    public void The_older_3579545_hz_counter_frequency_still_converts()
    {
        // Pre-TSC-invariant machines report the ACPI PM timer frequency. It does not divide
        // evenly into 100 ns, which is exactly why the conversion is done in Int128.
        const long acpiPmTimer = 3_579_545;

        QpcConversion.DeltaToTicks(acpiPmTimer, acpiPmTimer).ShouldBe(TimeSpan.TicksPerSecond);
        QpcConversion.DeltaToTicks(3600 * acpiPmTimer, acpiPmTimer)
            .ShouldBe(3600 * TimeSpan.TicksPerSecond);
    }

    [Fact]
    public void A_zero_frequency_is_refused_rather_than_dividing_by_zero()
    {
        Should.Throw<ArgumentOutOfRangeException>(() => QpcConversion.DeltaToTicks(1, 0));
    }

    [Fact]
    public void A_frame_that_began_before_the_epoch_is_clamped_and_counted()
    {
        // Legitimate: PresentMon's trace session can start before our epoch and flush a frame
        // that began earlier. Clamping silently would pile frames onto timestamp zero and
        // manufacture a burst of impossible zero-length frames, so the caller is told.
        var timestamp = QpcConversion.ToTimestamp(
            qpc: 900, epochQpc: 1000, TenMegahertz, out var precededEpoch);

        precededEpoch.ShouldBeTrue();
        timestamp.Ticks.ShouldBe(0);
    }

    [Fact]
    public void A_normal_frame_is_offset_from_the_epoch_and_not_flagged()
    {
        var timestamp = QpcConversion.ToTimestamp(
            qpc: 1000 + TenMegahertz, epochQpc: 1000, TenMegahertz, out var precededEpoch);

        precededEpoch.ShouldBeFalse();
        timestamp.Ticks.ShouldBe(TimeSpan.TicksPerSecond);
    }

    [Fact]
    public void A_counter_past_the_signed_range_still_subtracts_correctly()
    {
        // QPC is unsigned and a long-uptime machine can carry a value above long.MaxValue. The
        // subtraction is done unchecked in signed space precisely so it wraps correctly instead
        // of throwing or producing a nonsense magnitude.
        const ulong epoch = ulong.MaxValue - 5 * (ulong)TenMegahertz;
        var qpc = epoch + (ulong)TenMegahertz;

        var timestamp = QpcConversion.ToTimestamp(qpc, epoch, TenMegahertz, out var precededEpoch);

        precededEpoch.ShouldBeFalse();
        timestamp.Ticks.ShouldBe(TimeSpan.TicksPerSecond);
    }
}

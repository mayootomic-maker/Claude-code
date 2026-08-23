using Xunit;
using FrameDoctor.Platform.Windows.Processes;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// Turning two process enumerations into "Discord was using 84 % of a core".
/// </summary>
/// <remarks>
/// The cases here are all about processes that appear or vanish between the two readings, which
/// happens constantly on a real desktop and is the easiest way to name the wrong culprit.
/// </remarks>
public sealed class ProcessCpuDeltaTests
{
    private static readonly TimeSpan OneSecond = TimeSpan.FromSeconds(1);

    private static ProcessCpuSnapshot Snap(int pid, string name, double cpuSeconds) =>
        new(pid, name, (long)(cpuSeconds * TimeSpan.TicksPerSecond));

    [Fact]
    public void One_saturated_core_of_eight_reports_as_an_eighth_of_the_machine()
    {
        // Percent of the machine, not of a core. This is the number that composes with total CPU
        // load; reporting 100 % for one busy core would make every comparison downstream wrong.
        var before = new[] { Snap(4812, "game.exe", 10.0) };
        var after = new[] { Snap(4812, "game.exe", 11.0) };

        var result = ProcessCpuDelta.Compute(before, after, OneSecond, logicalProcessorCount: 8);

        result.Count.ShouldBe(1);
        result[0].CpuPercent.ShouldBe(12.5, 1e-9);
    }

    [Fact]
    public void Four_saturated_cores_of_sixteen_report_as_a_quarter()
    {
        var before = new[] { Snap(900, "compiler.exe", 0) };
        var after = new[] { Snap(900, "compiler.exe", 4.0) };

        ProcessCpuDelta.Compute(before, after, OneSecond, 16)[0].CpuPercent.ShouldBe(25.0, 1e-9);
    }

    [Fact]
    public void The_busiest_process_comes_first()
    {
        var before = new[] { Snap(1, "a", 0), Snap(2, "b", 0), Snap(3, "c", 0) };
        var after = new[] { Snap(1, "a", 0.2), Snap(2, "b", 1.6), Snap(3, "c", 0.9) };

        var result = ProcessCpuDelta.Compute(before, after, OneSecond, 4);

        result.Select(r => r.ProcessId).ShouldBe([2, 3, 1]);
    }

    [Fact]
    public void A_process_that_started_mid_interval_is_skipped_not_credited_with_its_whole_life()
    {
        // The trap this exists for. A process absent from the earlier reading has no baseline,
        // and treating its cumulative CPU as this interval's usage would name a long-running
        // process that just happened to be enumerated for the first time.
        var before = new[] { Snap(1, "a", 5.0) };
        var after = new[] { Snap(1, "a", 5.1), Snap(2, "newcomer", 900.0) };

        var result = ProcessCpuDelta.Compute(before, after, OneSecond, 4);

        result.ShouldAllBe(r => r.ProcessId == 1);
    }

    [Fact]
    public void A_recycled_process_id_is_dropped_rather_than_clamped_to_zero()
    {
        // A negative delta means this pid belongs to a different process now. There is no
        // correct value; reporting zero would claim the process was idle, which is a
        // measurement rather than an absence.
        var before = new[] { Snap(1, "old", 500.0) };
        var after = new[] { Snap(1, "new", 0.4) };

        ProcessCpuDelta.Compute(before, after, OneSecond, 4).ShouldBeEmpty();
    }

    [Fact]
    public void Near_idle_processes_are_left_out()
    {
        // A few hundred near-zero series would cost the correlation window far more than they
        // inform it.
        var before = new[] { Snap(1, "idle", 0), Snap(2, "busy", 0) };
        var after = new[] { Snap(1, "idle", 0.001), Snap(2, "busy", 2.0) };

        var result = ProcessCpuDelta.Compute(before, after, OneSecond, 4);

        result.Count.ShouldBe(1);
        result[0].ProcessId.ShouldBe(2);
    }

    [Fact]
    public void A_process_pegging_every_core_is_capped_at_the_whole_machine()
    {
        // Scheduling jitter can put slightly more CPU time in an interval than wall time times
        // core count. Above 100 % of the machine is not a meaningful reading.
        var before = new[] { Snap(1, "everything", 0) };
        var after = new[] { Snap(1, "everything", 4.4) };

        ProcessCpuDelta.Compute(before, after, OneSecond, 4)[0].CpuPercent.ShouldBe(100.0);
    }

    [Fact]
    public void A_zero_length_interval_yields_nothing_rather_than_infinity()
    {
        var before = new[] { Snap(1, "a", 0) };
        var after = new[] { Snap(1, "a", 1.0) };

        ProcessCpuDelta.Compute(before, after, TimeSpan.Zero, 4).ShouldBeEmpty();
        ProcessCpuDelta.Compute(before, after, TimeSpan.FromSeconds(-1), 4).ShouldBeEmpty();
    }

    [Fact]
    public void A_longer_interval_scales_the_percentage_down()
    {
        // Guards the denominator: one CPU-second over four wall-seconds on four cores is 6.25 %,
        // not 25 %.
        var before = new[] { Snap(1, "a", 0) };
        var after = new[] { Snap(1, "a", 1.0) };

        ProcessCpuDelta.Compute(before, after, TimeSpan.FromSeconds(4), 4)[0]
            .CpuPercent.ShouldBe(6.25, 1e-9);
    }

    [Fact]
    public void A_processor_count_of_zero_is_refused_rather_than_dividing_by_it()
    {
        Should.Throw<ArgumentOutOfRangeException>(() =>
            ProcessCpuDelta.Compute([], [], OneSecond, 0));
    }
}

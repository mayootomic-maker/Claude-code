using Xunit;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Platform.Windows.Pdh;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

public sealed class PdhStatusTests
{
    [Fact]
    public void A_counter_that_is_not_ready_yet_is_absent_not_zero()
    {
        // Every rate counter is in this state on the first collect of a session.
        var (state, reason) = PdhStatus.Classify(PdhStatus.InvalidData);

        state.ShouldBe(Availability.Unavailable);
        reason.ShouldBe(UnavailableReason.NotYetSampled);
    }

    [Fact]
    public void A_counter_whose_raw_values_ran_backwards_is_a_fault_not_a_number()
    {
        // Happens when an instance is recycled mid-interval. Reporting zero would render a busy
        // disk as idle at exactly the moment something interesting happened to it.
        PdhStatus.Classify(PdhStatus.CalcNegativeValue).State.ShouldBe(Availability.Failed);
        PdhStatus.Classify(PdhStatus.CalcNegativeDenominator).State.ShouldBe(Availability.Failed);
        PdhStatus.Classify(PdhStatus.CalcNegativeTimebase).State.ShouldBe(Availability.Failed);
    }

    [Fact]
    public void A_counter_this_machine_does_not_have_is_reported_as_no_sensor()
    {
        PdhStatus.Classify(PdhStatus.NoInstance).Reason.ShouldBe(UnavailableReason.NoSensor);
        PdhStatus.Classify(PdhStatus.CStatusNoObject).Reason.ShouldBe(UnavailableReason.NoSensor);
        PdhStatus.Classify(PdhStatus.CStatusNoCounter).Reason.ShouldBe(UnavailableReason.NoSensor);
    }

    [Fact]
    public void Access_denied_is_kept_distinct_because_the_user_can_act_on_it()
    {
        var (state, reason) = PdhStatus.Classify(PdhStatus.AccessDenied);

        state.ShouldBe(Availability.Denied);
        reason.ShouldBe(UnavailableReason.InsufficientPrivilege);
    }

    [Fact]
    public void An_unrecognised_status_is_a_fault_rather_than_an_invented_explanation()
    {
        PdhStatus.Classify(0xDEAD_BEEF).Reason.ShouldBe(UnavailableReason.SourceFaulted);
    }

    [Fact]
    public void Only_permanent_failures_retire_a_counter()
    {
        // The distinction that keeps the collector working. Retiring a counter that is merely
        // not ready would permanently disable every rate counter on the machine, since none of
        // them has a value on the first collect.
        PdhStatus.IsPermanent(PdhStatus.NoInstance).ShouldBeTrue();
        PdhStatus.IsPermanent(PdhStatus.CStatusNoCounter).ShouldBeTrue();
        PdhStatus.IsPermanent(PdhStatus.InvalidPath).ShouldBeTrue();

        PdhStatus.IsPermanent(PdhStatus.InvalidData).ShouldBeFalse();
        PdhStatus.IsPermanent(PdhStatus.CalcNegativeValue).ShouldBeFalse();
        PdhStatus.IsPermanent(PdhStatus.AccessDenied).ShouldBeFalse();
    }
}

public sealed class CounterPathTests
{
    [Fact]
    public void Processor_instances_are_group_comma_cpu_not_a_bare_index()
    {
        // The legacy Processor object uses bare indices; Processor Information does not. Getting
        // this wrong yields a path that adds successfully and never reads.
        CounterPaths.ProcessorInstance(0, 5).ShouldBe("0,5");
        CounterPaths.CpuUtilityFor(0, 5)
            .ShouldBe(@"\Processor Information(0,5)\% Processor Utility");
    }

    [Fact]
    public void A_machine_within_one_group_enumerates_as_group_zero()
    {
        var processors = CounterPaths.EnumerateProcessors(16).ToArray();

        processors.Length.ShouldBe(16);
        processors.ShouldAllBe(p => p.Group == 0);
        processors[15].Processor.ShouldBe(15);
    }

    [Fact]
    public void A_machine_past_sixty_four_threads_spills_into_a_second_group()
    {
        // Windows caps a processor group at 64 logical processors. A collector that assumes one
        // group silently measures only half a 128-thread workstation.
        var processors = CounterPaths.EnumerateProcessors(128).ToArray();

        processors[63].ShouldBe((0, 63));
        processors[64].ShouldBe((1, 0));
        processors[127].ShouldBe((1, 63));
    }
}

using Xunit;
using FrameDoctor.Platform.Windows.Optimization;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// The parts of the only system mutation that can be checked without Windows.
/// </summary>
/// <remarks>
/// The calls themselves cannot run here. What can — and what would be silently wrong if it were
/// not tested — is the mapping between Windows' two flag masks and the three states FrameDoctor
/// tells them apart as, and the target identity that stops a restore landing on the wrong
/// process.
/// </remarks>
public sealed class EcoQosChangeTests
{
    [Fact]
    public void A_cleared_control_mask_means_Windows_decides()
    {
        // The shipped default and the state almost every process is in. Reading it as
        // "explicitly not throttled" would make a later restore write an explicit choice where
        // the user had none.
        var (controlMask, stateMask) = EcoQosState.Compose(EcoQosState.SystemManaged);

        controlMask.ShouldBe(0u);
        stateMask.ShouldBe(0u);
        EcoQosState.Describe(controlMask, stateMask).ShouldBe(EcoQosState.SystemManaged);
    }

    [Fact]
    public void Restrained_sets_both_masks()
    {
        var (controlMask, stateMask) = EcoQosState.Compose(EcoQosState.Restrained);

        controlMask.ShouldBe(1u);
        stateMask.ShouldBe(1u);
        EcoQosState.Describe(controlMask, stateMask).ShouldBe(EcoQosState.Restrained);
    }

    [Fact]
    public void An_explicit_never_throttle_is_a_third_state_not_the_default()
    {
        // Restoring "system managed" over someone's explicit "never throttle this" would be
        // overwriting a decision they made. The two must not collapse into one.
        var (controlMask, stateMask) = EcoQosState.Compose(EcoQosState.NotThrottled);

        controlMask.ShouldBe(1u);
        stateMask.ShouldBe(0u);
        EcoQosState.Describe(controlMask, stateMask).ShouldBe(EcoQosState.NotThrottled);

        EcoQosState.NotThrottled.ShouldNotBe(EcoQosState.SystemManaged);
    }

    [Fact]
    public void Every_state_round_trips_through_the_flags()
    {
        foreach (var value in new[]
                 {
                     EcoQosState.SystemManaged,
                     EcoQosState.Restrained,
                     EcoQosState.NotThrottled,
                 })
        {
            var (controlMask, stateMask) = EcoQosState.Compose(value);
            EcoQosState.Describe(controlMask, stateMask).ShouldBe(value);
        }
    }

    [Fact]
    public void An_unrecognised_value_composes_to_the_documented_reset()
    {
        // Fail-safe rather than fail-arbitrary: an unknown value hands the decision back to
        // Windows instead of pinning the process to a state of our choosing.
        var (controlMask, stateMask) = EcoQosState.Compose("something-else");

        controlMask.ShouldBe(0u);
        stateMask.ShouldBe(0u);
    }

    [Fact]
    public void A_target_identifies_a_process_by_more_than_its_id()
    {
        // Windows reuses process ids freely. Restoring a captured value onto a different process
        // that happens to hold the same id would be a mutation of an innocent target, and the
        // compare-and-restore table cannot catch it.
        var target = EcoQosState.TargetFor(4812, 638_000_000_000_000_000);

        target.ShouldContain("4812");
        target.ShouldContain("638000000000000000");
    }

    [Fact]
    public void Two_processes_reusing_one_id_produce_different_targets()
    {
        EcoQosState.TargetFor(4812, 100).ShouldNotBe(EcoQosState.TargetFor(4812, 200));
    }

    [Fact]
    public void A_target_parses_back_to_its_process_id()
    {
        EcoQosState.TryParseTarget(EcoQosState.TargetFor(4812, 999), out var pid).ShouldBeTrue();
        pid.ShouldBe(4812u);
    }

    [Fact]
    public void A_malformed_target_is_refused_rather_than_defaulting_to_a_process()
    {
        // Defaulting to zero would address the System Idle Process, which is the worst possible
        // place for a stray write to land.
        EcoQosState.TryParseTarget("", out _).ShouldBeFalse();
        EcoQosState.TryParseTarget("discord.exe", out _).ShouldBeFalse();
        EcoQosState.TryParseTarget("pid:", out _).ShouldBeFalse();
        EcoQosState.TryParseTarget("pid:abc|started:1", out _).ShouldBeFalse();
    }
}

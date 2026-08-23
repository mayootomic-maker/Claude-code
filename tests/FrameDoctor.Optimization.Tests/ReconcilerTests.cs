using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// The function that decides whether to write to someone's machine.
/// </summary>
/// <remarks>
/// Every branch is tested because every branch is a decision to modify a system or to leave it
/// alone, and the failure modes are asymmetric: leaving a change applied is an annoyance, while
/// overwriting a later choice the user made is FrameDoctor doing the thing it exists not to do.
/// </remarks>
public sealed class ReconcilerTests
{
    private static JournalEntry Entry(string captured = "system-managed", string applied = "eco") =>
        new("pid-4812", "process-eco-qos", "pid:4812|started:1", "discord.exe (4812)",
            captured, applied, DateTimeOffset.UnixEpoch, "test");

    [Fact]
    public void A_setting_still_holding_what_we_applied_is_restored()
    {
        Reconciler.Decide(CurrentValue.Read("eco"), Entry())
            .ShouldBe(ReconcileDecision.Restore);
    }

    [Fact]
    public void A_setting_already_back_to_its_original_needs_nothing()
    {
        Reconciler.Decide(CurrentValue.Read("system-managed"), Entry())
            .ShouldBe(ReconcileDecision.AlreadyRestored);
    }

    [Fact]
    public void A_value_changed_by_someone_else_is_never_overwritten()
    {
        // The row this whole design exists for. Writing a captured value over a later choice is
        // a mutation, not a rollback: a rollback system that always restores is a system that
        // overwrites its user.
        Reconciler.Decide(CurrentValue.Read("high-performance"), Entry())
            .ShouldBe(ReconcileDecision.ChangedByThirdParty);
    }

    [Fact]
    public void A_third_party_change_keeps_its_entry_so_the_user_can_still_be_told()
    {
        Reconciler.EntryIsSettled(ReconcileDecision.ChangedByThirdParty).ShouldBeFalse();
    }

    [Fact]
    public void A_target_that_no_longer_exists_is_settled_with_nothing_to_do()
    {
        var decision = Reconciler.Decide(CurrentValue.Gone, Entry());

        decision.ShouldBe(ReconcileDecision.TargetGone);
        Reconciler.EntryIsSettled(decision).ShouldBeTrue();
    }

    [Fact]
    public void An_unreadable_setting_is_left_alone_and_its_entry_kept()
    {
        // Restoring without knowing the current value is a blind write, which is the practice
        // this design exists to avoid.
        var decision = Reconciler.Decide(CurrentValue.Unreadable, Entry());

        decision.ShouldBe(ReconcileDecision.CannotRead);
        Reconciler.EntryIsSettled(decision).ShouldBeFalse();
    }

    [Fact]
    public void A_restore_is_not_settled_until_it_has_been_verified()
    {
        // Deleting the entry on the strength of having attempted a write would lose the record
        // of a change that is still applied.
        Reconciler.EntryIsSettled(ReconcileDecision.Restore).ShouldBeFalse();
    }

    [Fact]
    public void Reconciling_twice_is_a_no_op_the_second_time()
    {
        // It runs at every engine start, at logon, and from the uninstaller, so idempotence is
        // not a nicety.
        var entry = Entry();

        Reconciler.Decide(CurrentValue.Read("eco"), entry).ShouldBe(ReconcileDecision.Restore);
        Reconciler.Decide(CurrentValue.Read("system-managed"), entry)
            .ShouldBe(ReconcileDecision.AlreadyRestored);
    }

    [Fact]
    public void Values_are_compared_exactly_rather_than_loosely()
    {
        // These are opaque platform values, not text. Two strings differing only by case are two
        // different settings, and a culture-aware comparison could equate them on one machine
        // and not another.
        Reconciler.Decide(CurrentValue.Read("ECO"), Entry())
            .ShouldBe(ReconcileDecision.ChangedByThirdParty);
    }

    [Fact]
    public void An_entry_whose_captured_and_applied_values_match_is_already_restored()
    {
        // Degenerate but reachable: a target that was already in the state we wanted. There is
        // nothing to undo and the entry must not linger forever.
        Reconciler.Decide(CurrentValue.Read("eco"), Entry(captured: "eco", applied: "eco"))
            .ShouldBe(ReconcileDecision.Restore);
    }

    [Fact]
    public void Every_decision_has_wording_that_says_what_happened_to_the_users_machine()
    {
        foreach (var decision in Enum.GetValues<ReconcileDecision>())
        {
            var description = Reconciler.Describe(decision, Entry());

            description.ShouldNotBeNullOrWhiteSpace();
            description.ShouldContain("discord.exe");
        }
    }

    [Fact]
    public void The_third_party_wording_tells_the_user_that_nothing_was_overwritten()
    {
        Reconciler.Describe(ReconcileDecision.ChangedByThirdParty, Entry())
            .ShouldContain("will not overwrite");
    }
}

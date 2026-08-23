using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// The apply protocol, and the orderings that make power loss survivable.
/// </summary>
/// <remarks>
/// The fake below is not a shortcut around testing the real thing — the real thing is a single
/// Windows API call. Everything that can go wrong lives in the sequencing around it, and the
/// fake is what makes each failure reachable on demand: a read that fails, a read that moves, a
/// write that lies about succeeding, a machine that loses power between two steps.
/// </remarks>
public sealed class ChangeApplierTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), $"framedoctor-applier-{Guid.NewGuid():N}");

    private ChangeJournal Journal => new(_directory);

    /// <summary>A settable value with every failure mode reachable on demand.</summary>
    private sealed class FakeSetting : IReversibleChange
    {
        public string ChangeKind => "test-setting";
        public string RestrainedValue => "eco";

        public string? Value { get; set; } = "system-managed";
        public bool Exists { get; set; } = true;

        /// <summary>Reads that will fail, consumed in order.</summary>
        public Queue<bool> ReadFailures { get; } = new();

        /// <summary>Values the next reads will return instead, consumed in order.</summary>
        public Queue<string> ReadOverrides { get; } = new();

        public bool WriteSucceeds { get; set; } = true;

        /// <summary>Whether a successful write actually changes anything.</summary>
        public bool WriteTakesEffect { get; set; } = true;

        public int Writes { get; private set; }
        public int Reads { get; private set; }

        public CurrentValue Read(string target)
        {
            Reads++;

            if (!Exists) return CurrentValue.Gone;
            if (ReadFailures.Count > 0 && ReadFailures.Dequeue()) return CurrentValue.Unreadable;
            if (ReadOverrides.Count > 0) return CurrentValue.Read(ReadOverrides.Dequeue());

            return Value is null ? CurrentValue.Unreadable : CurrentValue.Read(Value);
        }

        public bool Write(string target, string value)
        {
            Writes++;
            if (!WriteSucceeds) return false;
            if (WriteTakesEffect) Value = value;
            return true;
        }
    }

    private ApplyResult Apply(FakeSetting setting) =>
        new ChangeApplier(Journal, "test").Apply(setting, "entry-1", "pid:4812", "discord.exe");

    [Fact]
    public void A_successful_apply_changes_the_value_and_records_the_original()
    {
        var setting = new FakeSetting();

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.Applied);
        result.CapturedValue.ShouldBe("system-managed");
        setting.Value.ShouldBe("eco");

        var entries = Journal.ReadAll().Entries;
        entries.Count.ShouldBe(1);
        entries[0].CapturedValue.ShouldBe("system-managed");
        entries[0].AppliedValue.ShouldBe("eco");
    }

    [Fact]
    public void The_journal_entry_exists_before_the_write_happens()
    {
        // The invariant that makes power loss survivable: there is no reachable state in which
        // the mutation is applied and its journal entry is absent.
        var journalStateAtWrite = -1;
        var journal = Journal;

        var setting = new WriteObserver(() => journalStateAtWrite = journal.ReadAll().Entries.Count);

        new ChangeApplier(journal, "test").Apply(setting, "entry-1", "pid:4812", "discord.exe");

        journalStateAtWrite.ShouldBe(1);
    }

    [Fact]
    public void An_unreadable_current_value_stops_everything_before_the_machine_is_touched()
    {
        // A change applied without a verified original is a change that cannot be undone.
        var setting = new FakeSetting();
        setting.ReadFailures.Enqueue(true);

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.CannotRead);
        setting.Writes.ShouldBe(0);
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    [Fact]
    public void A_value_that_moves_between_two_reads_is_not_captured()
    {
        // Capturing the wrong original means restoring the wrong one later.
        var setting = new FakeSetting();
        setting.ReadOverrides.Enqueue("system-managed");
        setting.ReadOverrides.Enqueue("high-performance");

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.ReadUnstable);
        setting.Writes.ShouldBe(0);
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    [Fact]
    public void A_target_already_in_the_desired_state_is_left_alone_and_not_journalled()
    {
        // Journalling it would create an entry claiming FrameDoctor made a change it did not,
        // and reconciliation would later restore a value the user chose.
        var setting = new FakeSetting { Value = "eco" };

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.AlreadyInDesiredState);
        setting.Writes.ShouldBe(0);
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    [Fact]
    public void A_refused_write_removes_the_entry_it_had_already_written()
    {
        // Leaving it would make a later reconcile see a value matching neither the captured nor
        // the applied one, and report a third-party change that never happened.
        var setting = new FakeSetting { WriteSucceeds = false };

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.Refused);
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    [Fact]
    public void A_write_that_reports_success_but_did_not_take_effect_is_undone_at_once()
    {
        // A change whose effect cannot be confirmed is not a change FrameDoctor owns.
        var setting = new FakeSetting { WriteTakesEffect = false };

        var result = Apply(setting);

        result.Outcome.ShouldBe(ApplyOutcome.VerificationFailed);
        Journal.ReadAll().Entries.ShouldBeEmpty();

        // The revert attempt is the second write.
        setting.Writes.ShouldBe(2);
    }

    [Fact]
    public void Reconciling_a_still_applied_change_restores_it_and_clears_the_entry()
    {
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        var entry = Journal.ReadAll().Entries[0];
        var result = applier.Reconcile(setting, entry);

        result.Decision.ShouldBe(ReconcileDecision.Restore);
        result.Restored.ShouldBeTrue();
        result.EntryRemoved.ShouldBeTrue();
        setting.Value.ShouldBe("system-managed");
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    [Fact]
    public void Reconciling_a_value_someone_else_changed_writes_nothing_and_keeps_the_entry()
    {
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        // The user, or another tool, sets it to something of their own afterwards.
        setting.Value = "high-performance";
        var writesBefore = setting.Writes;

        var result = applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        result.Decision.ShouldBe(ReconcileDecision.ChangedByThirdParty);
        result.Restored.ShouldBeFalse();
        result.EntryRemoved.ShouldBeFalse();
        setting.Writes.ShouldBe(writesBefore);
        setting.Value.ShouldBe("high-performance");

        // The entry stays so the user can still be told, and can still ask for a restore.
        Journal.ReadAll().Entries.Count.ShouldBe(1);
    }

    [Fact]
    public void Reconciling_a_target_that_exited_clears_the_entry_without_writing()
    {
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        setting.Exists = false;
        var writesBefore = setting.Writes;

        var result = applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        result.Decision.ShouldBe(ReconcileDecision.TargetGone);
        result.EntryRemoved.ShouldBeTrue();
        setting.Writes.ShouldBe(writesBefore);
    }

    [Fact]
    public void A_restore_that_does_not_stick_keeps_its_entry_for_the_next_attempt()
    {
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        setting.WriteTakesEffect = false;

        var result = applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        result.Restored.ShouldBeFalse();
        result.EntryRemoved.ShouldBeFalse();
        Journal.ReadAll().Entries.Count.ShouldBe(1);
    }

    [Fact]
    public void Reconciling_twice_is_safe()
    {
        // It runs at every engine start, at logon, and from the uninstaller.
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        var entry = Journal.ReadAll().Entries[0];

        applier.Reconcile(setting, entry).Restored.ShouldBeTrue();

        var second = applier.Reconcile(setting, entry);
        second.Decision.ShouldBe(ReconcileDecision.AlreadyRestored);
        second.Restored.ShouldBeFalse();
    }

    [Fact]
    public void A_reconcile_that_cannot_read_writes_nothing()
    {
        var setting = new FakeSetting();
        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", "pid:4812", "discord.exe");

        setting.ReadFailures.Enqueue(true);
        var writesBefore = setting.Writes;

        var result = applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        result.Decision.ShouldBe(ReconcileDecision.CannotRead);
        setting.Writes.ShouldBe(writesBefore);
        Journal.ReadAll().Entries.Count.ShouldBe(1);
    }

    /// <summary>Runs a callback at the exact moment the write is attempted.</summary>
    private sealed class WriteObserver(Action onWrite) : IReversibleChange
    {
        private string _value = "system-managed";

        public string ChangeKind => "test-setting";
        public string RestrainedValue => "eco";

        public CurrentValue Read(string target) => CurrentValue.Read(_value);

        public bool Write(string target, string value)
        {
            onWrite();
            _value = value;
            return true;
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}

using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// The durable record without which a change cannot be undone.
/// </summary>
public sealed class ChangeJournalTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), $"framedoctor-journal-{Guid.NewGuid():N}");

    private ChangeJournal Journal => new(_directory);

    private static JournalEntry Entry(string id = "pid-4812", string target = "pid:4812|started:1") =>
        new(id, "process-eco-qos", target, "discord.exe (4812)", "system-managed", "eco",
            new DateTimeOffset(2026, 8, 23, 12, 0, 0, TimeSpan.Zero), "0.1.0");

    [Fact]
    public void An_entry_round_trips()
    {
        var entry = Entry();
        Journal.Write(entry);

        var contents = Journal.ReadAll();

        contents.Entries.Count.ShouldBe(1);
        contents.Entries[0].ShouldBe(entry);
        contents.Unreadable.ShouldBeEmpty();
    }

    [Fact]
    public void An_empty_journal_reads_as_empty_rather_than_failing()
    {
        var contents = Journal.ReadAll();

        contents.Entries.ShouldBeEmpty();
        contents.Unreadable.ShouldBeEmpty();
    }

    [Fact]
    public void Writing_the_same_id_twice_replaces_rather_than_duplicates()
    {
        // Re-applying to the same target must not leave two entries, or reconciliation would try
        // to restore twice and the second attempt would look like a third-party change.
        Journal.Write(Entry());
        Journal.Write(Entry() with { AppliedValue = "eco-2" });

        var contents = Journal.ReadAll();

        contents.Entries.Count.ShouldBe(1);
        contents.Entries[0].AppliedValue.ShouldBe("eco-2");
    }

    [Fact]
    public void Two_targets_get_two_files_even_when_their_ids_look_alike_as_filenames()
    {
        // Sanitizing an identifier into a filename can map two different targets onto one name,
        // and one entry would silently overwrite the other — leaving a real mutation with no
        // record of how to undo it.
        Journal.Write(Entry(id: @"pid:4812\image:a.exe"));
        Journal.Write(Entry(id: @"pid:4812/image:a.exe"));

        Journal.ReadAll().Entries.Count.ShouldBe(2);
    }

    [Fact]
    public void A_very_long_identifier_still_produces_one_file_per_target()
    {
        var long1 = new string('x', 400) + "-one";
        var long2 = new string('x', 400) + "-two";

        Journal.Write(Entry(id: long1));
        Journal.Write(Entry(id: long2));

        Journal.ReadAll().Entries.Count.ShouldBe(2);
    }

    [Fact]
    public void Entries_are_read_back_oldest_first()
    {
        // Reconciliation should undo changes in the order they were made.
        Journal.Write(Entry(id: "b") with { AppliedAtUtc = DateTimeOffset.UnixEpoch.AddHours(2) });
        Journal.Write(Entry(id: "a") with { AppliedAtUtc = DateTimeOffset.UnixEpoch.AddHours(1) });

        Journal.ReadAll().Entries.Select(e => e.Id).ShouldBe(["a", "b"]);
    }

    [Fact]
    public void A_corrupt_entry_is_reported_rather_than_skipped()
    {
        // An unreadable entry most likely means a change that was applied and can no longer be
        // undone automatically. Silently ignoring it leaves a user's machine modified with no
        // indication anywhere.
        Directory.CreateDirectory(_directory);
        File.WriteAllText(Path.Combine(_directory, "broken.journal.json"), "{ not json");

        var contents = Journal.ReadAll();

        contents.Entries.ShouldBeEmpty();
        contents.Unreadable.Count.ShouldBe(1);
        contents.Unreadable[0].Path.ShouldEndWith("broken.journal.json");
    }

    [Fact]
    public void A_corrupt_entry_does_not_hide_the_readable_ones()
    {
        // One file per entry exists precisely so a torn write loses one record rather than all
        // of them.
        Journal.Write(Entry());
        File.WriteAllText(Path.Combine(_directory, "broken.journal.json"), "{ not json");

        var contents = Journal.ReadAll();

        contents.Entries.Count.ShouldBe(1);
        contents.Unreadable.Count.ShouldBe(1);
    }

    [Fact]
    public void A_json_null_entry_is_reported_as_unreadable_not_treated_as_empty()
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(Path.Combine(_directory, "null.journal.json"), "null");

        Journal.ReadAll().Unreadable.Count.ShouldBe(1);
    }

    [Fact]
    public void Deleting_an_entry_removes_it_and_says_whether_it_was_there()
    {
        var journal = Journal;
        journal.Write(Entry());

        journal.Delete("pid-4812").ShouldBeTrue();
        journal.ReadAll().Entries.ShouldBeEmpty();

        // Idempotent, because reconciliation runs repeatedly and must not fail on the second
        // pass.
        journal.Delete("pid-4812").ShouldBeFalse();
    }

    [Fact]
    public void A_leftover_temporary_file_is_not_read_as_an_entry()
    {
        // A temp file means a write that did not complete, which means the change it described
        // was never applied — the journal is always written first.
        Journal.Write(Entry());
        File.WriteAllText(Path.Combine(_directory, "half.journal.json.tmp"), "{ partial");

        var contents = Journal.ReadAll();

        contents.Entries.Count.ShouldBe(1);
        contents.Unreadable.ShouldBeEmpty();
    }

    [Fact]
    public void Temporary_files_are_cleanable_and_the_count_is_reported()
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(Path.Combine(_directory, "a.journal.json.tmp"), "x");
        File.WriteAllText(Path.Combine(_directory, "b.journal.json.tmp"), "x");

        Journal.CleanTemporaryFiles().ShouldBe(2);
        Journal.CleanTemporaryFiles().ShouldBe(0);
    }

    [Fact]
    public void The_journal_directory_is_created_on_first_write()
    {
        Directory.Exists(_directory).ShouldBeFalse();

        Journal.Write(Entry());

        Directory.Exists(_directory).ShouldBeTrue();
    }

    [Fact]
    public void An_entry_without_an_identity_is_refused_at_the_boundary()
    {
        // An entry with no id cannot be found again, which makes it a record of a change that
        // can never be undone.
        Should.Throw<ArgumentException>(() => Journal.Write(Entry(id: "")));
        Should.Throw<ArgumentException>(() => Journal.Write(Entry(id: "   ")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}

namespace FrameDoctor.Optimization;

/// <summary>What reconciliation decided to do about one journal entry.</summary>
public enum ReconcileDecision
{
    /// <summary>The setting still holds what FrameDoctor applied. Restore what was captured.</summary>
    Restore = 0,

    /// <summary>
    /// The setting already holds the captured value.
    /// </summary>
    /// <remarks>
    /// Either it was restored already, or reconciliation is running twice. Either way there is
    /// nothing to do and the entry can go. This is what makes reconciliation idempotent, which
    /// matters because it runs at every engine start, at logon, and from the uninstaller.
    /// </remarks>
    AlreadyRestored = 1,

    /// <summary>
    /// The setting holds neither value. Someone else changed it after FrameDoctor did.
    /// </summary>
    /// <remarks>
    /// The most important row in the table. Writing a captured value over a <i>later</i> choice
    /// is a mutation, not a rollback: a rollback system that always restores is a system that
    /// overwrites its user. The entry is kept and surfaced, and only the user may trigger a
    /// restore from here.
    /// </remarks>
    ChangedByThirdParty = 2,

    /// <summary>
    /// The thing that was changed no longer exists.
    /// </summary>
    /// <remarks>
    /// A throttled process exited. Its power state died with it, so there is nothing to restore
    /// and the entry can go. Distinct from a failed read: one is resolved, the other is not.
    /// </remarks>
    TargetGone = 3,

    /// <summary>
    /// The current value could not be read.
    /// </summary>
    /// <remarks>
    /// Nothing is done and the entry is kept. Restoring without knowing the current value is a
    /// blind write, which is the practice this whole design exists to avoid.
    /// </remarks>
    CannotRead = 4,
}

/// <summary>What the platform reported when asked for a setting's current value.</summary>
/// <param name="TargetExists">Whether the thing being read is still there.</param>
/// <param name="Value">
/// The reading. Null when it could not be read — never a default, because a default here would
/// be compared against a captured value and could produce a confident wrong decision.
/// </param>
public readonly record struct CurrentValue(bool TargetExists, string? Value)
{
    public static readonly CurrentValue Gone = new(false, null);

    public static readonly CurrentValue Unreadable = new(true, null);

    public static CurrentValue Read(string value) => new(true, value);
}

/// <summary>
/// Compare-and-restore. Never blind-restore.
/// </summary>
/// <remarks>
/// <para>
/// The decision table is short enough to read in one go, which is deliberate: this is the
/// function that decides whether to write to a user's machine, and every branch of it has to be
/// defensible without reading anything else.
/// </para>
/// <para>
/// It is pure, takes no dependencies, and performs no I/O, so it is exhaustively testable on a
/// machine that cannot perform the mutation at all.
/// </para>
/// </remarks>
public static class Reconciler
{
    /// <summary>Decides what to do about one entry, given what the setting reads now.</summary>
    public static ReconcileDecision Decide(in CurrentValue current, JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        if (!current.TargetExists) return ReconcileDecision.TargetGone;
        if (current.Value is null) return ReconcileDecision.CannotRead;

        // Ordinal comparison. These are opaque platform values, not text: two strings that differ
        // only by case are two different settings, and a culture-aware comparison could equate
        // them on one machine and not another.
        if (string.Equals(current.Value, entry.AppliedValue, StringComparison.Ordinal))
            return ReconcileDecision.Restore;

        if (string.Equals(current.Value, entry.CapturedValue, StringComparison.Ordinal))
            return ReconcileDecision.AlreadyRestored;

        return ReconcileDecision.ChangedByThirdParty;
    }

    /// <summary>Whether a decision means the entry has served its purpose and can be removed.</summary>
    /// <remarks>
    /// Only after the restore has been verified, for <see cref="ReconcileDecision.Restore"/> —
    /// deleting the entry on the strength of having attempted a write would lose the record of a
    /// change that is still applied.
    /// </remarks>
    public static bool EntryIsSettled(ReconcileDecision decision) => decision
        is ReconcileDecision.AlreadyRestored or ReconcileDecision.TargetGone;

    /// <summary>What to tell the user about one entry, in their terms.</summary>
    public static string Describe(ReconcileDecision decision, JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        return decision switch
        {
            ReconcileDecision.Restore =>
                $"Restoring {entry.Target} to how it was before FrameDoctor changed it.",
            ReconcileDecision.AlreadyRestored =>
                $"{entry.Target} was already back to its original setting.",
            ReconcileDecision.TargetGone =>
                $"{entry.Target} no longer exists, so there is nothing to restore.",
            ReconcileDecision.ChangedByThirdParty =>
                $"{entry.Target} was changed again after FrameDoctor changed it. " +
                "FrameDoctor will not overwrite that; restore it yourself if you want the " +
                "original setting back.",
            _ =>
                $"The current setting for {entry.Target} could not be read, so it was left alone.",
        };
    }
}

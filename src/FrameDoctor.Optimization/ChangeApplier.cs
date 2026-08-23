namespace FrameDoctor.Optimization;

/// <summary>The result of an apply, with everything needed to explain it.</summary>
/// <param name="Outcome">What happened.</param>
/// <param name="CapturedValue">The original value, when one was captured.</param>
/// <param name="Detail">One sentence for the user.</param>
public readonly record struct ApplyResult(ApplyOutcome Outcome, string? CapturedValue, string Detail);

/// <summary>The result of reconciling one journal entry.</summary>
/// <param name="Decision">What the compare-and-restore table decided.</param>
/// <param name="Restored">Whether a value was actually written back.</param>
/// <param name="EntryRemoved">Whether the journal entry was cleared.</param>
/// <param name="Detail">One sentence for the user.</param>
public readonly record struct ReconcileResult(
    ReconcileDecision Decision,
    bool Restored,
    bool EntryRemoved,
    string Detail);

/// <summary>
/// Applies and undoes system changes, in the only order that survives power loss.
/// </summary>
/// <remarks>
/// <para>
/// The protocol, in order, and every step earns its place:
/// </para>
/// <list type="number">
///   <item>Read the current value. Abort if it cannot be read.</item>
///   <item>Read it again and require equality. A value that moves while being read is not a
///     value that can be captured, and capturing the wrong original means restoring the wrong
///     one later.</item>
///   <item>Write the journal entry and flush it to the device.</item>
///   <item>Apply the change.</item>
///   <item>Read it back, and revert immediately if it disagrees.</item>
/// </list>
/// <para>
/// Journal-before-apply is what buys the invariant that makes power loss survivable: there is
/// no reachable state in which the mutation is applied and its journal entry is absent. The
/// reverse ordering leaves a window in which the machine is changed and nothing remembers it.
/// </para>
/// </remarks>
public sealed class ChangeApplier
{
    private readonly ChangeJournal _journal;
    private readonly string _buildId;
    private readonly TimeProvider _time;

    public ChangeApplier(ChangeJournal journal, string buildId = "dev", TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(journal);

        _journal = journal;
        _buildId = buildId;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Applies a change to one target, journalling it first.</summary>
    /// <param name="change">The platform implementation.</param>
    /// <param name="entryId">Stable identity for the journal entry.</param>
    /// <param name="target">What to change, identified precisely enough not to be confused.</param>
    /// <param name="description">How the target reads to a user.</param>
    public ApplyResult Apply(
        IReversibleChange change,
        string entryId,
        string target,
        string description)
    {
        ArgumentNullException.ThrowIfNull(change);
        ArgumentException.ThrowIfNullOrWhiteSpace(entryId);

        var first = change.Read(target);

        if (!first.TargetExists)
            return new ApplyResult(ApplyOutcome.CannotRead, null, $"{description} is no longer running.");

        if (first.Value is null)
        {
            return new ApplyResult(ApplyOutcome.CannotRead, null,
                $"FrameDoctor could not read the current setting for {description}, so it " +
                "changed nothing. A change it cannot undo is one it will not make.");
        }

        var second = change.Read(target);

        if (second.Value is null || !string.Equals(first.Value, second.Value, StringComparison.Ordinal))
        {
            // A value that moves between two immediate reads is not one that can be captured,
            // and capturing the wrong original means restoring the wrong one later.
            return new ApplyResult(ApplyOutcome.ReadUnstable, null,
                $"The setting for {description} changed while FrameDoctor was reading it, so " +
                "nothing was applied.");
        }

        if (string.Equals(first.Value, change.RestrainedValue, StringComparison.Ordinal))
        {
            return new ApplyResult(ApplyOutcome.AlreadyInDesiredState, first.Value,
                $"{description} was already set this way. Nothing was changed.");
        }

        // Journal first. Everything after this point is recoverable; nothing before it needed to
        // be, because nothing before it touched the machine.
        _journal.Write(new JournalEntry(
            entryId,
            change.ChangeKind,
            description,
            first.Value,
            change.RestrainedValue,
            _time.GetUtcNow(),
            _buildId));

        if (!change.Write(target, change.RestrainedValue))
        {
            // Nothing was applied, so the entry describes a change that does not exist. Removing
            // it is correct — leaving it would cause a later reconcile to see a value matching
            // neither, and report a third-party change that never happened.
            _journal.Delete(entryId);

            return new ApplyResult(ApplyOutcome.Refused, first.Value,
                $"Windows refused to change {description}.");
        }

        var verification = change.Read(target);

        if (verification.Value is null ||
            !string.Equals(verification.Value, change.RestrainedValue, StringComparison.Ordinal))
        {
            // The write reported success and the read disagrees. Put it back at once and keep
            // nothing: a change whose effect cannot be confirmed is not a change we own.
            change.Write(target, first.Value);
            _journal.Delete(entryId);

            return new ApplyResult(ApplyOutcome.VerificationFailed, first.Value,
                $"The change to {description} did not take effect, so it was undone.");
        }

        return new ApplyResult(ApplyOutcome.Applied, first.Value,
            $"{description} is restrained. FrameDoctor will put it back.");
    }

    /// <summary>Undoes one journal entry, if the compare-and-restore table says to.</summary>
    public ReconcileResult Reconcile(IReversibleChange change, JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(change);
        ArgumentNullException.ThrowIfNull(entry);

        var current = change.Read(entry.Target);
        var decision = Reconciler.Decide(current, entry);
        var detail = Reconciler.Describe(decision, entry);

        if (Reconciler.EntryIsSettled(decision))
        {
            _journal.Delete(entry.Id);
            return new ReconcileResult(decision, Restored: false, EntryRemoved: true, detail);
        }

        if (decision is not ReconcileDecision.Restore)
            return new ReconcileResult(decision, false, false, detail);

        if (!change.Write(entry.Target, entry.CapturedValue))
        {
            return new ReconcileResult(decision, false, false,
                $"FrameDoctor could not put {entry.Target} back. It will try again next time.");
        }

        var verification = change.Read(entry.Target);

        if (verification.Value is null ||
            !string.Equals(verification.Value, entry.CapturedValue, StringComparison.Ordinal))
        {
            // Keep the entry. Deleting it on the strength of a write that did not stick would
            // lose the record of a change still applied to the machine.
            return new ReconcileResult(decision, false, false,
                $"The restore of {entry.Target} did not take effect. It will be tried again.");
        }

        _journal.Delete(entry.Id);
        return new ReconcileResult(decision, Restored: true, EntryRemoved: true, detail);
    }
}

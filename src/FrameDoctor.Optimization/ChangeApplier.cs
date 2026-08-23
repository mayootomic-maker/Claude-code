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
            // The identity, not the sentence. Reconcile reads and writes this string, so a
            // display name here would send every rollback path at a display name.
            target,
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

    /// <summary>
    /// How many reconcile passes an unresolvable entry gets before it stops being retried.
    /// </summary>
    /// <remarks>
    /// Three, because reconcile runs at engine start, at logon and from the uninstaller: an
    /// entry that survives all of those is not going to resolve itself. Past this it is reported
    /// once as needing the user, and removed, so the journal does not accumulate one permanent
    /// file per optimization ever applied.
    /// </remarks>
    public const int MaximumUnresolvedAttempts = 3;

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
            return Unresolved(entry, decision, detail);

        if (!change.Write(entry.Target, entry.CapturedValue))
        {
            return Unresolved(entry, decision,
                $"FrameDoctor could not put {entry.Description} back. It will try again next time.");
        }

        var verification = change.Read(entry.Target);

        if (verification.Value is null ||
            !string.Equals(verification.Value, entry.CapturedValue, StringComparison.Ordinal))
        {
            // Keep the entry. Deleting it on the strength of a write that did not stick would
            // lose the record of a change still applied to the machine.
            return Unresolved(entry, decision,
                $"The restore of {entry.Description} did not take effect. It will be tried again.");
        }

        _journal.Delete(entry.Id);
        return new ReconcileResult(decision, Restored: true, EntryRemoved: true, detail);
    }

    /// <summary>
    /// Records that a pass did not resolve an entry, and gives up after enough of them.
    /// </summary>
    /// <remarks>
    /// Giving up is removal, not silence: the caller is told the entry is being abandoned and
    /// what may still be applied. Keeping it forever would be the same information repeated at
    /// every logon for the life of the installation, which is how a real warning becomes noise.
    /// </remarks>
    private ReconcileResult Unresolved(JournalEntry entry, ReconcileDecision decision, string detail)
    {
        var attempts = entry.UnresolvedAttempts + 1;

        if (attempts < MaximumUnresolvedAttempts)
        {
            // Reconciliation used to be read-and-delete; counting attempts made it write, which
            // inherits every way a write can fail — a full disk, a locked directory, a roaming
            // profile not yet mounted at logon. A throw here would end the whole pass and leave
            // every remaining entry applied, so a failed bookkeeping write is swallowed: the
            // worst it costs is one extra retry, and the alternative costs the rollback.
            try
            {
                _journal.Write(entry with { UnresolvedAttempts = attempts });
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // Not fatal. The entry stays as it was and is tried again next pass.
            }

            return new ReconcileResult(decision, false, false, detail);
        }

        try
        {
            _journal.Delete(entry.Id);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // The change is abandoned either way; the user has been told what to put back.
        }

        return new ReconcileResult(decision, Restored: false, EntryRemoved: true,
            $"{detail} FrameDoctor has tried {attempts} times and will stop trying. " +
            $"If {entry.Description} is still changed, put it back yourself: it was " +
            $"\"{entry.CapturedValue}\" before FrameDoctor set it to \"{entry.AppliedValue}\".");
    }
}

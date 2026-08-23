namespace FrameDoctor.Optimization;

/// <summary>The outcome of trying to apply a change.</summary>
public enum ApplyOutcome
{
    /// <summary>Applied and verified by reading it back.</summary>
    Applied = 0,

    /// <summary>The setting already held the value we wanted. Nothing was changed.</summary>
    AlreadyInDesiredState = 1,

    /// <summary>
    /// The current value could not be read, so nothing was applied.
    /// </summary>
    /// <remarks>
    /// The apply protocol aborts here rather than proceeding. A change applied without a
    /// verified original value is a change that cannot be undone, which is the one thing this
    /// design does not permit.
    /// </remarks>
    CannotRead = 2,

    /// <summary>The two verification reads disagreed, so the value is not stable enough to capture.</summary>
    ReadUnstable = 3,

    /// <summary>Windows refused the change.</summary>
    Refused = 4,

    /// <summary>
    /// The change was applied but reading it back disagreed, so it was reverted immediately.
    /// </summary>
    VerificationFailed = 5,

    /// <summary>The deny-list refused this target.</summary>
    NotEligible = 6,
}

/// <summary>
/// One kind of system setting FrameDoctor can change and put back.
/// </summary>
/// <remarks>
/// <para>
/// The seam that keeps the mutation itself out of the portable core. Implementations perform the
/// platform call; the journal, the eligibility rules and the reconcile decision live above them
/// and are tested on a machine that cannot perform the mutation at all.
/// </para>
/// <para>
/// Values cross this interface as opaque strings. The journal has to survive being read by a
/// later build, and a typed value is a value whose representation can change between versions —
/// an entry a newer build cannot parse is an unrestored mutation.
/// </para>
/// </remarks>
public interface IReversibleChange
{
    /// <summary>Stable name for this kind of change, stored in the journal.</summary>
    string ChangeKind { get; }

    /// <summary>
    /// Reads the setting's current value.
    /// </summary>
    /// <remarks>
    /// Must distinguish "the target is gone" from "the value could not be read". Reconciliation
    /// settles the first and refuses to act on the second, and collapsing them would either
    /// leave entries forever or restore blindly.
    /// </remarks>
    CurrentValue Read(string target);

    /// <summary>Writes a value. Never called without a captured original in the journal.</summary>
    /// <returns>Whether the platform accepted the write.</returns>
    bool Write(string target, string value);

    /// <summary>The value this change applies when it restrains a target.</summary>
    string RestrainedValue { get; }
}

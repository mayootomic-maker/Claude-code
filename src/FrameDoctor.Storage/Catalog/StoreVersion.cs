namespace FrameDoctor.Storage.Catalog;

/// <summary>
/// Version numbers that govern whether a build may read or write a store.
/// </summary>
/// <remarks>
/// <para>
/// SQLite's <c>user_version</c> is a single number with no reader/writer semantics, which
/// cannot express "an older build may still read this". Three numbers can:
/// </para>
/// <list type="bullet">
///   <item><b>Schema</b> — bumped by every migration.</item>
///   <item><b>MinReader</b> — bumped only by a <i>destructive</i> change: a dropped column, a
///   changed meaning, a repurposed identifier.</item>
///   <item><b>MinWriter</b> — bumped by any change a naive writer could corrupt.</item>
/// </list>
/// <para>
/// The purpose is a rule the user can rely on: <b>we never migrate downward and we never
/// delete.</b> A user who reverts to an older build must find their history intact, even if
/// that build cannot open it.
/// </para>
/// </remarks>
public static class StoreVersion
{
    /// <summary>Current schema version.</summary>
    public const int Schema = 1;

    /// <summary>Oldest reader version that can still open the current schema.</summary>
    public const int MinReader = 1;

    /// <summary>Oldest writer version that can safely write the current schema.</summary>
    public const int MinWriter = 1;

    /// <summary>
    /// Magic number stamped into SQLite's <c>application_id</c>: "FD01".
    /// </summary>
    /// <remarks>
    /// Makes opening the wrong file a clean, immediate refusal rather than a confusing series
    /// of missing-table errors.
    /// </remarks>
    public const int ApplicationId = 0x46443031;
}

/// <summary>How a store may be used by the current build.</summary>
public enum StoreAccess
{
    /// <summary>The build may read and write.</summary>
    ReadWrite,

    /// <summary>
    /// Written by a newer build, but additively. History is browsable; writing is refused.
    /// </summary>
    ReadOnly,

    /// <summary>
    /// The existing store was written by a newer build in a way this one cannot interpret, so
    /// a new store was started alongside it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The name describes what happened rather than what was wrong, because the practical fact
    /// is that the returned store <b>is writable</b> — it is simply not the file that was asked
    /// for. An earlier version of this enum said "Incompatible", which read as "you cannot
    /// write" and caused exactly that bug.
    /// </para>
    /// <para>
    /// The original file is left byte-for-byte untouched, and its location is reported so the
    /// user can be told their history is intact.
    /// </para>
    /// </remarks>
    StartedNewStore,
}

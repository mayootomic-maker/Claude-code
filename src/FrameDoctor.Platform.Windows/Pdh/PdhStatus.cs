using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// Performance Data Helper status codes FrameDoctor distinguishes.
/// </summary>
/// <remarks>
/// Values verified against the win32metadata projection. Only the codes that lead to different
/// behaviour are named; everything else is handled by the catch-all, because inventing a
/// specific explanation for an unrecognised code would be a guess presented as a diagnosis.
/// </remarks>
public static class PdhStatus
{
    public const uint Success = 0;

    /// <summary>The supplied buffer was too small; call again with the returned size.</summary>
    public const uint MoreData = 0x800007D2;

    /// <summary>The named instance does not exist on this machine.</summary>
    public const uint NoInstance = 0x800007D1;

    /// <summary>The counter's raw values went backwards, e.g. an instance was recycled.</summary>
    public const uint CalcNegativeValue = 0x800007D8;

    /// <summary>The rate counter's denominator went backwards.</summary>
    public const uint CalcNegativeDenominator = 0x800007D6;

    public const uint CalcNegativeTimebase = 0x800007D7;

    /// <summary>No valid data for this counter yet, typically before the second collect.</summary>
    public const uint InvalidData = 0xC0000BC6;

    public const uint CStatusInvalidData = 0xC0000BBA;

    /// <summary>The counter object or name does not exist on this machine.</summary>
    public const uint CStatusNoObject = 0xC0000BB8;
    public const uint CStatusNoCounter = 0xC0000BB9;

    /// <summary>The counter path is syntactically wrong. Always our bug.</summary>
    public const uint InvalidPath = 0xC0000BBD;

    public const uint AccessDenied = 0xC0000BDB;

    public static bool IsSuccess(uint status) => status == Success;

    /// <summary>
    /// Turns a PDH status into how the resulting sample must be published.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The reason this is a table and not an <c>if (status != 0) return 0</c>: PDH's failure
    /// modes mean genuinely different things to a user, and one of them — the negative-value
    /// family — is the case where returning a number would be actively wrong. Those codes are
    /// returned when a counter's raw values ran backwards, which happens when an instance is
    /// recycled mid-interval. There is no value to report, and reporting zero would render a
    /// busy disk as idle at exactly the moment something interesting happened to it.
    /// </para>
    /// </remarks>
    public static (Availability State, UnavailableReason Reason) Classify(uint status) => status switch
    {
        Success => (Availability.Available, UnavailableReason.None),

        // The counter exists but has nothing yet. Rate counters need two collects before any
        // value exists at all, so this is the normal state for the first tick of a session.
        InvalidData or CStatusInvalidData =>
            (Availability.Unavailable, UnavailableReason.NotYetSampled),

        // Raw values ran backwards. There is no meaningful number here, and zero is a lie.
        CalcNegativeValue or CalcNegativeDenominator or CalcNegativeTimebase =>
            (Availability.Failed, UnavailableReason.SourceFaulted),

        NoInstance or CStatusNoObject or CStatusNoCounter =>
            (Availability.Unavailable, UnavailableReason.NoSensor),

        AccessDenied =>
            (Availability.Denied, UnavailableReason.InsufficientPrivilege),

        _ => (Availability.Failed, UnavailableReason.SourceFaulted),
    };

    /// <summary>
    /// Whether a status means "this counter will never work here" rather than "not right now".
    /// </summary>
    /// <remarks>
    /// Used to stop re-reading a counter that does not exist on this machine. A counter that is
    /// merely not ready must not be dropped: doing so would permanently disable every rate
    /// counter, since none of them has a value on the first collect.
    /// </remarks>
    public static bool IsPermanent(uint status) => status
        is NoInstance or CStatusNoObject or CStatusNoCounter or InvalidPath;
}

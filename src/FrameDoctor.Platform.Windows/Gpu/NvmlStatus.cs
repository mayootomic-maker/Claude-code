using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Platform.Windows.Gpu;

/// <summary>Reading an NVML return code as a statement about the hardware.</summary>
public static class NvmlStatus
{
    /// <summary>
    /// Turns a return code into how the resulting sample must be published.
    /// </summary>
    /// <remarks>
    /// The distinction that carries weight is <c>NVML_ERROR_NOT_SUPPORTED</c>. It is the routine
    /// answer to <c>nvmlDeviceGetPowerUsage</c> on several consumer parts and means the card has
    /// no such sensor — a fact about the hardware, not a failure. Publishing it as a fault would
    /// report a perfectly healthy GPU as broken, and publishing it as zero would report a card
    /// drawing no power.
    /// </remarks>
    public static (Availability State, UnavailableReason Reason) Classify(uint status) => status switch
    {
        NvmlReturn.Success => (Availability.Available, UnavailableReason.None),

        NvmlReturn.NotSupported or NvmlReturn.NotFound =>
            (Availability.Unavailable, UnavailableReason.NotExposedByVendor),

        NvmlReturn.NoPermission =>
            (Availability.Denied, UnavailableReason.InsufficientPrivilege),

        // The card fell off the bus. Distinct from a sensor that does not exist, because it is a
        // real fault the user is likely already seeing on screen.
        NvmlReturn.GpuIsLost =>
            (Availability.Failed, UnavailableReason.SourceFaulted),

        NvmlReturn.DriverNotLoaded or NvmlReturn.LibraryNotFound or NvmlReturn.FunctionNotFound =>
            (Availability.Unavailable, UnavailableReason.NoSensor),

        _ => (Availability.Failed, UnavailableReason.SourceFaulted),
    };

    /// <summary>
    /// Whether a call should stop being made for the rest of the session.
    /// </summary>
    /// <remarks>
    /// A card that does not expose board power will not start exposing it. Retiring the call
    /// keeps the poll loop honest about its own cost — the alternative is a failing P/Invoke four
    /// times a second for the length of a gaming session, in the collector path.
    /// </remarks>
    public static bool IsPermanent(uint status) => status
        is NvmlReturn.NotSupported or NvmlReturn.NotFound or NvmlReturn.FunctionNotFound;

    /// <summary>One sentence for the System view.</summary>
    public static string Describe(uint status, string deviceName) => status switch
    {
        NvmlReturn.NotSupported or NvmlReturn.NotFound =>
            $"{deviceName} does not report this value.",
        NvmlReturn.NoPermission =>
            "The driver refused this reading to an unelevated program.",
        NvmlReturn.GpuIsLost =>
            "The graphics card stopped responding to the driver.",
        NvmlReturn.DriverNotLoaded =>
            "The NVIDIA driver is not loaded.",
        NvmlReturn.LibraryNotFound =>
            "No NVIDIA management library is installed, which is normal without an NVIDIA GPU.",
        _ => "The NVIDIA driver returned an error for this reading.",
    };
}

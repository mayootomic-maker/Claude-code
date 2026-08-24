using System.Globalization;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>One <c>GPU Engine</c> counter instance, taken apart.</summary>
/// <param name="ProcessId">The process the engine work belongs to.</param>
/// <param name="EngineType">
/// The engine, as Windows names it: <c>3D</c>, <c>VideoDecode</c>, <c>Copy</c>, and others.
/// </param>
/// <param name="Adapter">
/// The adapter LUID, so work on two GPUs is not silently summed into one number.
/// </param>
public readonly record struct GpuEngineInstance(int ProcessId, string EngineType, string Adapter);

/// <summary>
/// Reading per-process GPU engine utilization out of PDH instance names.
/// </summary>
/// <remarks>
/// <para>
/// Instances are named like
/// <c>pid_9001_luid_0x00000000_0x0000C4B3_phys_0_eng_1_engtype_3D</c>. There is no API that
/// returns the pid, the adapter and the engine type as fields: the counter object encodes them
/// in the instance name, and taking that name apart is the only way to attribute GPU work to a
/// process.
/// </para>
/// <para>
/// Pure string work, deliberately. It is the part of GPU attribution that can be tested on a
/// machine with no GPU, and it is also the part most likely to be wrong — a parser that silently
/// accepts a name it does not understand would attribute one process's rendering to another.
/// </para>
/// </remarks>
public static class GpuEngineCounters
{
    /// <summary>The engine that does the rendering, and the only one Gate B counts.</summary>
    /// <remarks>
    /// Not <c>VideoDecode</c>. A video player keeps the decode engine busy while fullscreen and
    /// presenting steadily, and counting it here would confirm a film as a game.
    /// </remarks>
    public const string ThreeD = "3D";

    /// <summary>The counter to read for every instance.</summary>
    public const string UtilizationCounter = @"\GPU Engine(*)\Utilization Percentage";

    /// <summary>The full path for one instance.</summary>
    public static string UtilizationFor(string instance) =>
        $@"\GPU Engine({instance})\Utilization Percentage";

    /// <summary>
    /// Takes an instance name apart, or returns null when it is not one we understand.
    /// </summary>
    /// <remarks>
    /// Null rather than a partly-filled result. An instance name whose shape has changed is a
    /// name we cannot attribute, and guessing at the pid from a name we failed to parse is how
    /// one process's rendering gets credited to another.
    /// </remarks>
    public static GpuEngineInstance? Parse(string? instance)
    {
        if (string.IsNullOrWhiteSpace(instance)) return null;

        var parts = instance.Split('_');

        // pid_<n>_luid_<hi>_<lo>_phys_<n>_eng_<n>_engtype_<name> is ten fields. An engine type
        // containing an underscore would make it more, which is why the type is taken as
        // everything after the marker rather than as the last field.
        if (parts.Length < 4) return null;
        if (!parts[0].Equals("pid", StringComparison.OrdinalIgnoreCase)) return null;

        if (!int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid))
            return null;

        var marker = FindEngTypeMarker(parts);
        if (marker < 0 || marker + 1 >= parts.Length) return null;

        var engineType = string.Join('_', parts[(marker + 1)..]);
        if (engineType.Length == 0) return null;

        return new GpuEngineInstance(pid, engineType, AdapterOf(parts));
    }

    /// <summary>
    /// Finds the <c>engtype</c> marker.
    /// </summary>
    /// <remarks>
    /// Searched from the end. The literal string could in principle appear earlier, and the one
    /// that matters is always the last.
    /// </remarks>
    private static int FindEngTypeMarker(string[] parts)
    {
        for (var i = parts.Length - 2; i >= 0; i--)
        {
            if (parts[i].Equals("engtype", StringComparison.OrdinalIgnoreCase)) return i;
        }

        return -1;
    }

    /// <summary>The two LUID halves, or empty when the name does not carry them.</summary>
    private static string AdapterOf(string[] parts)
    {
        for (var i = 0; i < parts.Length - 2; i++)
        {
            if (parts[i].Equals("luid", StringComparison.OrdinalIgnoreCase))
                return $"{parts[i + 1]}_{parts[i + 2]}";
        }

        return string.Empty;
    }

    /// <summary>Whether this instance is 3D work belonging to the given process.</summary>
    public static bool IsThreeDFor(string? instance, int processId) =>
        Parse(instance) is { } parsed
        && parsed.ProcessId == processId
        && parsed.EngineType.Equals(ThreeD, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Sums the 3D utilization a process is responsible for.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A summed percentage, and it can legitimately exceed 100: a process rendering on two
    /// physical engines of one adapter contributes twice. Clamping it would erase the difference
    /// between a game saturating one engine and a game saturating several, and Gate B only ever
    /// asks whether the figure clears a floor.
    /// </para>
    /// <para>
    /// Returns null when no instance for that process could be read at all. Null is not zero:
    /// zero says the process rendered nothing, and a process whose counters are missing has not
    /// said that.
    /// </para>
    /// </remarks>
    /// <param name="readings">Instance name and its utilization percentage, in any order.</param>
    /// <param name="processId">The process to attribute.</param>
    public static double? ThreeDUtilizationFor(
        IEnumerable<(string Instance, double Value)> readings,
        int processId)
    {
        ArgumentNullException.ThrowIfNull(readings);

        var total = 0.0;
        var found = false;

        foreach (var (instance, value) in readings)
        {
            if (!IsThreeDFor(instance, processId)) continue;
            if (!double.IsFinite(value)) continue;

            total += value;
            found = true;
        }

        return found ? total : null;
    }

    /// <summary>Pulls the instance name back out of a fully expanded counter path.</summary>
    /// <remarks>
    /// Pure, and here rather than beside the PDH query for that reason. It is one of the two
    /// places a silent mistake would attribute one process's rendering to another, and it runs
    /// on a machine with no GPU.
    /// </remarks>
    public static string? InstanceOf(string? path)
    {
        if (string.IsNullOrEmpty(path)) return null;

        var open = path.IndexOf('(', StringComparison.Ordinal);
        if (open < 0) return null;

        var close = path.LastIndexOf(')');
        return close <= open + 1 ? null : path[(open + 1)..close];
    }

    /// <summary>
    /// Splits a double-null-terminated list of strings.
    /// </summary>
    /// <remarks>
    /// The Win32 multi-string convention: entries separated by one null and the list closed by a
    /// second. PDH reports how much of the buffer it used, and everything past that is whatever
    /// was in the array — reading on would invent instance names out of it.
    /// </remarks>
    public static List<string> SplitMultiString(char[] buffer, int length)
    {
        ArgumentNullException.ThrowIfNull(buffer);

        var result = new List<string>();
        var start = 0;
        var end = Math.Min(length, buffer.Length);

        for (var i = 0; i < end; i++)
        {
            if (buffer[i] != '\0') continue;

            if (i > start) result.Add(new string(buffer, start, i - start));
            start = i + 1;

            // The closing second null. Anything after it is uninitialised buffer.
            if (i + 1 < end && buffer[i + 1] == '\0') break;
        }

        return result;
    }
}

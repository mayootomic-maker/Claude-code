using System.Globalization;

namespace FrameDoctor.Storage.Settings;

/// <summary>What a setting is and how to describe it.</summary>
/// <param name="Key">The name used on the command line and on the control channel.</param>
/// <param name="Label">How the interface names it.</param>
/// <param name="Accepts">What a valid value looks like, in the words a refusal should use.</param>
public readonly record struct SettingDescriptor(string Key, string Label, string Accepts);

/// <summary>The outcome of trying to change one setting.</summary>
/// <param name="Updated">The new settings, or null when the request was refused.</param>
/// <param name="Error">Why it was refused, in the words the user should see.</param>
/// <param name="Note">
/// Something true about the outcome that is not a failure — most usefully, that the value was
/// clamped. A setting that silently became something other than what was asked for is a lie the
/// interface would then repeat back.
/// </param>
public readonly record struct SettingChange(
    FrameDoctorSettings? Updated,
    string? Error,
    string? Note)
{
    public bool Ok => Updated is not null;

    public static SettingChange Refused(string error) => new(null, error, null);
}

/// <summary>
/// The one place a setting name is turned into a change.
/// </summary>
/// <remarks>
/// <para>
/// Shared by the command line and the control channel on purpose. Two implementations would
/// drift, and the way they would drift is that the window would accept a key the command line
/// does not — which is exactly how a control channel grows a surface nobody reviewed.
/// </para>
/// <para>
/// Every input here is untrusted. The key comes from a message a peer wrote and the value is a
/// string; both are matched and parsed rather than interpreted.
/// </para>
/// </remarks>
public static class SettingsCommands
{
    /// <summary>Every setting that can be changed. Nothing outside this list is reachable.</summary>
    public static IReadOnlyList<SettingDescriptor> All { get; } =
    [
        new("retention-days", "Keep full frame data for",
            "a whole number of days, from 1 to 365"),
        new("live-window-seconds", "Live timeline window",
            "a whole number of seconds, from 15 to 300"),
        new("auto-start", "Start measuring when a game is detected", "true or false"),
        new("keep-measuring", "Keep measuring with the window closed", "true or false"),
        new("simulation", "Simulation mode", "true or false"),
    ];

    /// <summary>Whether a key names a setting at all.</summary>
    public static bool IsKnown(string? key) =>
        key is not null && All.Any(s => s.Key == key);

    /// <summary>
    /// Applies one change, or explains why not.
    /// </summary>
    /// <remarks>
    /// The result is always validated, and the note says so when validation moved the value.
    /// Clamping silently would leave the caller believing it set 9,999 days.
    /// </remarks>
    public static SettingChange Apply(FrameDoctorSettings current, string? key, string? value)
    {
        ArgumentNullException.ThrowIfNull(current);

        if (string.IsNullOrEmpty(key)) return SettingChange.Refused(UnknownKey(key));
        if (value is null) return SettingChange.Refused($"'{key}' needs a value.");

        var descriptor = All.FirstOrDefault(s => s.Key == key);
        if (descriptor.Key is null) return SettingChange.Refused(UnknownKey(key));

        var changed = key switch
        {
            "retention-days" => Number(current, value, (s, n) => s with { HighResolutionRetentionDays = n }),
            "live-window-seconds" => Number(current, value, (s, n) => s with { LiveWindowSeconds = n }),
            "auto-start" => Flag(current, value, (s, b) => s with { AutoStartOnGameDetected = b }),
            "keep-measuring" => Flag(current, value, (s, b) => s with { KeepMeasuringWithWindowClosed = b }),
            "simulation" => Flag(current, value, (s, b) => s with { SimulationMode = b }),
            _ => null,
        };

        if (changed is null) return SettingChange.Refused($"{descriptor.Key} takes {descriptor.Accepts}.");

        var validated = changed.Validated();

        return new SettingChange(validated, null, NoteIfClamped(descriptor, changed, validated));
    }

    /// <summary>Says so when validation moved a value, rather than letting the caller assume.</summary>
    private static string? NoteIfClamped(
        SettingDescriptor descriptor,
        FrameDoctorSettings asked,
        FrameDoctorSettings stored)
    {
        var (askedValue, storedValue) = descriptor.Key switch
        {
            "retention-days" =>
                (asked.HighResolutionRetentionDays, stored.HighResolutionRetentionDays),
            "live-window-seconds" =>
                (asked.LiveWindowSeconds, stored.LiveWindowSeconds),
            _ => (0, 0),
        };

        if (askedValue == storedValue) return null;

        return $"{askedValue} is outside what {descriptor.Key} accepts — {descriptor.Accepts}. " +
               $"Stored {storedValue}.";
    }

    private static FrameDoctorSettings? Number(
        FrameDoctorSettings current,
        string value,
        Func<FrameDoctorSettings, int, FrameDoctorSettings> set) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)
            ? set(current, n)
            : null;

    /// <summary>
    /// Parses a flag.
    /// </summary>
    /// <remarks>
    /// Exactly <c>true</c> or <c>false</c>, case-insensitively, and nothing else. Accepting 1, on
    /// and yes would mean the empty string, 0 and every typo become <c>false</c> — a setting
    /// turning itself off because the value was misspelled.
    /// </remarks>
    private static FrameDoctorSettings? Flag(
        FrameDoctorSettings current,
        string value,
        Func<FrameDoctorSettings, bool, FrameDoctorSettings> set) =>
        bool.TryParse(value, out var b) ? set(current, b) : null;

    private static string UnknownKey(string? key)
    {
        var names = string.Join(", ", All.Select(s => s.Key));

        return string.IsNullOrEmpty(key)
            ? $"No setting was named. The settings are: {names}."
            : $"There is no setting called '{key}'. The settings are: {names}.";
    }
}

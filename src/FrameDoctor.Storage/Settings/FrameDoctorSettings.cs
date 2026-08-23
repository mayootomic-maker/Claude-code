using System.Text.Json;
using System.Text.Json.Serialization;

namespace FrameDoctor.Storage.Settings;

/// <summary>
/// Everything the user can change about how FrameDoctor behaves.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately short. Every setting here is one where the honest answer genuinely depends on
/// the person: how long to keep data, whether to measure automatically, how much history to
/// hold. There is no detection-sensitivity setting and there will not be one — the threshold is
/// derived from the measured noise of the machine it runs on, and a slider over it would let a
/// user tune away the stutters instead of finding them, which is this product's distinction
/// inverted.
/// </para>
/// <para>
/// Persisted as JSON beside the session store, not in the registry. Registry settings survive an
/// uninstall, and a diagnostics tool leaving state behind after removal is exactly the behaviour
/// that gives this category its reputation.
/// </para>
/// </remarks>
public sealed record FrameDoctorSettings
{
    /// <summary>
    /// How long full-resolution frame data is kept before only the summary remains.
    /// </summary>
    /// <remarks>
    /// The summary is never deleted. Reclaiming space by destroying the session index would
    /// silently destroy the regression history, which is the feature the history exists for.
    /// </remarks>
    public int HighResolutionRetentionDays { get; init; } = 14;

    /// <summary>Whether to begin measuring when a game is detected in the foreground.</summary>
    /// <remarks>
    /// Off by default. A tool that starts recording without being asked is one the user has to
    /// trust rather than verify, and this one is asking to be trusted about a great deal already.
    /// </remarks>
    public bool AutoStartOnGameDetected { get; init; }

    /// <summary>Whether the engine keeps running after the window is closed.</summary>
    public bool KeepMeasuringWithWindowClosed { get; init; } = true;

    /// <summary>Seconds of frame history the Live timeline shows.</summary>
    public int LiveWindowSeconds { get; init; } = 60;

    /// <summary>
    /// Whether the interface runs against simulated telemetry instead of this machine.
    /// </summary>
    /// <remarks>
    /// A first-class mode, not a debug flag: the UI, the diagnostics and the tests all run
    /// against it. It is also how someone can see what the product does before trusting it with
    /// a capture.
    /// </remarks>
    public bool SimulationMode { get; init; }

    /// <summary>Bounds each value to something the rest of the product can honour.</summary>
    /// <remarks>
    /// Clamped rather than rejected. A settings file edited by hand into an impossible state
    /// should still start the application: a diagnostics tool that will not launch because a
    /// number in a text file is too large has failed at something more important than the
    /// setting.
    /// </remarks>
    public FrameDoctorSettings Validated() => this with
    {
        // One day is the floor. Zero would purge a session's frames the moment it is recorded,
        // which is indistinguishable from not recording it.
        HighResolutionRetentionDays = Math.Clamp(HighResolutionRetentionDays, 1, 365),

        // Below fifteen seconds the timeline cannot show a stutter and its recovery together.
        // Above five minutes a single pixel column spans more than a second of frames, and the
        // min/max envelope stops distinguishing a spike from a busy period.
        LiveWindowSeconds = Math.Clamp(LiveWindowSeconds, 15, 300),
    };
}

/// <summary>Reads and writes the settings file.</summary>
/// <remarks>
/// Every failure path returns defaults rather than throwing. A corrupt settings file must not
/// stop the application from measuring: settings describe how the product behaves, not what it
/// is for.
/// </remarks>
public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly string _path;

    public SettingsStore(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        _path = path;
    }

    public string Path => _path;

    /// <summary>Whether a settings file exists yet.</summary>
    /// <remarks>
    /// Distinct from "settings are all default". A first run and a run after someone reset every
    /// value produce the same values and are different situations.
    /// </remarks>
    public bool Exists => File.Exists(_path);

    /// <summary>Loads the settings, falling back to defaults on any problem.</summary>
    public FrameDoctorSettings Load()
    {
        if (!File.Exists(_path)) return new FrameDoctorSettings();

        try
        {
            var settings = JsonSerializer.Deserialize<FrameDoctorSettings>(
                File.ReadAllText(_path), Options);

            return (settings ?? new FrameDoctorSettings()).Validated();
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            return new FrameDoctorSettings();
        }
    }

    /// <summary>Writes the settings, replacing the file atomically.</summary>
    /// <remarks>
    /// Written to a temporary file and moved into place. A crash during a direct write leaves a
    /// truncated file, and a truncated settings file reads as "every setting is default" — which
    /// would silently turn off a retention policy someone set deliberately.
    /// </remarks>
    public void Save(FrameDoctorSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        var directory = System.IO.Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(settings.Validated(), Options));
        File.Move(temporary, _path, overwrite: true);
    }
}

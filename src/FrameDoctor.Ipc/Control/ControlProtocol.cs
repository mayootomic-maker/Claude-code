using System.Text.Json.Serialization;

namespace FrameDoctor.Ipc.Control;

/// <summary>
/// The complete command surface the window may ask the engine for.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately three. Every message crossing this boundary is untrusted input — the pipe is
/// scoped to one user, but a compromised or simply buggy shell is still on the other end of it,
/// and this is the only channel through which anything outside the engine can change its
/// behaviour. A wide surface here would be a wide surface for that.
/// </para>
/// <para>
/// Nothing on this channel mutates the system. Settings live in FrameDoctor's own file; changing
/// power policy or process priority goes through the change journal and its apply protocol, and
/// deliberately has no door here.
/// </para>
/// </remarks>
public enum ControlCommand
{
    /// <summary>Unrecognised. The value a malformed or hostile message deserialises to.</summary>
    /// <remarks>
    /// Zero on purpose: an absent, misspelled or newly-invented command name lands here rather
    /// than on whichever command happens to be first in the enum.
    /// </remarks>
    Unknown = 0,

    /// <summary>Is the engine there, and which build.</summary>
    Ping = 1,

    /// <summary>Read every setting.</summary>
    GetSettings = 2,

    /// <summary>Change one setting.</summary>
    SetSetting = 3,
}

/// <summary>One request from the window.</summary>
/// <param name="Id">
/// Echoed back on the response. Without it a caller with two requests in flight can attribute an
/// answer to the wrong question, which on this channel means showing a value that was never set.
/// </param>
/// <param name="Command">What is being asked.</param>
/// <param name="Key">Which setting, for <see cref="ControlCommand.SetSetting"/>.</param>
/// <param name="Value">The new value, as text. Parsed and validated on the engine's side.</param>
public sealed record ControlRequest(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("command")] string? Command,
    [property: JsonPropertyName("key")] string? Key = null,
    [property: JsonPropertyName("value")] string? Value = null)
{
    /// <summary>Builds a request from the enum, for callers on this side of the wire.</summary>
    /// <remarks>
    /// A factory rather than a second constructor: a record with two parameterized constructors
    /// has no unambiguous one for the deserializer to use, and the failure is a runtime
    /// exception on the first message rather than a compile error.
    /// </remarks>
    public static ControlRequest For(
        int id, ControlCommand command, string? key = null, string? value = null) =>
        new(id, command.ToString(), key, value);

    /// <summary>
    /// The command this names, or <see cref="ControlCommand.Unknown"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// An explicit switch, not <c>Enum.Parse</c> and not a string-enum converter. Both of those
    /// reject an unknown name by throwing, which collapses "you sent a command I do not have"
    /// into "your message was not valid JSON" — two different problems, and only one of them is
    /// something the caller can fix.
    /// </para>
    /// <para>
    /// Case-sensitive. A command surface this small does not need to guess at capitalisation,
    /// and matching loosely here is how <c>getsettings</c> and <c>GetSettings</c> become two
    /// spellings nobody wrote down.
    /// </para>
    /// </remarks>
    [JsonIgnore]
    public ControlCommand Parsed => Command switch
    {
        nameof(ControlCommand.Ping) => ControlCommand.Ping,
        nameof(ControlCommand.GetSettings) => ControlCommand.GetSettings,
        nameof(ControlCommand.SetSetting) => ControlCommand.SetSetting,
        _ => ControlCommand.Unknown,
    };
}

/// <summary>Settings as they cross the wire.</summary>
/// <remarks>
/// A flat record of primitives rather than the settings type itself. The storage type carries
/// validation and defaults that belong to the engine; sending it would make the wire contract
/// change every time that type does.
/// </remarks>
public sealed record ControlSettings(
    [property: JsonPropertyName("highResolutionRetentionDays")] int HighResolutionRetentionDays,
    [property: JsonPropertyName("autoStartOnGameDetected")] bool AutoStartOnGameDetected,
    [property: JsonPropertyName("keepMeasuringWithWindowClosed")] bool KeepMeasuringWithWindowClosed,
    [property: JsonPropertyName("liveWindowSeconds")] int LiveWindowSeconds,
    [property: JsonPropertyName("simulationMode")] bool SimulationMode);

/// <summary>One answer.</summary>
/// <param name="Id">The request this answers.</param>
/// <param name="Ok">Whether the request was carried out.</param>
/// <param name="Error">
/// Why not, in the words the user should see. Null when <paramref name="Ok"/>.
/// </param>
/// <param name="Settings">The settings after the request, so a caller never has to re-read.</param>
/// <param name="Note">
/// Something true about the outcome that is not a failure — most usefully, that a value was
/// clamped. A setting that silently became something other than what was asked for is a lie the
/// interface would then repeat.
/// </param>
/// <param name="Build">The engine's version, for <see cref="ControlCommand.Ping"/>.</param>
public sealed record ControlResponse(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("error")] string? Error = null,
    [property: JsonPropertyName("settings")] ControlSettings? Settings = null,
    [property: JsonPropertyName("note")] string? Note = null,
    [property: JsonPropertyName("build")] string? Build = null);

/// <summary>
/// Source-generated serialization for the control channel.
/// </summary>
/// <remarks>
/// Source-generated rather than reflection-based so the engine stays trim- and AOT-safe, and so
/// the set of types that can cross this boundary is fixed at compile time. A reflection
/// serializer will deserialize whatever it is asked to; this one will not.
/// </remarks>
[JsonSourceGenerationOptions(
    PropertyNameCaseInsensitive = false,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never)]
[JsonSerializable(typeof(ControlRequest))]
[JsonSerializable(typeof(ControlResponse))]
[JsonSerializable(typeof(ControlSettings))]
public sealed partial class ControlJson : JsonSerializerContext;

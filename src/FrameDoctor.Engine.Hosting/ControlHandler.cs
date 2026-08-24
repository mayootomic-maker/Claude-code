using FrameDoctor.Ipc.Control;
using FrameDoctor.Storage.Settings;

namespace FrameDoctor.Engine.Hosting;

/// <summary>
/// Answers one control request. The whole of what the window may make the engine do.
/// </summary>
/// <remarks>
/// <para>
/// Every field of every request is untrusted. The pipe is scoped to one user, which bounds who
/// can connect; it says nothing about what they send. So the command is matched rather than
/// dispatched, the key is looked up in a fixed list rather than reflected onto a property, and
/// the value is parsed rather than converted.
/// </para>
/// <para>
/// Pure of transport: it takes a request and returns a response, so every refusal is reachable
/// from a test without a pipe.
/// </para>
/// </remarks>
public sealed class ControlHandler(SettingsStore store, string build)
{
    private readonly SettingsStore _store = store ?? throw new ArgumentNullException(nameof(store));
    private readonly string _build = build ?? throw new ArgumentNullException(nameof(build));

    /// <summary>Raised after a setting changes, so the engine can act on it.</summary>
    /// <remarks>
    /// The engine does not poll the file. A setting the user changed and the engine did not
    /// notice is a control that appears to work and does not, which is what invariant 9 forbids.
    /// </remarks>
    public event Action<FrameDoctorSettings>? SettingsChanged;

    public ControlResponse Handle(ControlRequest? request)
    {
        // A message that did not deserialise at all still deserves an answer, or the caller
        // waits forever on a request it believes is in flight.
        if (request is null)
        {
            return new ControlResponse(0, Ok: false, Error: "The request could not be read.");
        }

        return request.Parsed switch
        {
            ControlCommand.Ping => new ControlResponse(request.Id, Ok: true, Build: _build),
            ControlCommand.GetSettings => Read(request.Id),
            ControlCommand.SetSetting => Set(request),

            // Including Unknown, which is what an absent, misspelled or newly-invented command
            // name deserialises to. Naming what is accepted, because a peer that guessed wrong
            // cannot fix it from a refusal that says only "no".
            _ => new ControlResponse(
                request.Id,
                Ok: false,
                Error: $"'{request.Command ?? "(none)"}' is not a command this engine accepts. " +
                       $"It accepts: {nameof(ControlCommand.Ping)}, " +
                       $"{nameof(ControlCommand.GetSettings)}, " +
                       $"{nameof(ControlCommand.SetSetting)}."),
        };
    }

    private ControlResponse Read(int id) =>
        new(id, Ok: true, Settings: ToWire(_store.Load()));

    private ControlResponse Set(ControlRequest request)
    {
        var current = _store.Load();
        var change = SettingsCommands.Apply(current, request.Key, request.Value);

        if (change.Updated is not { } updated)
        {
            // The current settings ride along on a refusal too. A window that just showed a
            // rejected value needs to put the real one back, and asking again for it would be a
            // second round trip during which the user is looking at a wrong number.
            return new ControlResponse(
                request.Id, Ok: false, Error: change.Error, Settings: ToWire(current));
        }

        try
        {
            _store.Save(updated);
        }
        catch (IOException e)
        {
            return new ControlResponse(
                request.Id,
                Ok: false,
                Error: $"The setting could not be saved: {e.Message}",
                Settings: ToWire(current));
        }
        catch (UnauthorizedAccessException e)
        {
            return new ControlResponse(
                request.Id,
                Ok: false,
                Error: $"The setting could not be saved: {e.Message}",
                Settings: ToWire(current));
        }

        SettingsChanged?.Invoke(updated);

        // What was stored, never what was asked for. They differ when a value was clamped, and
        // the note says so.
        return new ControlResponse(
            request.Id, Ok: true, Settings: ToWire(updated), Note: change.Note);
    }

    private static ControlSettings ToWire(FrameDoctorSettings settings)
    {
        var validated = settings.Validated();

        return new ControlSettings(
            validated.HighResolutionRetentionDays,
            validated.AutoStartOnGameDetected,
            validated.KeepMeasuringWithWindowClosed,
            validated.LiveWindowSeconds,
            validated.SimulationMode);
    }
}

using System.IO.Pipes;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Ipc;

namespace FrameDoctor.Engine;

/// <summary>
/// Serves the live telemetry channel to whichever shell is attached.
/// </summary>
/// <remarks>
/// <para>
/// One client at a time, and the engine outlives it. Closing the window must not end the
/// session: someone who starts a capture, plays for two hours and reopens the UI expects two
/// hours of data, and an engine that dies with its window cannot deliver that.
/// </para>
/// <para>
/// Writes are blocking, on this thread, into a span. The asynchronous alternative allocates per
/// message — measurably, at the rates this runs at — and this thread has nothing else to do
/// while a local named pipe accepts a few hundred bytes.
/// </para>
/// <para>
/// A disconnected client is not an error. It is the normal state whenever the UI is closed, and
/// the server simply goes back to waiting.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class TelemetryServer : IAsyncDisposable
{
    /// <summary>The pipe name the shell connects to.</summary>
    /// <remarks>
    /// Per-user rather than machine-wide. Two people signed into the same machine each get their
    /// own engine and their own sessions, and neither can read the other's telemetry.
    /// </remarks>
    public static string PipeNameFor(string userName) => $"FrameDoctor.Telemetry.{userName}";

    private readonly string _pipeName;
    private NamedPipeServerStream? _pipe;
    private TelemetryChannelWriter? _writer;

    public TelemetryServer(string? pipeName = null)
    {
        _pipeName = pipeName ?? PipeNameFor(Environment.UserName);
    }

    public bool IsConnected => _pipe is { IsConnected: true };

    public ulong MessagesSent => _writer?.FramesWritten ?? 0;

    /// <summary>Waits for a shell to attach.</summary>
    public async Task AcceptAsync(CancellationToken cancellationToken)
    {
        await DisconnectAsync().ConfigureAwait(false);

        _pipe = new NamedPipeServerStream(
            _pipeName,
            PipeDirection.Out,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

        await _pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
        _writer = new TelemetryChannelWriter(_pipe);
    }

    /// <summary>
    /// Sends one message, returning false if the client went away.
    /// </summary>
    /// <remarks>
    /// The disconnect is swallowed here rather than thrown, because every caller's correct
    /// response to it is the same: keep measuring, and wait for the shell to come back.
    /// </remarks>
    public bool TrySend(
        WireMessageType type,
        ReadOnlySpan<TelemetrySample> samples,
        WireCondition condition = WireCondition.None)
    {
        if (_writer is null || _pipe is not { IsConnected: true }) return false;

        try
        {
            _writer.WriteSamples(type, samples, condition);
            _writer.Flush();
            return true;
        }
        catch (IOException)
        {
            // The shell closed. Normal.
            return false;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private async ValueTask DisconnectAsync()
    {
        _writer = null;

        if (_pipe is not null)
        {
            await _pipe.DisposeAsync().ConfigureAwait(false);
            _pipe = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        // A goodbye is worth the attempt: without it the shell cannot tell a clean shutdown from
        // an engine that crashed, and those need different things said to the user.
        TrySend(WireMessageType.Goodbye, []);
        await DisconnectAsync().ConfigureAwait(false);
    }
}

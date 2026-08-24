using System.IO.Pipes;
using FrameDoctor.Ipc.Control;

namespace FrameDoctor.Engine.Hosting;

/// <summary>
/// The duplex pipe the window uses to ask the engine for things.
/// </summary>
/// <remarks>
/// <para>
/// A second pipe rather than a direction on the telemetry one. Telemetry is a stream the engine
/// pushes at ten hertz and the shell may fall behind on; control is a request and an answer.
/// Multiplexing them would put a request behind a backlog of ticks, and a settings change that
/// takes effect a second late is a control that appears not to work.
/// </para>
/// <para>
/// <c>CurrentUserOnly</c>, like the telemetry pipe: two people signed into one machine each get
/// their own engine, and neither can send the other commands.
/// </para>
/// <para>
/// One client at a time, and a client that misbehaves is disconnected rather than tolerated. A
/// bad length has no recovery on a length-prefixed stream — the bytes after it could be anything
/// — so the connection ends and the next one starts clean.
/// </para>
/// <para>
/// Here rather than in the executable so the whole request-and-answer loop, including every
/// refusal, is reachable from a test over an in-memory stream pair.
/// </para>
/// </remarks>
public sealed class ControlServer : IAsyncDisposable
{
    /// <summary>The pipe name, per user.</summary>
    public static string PipeNameFor(string userName) => $"FrameDoctor.Control.{userName}";

    private readonly string _pipeName;
    private readonly ControlHandler _handler;

    public ControlServer(ControlHandler handler, string? pipeName = null)
    {
        ArgumentNullException.ThrowIfNull(handler);

        _handler = handler;
        _pipeName = pipeName ?? PipeNameFor(Environment.UserName);
    }

    /// <summary>Requests answered since the engine started, for the System view.</summary>
    public int RequestsAnswered { get; private set; }

    /// <summary>Connections dropped for sending something unreadable.</summary>
    /// <remarks>
    /// Counted rather than logged and forgotten. A number climbing here means something is
    /// talking to this pipe that should not be, which is worth being able to see.
    /// </remarks>
    public int ConnectionsRefused { get; private set; }

    /// <summary>Serves clients until cancelled, one at a time.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ServeOneAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
                // A client vanished mid-message. The next one gets a fresh pipe; this is the
                // ordinary way a window closes, not an error worth reporting.
            }
        }
    }

    private async Task ServeOneAsync(CancellationToken cancellationToken)
    {
        await using var pipe = new NamedPipeServerStream(
            _pipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

        await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);

        await ServeAsync(pipe, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Serves one connected stream until it closes or misbehaves.
    /// </summary>
    /// <remarks>
    /// Takes a stream rather than owning the pipe, so the whole request-and-answer loop —
    /// including every refusal — is reachable from a test over an in-memory pair.
    /// </remarks>
    public async Task ServeAsync(Stream stream, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(stream);

        while (!cancellationToken.IsCancellationRequested)
        {
            var (outcome, request) = await ControlFraming.ReadAsync(
                stream, ControlJson.Default.ControlRequest, cancellationToken).ConfigureAwait(false);

            if (outcome is ControlFraming.ReadOutcome.Closed) return;

            // A framing failure ends the connection. There is no way to resynchronise a
            // length-prefixed stream after a bad length, so continuing would turn one malformed
            // message into a sequence of them.
            if (outcome is ControlFraming.ReadOutcome.BadLength or ControlFraming.ReadOutcome.Truncated)
            {
                ConnectionsRefused++;
                return;
            }

            // Malformed JSON is different: the framing held, the stream is still aligned, and
            // the peer gets told what was wrong and may try again.
            var response = outcome is ControlFraming.ReadOutcome.Malformed
                ? new ControlResponse(0, Ok: false, Error: ControlFraming.Describe(outcome))
                : _handler.Handle(request);

            await ControlFraming.WriteAsync(
                stream, response, ControlJson.Default.ControlResponse, cancellationToken)
                .ConfigureAwait(false);

            RequestsAnswered++;
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

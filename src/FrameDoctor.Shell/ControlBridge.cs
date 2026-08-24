using System.IO;
using System.IO.Pipes;
using System.Text.Json;
using FrameDoctor.Ipc.Control;
using Microsoft.Web.WebView2.Core;

namespace FrameDoctor.Shell;

/// <summary>
/// Carries requests from the web view to the engine, and answers back.
/// </summary>
/// <remarks>
/// <para>
/// The other direction from <see cref="TelemetryBridge"/>, and a separate class for that reason:
/// telemetry is a stream the engine pushes and this is a request and an answer. A bug in the
/// render path cannot issue a command, because the render path never touches this.
/// </para>
/// <para>
/// This is a relay, not an authority. It does not decide whether a key exists or a value is
/// valid — the engine does, because the engine is where the settings live and where the rules
/// are tested. Validating here as well would put a second copy of those rules in a place nobody
/// would think to update.
/// </para>
/// <para>
/// One request at a time. The window has one settings screen and a person changing one thing at
/// a time; a queue would be machinery for a concurrency this application does not have.
/// </para>
/// </remarks>
public sealed class ControlBridge : IDisposable
{
    private readonly CoreWebView2 _webView;
    private readonly string _pipeName;
    private readonly SemaphoreSlim _oneAtATime = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();

    public ControlBridge(CoreWebView2 webView, string? pipeName = null)
    {
        ArgumentNullException.ThrowIfNull(webView);

        _webView = webView;
        _pipeName = pipeName ?? $"FrameDoctor.Control.{Environment.UserName}";
    }

    /// <summary>Requests relayed to the engine.</summary>
    public int RequestsRelayed { get; private set; }

    /// <summary>Requests that never reached it.</summary>
    public int RequestsFailed { get; private set; }

    /// <summary>Starts listening for requests from the page.</summary>
    public void Start() => _webView.WebMessageReceived += OnMessage;

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        // The page is ours, and it is still a boundary. A message this class cannot read is
        // dropped rather than allowed to throw on the UI thread and take the window with it.
        ControlRequest? request;
        try
        {
            request = JsonSerializer.Deserialize(
                args.WebMessageAsJson, ControlJson.Default.ControlRequest);
        }
        catch (JsonException)
        {
            return;
        }
        catch (ArgumentException)
        {
            // WebMessageAsJson throws when the message was posted as a string rather than JSON.
            return;
        }

        if (request is null) return;

        var response = await SendAsync(request).ConfigureAwait(true);

        _webView.PostWebMessageAsJson(
            JsonSerializer.Serialize(response, ControlJson.Default.ControlResponse));
    }

    /// <summary>
    /// Sends one request and waits for its answer.
    /// </summary>
    /// <remarks>
    /// A failure to reach the engine is answered rather than swallowed. The page has a control
    /// showing a pending change; leaving it pending forever is worse than telling the user the
    /// measuring process is not running.
    /// </remarks>
    private async Task<ControlResponse> SendAsync(ControlRequest request)
    {
        await _oneAtATime.WaitAsync(_lifetime.Token).ConfigureAwait(false);

        try
        {
            await using var pipe = new NamedPipeClientStream(
                ".", _pipeName, PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

            // Bounded. Without a timeout, a window opened while the engine is not running waits
            // on a connection that will never come, and the settings screen simply never answers.
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));

            await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);

            await ControlFraming.WriteAsync(
                pipe, request, ControlJson.Default.ControlRequest, timeout.Token).ConfigureAwait(false);

            var (outcome, response) = await ControlFraming.ReadAsync(
                pipe, ControlJson.Default.ControlResponse, timeout.Token).ConfigureAwait(false);

            RequestsRelayed++;

            if (outcome is ControlFraming.ReadOutcome.Message && response is not null) return response;

            RequestsFailed++;
            return new ControlResponse(
                request.Id, Ok: false,
                Error: $"The measuring process answered something unreadable. " +
                       $"{ControlFraming.Describe(outcome)}");
        }
        catch (OperationCanceledException)
        {
            RequestsFailed++;
            return new ControlResponse(
                request.Id, Ok: false,
                Error: "The measuring process did not answer. It may not be running.");
        }
        catch (IOException e)
        {
            RequestsFailed++;
            return new ControlResponse(
                request.Id, Ok: false,
                Error: $"The measuring process could not be reached: {e.Message}");
        }
        catch (UnauthorizedAccessException)
        {
            RequestsFailed++;
            return new ControlResponse(
                request.Id, Ok: false,
                Error: "The measuring process is running as a different user.");
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    public void Dispose()
    {
        _webView.WebMessageReceived -= OnMessage;
        _lifetime.Cancel();
        _lifetime.Dispose();
        _oneAtATime.Dispose();
    }
}

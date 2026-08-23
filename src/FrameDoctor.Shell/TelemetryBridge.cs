using System.Buffers;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Ipc;
using Microsoft.Web.WebView2.Core;

namespace FrameDoctor.Shell;

/// <summary>
/// Carries telemetry from the engine into the web view.
/// </summary>
/// <remarks>
/// <para>
/// The one place the two halves of the application meet, and it is deliberately one-directional
/// for telemetry: the engine pushes, the frontend renders. Commands travel the other way over a
/// separate channel, so a bug in the render path can never issue one.
/// </para>
/// <para>
/// Everything crossing this boundary is translated into a shape the frontend already
/// understands, including absence. A sample with no reading arrives as a state and a reason,
/// never as a number — the frontend's own type system makes a numeric fallback unwritable, and
/// this is the point where that guarantee would otherwise be lost.
/// </para>
/// </remarks>
public sealed class TelemetryBridge : IDisposable
{
    private readonly CoreWebView2 _webView;
    private readonly string _pipeName;
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _pump;

    public TelemetryBridge(CoreWebView2 webView, string? pipeName = null)
    {
        ArgumentNullException.ThrowIfNull(webView);

        _webView = webView;
        _pipeName = pipeName ?? $"FrameDoctor.Telemetry.{Environment.UserName}";
    }

    /// <summary>Live ticks delivered to the frontend.</summary>
    public long TicksDelivered { get; private set; }

    /// <summary>Samples the engine reported as lost before they reached us.</summary>
    /// <remarks>
    /// Forwarded to the frontend rather than absorbed. A gap in the stream must render as a gap;
    /// a smooth line drawn through absent measurements is a fabricated reading, and it would be
    /// fabricated at exactly the moment something interesting was happening.
    /// </remarks>
    public ulong SamplesLost { get; private set; }

    public void Start()
    {
        _pump = Task.Run(() => PumpAsync(_lifetime.Token), CancellationToken.None);
    }

    private async Task PumpAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeClientStream(
                    ".", _pipeName, PipeDirection.In,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

                await pipe.ConnectAsync(cancellationToken).ConfigureAwait(false);
                await ConsumeAsync(pipe, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
                // The engine restarted or went away. Reconnecting is the right response: the
                // window is expected to survive an engine restart, not to need relaunching.
            }

            await PostConnectionStateAsync(connected: false).ConfigureAwait(false);

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task ConsumeAsync(Stream stream, CancellationToken cancellationToken)
    {
        await PostConnectionStateAsync(connected: true).ConfigureAwait(false);

        var reader = new TelemetryChannelReader(stream);

        foreach (var frame in reader.ReadAll())
        {
            if (cancellationToken.IsCancellationRequested) return;

            if (frame.Type is WireMessageType.Goodbye)
            {
                await PostConnectionStateAsync(connected: false).ConfigureAwait(false);
                return;
            }

            SamplesLost += frame.SkippedFrames;

            if (frame.Type is not WireMessageType.LiveTick) continue;

            var json = Encode(frame);
            TicksDelivered++;

            await PostAsync(json).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Encodes one frame as the frontend's telemetry shape.
    /// </summary>
    /// <remarks>
    /// Written by hand rather than reflected, because the shape has to match the frontend's
    /// discriminated union exactly and a serializer that decides for itself how to render a
    /// double will eventually emit a <c>NaN</c> that JSON cannot carry — which arrives at the
    /// other end as either a parse error or, worse, a zero.
    /// </remarks>
    private static string Encode(in TelemetryFrame frame)
    {
        var buffer = new ArrayBufferWriter<byte>(1024);
        using var writer = new Utf8JsonWriter(buffer);

        writer.WriteStartObject();
        writer.WriteString("kind", "tick");
        writer.WriteNumber("sequence", frame.Sequence);
        writer.WriteBoolean("degraded", frame.Flags.HasFlag(WireCondition.Degraded));
        writer.WriteBoolean("afterDiscontinuity", frame.Flags.HasFlag(WireCondition.AfterDiscontinuity));
        writer.WriteNumber("skipped", frame.SkippedFrames);

        writer.WriteStartArray("metrics");

        foreach (ref readonly var sample in frame.AsSamples())
        {
            writer.WriteStartObject();
            writer.WriteString("metric", sample.Metric.ToString());
            writer.WriteNumber("state", (int)sample.Availability);
            writer.WriteNumber("quality", (int)sample.Quality);
            writer.WriteNumber("reason", (int)sample.Reason);

            if (sample.Instance != TelemetrySample.NoInstance)
                writer.WriteNumber("instance", sample.Instance);

            // The value is written only when there is one. An absent metric carries no number at
            // all, so there is nothing for the frontend to accidentally read as zero.
            if (sample.TryGetValue(out var value) && double.IsFinite(value))
                writer.WriteNumber("value", value);

            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
        writer.Flush();

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private Task PostConnectionStateAsync(bool connected)
    {
        var json = string.Create(CultureInfo.InvariantCulture,
            $$"""{"kind":"connection","connected":{{(connected ? "true" : "false")}}}""");

        return PostAsync(json);
    }

    /// <summary>Posts a message onto the web view's own thread.</summary>
    private Task PostAsync(string json)
    {
        var completion = new TaskCompletionSource();

        // WebView2 is thread-affine and the pump is not on its thread. Marshalling every message
        // is the cost of keeping the pump off the UI thread, which matters more: a stalled pipe
        // read must never freeze the window.
        System.Windows.Application.Current?.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                _webView.PostWebMessageAsJson(json);
            }
            catch (InvalidOperationException)
            {
                // The web view is gone. The window is closing.
            }
            finally
            {
                completion.TrySetResult();
            }
        });

        return completion.Task;
    }

    public void Dispose()
    {
        _lifetime.Cancel();

        try
        {
            _pump?.Wait(TimeSpan.FromSeconds(2));
        }
        catch (AggregateException)
        {
            // Shutdown.
        }

        _lifetime.Dispose();
    }
}

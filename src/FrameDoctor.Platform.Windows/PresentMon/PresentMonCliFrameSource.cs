using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Channels;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Platform.Windows.Time;

namespace FrameDoctor.Platform.Windows.PresentMon;

/// <summary>Where the PresentMon executable lives and which process to watch.</summary>
/// <param name="ExecutablePath">Full path to the bundled PresentMon binary.</param>
/// <param name="TargetProcessId">The game.</param>
/// <param name="EpochQpc">Counter value at the session epoch, for converting frame timestamps.</param>
/// <param name="QpcFrequency">Counter frequency, read once at start-up.</param>
public sealed record PresentMonOptions(
    string ExecutablePath,
    int TargetProcessId,
    ulong EpochQpc,
    long QpcFrequency)
{
    /// <summary>
    /// How long to wait for a first frame before declaring the source unavailable.
    /// </summary>
    /// <remarks>
    /// A capture that produces no rows and no error is the dangerous case: it renders as a
    /// perfectly smooth session. Anti-cheat blocking the target's events looks exactly like
    /// this. A bounded wait converts silence into a statement.
    /// </remarks>
    public TimeSpan FirstFrameTimeout { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>Frames buffered between the reader thread and the pipeline.</summary>
    /// <remarks>
    /// Two seconds at 1000 fps. Bounded on purpose: if the pipeline stalls, dropping the oldest
    /// frames and recording that they were dropped is honest, whereas an unbounded queue turns
    /// a stall into unbounded memory growth and then into the stutter this product exists to
    /// prevent.
    /// </remarks>
    public int FrameQueueCapacity { get; init; } = 2048;
}

/// <summary>
/// Frame timing from the bundled PresentMon command-line tool.
/// </summary>
/// <remarks>
/// <para>
/// A child process rather than a library. PresentMon's ETW consumer is the part most likely to
/// be blocked, starved or killed on a real machine, and running it out-of-process means it
/// cannot take the Engine with it — a crash there becomes an unavailable frame source, not a
/// lost session.
/// </para>
/// <para>
/// Everything the parser needs to know about the CSV contract, including the columns whose
/// missing value is an indistinguishable zero, is in
/// <c>docs/research/collector-implementation.md</c> §1.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: this type cannot execute on the Linux container this
/// repository is developed in. Its parsing, argument-building and failure-classification logic
/// are covered by tests; the process lifecycle is not.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class PresentMonCliFrameSource : IFrameSource
{
    private readonly PresentMonOptions _options;
    private readonly Channel<FramePresent> _frames;
    private readonly StringBuilder _stderr = new();

    private Process? _process;
    private Task? _pumpTask;
    private CancellationTokenSource? _lifetime;

    private long _rowsParsed;
    private long _rowsRejected;
    private long _framesBeforeEpoch;
    private long _framesDropped;
    private bool _sawLostData;
    private bool _headerSeen;

    public PresentMonCliFrameSource(PresentMonOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;

        _frames = Channel.CreateBounded<FramePresent>(
            new BoundedChannelOptions(options.FrameQueueCapacity)
            {
                // Dropping the oldest frame keeps the newest data flowing during a stall, and the
                // drop is counted so the session records that its own instrumentation fell behind
                // rather than presenting an unexplained gap as smooth play.
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = true,
            },
            _ => Interlocked.Increment(ref _framesDropped));
    }

    public SourceId Id => SourceId.PresentMonCli;

    public string DisplayName => "PresentMon (frame timing)";

    public IReadOnlyList<MetricId> DeclaredMetrics { get; } =
    [
        MetricId.FrameTime,
        MetricId.FrameDisplayedTime,
        MetricId.FrameDropped,
    ];

    /// <summary>
    /// Frame times are app-start to app-start, not present to present.
    /// </summary>
    /// <remarks>
    /// PresentMon's <c>MsBetweenAppStart</c> measures the interval the game's own frame loop
    /// took. It is the interval a user perceives as pacing; present-to-present can be smoothed
    /// by the present queue while the game itself is hitching.
    /// </remarks>
    public FrameTimeBasis Basis => FrameTimeBasis.CpuSubmitToSubmit;

    /// <summary>Frames the queue discarded because the pipeline could not keep up.</summary>
    /// <remarks>
    /// Surfaced, not swallowed. A frame FrameDoctor dropped is indistinguishable in the data
    /// from a frame the game never rendered, so a nonzero count degrades the session's quality.
    /// </remarks>
    public long FramesDroppedByBackpressure => Interlocked.Read(ref _framesDropped);

    /// <summary>Rows PresentMon emitted that did not parse.</summary>
    public long RowsRejected => Interlocked.Read(ref _rowsRejected);

    /// <summary>Whether PresentMon reported lost ETW events during this run.</summary>
    /// <remarks>
    /// Lost events mean missing frames, and missing frames look like smooth play. When this is
    /// set the whole session's frame data is <see cref="Quality.Degraded"/>.
    /// </remarks>
    public bool ReportedLostData => Volatile.Read(ref _sawLostData);

    public ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!File.Exists(_options.ExecutablePath))
        {
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id,
                DisplayName,
                UnavailableReason.SourceFaulted,
                "The bundled frame-timing helper is missing from the installation."));
        }

        // Probing does not start a trace session. Doing so would take an ETW provider slot from
        // whatever the user is running, once per probe, to learn something the first real run
        // reports anyway.
        return ValueTask.FromResult(SourceProbe.Working(
            Id,
            DisplayName,
            [
                MetricAvailability.Available(MetricId.FrameTime),
                MetricAvailability.Available(MetricId.FrameDisplayedTime),
                MetricAvailability.Available(MetricId.FrameDropped),
            ]));
    }

    public ValueTask StartAsync(CancellationToken cancellationToken)
    {
        if (_process is not null) throw new InvalidOperationException("Already started.");

        var startInfo = new ProcessStartInfo
        {
            FileName = _options.ExecutablePath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = false,
            UseShellExecute = false,
            CreateNoWindow = true,
            // PresentMon writes wide characters; when stdout is a pipe the runtime hands us
            // bytes, and UTF-8 is what the CRT emits for the ASCII-range content of a CSV row.
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        foreach (var argument in PresentMonInvocation.BuildArguments(_options.TargetProcessId))
            startInfo.ArgumentList.Add(argument);

        _lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The frame-timing helper did not start.");

        _pumpTask = Task.Run(() => PumpAsync(_process, _lifetime.Token), CancellationToken.None);

        return ValueTask.CompletedTask;
    }

    public IAsyncEnumerable<FramePresent> ReadFramesAsync(CancellationToken cancellationToken) =>
        _frames.Reader.ReadAllAsync(cancellationToken);

    /// <summary>
    /// Reads the child's stdout until it ends, turning rows into frames.
    /// </summary>
    /// <remarks>
    /// Runs on its own task and never touches the pipeline directly. The only shared state is
    /// the bounded channel and the counters, which is what keeps a slow consumer from blocking
    /// the pipe and back-pressuring PresentMon's ETW consumer thread.
    /// </remarks>
    private async Task PumpAsync(Process process, CancellationToken cancellationToken)
    {
        var stderrTask = Task.Run(() => ReadStderrAsync(process, cancellationToken), CancellationToken.None);

        try
        {
            var reader = process.StandardOutput;

            while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
            {
                if (!_headerSeen && PresentMonCsvParser.IsPinnedHeader(line))
                {
                    _headerSeen = true;
                    continue;
                }

                if (!PresentMonCsvParser.LooksLikeDataRow(line)) continue;

                if (!PresentMonCsvParser.TryParse(line, out var row))
                {
                    Interlocked.Increment(ref _rowsRejected);
                    continue;
                }

                Interlocked.Increment(ref _rowsParsed);

                if (TryConvert(row, out var frame))
                    await _frames.Writer.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
            }

            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Shutdown. Not a fault.
        }
        finally
        {
            await stderrTask.ConfigureAwait(false);
            _frames.Writer.TryComplete();
        }
    }

    private async Task ReadStderrAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            var reader = process.StandardError;
            while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
            {
                if (PresentMonInvocation.ReportsLostData(line)) Volatile.Write(ref _sawLostData, true);

                // Expected warnings are recorded but not accumulated into the text that
                // classification reads, so a routine unelevated-start warning cannot be mistaken
                // for the cause of a failure.
                if (PresentMonInvocation.IsExpectedWarning(line)) continue;

                lock (_stderr) _stderr.AppendLine(line);
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown.
        }
    }

    /// <summary>
    /// Turns a parsed row into a frame, or rejects it.
    /// </summary>
    /// <remarks>
    /// The rejection cases are the honest ones. A row whose CPU-pacing columns are the
    /// ambiguous-zero pattern carries no frame time, and inventing one — from
    /// <c>MsBetweenPresents</c>, say — would substitute a different measurement under the same
    /// name.
    /// </remarks>
    private bool TryConvert(in PresentMonRow row, out FramePresent frame)
    {
        frame = default;

        if (!row.HasTrustworthyCpuPacing) return false;
        if (!row.MsBetweenAppStart.TryGetValue(out var frameTimeMs)) return false;
        if (!(frameTimeMs > 0)) return false;

        var timestamp = QpcConversion.ToTimestamp(
            row.CpuStartQpc, _options.EpochQpc, _options.QpcFrequency, out var precededEpoch);

        if (precededEpoch) Interlocked.Increment(ref _framesBeforeEpoch);

        double? displayedMs = row.MsBetweenDisplayChange.TryGetValue(out var displayed)
            ? displayed
            : null;

        frame = new FramePresent(timestamp, frameTimeMs, displayedMs, row.WasDropped, row.ProcessId);
        return true;
    }

    /// <summary>Frames PresentMon reported as starting before the session epoch.</summary>
    /// <remarks>
    /// Expected to be a handful at start-up. A steady stream means the epoch is wrong, and the
    /// count is what makes that visible instead of producing a pile of frames at time zero.
    /// </remarks>
    public long FramesBeforeEpoch => Interlocked.Read(ref _framesBeforeEpoch);

    /// <summary>Classifies how the run ended, once the child has exited.</summary>
    public PresentMonInvocation.Outcome Outcome(bool targetStillRunning)
    {
        if (_process is not { HasExited: true } exited) return PresentMonInvocation.Outcome.Clean;

        string stderrText;
        lock (_stderr) stderrText = _stderr.ToString();

        return PresentMonInvocation.Classify(exited.ExitCode, stderrText, targetStillRunning);
    }

    public async ValueTask DisposeAsync()
    {
        if (_lifetime is not null) await _lifetime.CancelAsync().ConfigureAwait(false);

        if (_pumpTask is not null)
        {
            try { await _pumpTask.ConfigureAwait(false); }
            catch (OperationCanceledException) { /* shutdown */ }
        }

        if (_process is { HasExited: false } running)
        {
            // PresentMon has no graceful stdin protocol and we deliberately do not create a
            // console to send it Ctrl-C. --terminate_on_proc_exit means it normally goes away on
            // its own; this is the path where the game outlived the session.
            try { running.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { /* already gone */ }
        }

        _process?.Dispose();
        _lifetime?.Dispose();
    }
}

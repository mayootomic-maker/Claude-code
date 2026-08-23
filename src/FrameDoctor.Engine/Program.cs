using System.Globalization;
using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Engine;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Ipc;
using FrameDoctor.Platform.Windows.Time;
using FrameDoctor.Simulation;
using FrameDoctor.Storage.Catalog;
using FrameDoctor.Storage.Settings;

// The engine is the resident process: it owns the collectors, the pipeline and the session
// store, and it outlives whatever window happens to be open. Closing the UI must not end a
// capture, and a UI that crashes must not take two hours of measurement with it.

return await Run(args).ConfigureAwait(false);

static async Task<int> Run(string[] args)
{
    var verb = args.Length > 0 ? args[0] : "help";

    return verb switch
    {
        "probe" => await Probe().ConfigureAwait(false),
        "serve" => await Serve(args).ConfigureAwait(false),
        "simulate" => await Simulate(args).ConfigureAwait(false),
        "sessions" => Sessions(args),
        "export-sessions" => ExportSessions(args),
        "settings" => Settings(args),
        _ => Help(),
    };
}

static int Help()
{
    Console.WriteLine("""
        FrameDoctor engine

          The resident measurement process. It collects telemetry, detects stutters and
          explains them, and serves the result to a user interface over a local pipe.

        Usage:
          framedoctor-engine probe              Report what this machine can measure
          framedoctor-engine serve              Collect and serve until stopped
          framedoctor-engine simulate <id>      Run one scenario through the live pipeline
          framedoctor-engine simulate <id> --save  ... and record it as a session
          framedoctor-engine sessions           List recorded sessions
          framedoctor-engine export-sessions <f>   Write the session list as JSON
          framedoctor-engine settings           Show settings and where they live
          framedoctor-engine settings <k> <v>   Change one setting

        `probe` changes nothing and starts no capture. It is the honest answer to
        "what will this actually be able to tell me on my hardware?"

        Sessions are stored under this machine's local application data. Nothing
        leaves it: there is no account, no upload and no analytics.
        """);

    return 0;
}

static IMonotonicClock CreateClock() =>
    RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
        ? new QpcMonotonicClock()
        : new StopwatchClock();

static async Task<int> Probe()
{
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    var clock = CreateClock();

    await using var sources = await SourceSet.ProbeAllAsync(clock, cts.Token).ConfigureAwait(false);

    Console.WriteLine();
    Console.WriteLine("  WHAT THIS MACHINE CAN MEASURE");
    Console.WriteLine();

    foreach (var probe in sources.Probes)
    {
        Console.WriteLine($"  {probe.DisplayName}");

        if (!probe.IsAvailable)
        {
            Console.WriteLine($"    unavailable — {probe.Detail}");
            Console.WriteLine();
            continue;
        }

        foreach (var metric in probe.Metrics)
        {
            var name = metric.Metric.ToString();

            if (metric.IsAvailable)
            {
                Console.WriteLine($"    {name,-28} available");
                continue;
            }

            Console.WriteLine($"    {name,-28} {Availability(metric)}");
            if (!string.IsNullOrEmpty(metric.Detail)) Console.WriteLine($"      {metric.Detail}");
        }

        Console.WriteLine();
    }

    var available = sources.AvailableMetrics.Count;
    Console.WriteLine($"  {available} metric(s) available on this machine.");
    Console.WriteLine();

    // An engine that can measure nothing is not a failure to report as success. On Linux this is
    // the expected outcome and the message says so.
    return available > 0 ? 0 : 2;

    static string Availability(MetricAvailability metric) => metric.State switch
    {
        FrameDoctor.Abstractions.Telemetry.Availability.Denied => "denied",
        FrameDoctor.Abstractions.Telemetry.Availability.Failed => "failed",
        _ => "unavailable",
    };
}

static async Task<int> Serve(string[] args)
{
    if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
    {
        Console.Error.WriteLine(
            "  Live collection needs Windows. Use `simulate` to exercise the pipeline here.");
        return 2;
    }

    return await ServeWindows(args).ConfigureAwait(false);
}

static async Task<int> ServeWindows(string[] args)
{
    var refreshHz = ParseRefresh(args);
    var clock = CreateClock();

    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

    await using var sources = await SourceSet.ProbeAllAsync(clock, cts.Token).ConfigureAwait(false);

    if (sources.Sensors.Count == 0)
    {
        Console.Error.WriteLine("  No telemetry source on this machine could be started.");
        foreach (var probe in sources.Probes.Where(p => !p.IsAvailable))
            Console.Error.WriteLine($"    {probe.DisplayName}: {probe.Detail}");

        return 2;
    }

    var session = new LiveSession(refreshHz);
    var loop = new CollectorLoop(sources.Sensors, clock, session);

    await using var server = new TelemetryServer();

    session.EventDiagnosed += diagnosis =>
    {
        Console.WriteLine(
            $"  {diagnosis.Event.Start.TotalMilliseconds / 1000.0,8:F1}s  " +
            $"{diagnosis.Event.PeakFrameTimeMs,6:F0} ms  " +
            $"{(diagnosis.IsExplained ? diagnosis.Title : "Unexplained")}");
    };

    Console.WriteLine($"  Collecting. {sources.AvailableMetrics.Count} metric(s) available.");
    Console.WriteLine("  Ctrl-C to stop.");
    Console.WriteLine();

    var collecting = loop.RunAsync(cts.Token);
    var serving = ServeClients(server, session, cts.Token);

    try
    {
        await Task.WhenAny(collecting, serving).ConfigureAwait(false);
    }
    catch (OperationCanceledException)
    {
        // Ctrl-C.
    }

    var remaining = session.Complete();
    var stats = session.Statistics();

    Console.WriteLine();
    Console.WriteLine($"  {stats.FrameCount:N0} frames over {stats.Elapsed.TotalSeconds:F0} s");
    Console.WriteLine($"  {stats.StutterCount} stutter(s), {remaining.Count} closed at shutdown");
    Console.WriteLine($"  Worst single poll: {loop.WorstPollDuration.TotalMilliseconds:F2} ms");

    return 0;
}

// Accepts a shell, streams to it, and goes back to waiting when it leaves.
static async Task ServeClients(
    TelemetryServer server,
    LiveSession session,
    CancellationToken cancellationToken)
{
    // 10 Hz. Fast enough that the UI feels attached to the machine, slow enough that it is not
    // the thing keeping a core awake. The chart interpolates nothing between ticks — it draws
    // what arrived.
    using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
    var buffer = new TelemetrySample[16];

    while (!cancellationToken.IsCancellationRequested)
    {
        try
        {
            await server.AcceptAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (IOException)
        {
            continue;
        }

        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            var stats = session.Statistics();
            var now = MonotonicTimestamp.FromMilliseconds(stats.Elapsed.TotalMilliseconds);

            var written = 0;
            buffer[written++] = TelemetrySample.Measured(
                now, MetricId.FrameFpsRolling, SourceId.Derived, stats.RollingFps,
                Unit.FramesPerSecond, Quality.Derived);

            // A statistic below its minimum sample size is sent as unavailable, not omitted: the
            // UI must be able to tell "not enough data yet" from "the link dropped a message".
            buffer[written++] = Publish(now, MetricId.FrameTimeMedian, stats.MedianFrameTimeMs);
            buffer[written++] = Publish(now, MetricId.FrameTimeP99, stats.P99FrameTimeMs);
            buffer[written++] = Publish(now, MetricId.FrameLow1Pct, stats.Low1PercentFps);

            buffer[written++] = TelemetrySample.Measured(
                now, MetricId.FrameStutterCount, SourceId.Derived, stats.StutterCount,
                Unit.Count);
            buffer[written++] = TelemetrySample.Measured(
                now, MetricId.FrameSevereStutterCount, SourceId.Derived, stats.SevereCount,
                Unit.Count);

            var condition = stats.FramesLostToBackpressure > 0
                ? WireCondition.Degraded
                : WireCondition.None;

            if (!server.TrySend(WireMessageType.LiveTick, buffer.AsSpan(0, written), condition))
                break;
        }
    }

    static TelemetrySample Publish(MonotonicTimestamp now, MetricId metric, double value) =>
        double.IsNaN(value)
            ? TelemetrySample.Unavailable(
                now, metric, SourceId.Derived, UnavailableReason.InsufficientData)
            : TelemetrySample.Measured(
                now, metric, SourceId.Derived, value,
                metric == MetricId.FrameLow1Pct ? Unit.FramesPerSecond : Unit.Milliseconds,
                Quality.Derived);
}

// Runs one scenario through the live pipeline, exactly as a real session would run.
//
// Not a test fixture. This is the same LiveSession, the same detector and the same rules a real
// capture uses, and it is how the engine itself — rather than the libraries it composes — is
// exercised on a machine with no Windows and no GPU.
static async Task<int> Simulate(string[] args)
{
    var id = args.Length > 1 ? args[1] : "background-cpu-spike";

    SimulationScenario scenario;
    try
    {
        scenario = ScenarioCatalog.ById(id);
    }
    catch (KeyNotFoundException)
    {
        Console.Error.WriteLine($"  No scenario named '{id}'. Known scenarios:");
        foreach (var known in ScenarioCatalog.All) Console.Error.WriteLine($"    {known.Id}");
        return 2;
    }

    var session = new LiveSession(scenario.RefreshRateHz);
    var diagnosed = new List<FrameDoctor.Diagnostics.Diagnosis>();
    var explained = 0;
    var total = 0;

    session.EventDiagnosed += diagnosis =>
    {
        total++;
        if (diagnosis.IsExplained) explained++;
        diagnosed.Add(diagnosis);

        Console.WriteLine(
            $"  {diagnosis.Event.Start.TotalMilliseconds / 1000.0,8:F1}s  " +
            $"{diagnosis.Event.PeakFrameTimeMs,6:F0} ms  " +
            $"{(diagnosis.IsExplained ? diagnosis.Title : "Unexplained"),-28} " +
            $"{diagnosis.Confidence.Value * 100,3:F0}%");
    };

    Console.WriteLine();
    Console.WriteLine($"  {scenario.Title.ToUpperInvariant()}");
    Console.WriteLine($"  {scenario.Description}");
    Console.WriteLine();

    var one = new TelemetrySample[1];

    foreach (var sample in scenario.Generate())
    {
        if (sample.Metric == MetricId.FrameTime)
        {
            if (sample.TryGetValue(out var frameTimeMs))
                session.AddFrame(new FramePresent(sample.Timestamp, frameTimeMs, null, false, 0));
            else
                session.AddUnreadableFrame(sample.Timestamp);

            continue;
        }

        one[0] = sample;
        session.AddSensorSamples(one);
    }

    var completed = session.Complete();
    foreach (var diagnosis in completed)
    {
        total++;
        if (diagnosis.IsExplained) explained++;
        diagnosed.Add(diagnosis);
    }

    var stats = session.Statistics();

    if (args.Contains("--save"))
    {
        var path = StorePath(args);
        using var store = SessionStore.Open(path);

        if (!store.IsWritable)
        {
            Console.Error.WriteLine($"  The session store at {path} is not writable.");
            return 3;
        }

        var recorder = new SessionRecorder(new SessionRepository(store));

        // A simulated session is recorded as what it is. The machine fingerprint says
        // "simulation" so a real session can never be compared against one, which would be a
        // regression manufactured entirely out of synthetic data.
        var config = new ConfigRecord(
            new GameRecord($"{scenario.Id}.sim", null, scenario.Title),
            new MachineRecord("simulation", "Simulated CPU", "Simulated GPU", null, null),
            GpuDriver: null,
            MonitorHz: scenario.RefreshRateHz,
            MonitorWidth: null,
            MonitorHeight: null,
            PowerScheme: null,
            PowerOverlay: null,
            GameMode: null,
            Optimizations: null);

        var recordedId = recorder.Record(config, new StopwatchClock(), stats, diagnosed,
            baselineEligible: false);

        Console.WriteLine($"  Recorded as session {recordedId} in {path}");
    }

    Console.WriteLine();
    Console.WriteLine($"  {stats.FrameCount:N0} frames over {stats.Elapsed.TotalSeconds:F0} s");
    Console.WriteLine($"  median {stats.MedianFrameTimeMs:F2} ms, p99 {stats.P99FrameTimeMs:F2} ms");
    Console.WriteLine($"  {stats.StutterCount} stutter(s), {stats.SevereCount} severe");
    Console.WriteLine($"  {total} event(s), {explained} explained");
    Console.WriteLine($"  sensor history held {session.History.Count} sample(s) at the end");
    Console.WriteLine();

    await Task.CompletedTask.ConfigureAwait(false);
    return 0;
}

// Where sessions live. Local application data, per user, and nowhere else: FrameDoctor has no
// account, uploads nothing and keeps no analytics.
static string StorePath(string[] args)
{
    for (var i = 0; i < args.Length - 1; i++)
        if (args[i] is "--store") return args[i + 1];

    var root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FrameDoctor");

    Directory.CreateDirectory(root);
    return Path.Combine(root, "sessions.db");
}

// Lists what has been recorded, newest first.
static int Sessions(string[] args)
{
    var path = StorePath(args);

    if (!File.Exists(path))
    {
        Console.WriteLine();
        Console.WriteLine("  No sessions recorded yet.");
        Console.WriteLine($"  The store would be at {path}");
        Console.WriteLine();
        return 0;
    }

    using var store = SessionStore.Open(path);
    var repository = new SessionRepository(store);
    var sessions = repository.ListAll();

    Console.WriteLine();
    Console.WriteLine($"  {sessions.Count} session(s) in {path}");
    Console.WriteLine();

    foreach (var (session, game, stutters) in sessions)
    {
        var when = new DateTimeOffset(session.EpochUtcTicks, TimeSpan.Zero).ToLocalTime();
        var duration = TimeSpan.FromTicks(session.DurationTicks);

        Console.WriteLine(
            $"  {when:yyyy-MM-dd HH:mm}  {game,-24} " +
            $"{duration.TotalSeconds,6:F0}s  {session.FrameCount,8:N0} frames  " +
            $"{stutters,3} stutter(s)" +
            // Stated per row rather than in a footnote. A session excluded from baselines looks
            // identical to one included, and comparing across the two would manufacture a
            // regression out of a measurement problem.
            (session.BaselineEligible ? string.Empty : "  [not baseline-eligible]"));
    }

    Console.WriteLine();
    return 0;
}

// Records every scenario into a scratch store and writes the listing back out as JSON.
//
// The fixture the Sessions view renders. It is deliberately produced by round-tripping through
// the real catalog rather than assembled in memory: a fixture that never touches the storage
// layer would let the view be built against a shape the database cannot actually produce.
static int ExportSessions(string[] args)
{
    var destination = args.Length > 1 ? args[1] : "sessions.json";
    var scratch = Path.Combine(Path.GetTempPath(), $"framedoctor-export-{Guid.NewGuid():N}.db");

    try
    {
        using (var store = SessionStore.Open(scratch))
        {
            var recorder = new SessionRecorder(new SessionRepository(store));

            foreach (var scenario in ScenarioCatalog.All)
            {
                var (stats, diagnoses) = RunThroughPipeline(scenario);

                var config = new ConfigRecord(
                    new GameRecord($"{scenario.Id}.sim", null, scenario.Title),
                    new MachineRecord("simulation", "Simulated CPU", "Simulated GPU", null, null),
                    null, scenario.RefreshRateHz, null, null, null, null, null, null);

                recorder.Record(config, new StopwatchClock(), stats, diagnoses,
                    baselineEligible: false);
            }
        }

        using (var store = SessionStore.Open(scratch))
        {
            var rows = new SessionRepository(store).ListAll();

            var payload = rows.Select(r => new
            {
                id = r.Session.Id.ToString(),
                game = r.GameName,
                epochUtcTicks = r.Session.EpochUtcTicks,
                durationMs = TimeSpan.FromTicks(r.Session.DurationTicks).TotalMilliseconds,
                frameCount = r.Session.FrameCount,
                stutterCount = r.StutterCount,
                state = r.Session.State.ToString(),
                // Null rather than absent-as-zero, so the frontend's own type system can force
                // the caller to decide what an unmeasured floor looks like.
                sensitivityFloorMs = r.Session.SensitivityFloorMs,
                baselineEligible = r.Session.BaselineEligible,
            });

            var json = System.Text.Json.JsonSerializer.Serialize(payload,
                new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

            File.WriteAllText(destination, json);
            Console.WriteLine($"  {rows.Count} session(s) -> {destination}");
        }

        return 0;
    }
    finally
    {
        foreach (var suffix in new[] { string.Empty, "-wal", "-shm" })
        {
            var path = scratch + suffix;
            if (File.Exists(path)) File.Delete(path);
        }
    }
}

static (LiveStatistics Stats, List<FrameDoctor.Diagnostics.Diagnosis> Diagnoses)
    RunThroughPipeline(SimulationScenario scenario)
{
    var session = new LiveSession(scenario.RefreshRateHz);
    var diagnoses = new List<FrameDoctor.Diagnostics.Diagnosis>();
    session.EventDiagnosed += diagnoses.Add;

    var one = new TelemetrySample[1];

    foreach (var sample in scenario.Generate())
    {
        if (sample.Metric == MetricId.FrameTime)
        {
            if (sample.TryGetValue(out var ms))
                session.AddFrame(new FramePresent(sample.Timestamp, ms, null, false, 0));
            else
                session.AddUnreadableFrame(sample.Timestamp);

            continue;
        }

        one[0] = sample;
        session.AddSensorSamples(one);
    }

    diagnoses.AddRange(session.Complete());
    return (session.Statistics(), diagnoses);
}

static string SettingsPath(string[] args)
{
    for (var i = 0; i < args.Length - 1; i++)
        if (args[i] is "--settings") return args[i + 1];

    var root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FrameDoctor");

    Directory.CreateDirectory(root);
    return Path.Combine(root, "settings.json");
}

// Shows or changes settings.
//
// Every value prints with its file path, because a setting a user cannot find is one they cannot
// undo, and this file is the only place FrameDoctor keeps configuration — deliberately not the
// registry, which would survive an uninstall.
static int Settings(string[] args)
{
    var store = new SettingsStore(SettingsPath(args));
    var settings = store.Load();

    // Flags take a value, so a plain "does not start with --" filter would read a flag's value
    // as a setting name — which is how `settings --json out.json` ended up reporting that there
    // is no setting called "out.json".
    var positional = new List<string>();
    for (var i = 1; i < args.Length; i++)
    {
        if (args[i].StartsWith("--", StringComparison.Ordinal))
        {
            i++;
            continue;
        }

        positional.Add(args[i]);
    }

    if (positional.Count >= 2)
    {
        var (updated, error) = Apply(settings, positional[0], positional[1]);

        if (error is not null)
        {
            Console.Error.WriteLine($"  {error}");
            return 2;
        }

        store.Save(updated!);
        settings = store.Load();
        Console.WriteLine($"  Saved to {store.Path}");
    }

    // The interface reads this file rather than being told the values, so the screen it renders
    // cannot drift away from what the engine would actually honour.
    var jsonIndex = Array.IndexOf(args, "--json");
    if (jsonIndex >= 0 && jsonIndex + 1 < args.Length)
    {
        var payload = new
        {
            path = store.Path,
            exists = store.Exists,
            settings.HighResolutionRetentionDays,
            settings.AutoStartOnGameDetected,
            settings.KeepMeasuringWithWindowClosed,
            settings.LiveWindowSeconds,
            settings.SimulationMode,
        };

        File.WriteAllText(args[jsonIndex + 1], System.Text.Json.JsonSerializer.Serialize(
            payload,
            new System.Text.Json.JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
            }));

        Console.WriteLine($"  settings -> {args[jsonIndex + 1]}");
        return 0;
    }

    Console.WriteLine();
    Console.WriteLine($"  {store.Path}{(store.Exists ? string.Empty : "  (not written yet)")}");
    Console.WriteLine();
    Console.WriteLine($"  retention-days        {settings.HighResolutionRetentionDays}");
    Console.WriteLine($"  auto-start            {settings.AutoStartOnGameDetected}");
    Console.WriteLine($"  keep-measuring        {settings.KeepMeasuringWithWindowClosed}");
    Console.WriteLine($"  live-window-seconds   {settings.LiveWindowSeconds}");
    Console.WriteLine($"  simulation            {settings.SimulationMode}");
    Console.WriteLine();

    return 0;

    // Returns the updated settings, or an explanation. A rejected value says what was expected
    // rather than repeating what was given.
    static (FrameDoctorSettings? Updated, string? Error) Apply(
        FrameDoctorSettings current, string key, string value)
    {
        switch (key)
        {
            case "retention-days":
                return int.TryParse(value, CultureInfo.InvariantCulture, out var days)
                    ? (current with { HighResolutionRetentionDays = days }, null)
                    : (null, "retention-days takes a whole number of days, from 1 to 365.");

            case "live-window-seconds":
                return int.TryParse(value, CultureInfo.InvariantCulture, out var seconds)
                    ? (current with { LiveWindowSeconds = seconds }, null)
                    : (null, "live-window-seconds takes a whole number of seconds, from 15 to 300.");

            case "auto-start":
                return bool.TryParse(value, out var autoStart)
                    ? (current with { AutoStartOnGameDetected = autoStart }, null)
                    : (null, "auto-start takes true or false.");

            case "keep-measuring":
                return bool.TryParse(value, out var keep)
                    ? (current with { KeepMeasuringWithWindowClosed = keep }, null)
                    : (null, "keep-measuring takes true or false.");

            case "simulation":
                return bool.TryParse(value, out var simulation)
                    ? (current with { SimulationMode = simulation }, null)
                    : (null, "simulation takes true or false.");

            default:
                return (null,
                    $"There is no setting called '{key}'. Run `settings` with no arguments to see them all.");
        }
    }
}

static double ParseRefresh(string[] args)
{
    for (var i = 0; i < args.Length - 1; i++)
    {
        if (args[i] is not "--refresh") continue;
        if (double.TryParse(args[i + 1], CultureInfo.InvariantCulture, out var hz) && hz > 0)
            return hz;
    }

    return 144.0;
}

/// <summary>
/// The session clock on platforms without <c>QueryPerformanceCounter</c>.
/// </summary>
/// <remarks>
/// Exists so the engine runs against simulation off Windows. It is never used for a real
/// capture: FrameDoctor collects live telemetry on Windows only, and this clock's job is to let
/// the pipeline above the collectors be exercised anywhere.
/// </remarks>
file sealed class StopwatchClock : IMonotonicClock
{
    private readonly long _epoch = System.Diagnostics.Stopwatch.GetTimestamp();
    private readonly DateTimeOffset _epochUtc = DateTimeOffset.UtcNow;

    public MonotonicTimestamp Now =>
        new(System.Diagnostics.Stopwatch.GetElapsedTime(_epoch).Ticks);

    public DateTimeOffset EpochUtc => _epochUtc;

    public DateTimeOffset ToUtc(MonotonicTimestamp timestamp) => _epochUtc + timestamp.SinceEpoch;
}

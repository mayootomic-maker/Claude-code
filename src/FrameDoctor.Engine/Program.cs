using System.Globalization;
using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Engine;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Ipc;
using FrameDoctor.Pipeline.Attribution;
using FrameDoctor.Platform.Windows.Pdh;
using FrameDoctor.Platform.Windows.Processes;
using FrameDoctor.Platform.Windows.Time;
using FrameDoctor.Simulation;
using FrameDoctor.Storage.Catalog;
using FrameDoctor.Optimization;
using FrameDoctor.Platform.Windows.Optimization;
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
        "detect" => await Detect(args).ConfigureAwait(false),
        "retain" => Retain(args),
        "sessions" => Sessions(args),
        "export-sessions" => ExportSessions(args),
        "settings" => Settings(args),
        "reconcile" or "--reconcile-and-exit" => Reconcile(args),
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
          framedoctor-engine detect             Show what would be measured, changing nothing
          framedoctor-engine sessions           List recorded sessions
          framedoctor-engine retain             Reclaim frame data past the retention window
          framedoctor-engine export-sessions <f>   Write the session and baseline fixtures
          framedoctor-engine settings           Show settings and where they live
          framedoctor-engine settings <k> <v>   Change one setting
          framedoctor-engine reconcile          Put back anything FrameDoctor changed

        `probe` changes nothing and starts no capture. It is the honest answer to
        "what will this actually be able to tell me on my hardware?"

        `detect` is the same promise for game detection: it reports which process
        would be measured and, when none would be, exactly which requirement is
        unmet. It starts no capture and records nothing.

        `retain` deletes frame series older than the retention window and nothing
        else. Session summaries, events and diagnoses are kept forever — dropping
        those would destroy the history that regression detection is built on. It
        runs by itself when the engine starts and when a session is recorded; the
        verb exists so it can be run on demand and so its result is inspectable.

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

    // Before anything is collected. Retention is disk work, and the only safe time for it is
    // when nothing is being measured — which is now, and not again until this run ends.
    ReclaimBeforeCollecting(args);

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

        // Retention runs after a session is written, never during one. This is a moment when
        // nothing is being measured; a timer would eventually fire during a game.
        var reclaimed = RunRetention(store, new SettingsStore(SettingsPath(args)).Load(), args);
        if (reclaimed.Describe() is { } line) Console.WriteLine($"  {line}");
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

// Reports what game detection would decide, and changes nothing.
//
// The counterpart to `probe`. Detection is a conjunction of three signals from three unrelated
// sources, and when it declines there is no way to tell from the outside which one was missing.
// This prints that, once a second, without starting a capture or writing a row.
static async Task<int> Detect(string[] args)
{
    if (!OperatingSystem.IsWindows())
    {
        Console.Error.WriteLine("  Game detection reads the foreground window and the GPU engine");
        Console.Error.WriteLine("  counters. Neither exists on this platform.");
        return 2;
    }

    return await DetectWindows(args).ConfigureAwait(false);
}

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
static async Task<int> DetectWindows(string[] args)
{
    var clock = CreateClock();

    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

    var detector = new GameDetector(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        Environment.ProcessId);

    // No frame source is running under this verb, so the present rate is genuinely unknown
    // rather than zero — and Gate B will say so instead of confirming on two signals.
    // --assume-frames states that one exists without measuring it; named for what it does,
    // because a flag that quietly satisfies a requirement turns a conjunction into a score.
    using var sources = new WindowsGameSources(
        detector, args.Contains("--assume-frames") ? 144.0 : null);

    if (!sources.GpuCountersAvailable)
    {
        // Stated, not worked around. Gate B then has a signal it cannot read and will decline to
        // confirm anything, which is the correct outcome and not a silent one.
        Console.Error.WriteLine(
            "  The GPU Engine counter object could not be opened, so 3D work cannot be");
        Console.Error.WriteLine(
            $"  attributed to a process and nothing will ever be confirmed. PDH status 0x{sources.GpuStatus:X8}.");
    }

    var watcher = new GameWatcher(
        detector, sources.Foreground, sources.ThreeDUtilization, sources.PresentRate);

    Console.WriteLine("  Watching. Nothing is being captured or recorded. Ctrl-C to stop.");
    Console.WriteLine();

    var last = string.Empty;

    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));

    try
    {
        while (await timer.WaitForNextTickAsync(cts.Token).ConfigureAwait(false))
        {
            var line = watcher.Poll(clock.Now).Explain();

            // Only on change. A line a second for an hour is a log nobody reads.
            if (line == last) continue;

            last = line;
            Console.WriteLine($"  {DateTimeOffset.Now:HH:mm:ss}  {line}");
        }
    }
    catch (OperationCanceledException)
    {
        // Ctrl-C.
    }

    Console.WriteLine();
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

// Where session segment files live: beside the catalog, in their own directory.
//
// Separate from the database so that purging a session's frame series is a file delete costing
// zero bytes written, rather than a page rewrite inside SQLite. Its own directory so the orphan
// sweep has somewhere bounded to look — a sweep pointed at a directory holding anything else
// would be one bug away from deleting it.
static string SegmentDirectory(string[] args)
{
    var root = Path.GetDirectoryName(StorePath(args));
    if (string.IsNullOrEmpty(root)) return string.Empty;

    var directory = Path.Combine(root, "segments");
    Directory.CreateDirectory(directory);
    return directory;
}

// Reclaims frame series past the retention window.
static int Retain(string[] args)
{
    var path = StorePath(args);
    using var store = SessionStore.Open(path);

    if (!store.IsWritable)
    {
        Console.Error.WriteLine($"  The session store at {path} is not writable.");
        return 3;
    }

    var settings = new SettingsStore(SettingsPath(args)).Load();
    var report = RunRetention(store, settings, args);

    Console.WriteLine();
    Console.WriteLine($"  {report.Describe() ?? "Nothing to reclaim."}");
    Console.WriteLine(
        $"  Keeping frame data for {settings.HighResolutionRetentionDays} day(s). " +
        "Session summaries are kept forever.");
    Console.WriteLine();

    return report.Failures > 0 ? 1 : 0;
}

// One retention pass, and the single place that decides when one happens.
//
// Called at engine start and after a session is recorded — both moments when nothing is being
// measured. Never on a timer during a session: deleting files while a game is running is exactly
// the disk activity this product exists to diagnose.
static RetentionReport RunRetention(SessionStore store, FrameDoctorSettings settings, string[] args)
{
    var service = new RetentionService(new SessionRepository(store));

    return service.Run(
        settings.Validated().HighResolutionRetentionDays,
        SegmentDirectory(args));
}

// Runs retention at engine start, and says nothing when there was nothing to do.
//
// Failures here are reported and not fatal. A store that cannot be opened is a reason not to
// reclaim disk; it is not a reason to refuse to measure, which is what the user actually asked
// for.
static void ReclaimBeforeCollecting(string[] args)
{
    try
    {
        using var store = SessionStore.Open(StorePath(args));
        if (!store.IsWritable) return;

        var report = RunRetention(store, new SettingsStore(SettingsPath(args)).Load(), args);
        if (report.Describe() is { } line) Console.WriteLine($"  {line}");
    }
    catch (IOException e)
    {
        Console.Error.WriteLine($"  Retention did not run: {e.Message}");
    }
    catch (UnauthorizedAccessException e)
    {
        Console.Error.WriteLine($"  Retention did not run: {e.Message}");
    }
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

    // Both fixtures come out of this one catalog. They used to be built by two commands into two
    // scratch stores, and the Sessions screen ended up showing a baseline panel describing a
    // history that appeared nowhere in the table beneath it — a reader would reasonably have
    // read the panel as being about the rows they could see.
    var baselineDestination = Path.Combine(
        Path.GetDirectoryName(destination) is { Length: > 0 } dir ? dir : ".",
        "baseline.json");

    try
    {
        List<object> history;

        using (var store = SessionStore.Open(scratch))
        {
            var recorder = new SessionRecorder(new SessionRepository(store));

            // One session per scenario: the showcase the table exists to display. Each is its
            // own configuration — a different game — so none of them is comparable to another,
            // and none may seed a baseline.
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

            history = RecordBaselineHistory(store, recorder);
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

            File.WriteAllText(destination, Serialize(payload));
            Console.WriteLine($"  {rows.Count} session(s) -> {destination}");
        }

        File.WriteAllText(baselineDestination, Serialize(history));
        Console.WriteLine($"  {history.Count} session(s) of history -> {baselineDestination}");

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

// Absent stays absent. A null dropped from the payload becomes a missing key on the other side,
// and a missing key becomes `?? 0` — which is how a measurement nobody took becomes a zero.
static string Serialize(object payload) =>
    System.Text.Json.JsonSerializer.Serialize(payload,
        new System.Text.Json.JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
        });

// Records a genuine history for one configuration and returns what the detector concluded.
//
// The data behind the baseline panel. Every number in it is computed by the same BaselineBuilder
// and RegressionDetector a real machine runs — nothing here is authored. What is chosen is only
// the *telemetry*: eight healthy runs under distinct seeds, each a genuinely different series,
// followed by one run of a machine that started thermally throttling. The verdicts that come out
// are whatever the arithmetic says, including the several that say nothing changed.
static List<object> RecordBaselineHistory(SessionStore store, SessionRecorder recorder)
{
    // One configuration for the whole history. The machine fingerprint is "simulation", and
    // ConfigRecord.KeyHash folds it in, so no real session can ever land in this baseline — the
    // isolation is in the key, not in a flag someone could forget to set.
    var config = new ConfigRecord(
        new GameRecord("simulated-title.sim", null, "Simulated title"),
        new MachineRecord("simulation", "Simulated CPU", "Simulated GPU", 32768, null),
        GpuDriver: "sim-1.0",
        MonitorHz: 144.0,
        MonitorWidth: 2560,
        MonitorHeight: 1440,
        PowerScheme: null,
        PowerOverlay: null,
        GameMode: null,
        Optimizations: null);

    // Distinct seeds, not repetitions. The same seed twice would give byte-identical sessions
    // and a baseline with no spread at all, which is the one shape that flatters the detector.
    int[] seeds = [11, 29, 47, 63, 81, 97, 113, 131];

    var service = new BaselineService(new BaselineRepository(store));
    var key = config.KeyHash();

    var healthy = ScenarioCatalog.ById("healthy");
    var throttling = ScenarioCatalog.ById("gpu-thermal-throttle");

    var rows = new List<object>(seeds.Length + 1);

    // Oldest first, one session a day, so the history reads in the order it happened.
    var epoch = DateTimeOffset.UtcNow.AddDays(-(seeds.Length + 1));

    foreach (var seed in seeds)
    {
        rows.Add(RecordAndEvaluate(healthy, seed, epoch));
        epoch = epoch.AddDays(1);
    }

    // The same game on the same machine, now thermally throttling. Not a different
    // configuration — that is the whole point: a config fork would have made this incomparable,
    // and the user would have been told nothing.
    rows.Add(RecordAndEvaluate(throttling, 20260823, epoch));

    return rows;

    object RecordAndEvaluate(SimulationScenario scenario, int seed, DateTimeOffset at)
    {
        var (stats, diagnoses) = RunThroughPipeline(scenario, seed);

        var id = recorder.Record(config, new FixedEpochClock(at), stats, diagnoses);
        var standing = service.Evaluate(key, id);

        return new
        {
            id = id.ToString(),
            game = config.Game.DisplayName,
            scenario = scenario.Id,
            seed,
            epochUtcTicks = at.UtcTicks,
            frameCount = stats.FrameCount,
            // Null rather than absent-as-zero. A median below its minimum sample size is not a
            // fast session.
            medianFrameTimeMs = Finite(stats.MedianFrameTimeMs),
            p99FrameTimeMs = Finite(stats.P99FrameTimeMs),
            stutterCount = stats.StutterCount,
            baseline = new
            {
                sessionCount = standing.Baseline.SessionCount,
                trust = standing.Baseline.Trust.ToString(),
                exists = standing.Baseline.Exists,
                mayDeclareRegression = standing.Baseline.MayDeclareRegression,
                medianFrameTimeMs = standing.Baseline.Exists
                    ? Finite(standing.Baseline.MedianFrameTimeMs) : null,
                spreadMs = standing.Baseline.Exists
                    ? Finite(standing.Baseline.MedianAbsoluteDeviationMs) : null,
                describe = standing.Baseline.Describe(),
            },
            comparison = new
            {
                verdict = standing.Median.Verdict.ToString(),
                metric = standing.Median.Metric,
                baselineValue = Finite(standing.Median.BaselineValue),
                sessionValue = Finite(standing.Median.SessionValue),
                differenceMs = Finite(standing.Median.DifferenceMs),
                noiseMs = Finite(standing.Median.NoiseMs),
                effectSize = Finite(standing.Median.EffectSize),
                detail = standing.Median.Detail,
            },
        };
    }

    static double? Finite(double value) => double.IsFinite(value) ? value : null;
}

static (LiveStatistics Stats, List<FrameDoctor.Diagnostics.Diagnosis> Diagnoses)
    RunThroughPipeline(SimulationScenario scenario, int? seed = null)
{
    var session = new LiveSession(scenario.RefreshRateHz);
    var diagnoses = new List<FrameDoctor.Diagnostics.Diagnosis>();
    session.EventDiagnosed += diagnoses.Add;

    var one = new TelemetrySample[1];

    foreach (var sample in seed is { } s ? scenario.Generate(s) : scenario.Generate())
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

// Where the rollback journal lives: one plain file per outstanding change, in local application
// data and deliberately not inside the session database. The rollback doctrine requires
// restoration to survive database corruption, which is unsatisfiable if the rollback state lives
// in the database.
static string JournalPath(string[] args)
{
    for (var i = 0; i < args.Length - 1; i++)
        if (args[i] is "--journal") return args[i + 1];

    return Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FrameDoctor",
        "rollback");
}

// Puts back everything FrameDoctor changed and has not yet undone.
//
// One verb, one code path. It runs at every engine start, from the logon entry, from the
// uninstaller, and whenever the user asks — which is why it has to be idempotent, and why the
// compare-and-restore table refuses to write when a value no longer matches what was applied.
static int Reconcile(string[] args)
{
    var journal = new ChangeJournal(JournalPath(args));

    // A leftover temp file is a write that never completed, which means the change it described
    // was never applied — the journal is always written first.
    var cleaned = journal.CleanTemporaryFiles();
    var contents = journal.ReadAll();

    Console.WriteLine();

    if (contents.Entries.Count == 0 && contents.Unreadable.Count == 0)
    {
        Console.WriteLine("  FrameDoctor has not changed anything on this machine.");
        if (cleaned > 0) Console.WriteLine($"  Cleared {cleaned} incomplete journal file(s).");
        Console.WriteLine();
        return 0;
    }

    if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
    {
        // The journal is readable anywhere; undoing the change is not. Saying so beats silently
        // reporting that there was nothing to do.
        Console.WriteLine($"  {contents.Entries.Count} change(s) are recorded in {journal.Directory}.");
        Console.WriteLine("  Undoing them needs Windows.");
        Console.WriteLine();
        return 2;
    }

    return ReconcileWindows(journal, contents);
}

static int ReconcileWindows(ChangeJournal journal, JournalContents contents)
{
    var applier = new ChangeApplier(journal, ThisBuild());
    var change = new EcoQosChange();

    var restored = 0;
    var left = 0;

    // Kept so anything unresolved can be written down as well as printed.
    var transcript = new List<string>();

    foreach (var entry in contents.Entries)
    {
        // One implementation today. The kind is checked rather than assumed so an entry written
        // by a future build, for a change this build does not understand, is left alone instead
        // of being handed to the wrong restorer.
        if (entry.ChangeKind != change.ChangeKind)
        {
            var note = $"{entry.Description}: recorded by a newer version of FrameDoctor. Left alone.";
            Console.WriteLine($"  {note}");
            transcript.Add(note);
            left++;
            continue;
        }

        // One entry cannot cancel the others. Every remaining change would otherwise stay
        // applied because the first one hit a locked file.
        ReconcileResult result;
        try
        {
            result = applier.Reconcile(change, entry);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            var message = $"{entry.Description}: could not be reconciled — {e.Message}";
            Console.WriteLine($"  {message}");
            transcript.Add(message);
            left++;
            continue;
        }

        Console.WriteLine($"  {result.Detail}");

        if (result.Restored)
        {
            restored++;
        }
        else
        {
            transcript.Add(result.Detail);
            if (!result.EntryRemoved) left++;
        }
    }

    // Never summarised away. An unreadable entry most likely means a change that was applied and
    // can no longer be undone automatically, which is exactly what a user must be told.
    foreach (var unreadable in contents.Unreadable)
    {
        Console.WriteLine();
        Console.WriteLine($"  A rollback record could not be read: {unreadable.Path}");
        Console.WriteLine($"    {unreadable.Reason}");
        Console.WriteLine("    A setting FrameDoctor changed may still be applied.");

        transcript.Add(
            $"A rollback record could not be read: {unreadable.Path} — {unreadable.Reason}. " +
            "A setting FrameDoctor changed may still be applied.");

        left++;
    }

    Console.WriteLine();
    Console.WriteLine($"  {restored} restored, {left} left for you to decide about.");
    Console.WriteLine();

    // Written down, because at logon nobody is reading this.
    //
    // The Run entry launches a console executable, so everything above appears in a window that
    // flashes and closes. Anything that needs the user — "FrameDoctor has tried three times and
    // will stop trying; here is what to put back" — would be said into a void. The report is a
    // file the interface can surface later, and it is written only when there is something to
    // say, so it does not become a log nobody reads.
    if (left > 0 || contents.Unreadable.Count > 0)
        WriteReport(journal.Directory, transcript, restored, left);

    return left == 0 ? 0 : 1;
}

// Records what reconciliation could not finish, next to the journal it was reading.
static void WriteReport(string journalDirectory, List<string> lines, int restored, int left)
{
    try
    {
        Directory.CreateDirectory(journalDirectory);

        var path = Path.Combine(journalDirectory, "unfinished-rollback.txt");
        var report = new List<string>
        {
            "FrameDoctor could not finish putting everything back.",
            string.Empty,
            $"{restored} setting(s) restored, {left} left.",
            "The details below are what you would need to undo the rest by hand.",
            string.Empty,
        };

        report.AddRange(lines);

        File.WriteAllLines(path, report);
        Console.WriteLine($"  Written to {path}");
    }
    catch (Exception e) when (e is IOException or UnauthorizedAccessException)
    {
        // The console line above is all there is, then. Failing to write a report must not turn
        // a partly-successful rollback into a crash.
    }
}

// Identifies which build made a change, so a bad release is identifiable later.
static string ThisBuild() =>
    typeof(ChangeJournal).Assembly.GetName().Version?.ToString() ?? "unknown";

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
// The three readings game detection needs, on this machine.
//
// A class rather than three lambdas at the call site: a lambda closing over a Windows-only API
// compiles into a closure type that carries no platform attribute, so CA1416 loses the seam it
// is there to enforce. Holding them here keeps the boundary where it can be checked.
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
file sealed class WindowsGameSources : IDisposable
{
    private readonly ForegroundWatcher _foreground = new();
    private readonly GpuEngineReader _gpu = new();
    private readonly GameDetector _detector;
    private readonly double? _assumedPresentRateHz;

    public WindowsGameSources(GameDetector detector, double? assumedPresentRateHz)
    {
        _detector = detector;
        _assumedPresentRateHz = assumedPresentRateHz;
        GpuCountersAvailable = _gpu.Open();
        GpuStatus = _gpu.LastStatus;
    }

    public bool GpuCountersAvailable { get; }

    public uint GpuStatus { get; }

    public ForegroundFacts? Foreground() =>
        _foreground.Read() is { } p
            ? new ForegroundFacts(p.ProcessId, p.ImagePath, p.SignerSubject)
            : null;

    /// <summary>Rediscovery slows once a game is confirmed, because its instances stop changing.</summary>
    public double? ThreeDUtilization(int processId) =>
        _gpu.ThreeDUtilizationFor(processId, settled: _detector.ConfirmedProcessId is not null);

    public double? PresentRate(int processId)
    {
        _ = processId;
        return _assumedPresentRateHz;
    }

    public void Dispose() => _gpu.Dispose();
}

// A clock whose wall-clock anchor is chosen rather than read.
//
// Only for building fixtures, where sessions must land on distinct days in a known order. A
// real capture must never use this: the epoch is what ties a session's monotonic timestamps to
// a moment that actually happened.
file sealed class FixedEpochClock(DateTimeOffset epochUtc) : IMonotonicClock
{
    private readonly long _epoch = System.Diagnostics.Stopwatch.GetTimestamp();

    public MonotonicTimestamp Now =>
        new(System.Diagnostics.Stopwatch.GetElapsedTime(_epoch).Ticks);

    public DateTimeOffset EpochUtc { get; } = epochUtc;

    public DateTimeOffset ToUtc(MonotonicTimestamp timestamp) => EpochUtc + timestamp.SinceEpoch;
}

file sealed class StopwatchClock : IMonotonicClock
{
    private readonly long _epoch = System.Diagnostics.Stopwatch.GetTimestamp();
    private readonly DateTimeOffset _epochUtc = DateTimeOffset.UtcNow;

    public MonotonicTimestamp Now =>
        new(System.Diagnostics.Stopwatch.GetElapsedTime(_epoch).Ticks);

    public DateTimeOffset EpochUtc => _epochUtc;

    public DateTimeOffset ToUtc(MonotonicTimestamp timestamp) => _epochUtc + timestamp.SinceEpoch;
}

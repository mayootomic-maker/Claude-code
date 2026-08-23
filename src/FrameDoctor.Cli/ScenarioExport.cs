using System.Text.Json;
using System.Text.Json.Serialization;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Simulation;

namespace FrameDoctor.Cli;

/// <summary>
/// Exports a simulation scenario, run through the real pipeline, as JSON for the frontend.
/// </summary>
/// <remarks>
/// <para>
/// This exists so the user interface can be developed and reviewed against <b>genuine pipeline
/// output</b> rather than hand-written mock data. Invariant 9 forbids fake charts and
/// hardcoded metrics; a fixture produced by running the actual detector and diagnostic engine
/// over the actual simulation source is not fake, it is simulation mode — which is a
/// first-class part of the product, not a test scaffold.
/// </para>
/// <para>
/// Everything in the payload is measured by the same code that will run against a real
/// machine. The only difference is where the samples came from, and the frontend is required
/// to say so on every screen.
/// </para>
/// </remarks>
internal static class ScenarioExport
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    public static int Run(string scenarioId, string outputPath)
    {
        SimulationScenario scenario;
        try
        {
            scenario = ScenarioCatalog.ById(scenarioId);
        }
        catch (ArgumentOutOfRangeException)
        {
            Console.Error.WriteLine($"No scenario '{scenarioId}'. Run 'framedoctor list'.");
            return 2;
        }

        var samples = scenario.Generate().ToArray();
        var analysis = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(samples);

        var payload = Build(scenario, samples, analysis);

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
        using (var stream = File.Create(outputPath))
        {
            JsonSerializer.Serialize(stream, payload, Options);
        }

        Console.WriteLine(
            $"{scenario.Id}: {payload.FrameTimes.Length:N0} frames, {payload.Events.Length} event(s) " +
            $"-> {outputPath} ({new FileInfo(outputPath).Length / 1024.0:F0} KB)");
        return 0;
    }

    public static int RunAll(string outputDirectory)
    {
        foreach (var scenario in ScenarioCatalog.All)
        {
            var path = Path.Combine(outputDirectory, $"{scenario.Id}.json");
            if (Run(scenario.Id, path) != 0) return 1;
        }

        // An index so the frontend can enumerate without hardcoding a list that will drift.
        var index = ScenarioCatalog.All
            .Select(s => new ScenarioIndexEntry(s.Id, s.Title, s.Description, s.RefreshRateHz))
            .ToArray();

        var indexPath = Path.Combine(outputDirectory, "index.json");
        using (var stream = File.Create(indexPath))
        {
            JsonSerializer.Serialize(stream, index, Options);
        }

        Console.WriteLine($"index -> {indexPath}");
        return 0;
    }

    private static ScenarioPayload Build(
        SimulationScenario scenario, TelemetrySample[] samples, SessionAnalysis analysis)
    {
        // Frame timeline: two parallel arrays rather than an array of objects. At 13,000 frames
        // the object form triples the payload and forces the frontend to walk it to build the
        // typed arrays the chart wants anyway.
        var frameTimestamps = new List<double>();
        var frameTimes = new List<double>();

        foreach (var s in samples)
        {
            if (s.Metric != MetricId.FrameTime) continue;
            if (!s.TryGetValue(out var ms)) continue;
            frameTimestamps.Add(s.Timestamp.TotalMilliseconds);
            frameTimes.Add(ms);
        }

        // Slow metrics keep their own timestamps. They are never resampled onto the frame
        // timeline: pretending a 4 Hz sensor has 300 Hz resolution is the specific dishonesty
        // the telemetry model exists to prevent.
        var series = samples
            .Where(s => s.Metric != MetricId.FrameTime)
            .GroupBy(s => (s.Metric, s.Instance))
            .Select(g => new SeriesPayload(
                g.Key.Metric.ToString(),
                (int)g.Key.Metric,
                g.Key.Instance,
                MetricCatalog.UnitOf(g.Key.Metric).ToString(),
                (int)g.First().Availability,
                (int)g.First().Reason,
                (int)g.Max(s => s.Quality),
                [.. g.Select(s => s.Timestamp.TotalMilliseconds)],
                [.. g.Select(s => s.TryGetValue(out var v) ? v : double.NaN)]))
            .OrderBy(s => s.MetricId)
            .ToArray();

        var events = analysis.Events.Zip(analysis.Diagnoses)
            .Select(pair => ToEventPayload(pair.First, pair.Second))
            .ToArray();

        return new ScenarioPayload(
            scenario.Id,
            scenario.Title,
            scenario.Description,
            scenario.RefreshRateHz,
            analysis.FrameCount,
            analysis.Duration.TotalMilliseconds,
            Finite(analysis.MedianFrameTimeMs),
            Finite(analysis.P99FrameTimeMs),
            Finite(analysis.Low1PercentFps),
            Finite(analysis.SensitivityFloorMs),
            analysis.StutterCount,
            analysis.SevereStutterCount,
            Finite(analysis.ExplanationRate),
            [.. frameTimestamps],
            [.. frameTimes],
            series,
            events);
    }

    private static EventPayload ToEventPayload(
        Pipeline.Detection.StutterEvent e, Diagnosis d) =>
        new(e.Start.TotalMilliseconds,
            e.End.TotalMilliseconds,
            e.Class.ToString(),
            (int)e.Class,
            e.PeakFrameTimeMs,
            e.ExcessMs,
            e.ThresholdMs,
            e.BaselineMedianMs,
            e.FrameCount,
            e.MergedCount,
            e.DuringWarmUp,
            e.ForceClosed,
            e.CountsTowardTally,
            d.RuleId,
            d.Title,
            d.IsExplained ? d.Confidence.Value : null,
            (int)d.Confidence.BindingCap,
            d.WhatHappened,
            d.Mechanism,
            d.RecommendedAction,
            [.. d.Evidence.Select(i => new EvidencePayload(
                i.Metric.ToString(),
                i.Statement,
                i.Role.ToString(),
                i.SampleCount,
                Finite(i.NativeRateHz),
                i.CanEstablishOrdering,
                i.Quality.ToString()))],
            [.. d.RuledOut.Select(r => new RuledOutPayload(r.Title, r.Reason, r.WasCheckable))]);

    /// <summary>Maps NaN to null so the frontend cannot mistake "insufficient data" for a value.</summary>
    private static double? Finite(double value) => double.IsFinite(value) ? value : null;
}

internal sealed record ScenarioIndexEntry(string Id, string Title, string Description, double RefreshRateHz);

internal sealed record ScenarioPayload(
    string Id,
    string Title,
    string Description,
    double RefreshRateHz,
    int FrameCount,
    double DurationMs,
    double? MedianFrameTimeMs,
    double? P99FrameTimeMs,
    double? Low1PercentFps,
    double? SensitivityFloorMs,
    int StutterCount,
    int SevereStutterCount,
    double? ExplanationRate,
    double[] FrameTimestamps,
    double[] FrameTimes,
    SeriesPayload[] Series,
    EventPayload[] Events);

internal sealed record SeriesPayload(
    string Metric,
    int MetricId,
    int Instance,
    string Unit,
    int Availability,
    int Reason,
    int Quality,
    double[] Timestamps,
    double[] Values);

internal sealed record EvidencePayload(
    string Metric,
    string Statement,
    string Role,
    int SampleCount,
    double? NativeRateHz,
    bool CanEstablishOrdering,
    string Quality);

internal sealed record RuledOutPayload(string Title, string Reason, bool WasCheckable);

internal sealed record EventPayload(
    double StartMs,
    double EndMs,
    string ClassName,
    int ClassId,
    double PeakFrameTimeMs,
    double ExcessMs,
    double ThresholdMs,
    double BaselineMedianMs,
    int FrameCount,
    int MergedCount,
    bool DuringWarmUp,
    bool ForceClosed,
    bool CountsTowardTally,
    string? RuleId,
    string Title,
    double? Confidence,
    int BindingCap,
    string WhatHappened,
    string? Mechanism,
    string? RecommendedAction,
    EvidencePayload[] Evidence,
    RuledOutPayload[] RuledOut);

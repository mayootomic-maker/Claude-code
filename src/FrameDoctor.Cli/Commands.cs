using System.Globalization;
using FrameDoctor.Diagnostics;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Pipeline.Detection;
using FrameDoctor.Simulation;

namespace FrameDoctor.Cli;

/// <summary>Console entry points over the real diagnostic pipeline.</summary>
internal static class Commands
{
    public static int Usage()
    {
        Console.WriteLine("""
            FrameDoctor diagnostic harness

              This runs the real detection and diagnosis pipeline against simulated
              telemetry. It reads nothing from your machine and changes nothing on it.

            Usage:
              framedoctor list                    List available scenarios
              framedoctor run <scenario>          Run one scenario and report
              framedoctor run <scenario> --seed N Run with a different noise seed
              framedoctor run-all                 Run every scenario
              framedoctor export <scenario> <file>  Export one scenario as JSON
              framedoctor export-all <directory>   Export every scenario as JSON

              Export writes the output of the real pipeline, for the user interface to
              render. It is simulation data and the interface says so on every screen.
            """);
        return 0;
    }

    public static int Unknown(string[] args)
    {
        Console.Error.WriteLine($"Unrecognised arguments: {string.Join(' ', args)}");
        Console.Error.WriteLine("Run 'framedoctor --help'.");
        return 2;
    }

    public static int List()
    {
        Console.WriteLine();
        foreach (var s in ScenarioCatalog.All)
        {
            Console.WriteLine($"  {s.Id,-26} {s.Title}");
            Console.WriteLine($"  {"",-26} {s.Description}");
            Console.WriteLine();
        }
        return 0;
    }

    public static int RunAll()
    {
        var failures = 0;
        foreach (var s in ScenarioCatalog.All) failures += Run(s.Id) == 0 ? 0 : 1;
        return failures == 0 ? 0 : 1;
    }

    public static int Run(string scenarioId, int seed = 20260823)
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

        var analysis = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(scenario.Generate(seed));

        Rule();
        Console.WriteLine($"  {scenario.Title.ToUpperInvariant()}");
        Console.WriteLine($"  {scenario.Description}");
        Rule();

        Console.WriteLine();
        Console.WriteLine($"  Frames            {analysis.FrameCount:N0} over {analysis.Duration.TotalSeconds:F0} s");
        Console.WriteLine($"  Median frame time {Fmt(analysis.MedianFrameTimeMs, "ms")}");
        Console.WriteLine($"  p99 frame time    {Fmt(analysis.P99FrameTimeMs, "ms")}");
        Console.WriteLine($"  1% low            {Fmt(analysis.Low1PercentFps, "fps")}");

        // Stated deliberately. On an unstable game this can exceed 25 ms, and "no stutters
        // detected" without it would be a misleading claim rather than a reassuring one.
        Console.WriteLine($"  Smallest excess this regime can resolve: {analysis.SensitivityFloorMs:F1} ms");
        Console.WriteLine();

        if (analysis.Events.Count == 0)
        {
            Console.WriteLine("  No frame-timing anomalies detected.");
            Console.WriteLine();
            return 0;
        }

        Console.WriteLine($"  {analysis.Events.Count} event(s), " +
                          $"{analysis.StutterCount} counted as stutters " +
                          $"({analysis.SevereStutterCount} severe)");

        if (!double.IsNaN(analysis.ExplanationRate))
        {
            Console.WriteLine($"  Explanation rate: {analysis.ExplanationRate * 100:F0}%");
        }
        Console.WriteLine();

        foreach (var d in analysis.Diagnoses) Report(d);
        return 0;
    }

    private static void Report(Diagnosis d)
    {
        var e = d.Event;
        Console.WriteLine($"  +-- {e.Start.TotalMilliseconds / 1000:F2}s  " +
                          $"{e.PeakFrameTimeMs:F0} ms frame  [{e.Class}]");

        if (e.Class == StutterClass.RegimeChange)
        {
            // Not a stutter. Saying so plainly avoids inflating the number that matters most.
            Console.WriteLine("  |   Performance changed level and stayed there rather than");
            Console.WriteLine("  |   spiking. Not counted as a stutter.");
            Console.WriteLine();
            return;
        }

        if (d.IsExplained)
        {
            Console.WriteLine($"  |   {d.Title} - {d.Confidence.Value * 100:F0}% confidence");
            if (d.Confidence.BindingCap != Diagnostics.Evidence.ConfidenceCap.None)
            {
                Console.WriteLine($"  |   (limited by: {Describe(d.Confidence.BindingCap)})");
            }
        }
        else
        {
            Console.WriteLine("  |   Unexplained");
        }

        Console.WriteLine("  |");
        Console.WriteLine($"  |   What happened: {d.WhatHappened}");

        if (d.Mechanism is not null)
        {
            Console.WriteLine($"  |   Why: {d.Mechanism}");
        }

        if (d.Evidence.Count > 0)
        {
            Console.WriteLine("  |");
            Console.WriteLine("  |   Evidence:");
            foreach (var item in d.Evidence)
            {
                var role = item.Role == Diagnostics.Evidence.EvidenceRole.Consequence
                    ? "  (follows, does not cause)" : string.Empty;
                Console.WriteLine($"  |     - {item.Statement}{role}");
                Console.WriteLine($"  |       {item.SampleCount} sample(s) at " +
                                  $"{(double.IsNaN(item.NativeRateHz) ? "unknown rate" : $"{item.NativeRateHz:F1} Hz")}" +
                                  $"{(item.CanEstablishOrdering ? string.Empty : ", too coarse to establish ordering")}");
            }
        }

        var checkable = d.RuledOut.Where(r => r.WasCheckable).ToArray();
        if (checkable.Length > 0)
        {
            Console.WriteLine("  |");
            Console.WriteLine("  |   Ruled out:");
            foreach (var r in checkable) Console.WriteLine($"  |     - {r.Title}: {r.Reason}");
        }

        var blind = d.BlindSpots.ToArray();
        if (blind.Length > 0)
        {
            Console.WriteLine("  |");
            Console.WriteLine("  |   Could not check:");
            foreach (var r in blind) Console.WriteLine($"  |     - {r.Title}: {r.Reason}");
        }

        if (d.RecommendedAction is not null)
        {
            Console.WriteLine("  |");
            Console.WriteLine($"  |   Suggested: {d.RecommendedAction}");
        }

        Console.WriteLine();
    }

    private static string Describe(Diagnostics.Evidence.ConfidenceCap cap) => cap switch
    {
        Diagnostics.Evidence.ConfidenceCap.GlobalCeiling =>
            "attributing a cause is correlational, so certainty is never claimed",
        Diagnostics.Evidence.ConfidenceCap.SingleEvidenceClass =>
            "only one kind of evidence supported this",
        Diagnostics.Evidence.ConfidenceCap.EstimatedEvidence =>
            "some evidence was modelled rather than measured",
        Diagnostics.Evidence.ConfidenceCap.RequiredMetricMissing =>
            "a sensor this diagnosis needs is unavailable",
        _ => cap.ToString(),
    };

    /// <summary>Formats a value, or says it is unavailable. Never prints a placeholder zero.</summary>
    private static string Fmt(double value, string unit) =>
        double.IsNaN(value)
            ? "unavailable (insufficient data)"
            : value.ToString("F2", CultureInfo.InvariantCulture) + " " + unit;

    private static void Rule() => Console.WriteLine(new string('-', 74));
}

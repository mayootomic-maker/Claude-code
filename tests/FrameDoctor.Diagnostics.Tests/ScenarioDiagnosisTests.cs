using FrameDoctor.Engine.Hosting;
using FrameDoctor.Simulation;
using Shouldly;
using Xunit;

namespace FrameDoctor.Diagnostics.Tests;

/// <summary>
/// Every simulation scenario, end to end, asserted against its declared expectation.
/// </summary>
/// <remarks>
/// This is the suite that decides whether the product works. It exercises the whole vertical
/// slice — statistics, detection, correlation, diagnosis — against telemetry whose correct
/// answer is known in advance, including the two scenarios whose correct answer is "nothing" and
/// "I cannot tell you".
/// </remarks>
public sealed class ScenarioDiagnosisTests(ITestOutputHelper output)
{
    public static TheoryData<string> ScenarioIds()
    {
        var data = new TheoryData<string>();
        foreach (var s in ScenarioCatalog.All) data.Add(s.Id);
        return data;
    }

    [Theory]
    [MemberData(nameof(ScenarioIds))]
    public void Scenario_produces_its_expected_outcome(string scenarioId)
    {
        var scenario = ScenarioCatalog.ById(scenarioId);
        var expected = scenario.Expected;

        var analyzer = new SessionAnalyzer(scenario.RefreshRateHz);
        var analysis = analyzer.Analyze(scenario.Generate());

        output.WriteLine($"=== {scenario.Id}: {scenario.Title}");
        output.WriteLine($"    {analysis.FrameCount} frames over {analysis.Duration.TotalSeconds:F1}s, " +
                         $"median {analysis.MedianFrameTimeMs:F2} ms, " +
                         $"sensitivity floor {analysis.SensitivityFloorMs:F1} ms");
        output.WriteLine($"    {analysis.Events.Count} event(s)");

        foreach (var d in analysis.Diagnoses)
        {
            output.WriteLine($"    -> {d.Title} @ {d.Confidence.Value * 100:F0}% " +
                             $"(cap: {d.Confidence.BindingCap}, peak {d.Event.PeakFrameTimeMs:F0} ms)");
            foreach (var e in d.Evidence)
            {
                output.WriteLine($"         [{e.Role}] {e.Statement} " +
                                 $"(n={e.SampleCount}, {e.NativeRateHz:F1} Hz)");
            }
            foreach (var r in d.RuledOut)
            {
                output.WriteLine($"         ruled out: {r.Title} - {r.Reason}");
            }
        }

        analysis.Events.Count.ShouldBeGreaterThanOrEqualTo(expected.MinimumEvents,
            $"{scenario.Id}: too few events");
        analysis.Events.Count.ShouldBeLessThanOrEqualTo(expected.MaximumEvents,
            $"{scenario.Id}: too many events - a user would perceive fewer problems than this");

        if (!expected.ExpectStutter) return;

        if (expected.DiagnosisId is null)
        {
            // The unexplained case. Reporting a plausible cause here would be worse than
            // reporting none, because the user cannot check it.
            analysis.Diagnoses.ShouldAllBe(d => !d.IsExplained,
                $"{scenario.Id}: expected no cause to be identified");

            // But it must still be informative: an empty result is a retention killer.
            foreach (var d in analysis.Diagnoses)
            {
                d.RuledOut.Count(r => r.WasCheckable).ShouldBeGreaterThanOrEqualTo(3,
                    "an unexplained event must list what was ruled out");
            }
            return;
        }

        var explained = analysis.Diagnoses.Where(d => d.IsExplained).ToArray();
        explained.ShouldNotBeEmpty($"{scenario.Id}: expected a diagnosis");

        explained.ShouldContain(d => d.RuleId == expected.DiagnosisId,
            $"{scenario.Id}: expected '{expected.DiagnosisId}', got " +
            string.Join(", ", explained.Select(d => d.RuleId)));

        var match = explained.First(d => d.RuleId == expected.DiagnosisId);
        match.Confidence.Value.ShouldBeGreaterThanOrEqualTo(expected.MinimumConfidence);
        match.Confidence.Value.ShouldBeLessThanOrEqualTo(expected.MaximumConfidence,
            $"{scenario.Id}: overconfident. Evidence this weak must not produce this number.");

        match.Mechanism.ShouldNotBeNullOrWhiteSpace(
            "a diagnosis that names a number without naming a mechanism has failed");
    }

    [Fact]
    public void A_healthy_session_reports_nothing_at_all()
    {
        // The single most important test here. A tool that only proves itself by finding
        // something will find something.
        var scenario = ScenarioCatalog.ById("healthy");
        var analysis = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(scenario.Generate());

        analysis.Events.ShouldBeEmpty();
        analysis.StutterCount.ShouldBe(0);
        analysis.FrameCount.ShouldBeGreaterThan(10_000);
    }

    [Fact]
    public void Confidence_never_reaches_certainty_even_with_strong_agreeing_evidence()
    {
        var scenario = ScenarioCatalog.ById("gpu-thermal-throttle");
        var analysis = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(scenario.Generate());

        foreach (var d in analysis.Diagnoses)
        {
            d.Confidence.Value.ShouldBeLessThanOrEqualTo(0.97);
        }
    }

    [Fact]
    public void A_missing_sensor_caps_confidence_and_is_named_as_a_blind_spot()
    {
        // The CPU frequency-collapse scenario has no temperature sensor, which is the common
        // case without a kernel driver. The diagnosis must stay modest and say what it could
        // not check.
        var scenario = ScenarioCatalog.ById("cpu-frequency-collapse");
        var analysis = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(scenario.Generate());

        var collapse = analysis.Diagnoses.FirstOrDefault(d => d.RuleId == "cpu-frequency-collapse");
        collapse.ShouldNotBeNull();

        collapse.Confidence.Value.ShouldBeLessThanOrEqualTo(0.75);
        collapse.Confidence.MissingMetrics.ShouldContain("cpu.temperature");

        // And it must not claim heat.
        collapse.Mechanism.ShouldNotBeNull();
        collapse.Mechanism.ShouldContain("cannot be determined");
    }
}

using Xunit;
using FrameDoctor.Pipeline.Detection;
using Shouldly;

namespace FrameDoctor.Pipeline.Tests;

/// <summary>
/// Adversarial: excursions the display cannot show still reach the headline tally.
/// </summary>
/// <remarks>
/// The threshold floor is <c>max(3 ms, ½ × refreshInterval, ½ × median)</c>, and the comment on
/// it says the floor "encodes what is perceptible". Half a refresh interval is not perceptible:
/// a frame that finishes inside the refresh interval is on screen at the next refresh like every
/// other frame, and nothing is dropped or repeated.
/// </remarks>
public sealed class DetectorPerceptibilityTests
{
    /// <summary>
    /// A menu running at 1000 fps reports stutters the user cannot possibly have seen.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A 144 Hz display refreshes every 6.94 ms. This series runs at about 1000 fps with
    /// occasional 5 ms frames — five times the median, statistically glaring, and still shorter
    /// than one refresh. Every one of those frames is presented before the next refresh, so the
    /// user's experience is identical with and without them.
    /// </para>
    /// <para>
    /// The detector counts one toward the tally anyway. FrameDoctor exists to be the tool that
    /// does not manufacture problems, and its headline number is the first thing a user reads:
    /// "3 stutters" in a game menu is exactly the invented finding the product is positioned
    /// against.
    /// </para>
    /// </remarks>
    [Fact]
    public void An_excursion_shorter_than_one_refresh_interval_is_counted_as_a_stutter()
    {
        const double refreshHz = 144.0;
        const double refreshIntervalMs = 1000.0 / refreshHz;   // 6.94 ms

        var rng = new Random(7);
        var series = new List<double>();
        for (var i = 0; i < 6000; i++) series.Add(1.0 + (rng.NextDouble() * 0.2));

        // Excursions that the display cannot show: every one finishes inside a refresh interval.
        for (var i = 2000; i < 6000; i += 200) series[i] = 5.0;

        series.Max().ShouldBeLessThan(refreshIntervalMs);

        var events = DetectorHarness.Run(new StutterDetector(refreshHz), series);

        events.Count(e => e.CountsTowardTally).ShouldBe(
            0,
            "frames shorter than one refresh interval are reported to the user as stutters");
    }
}

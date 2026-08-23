using FrameDoctor.Abstractions.Time;
using FrameDoctor.Pipeline.Detection;

namespace FrameDoctor.Pipeline.Tests;

/// <summary>
/// Feeds a frame-time series through a detector, advancing the clock by each frame's duration.
/// </summary>
internal static class DetectorHarness
{
    public static IReadOnlyList<StutterEvent> Run(
        StutterDetector detector,
        IEnumerable<double> frameTimesMs)
    {
        var events = new List<StutterEvent>();
        var t = MonotonicTimestamp.Zero;

        foreach (var ft in frameTimesMs)
        {
            var e = detector.Add(t, ft);
            if (e is not null) events.Add(e);
            t += TimeSpan.FromMilliseconds(double.IsFinite(ft) && ft > 0 ? ft : 1.0);
        }

        events.AddRange(detector.Flush(t));
        return events;
    }

    /// <summary>Warm-up frames, then the payload, so detection is trusted when the payload lands.</summary>
    public static double[] AfterWarmUp(double[] warmUp, params double[] payload)
    {
        var combined = new double[warmUp.Length + payload.Length];
        warmUp.CopyTo(combined, 0);
        payload.CopyTo(combined, warmUp.Length);
        return combined;
    }

    /// <summary>Injects a hitch, then a recovery tail long enough to close the event.</summary>
    public static double[] WithHitch(double[] baseSeries, int atIndex, double hitchMs)
    {
        var v = (double[])baseSeries.Clone();
        v[atIndex] = hitchMs;
        return v;
    }
}

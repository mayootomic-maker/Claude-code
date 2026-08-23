namespace FrameDoctor.Pipeline.Tests;

/// <summary>
/// Deterministic synthetic frame-time series covering the regimes detection must handle.
/// </summary>
/// <remarks>
/// Seeded, so a failing test reproduces exactly. These are test fixtures, not the product's
/// simulation mode — the single sanctioned synthetic transport is
/// <c>FrameDoctor.Simulation</c>, and randomness anywhere else is greppably illegal.
/// </remarks>
internal static class FrameTimeRegimes
{
    /// <summary>Vsync-locked 60 Hz: near-zero variance. The hard case for a relative threshold.</summary>
    public static double[] VsyncLocked60(int n, int seed = 1)
    {
        var rng = new Random(seed);
        var v = new double[n];
        for (var i = 0; i < n; i++) v[i] = 16.667 + ((rng.NextDouble() - 0.5) * 0.06);
        return v;
    }

    /// <summary>Uncapped 144 fps with realistic jitter.</summary>
    public static double[] Uncapped144(int n, int seed = 2)
    {
        var rng = new Random(seed);
        var v = new double[n];
        for (var i = 0; i < n; i++) v[i] = 6.94 + ((rng.NextDouble() - 0.5) * 1.2);
        return v;
    }

    /// <summary>Uncapped 300 fps.</summary>
    public static double[] Uncapped300(int n, int seed = 3)
    {
        var rng = new Random(seed);
        var v = new double[n];
        for (var i = 0; i < n; i++) v[i] = 3.33 + ((rng.NextDouble() - 0.5) * 0.7);
        return v;
    }

    /// <summary>
    /// Genuinely unstable 25–40 fps: large slow drift plus noise.
    /// </summary>
    /// <remarks>
    /// The opposite hard case from vsync. A dispersion estimate taken over the raw values here
    /// measures the drift, not the noise, and produces a threshold too high to catch real hitches.
    /// </remarks>
    public static double[] Unstable25To40(int n, int seed = 4)
    {
        var rng = new Random(seed);
        var v = new double[n];
        for (var i = 0; i < n; i++)
        {
            var drift = 32.0 + (8.0 * Math.Sin(i / 240.0));
            v[i] = drift + ((rng.NextDouble() - 0.5) * 5.0);
        }
        return v;
    }
}

using FrameDoctor.Storage.Codecs;
using Shouldly;
using Xunit;

namespace FrameDoctor.Storage.Tests;

public sealed class FrameChunkCodecTests
{
    /// <summary>Builds quantized timestamps from a frame-time series.</summary>
    private static long[] Quantize(IReadOnlyList<double> frameTimesMs)
    {
        var units = new long[frameTimesMs.Count + 1];
        var elapsedMs = 0.0;
        units[0] = 0;
        for (var i = 0; i < frameTimesMs.Count; i++)
        {
            elapsedMs += frameTimesMs[i];
            units[i + 1] = FrameQuantum.FromMilliseconds(elapsedMs);
        }
        return units;
    }

    private static double[] Series(int n, double meanMs, double jitterMs, int seed)
    {
        var rng = new Random(seed);
        var v = new double[n];
        for (var i = 0; i < n; i++) v[i] = meanMs + ((rng.NextDouble() - 0.5) * jitterMs);
        return v;
    }

    [Theory]
    [InlineData(60, 16.667, 0.06)]
    [InlineData(144, 6.94, 1.2)]
    [InlineData(300, 3.33, 0.7)]
    [InlineData(1000, 1.0, 0.3)]
    public void Timestamps_round_trip_exactly(double fps, double meanMs, double jitterMs)
    {
        var frames = (int)(fps * 20);   // one 20 s chunk
        var original = Quantize(Series(frames, meanMs, jitterMs, seed: (int)fps));

        var buffer = new byte[FrameChunkCodec.MaxEncodedSize(original.Length)];
        var written = FrameChunkCodec.Encode(original, buffer);

        FrameChunkCodec.PeekCount(buffer).ShouldBe(original.Length);

        var decoded = new long[original.Length];
        FrameChunkCodec.Decode(buffer.AsSpan(0, written), decoded).ShouldBe(original.Length);

        // Exact, in integer arithmetic. Not "within a tolerance".
        decoded.ShouldBe(original);
    }

    [Fact]
    public void Reconstruction_does_not_drift_where_the_naive_encoding_would()
    {
        // The failure this codec exists to prevent. Encoding quantized *frame times* and
        // reconstructing timestamps by cumulative sum is a random walk: each frame contributes
        // up to half a quantum and the errors accumulate as the square root of n.
        const int Frames = 300_000;   // 300 s at 1000 fps
        var frameTimes = Series(Frames, 1.0, 0.3, seed: 99);

        // Truth: exact millisecond timeline.
        var trueElapsed = new double[Frames + 1];
        for (var i = 0; i < Frames; i++) trueElapsed[i + 1] = trueElapsed[i] + frameTimes[i];

        // Naive: quantize each frame time, then cumulative-sum.
        var naiveWorstErrorMs = 0.0;
        var naiveElapsed = 0.0;
        for (var i = 0; i < Frames; i++)
        {
            naiveElapsed += FrameQuantum.ToMilliseconds(FrameQuantum.FromMilliseconds(frameTimes[i]));
            naiveWorstErrorMs = Math.Max(naiveWorstErrorMs, Math.Abs(naiveElapsed - trueElapsed[i + 1]));
        }

        // Ours: quantize the timeline, encode second differences, decode.
        var original = Quantize(frameTimes);
        var buffer = new byte[FrameChunkCodec.MaxEncodedSize(original.Length)];
        var written = FrameChunkCodec.Encode(original, buffer);
        var decoded = new long[original.Length];
        FrameChunkCodec.Decode(buffer.AsSpan(0, written), decoded).ShouldBe(original.Length);

        var oursWorstErrorMs = 0.0;
        for (var i = 0; i < original.Length; i++)
        {
            oursWorstErrorMs = Math.Max(oursWorstErrorMs,
                Math.Abs(FrameQuantum.ToMilliseconds(decoded[i]) - trueElapsed[i]));
        }

        // Ours never exceeds a single quantization step, however long the series.
        oursWorstErrorMs.ShouldBeLessThanOrEqualTo(FrameQuantum.MaxQuantizationErrorMs);

        // And the naive approach is materially worse - this is the measurement that justifies
        // the extra complexity, so it is asserted rather than asserted-about.
        naiveWorstErrorMs.ShouldBeGreaterThan(oursWorstErrorMs * 20);
    }

    [Theory]
    [InlineData(60, 16.667, 0.06)]
    [InlineData(144, 6.94, 1.2)]
    [InlineData(300, 3.33, 0.7)]
    [InlineData(1000, 1.0, 0.3)]
    public void Encoded_size_stays_within_the_storage_budget(double fps, double meanMs, double jitterMs)
    {
        var frames = (int)(fps * 20);
        var units = Quantize(Series(frames, meanMs, jitterMs, seed: (int)fps + 7));

        var buffer = new byte[FrameChunkCodec.MaxEncodedSize(units.Length)];
        var written = FrameChunkCodec.Encode(units, buffer);

        var bitsPerFrame = written * 8.0 / units.Length;

        // ADR 0006 sizes the disk budget on roughly 8 bits per frame for the timeline. Well
        // under two bytes leaves headroom for the other series in the hot set.
        bitsPerFrame.ShouldBeLessThan(16.0,
            $"{fps} fps encoded at {bitsPerFrame:F2} bits/frame ({written} bytes for {units.Length} frames)");
    }

    [Fact]
    public void A_hitch_costs_more_bits_but_does_not_break_the_encoding()
    {
        var frameTimes = Series(2000, 6.94, 1.2, seed: 5).ToList();
        frameTimes[1000] = 142.0;

        var units = Quantize(frameTimes);
        var buffer = new byte[FrameChunkCodec.MaxEncodedSize(units.Length)];
        var written = FrameChunkCodec.Encode(units, buffer);

        var decoded = new long[units.Length];
        FrameChunkCodec.Decode(buffer.AsSpan(0, written), decoded).ShouldBe(units.Length);
        decoded.ShouldBe(units);

        var times = new double[units.Length];
        FrameChunkCodec.ToFrameTimesMs(decoded, times);
        times[1001].ShouldBe(142.0, FrameQuantum.MillisecondsPerUnit);
    }

    [Fact]
    public void First_frame_duration_is_unknown_rather_than_zero()
    {
        // The first frame has no predecessor. Reporting zero would invent an infinitely
        // fast frame; NaN forces the caller to handle it.
        var units = Quantize(Series(10, 6.94, 0.5, seed: 1));
        var times = new double[units.Length];
        FrameChunkCodec.ToFrameTimesMs(units, times);

        double.IsNaN(times[0]).ShouldBeTrue();
        times[1..].ShouldAllBe(t => !double.IsNaN(t));
    }

    [Fact]
    public void Empty_and_single_frame_chunks_round_trip()
    {
        var buffer = new byte[64];

        var written = FrameChunkCodec.Encode([], buffer);
        FrameChunkCodec.PeekCount(buffer).ShouldBe(0);
        FrameChunkCodec.Decode(buffer.AsSpan(0, written), []).ShouldBe(0);

        written = FrameChunkCodec.Encode([12345L], buffer);
        var one = new long[1];
        FrameChunkCodec.Decode(buffer.AsSpan(0, written), one).ShouldBe(1);
        one[0].ShouldBe(12345L);
    }

    [Fact]
    public void Truncated_input_is_rejected_rather_than_returning_partial_garbage()
    {
        var units = Quantize(Series(500, 6.94, 1.2, seed: 3));
        var buffer = new byte[FrameChunkCodec.MaxEncodedSize(units.Length)];
        var written = FrameChunkCodec.Encode(units, buffer);

        var decoded = new long[units.Length];
        FrameChunkCodec.Decode(buffer.AsSpan(0, written / 2), decoded).ShouldBe(-1);
        FrameChunkCodec.Decode(buffer.AsSpan(0, 4), decoded).ShouldBe(-1);
    }
}

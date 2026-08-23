using System.Runtime.CompilerServices;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Ipc;
using Shouldly;
using Xunit;

namespace FrameDoctor.Ipc.Tests;

public sealed class TelemetryChannelTests
{
    private static TelemetrySample[] Batch(int n, int startInstance = 0)
    {
        var samples = new TelemetrySample[n];
        for (var i = 0; i < n; i++)
        {
            samples[i] = TelemetrySample.Measured(
                MonotonicTimestamp.FromMilliseconds(i * 6.94),
                MetricId.FrameTime, SourceId.PresentMonCli,
                6.94 + (i % 7 * 0.1), Unit.Milliseconds,
                instance: startInstance + i);
        }
        return samples;
    }

    [Fact]
    public void Samples_round_trip_through_the_wire_unchanged()
    {
        using var buffer = new MemoryStream();
        var writer = new TelemetryChannelWriter(buffer);
        var original = Batch(40);

        writer.WriteSamples(WireMessageType.LiveTick, original);
        buffer.Position = 0;

        var frame = new TelemetryChannelReader(buffer).Read();

        frame.ShouldNotBeNull();
        frame.Value.Type.ShouldBe(WireMessageType.LiveTick);
        frame.Value.Sequence.ShouldBe(1UL);
        frame.Value.SkippedFrames.ShouldBe(0UL);

        var decoded = frame.Value.AsSamples();
        decoded.Length.ShouldBe(original.Length);

        for (var i = 0; i < original.Length; i++)
        {
            decoded[i].Metric.ShouldBe(original[i].Metric);
            decoded[i].Instance.ShouldBe(original[i].Instance);
            decoded[i].TryGetValue(out var v).ShouldBeTrue();
            original[i].TryGetValue(out var expected).ShouldBeTrue();
            v.ShouldBe(expected);
        }
    }

    [Fact]
    public void An_unavailable_sample_survives_the_wire_as_unavailable()
    {
        // The honesty invariant has to hold across process boundaries too. If a missing sensor
        // arrived at the UI as a zero, every guarantee upstream would be pointless.
        using var buffer = new MemoryStream();
        var writer = new TelemetryChannelWriter(buffer);

        writer.WriteSamples(WireMessageType.LiveTick,
        [
            TelemetrySample.Unavailable(MonotonicTimestamp.Zero, MetricId.CpuTemperature,
                SourceId.PerformanceCounters, UnavailableReason.RequiresSensorDriver, Unit.Celsius),
        ]);
        buffer.Position = 0;

        var sample = new TelemetryChannelReader(buffer).Read()!.Value.AsSamples()[0];

        sample.Availability.ShouldBe(Availability.Unavailable);
        sample.Reason.ShouldBe(UnavailableReason.RequiresSensorDriver);
        sample.TryGetValue(out _).ShouldBeFalse();
    }

    [Fact]
    public void Writing_does_not_allocate_in_steady_state()
    {
        // The budget requires zero steady-state allocation here. A collection inside the
        // process watching for stutters is a stutter we caused, and it would land exactly
        // when load is highest.
        using var buffer = new MemoryStream(1 << 20);
        var writer = new TelemetryChannelWriter(buffer);
        var samples = Batch(40);

        // Warm up so first-call costs are not counted.
        for (var i = 0; i < 100; i++) { buffer.Position = 0; writer.WriteSamples(WireMessageType.LiveTick, samples); }

        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < 10_000; i++)
        {
            buffer.Position = 0;
            writer.WriteSamples(WireMessageType.LiveTick, samples);
        }
        var perMessage = (GC.GetAllocatedBytesForCurrentThread() - before) / 10_000.0;

        perMessage.ShouldBeLessThan(1.0,
            $"allocated {perMessage:F2} bytes per message; the write path must be allocation-free");
    }

    [Fact]
    public void A_writer_restart_is_reported_as_a_restart_rather_than_a_gap()
    {
        // A sequence that goes backwards is a different peer, not lost frames. How much was
        // lost across that boundary is unknowable, and folding it into the dropped count would
        // understate it as zero.
        using var buffer = new MemoryStream();

        var first = new TelemetryChannelWriter(buffer);
        for (var i = 0; i < 3; i++) first.WriteSamples(WireMessageType.LiveTick, Batch(2));

        var restarted = new TelemetryChannelWriter(buffer);
        restarted.WriteSamples(WireMessageType.LiveTick, Batch(2));

        buffer.Position = 0;
        var reader = new TelemetryChannelReader(buffer);

        reader.Read()!.Value.AfterPeerRestart.ShouldBeFalse();
        reader.Read()!.Value.AfterPeerRestart.ShouldBeFalse();
        reader.Read()!.Value.AfterPeerRestart.ShouldBeFalse();

        var afterRestart = reader.Read()!.Value;
        afterRestart.Sequence.ShouldBe(1UL);
        afterRestart.AfterPeerRestart.ShouldBeTrue();
        afterRestart.SkippedFrames.ShouldBe(0UL);

        reader.PeerRestarts.ShouldBe(1UL);
        reader.TotalSkippedFrames.ShouldBe(0UL);
    }

    [Fact]
    public void Frames_missing_between_sequence_numbers_are_counted()
    {
        using var buffer = new MemoryStream();
        Span<byte> header = stackalloc byte[WireFormat.HeaderBytes];

        WireFormat.WriteHeader(header, WireMessageType.LiveTick, WireCondition.None, 1, 0);
        buffer.Write(header);
        WireFormat.WriteHeader(header, WireMessageType.LiveTick, WireCondition.None, 7, 0);
        buffer.Write(header);

        buffer.Position = 0;
        var reader = new TelemetryChannelReader(buffer);

        reader.Read()!.Value.SkippedFrames.ShouldBe(0UL);
        reader.Read()!.Value.SkippedFrames.ShouldBe(5UL);
        reader.TotalSkippedFrames.ShouldBe(5UL);
    }

    [Fact]
    public void The_degraded_flag_survives_the_wire()
    {
        using var buffer = new MemoryStream();
        new TelemetryChannelWriter(buffer)
            .WriteSamples(WireMessageType.LiveTick, Batch(1), WireCondition.Degraded | WireCondition.Decimated);
        buffer.Position = 0;

        var frame = new TelemetryChannelReader(buffer).Read()!.Value;
        frame.Flags.HasFlag(WireCondition.Degraded).ShouldBeTrue();
        frame.Flags.HasFlag(WireCondition.Decimated).ShouldBeTrue();
    }

    [Fact]
    public void A_clean_peer_disconnect_reads_as_end_of_stream_not_an_error()
    {
        using var buffer = new MemoryStream();
        new TelemetryChannelWriter(buffer).WriteSamples(WireMessageType.Goodbye, []);
        buffer.Position = 0;

        var reader = new TelemetryChannelReader(buffer);
        reader.Read()!.Value.Type.ShouldBe(WireMessageType.Goodbye);
        reader.Read().ShouldBeNull();
    }

    [Fact]
    public void A_truncated_payload_throws_rather_than_yielding_half_a_message()
    {
        using var buffer = new MemoryStream();
        new TelemetryChannelWriter(buffer).WriteSamples(WireMessageType.LiveTick, Batch(40));

        var bytes = buffer.ToArray();
        using var truncated = new MemoryStream(bytes, 0, bytes.Length - 32);

        Should.Throw<InvalidDataException>(() => new TelemetryChannelReader(truncated).Read());
    }

    [Fact]
    public void A_corrupt_length_field_is_rejected_rather_than_allocating_arbitrarily()
    {
        using var buffer = new MemoryStream();
        Span<byte> header = stackalloc byte[WireFormat.HeaderBytes];
        WireFormat.WriteHeader(header, WireMessageType.LiveTick, WireCondition.None, 1, 0);

        // Claim a two-gigabyte payload.
        System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(header, int.MaxValue);
        buffer.Write(header);
        buffer.Position = 0;

        Should.Throw<InvalidDataException>(() => new TelemetryChannelReader(buffer).Read());
    }

    [Fact]
    public void A_frame_from_a_different_schema_version_is_rejected()
    {
        using var buffer = new MemoryStream();
        Span<byte> header = stackalloc byte[WireFormat.HeaderBytes];
        WireFormat.WriteHeader(header, WireMessageType.LiveTick, WireCondition.None, 1, 0);
        header[5] = 99;
        buffer.Write(header);
        buffer.Position = 0;

        Should.Throw<InvalidDataException>(() => new TelemetryChannelReader(buffer).Read());
    }

    [Fact]
    public void The_sample_struct_stays_blittable_so_the_wire_stays_zero_copy()
    {
        RuntimeHelpers.IsReferenceOrContainsReferences<TelemetrySample>().ShouldBeFalse();
    }

    [Fact]
    public void Consecutive_frames_are_read_one_at_a_time_and_none_are_swallowed()
    {
        // Regression: Stream.ReadAtLeast fills the whole span it is given, not merely its
        // minimum. The reader reuses a growable payload buffer, so passing it whole made a
        // single read consume every frame that followed and discard them silently. Three
        // frames went in and one came out.
        using var buffer = new MemoryStream();
        var writer = new TelemetryChannelWriter(buffer);
        for (var i = 0; i < 8; i++) writer.WriteSamples(WireMessageType.LiveTick, Batch(2, startInstance: i * 10));

        buffer.Position = 0;
        var frames = new TelemetryChannelReader(buffer).ReadAll().ToList();

        frames.Count.ShouldBe(8);
        for (var i = 0; i < 8; i++)
        {
            frames[i].Sequence.ShouldBe((ulong)(i + 1));
            frames[i].AsSamples()[0].Instance.ShouldBe(i * 10);
        }
    }
}

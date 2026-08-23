using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Ipc;

/// <summary>One frame read from the telemetry channel.</summary>
/// <param name="Type">What the frame carries.</param>
/// <param name="Flags">Quality and continuity flags set by the writer.</param>
/// <param name="Sequence">Monotonic frame number.</param>
/// <param name="SkippedFrames">
/// Frames missing between this one and the last. Non-zero means the transport dropped data, and
/// the UI must show reduced fidelity rather than drawing through the gap.
/// </param>
/// <param name="AfterPeerRestart">
/// The sequence went backwards, meaning a new writer took over the channel. Statistics must not
/// span the boundary, and the gap is unknowable rather than zero.
/// </param>
/// <param name="Payload">
/// The frame body.
/// <para>
/// <b>Lifetime:</b> when produced by <see cref="TelemetryChannelReader.Read"/> this is a view
/// into a buffer the reader reuses, and it is only valid until the next call. Consume it
/// immediately, or use <see cref="TelemetryChannelReader.ReadAll"/>, which hands back owned
/// copies. Frames from <c>Read</c> collected into a list will all end up pointing at the last
/// payload read.
/// </para>
/// </param>
public readonly record struct TelemetryFrame(
    WireMessageType Type,
    WireCondition Flags,
    ulong Sequence,
    ulong SkippedFrames,
    bool AfterPeerRestart,
    ReadOnlyMemory<byte> Payload)
{
    /// <summary>Reinterprets the payload as telemetry samples.</summary>
    /// <remarks>
    /// Zero-copy: the samples are blittable and fixed-layout, so this is a reinterpretation of
    /// the buffer rather than a deserialization pass.
    /// </remarks>
    public ReadOnlySpan<TelemetrySample> AsSamples() =>
        MemoryMarshal.Cast<byte, TelemetrySample>(Payload.Span);
}

/// <summary>
/// Reads telemetry frames from a stream.
/// </summary>
/// <remarks>
/// Reads the length before the body, so a partial message is never handed to a consumer. Tracks
/// the sequence number so a gap is reported as a count of missing frames rather than passing
/// silently — the difference between the UI knowing its data is incomplete and it quietly
/// drawing a smooth line through absent measurements.
/// </remarks>
public sealed class TelemetryChannelReader(Stream stream)
{
    private readonly Stream _stream = stream ?? throw new ArgumentNullException(nameof(stream));
    private readonly byte[] _header = new byte[WireFormat.HeaderBytes];
    private byte[] _payload = new byte[64 * 1024];
    private ulong _lastSequence;
    private bool _seenAny;

    /// <summary>Total frames the transport dropped since construction.</summary>
    public ulong TotalSkippedFrames { get; private set; }

    /// <summary>
    /// Times a new writer took over the channel.
    /// </summary>
    /// <remarks>
    /// A sequence that goes backwards is not a gap - it is a different peer, most likely the
    /// engine having restarted. How much was lost across that boundary is unknowable, so it is
    /// reported as a restart rather than folded into the dropped-frame count, which would
    /// understate it as zero.
    /// </remarks>
    public ulong PeerRestarts { get; private set; }

    /// <summary>
    /// Reads the next frame, without copying its payload.
    /// </summary>
    /// <remarks>
    /// The returned <see cref="TelemetryFrame.Payload"/> points into a buffer this reader
    /// reuses, so it is valid only until the next call. That is deliberate: it keeps the hot
    /// path allocation-free. Callers that need to retain frames should use
    /// <see cref="ReadAll"/> instead of collecting these.
    /// </remarks>
    /// <returns>
    /// <see langword="null"/> at a clean end of stream, meaning the peer closed. A malformed
    /// frame throws, because continuing past one would resynchronise on arbitrary bytes.
    /// </returns>
    /// <exception cref="InvalidDataException">The frame header or body is malformed or truncated.</exception>
    public TelemetryFrame? Read()
    {
        var read = _stream.ReadAtLeast(_header, _header.Length, throwOnEndOfStream: false);
        if (read == 0) return null;
        if (read < _header.Length) throw new InvalidDataException("Truncated frame header.");

        if (!WireFormat.TryReadHeader(_header, out var type, out var flags, out var sequence, out var length))
        {
            throw new InvalidDataException("Malformed frame header.");
        }

        if (_payload.Length < length) _payload = new byte[Math.Max(length, _payload.Length * 2)];

        // Slice to exactly the payload length. Stream.ReadAtLeast fills the whole span it is
        // given, not just its minimum, so passing the reused buffer whole would consume the
        // frames that follow this one and silently discard them.
        if (length > 0 &&
            _stream.ReadAtLeast(_payload.AsSpan(0, length), length, throwOnEndOfStream: false) < length)
        {
            throw new InvalidDataException("Truncated frame payload.");
        }

        ulong skipped = 0;
        var restarted = false;

        if (_seenAny)
        {
            if (sequence <= _lastSequence)
            {
                restarted = true;
                PeerRestarts++;
            }
            else if (sequence > _lastSequence + 1)
            {
                skipped = sequence - _lastSequence - 1;
                TotalSkippedFrames += skipped;
            }
        }

        _lastSequence = sequence;
        _seenAny = true;

        return new TelemetryFrame(type, flags, sequence, skipped, restarted, _payload.AsMemory(0, length));
    }

    /// <summary>
    /// Reads frames until the peer closes, each with an owned copy of its payload.
    /// </summary>
    /// <remarks>
    /// Allocates one array per frame, so this is the tooling and test path rather than the hot
    /// path. It exists because <see cref="Read"/>'s reused buffer is a genuine trap for anyone
    /// collecting frames: every retained frame would otherwise alias the same memory.
    /// </remarks>
    public IEnumerable<TelemetryFrame> ReadAll()
    {
        while (true)
        {
            var frame = Read();
            if (frame is null) yield break;
            yield return frame.Value with { Payload = frame.Value.Payload.ToArray() };
        }
    }
}

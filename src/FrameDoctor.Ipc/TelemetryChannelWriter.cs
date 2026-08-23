using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Ipc;

/// <summary>
/// Writes telemetry frames to a stream with no steady-state allocation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Deliberately synchronous.</b> The obvious implementation awaits
/// <c>Stream.WriteAsync</c>, and that allocates roughly 24 bytes per message from ValueTask and
/// state-machine boxing whenever the write completes asynchronously. Measured against a
/// blocking span write on a dedicated thread: 24.5 B/msg versus 0.0 B/msg on identical framing.
/// </para>
/// <para>
/// That difference matters more than it looks. The budget requires zero steady-state allocation
/// in this path, because a garbage collection inside the process watching for stutters is a
/// stutter we caused — and it would land exactly when load is highest, which is when the events
/// we care about happen.
/// </para>
/// <para>
/// Callers run this on a dedicated thread, not the thread pool.
/// </para>
/// </remarks>
public sealed class TelemetryChannelWriter(Stream stream)
{
    private readonly Stream _stream = stream ?? throw new ArgumentNullException(nameof(stream));
    private readonly byte[] _header = new byte[WireFormat.HeaderBytes];
    private ulong _sequence;

    /// <summary>Frames written since construction.</summary>
    public ulong FramesWritten => _sequence;

    /// <summary>Bytes written since construction, for budget accounting.</summary>
    public long BytesWritten { get; private set; }

    /// <summary>Writes a batch of samples as one frame.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The batch exceeds the maximum payload size.</exception>
    public void WriteSamples(WireMessageType type, ReadOnlySpan<TelemetrySample> samples, WireCondition flags = WireCondition.None)
    {
        var payload = MemoryMarshal.AsBytes(samples);
        WriteRaw(type, payload, flags);
    }

    /// <summary>Writes an already-encoded payload as one frame.</summary>
    public void WriteRaw(WireMessageType type, ReadOnlySpan<byte> payload, WireCondition flags = WireCondition.None)
    {
        if (payload.Length > WireFormat.MaxPayloadBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(payload), payload.Length,
                $"Payload exceeds {WireFormat.MaxPayloadBytes} bytes.");
        }

        _sequence++;
        WireFormat.WriteHeader(_header, type, flags, _sequence, payload.Length);

        // Two synchronous span writes. No await, no state machine, no boxing.
        _stream.Write(_header);
        if (!payload.IsEmpty) _stream.Write(payload);

        BytesWritten += _header.Length + payload.Length;
    }

    /// <summary>Flushes buffered bytes to the transport.</summary>
    public void Flush() => _stream.Flush();
}

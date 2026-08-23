using System.Buffers.Binary;

namespace FrameDoctor.Ipc;

/// <summary>What a telemetry frame carries.</summary>
public enum WireMessageType : byte
{
    /// <summary>Aggregated telemetry for the live view, at the UI's refresh rate.</summary>
    LiveTick = 1,

    /// <summary>Full-resolution telemetry around a detected event.</summary>
    EventEvidence = 2,

    /// <summary>Source health: availability, dropped samples, degraded quality.</summary>
    SourceHealth = 3,

    /// <summary>Sent when the engine is shutting down cleanly.</summary>
    Goodbye = 4,
}

/// <summary>Conditions of a delivered frame: what the transport did to it on the way.</summary>
[Flags]
public enum WireCondition : ushort
{
    None = 0,

    /// <summary>
    /// Samples were dropped upstream of this frame.
    /// </summary>
    /// <remarks>
    /// Set when the bounded queue overflowed and the oldest entries were discarded. The UI must
    /// render reduced fidelity honestly rather than interpolating over the gap — a smooth line
    /// drawn through missing data is a fabricated measurement.
    /// </remarks>
    Degraded = 1 << 0,

    /// <summary>This frame follows a discontinuity; statistics must not span it.</summary>
    AfterDiscontinuity = 1 << 1,

    /// <summary>The payload is decimated rather than full resolution.</summary>
    Decimated = 1 << 2,
}

/// <summary>
/// The binary framing used on the telemetry channel.
/// </summary>
/// <remarks>
/// <para>
/// Length first, so a partial message is never handed downstream. A monotonic sequence number,
/// so a gap is <i>detected and reported</i> rather than silently interpolated over.
/// </para>
/// <para>
/// Layout, little-endian: <c>[int32 payloadLength][uint8 type][uint8 schemaVersion]
/// [uint16 flags][uint64 sequence]</c>, then the payload.
/// </para>
/// </remarks>
public static class WireFormat
{
    public const byte SchemaVersion = 1;

    /// <summary>payloadLength(4) + type(1) + schemaVersion(1) + flags(2) + sequence(8).</summary>
    public const int HeaderBytes = 16;

    /// <summary>
    /// Largest permitted payload.
    /// </summary>
    /// <remarks>
    /// Bounds a malformed length field so a corrupt header cannot make the reader allocate
    /// arbitrarily. Comfortably above the largest legitimate message, which is an event
    /// evidence bundle.
    /// </remarks>
    public const int MaxPayloadBytes = 4 * 1024 * 1024;

    /// <summary>Writes a frame header into <paramref name="destination"/>.</summary>
    public static void WriteHeader(
        Span<byte> destination, WireMessageType type, WireCondition flags, ulong sequence, int payloadLength)
    {
        BinaryPrimitives.WriteInt32LittleEndian(destination, payloadLength);
        destination[4] = (byte)type;
        destination[5] = SchemaVersion;
        BinaryPrimitives.WriteUInt16LittleEndian(destination[6..], (ushort)flags);
        BinaryPrimitives.WriteUInt64LittleEndian(destination[8..], sequence);
    }

    /// <summary>Reads a frame header.</summary>
    /// <returns><see langword="false"/> if the header is malformed.</returns>
    public static bool TryReadHeader(
        ReadOnlySpan<byte> source,
        out WireMessageType type,
        out WireCondition flags,
        out ulong sequence,
        out int payloadLength)
    {
        type = default;
        flags = default;
        sequence = 0;
        payloadLength = 0;

        if (source.Length < HeaderBytes) return false;

        payloadLength = BinaryPrimitives.ReadInt32LittleEndian(source);
        if (payloadLength < 0 || payloadLength > MaxPayloadBytes) return false;

        if (source[5] != SchemaVersion) return false;

        type = (WireMessageType)source[4];
        flags = (WireCondition)BinaryPrimitives.ReadUInt16LittleEndian(source[6..]);
        sequence = BinaryPrimitives.ReadUInt64LittleEndian(source[8..]);
        return true;
    }
}

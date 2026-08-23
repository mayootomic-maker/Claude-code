namespace FrameDoctor.Storage.Segments;

/// <summary>What a segment chunk holds.</summary>
public enum ChunkKind : byte
{
    /// <summary>Quantized frame timestamps, second-difference encoded.</summary>
    FrameTimeline = 1,

    /// <summary>Low-rate telemetry samples: counters and sensors.</summary>
    LowRateSamples = 2,

    /// <summary>Full-resolution telemetry around a detected event.</summary>
    EventWindow = 3,

    /// <summary>A break in the series across which statistics must not span.</summary>
    Discontinuity = 4,

    /// <summary>Closing record written at session finalize.</summary>
    SessionTrailer = 5,
}

/// <summary>
/// On-disk layout constants for a session segment file.
/// </summary>
/// <remarks>
/// <para>
/// Segment files are <b>never migrated</b>. Each carries its own format version, and readers
/// keep every version forever. That is the point of an append-only format: a schema change in
/// the catalog can never put a user's frame data out of reach.
/// </para>
/// <para>
/// Every chunk is length-prefixed and checksummed, so a torn final write — the expected
/// outcome of a power cut, since the session is not fsynced — costs the last flush interval and
/// nothing more. Recovery is to truncate at the last chunk that verifies.
/// </para>
/// </remarks>
public static class SegmentFormat
{
    /// <summary>Magic bytes: "FDSEG\0".</summary>
    public static ReadOnlySpan<byte> Magic => "FDSEG\0"u8;

    public const ushort CurrentVersion = 1;

    /// <summary>magic(6) + version(2) + uuid(16) + tickFrequency(8) + epochUtcTicks(8) + crc(4).</summary>
    public const int HeaderBytes = 6 + 2 + 16 + 8 + 8 + 4;

    /// <summary>payloadLength(4) + crc(4) + kind(1) + reserved(3) + startTicks(8) + count(4).</summary>
    public const int ChunkHeaderBytes = 4 + 4 + 1 + 3 + 8 + 4;

    /// <summary>
    /// Largest permitted chunk payload.
    /// </summary>
    /// <remarks>
    /// Bounds both a malformed length field and the largest single write we will issue. The
    /// performance budget caps a single write at 128 KB because a 256 KB buffered write was
    /// measured at up to 8.95 ms — long enough to be the stutter we exist to detect.
    /// </remarks>
    public const int MaxChunkPayloadBytes = 128 * 1024;
}

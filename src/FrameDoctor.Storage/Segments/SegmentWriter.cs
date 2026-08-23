using System.Buffers.Binary;
using System.IO.Hashing;

namespace FrameDoctor.Storage.Segments;

/// <summary>
/// Appends length-prefixed, checksummed chunks to a session segment file.
/// </summary>
/// <remarks>
/// <para>
/// One buffered write per flush and <b>no fsync during a session</b>. That is a deliberate
/// trade recorded in ADR 0006: fsync is the only call in the write path that blocks on the
/// device, measured at up to 2.84 ms, and a monitoring tool that stalls the disk is
/// contributing to the problem it is measuring. The cost of a power cut is bounded at one
/// flush interval of frame data, which is regenerable in the sense that it is telemetry about
/// a session that also died.
/// </para>
/// <para>
/// A single <see cref="FlushToDisk"/> happens at finalize.
/// </para>
/// </remarks>
public sealed class SegmentWriter : IDisposable, IAsyncDisposable
{
    private readonly FileStream _stream;
    private readonly byte[] _chunkHeader = new byte[SegmentFormat.ChunkHeaderBytes];

    private SegmentWriter(FileStream stream) => _stream = stream;

    /// <summary>Bytes written to this segment, for budget accounting.</summary>
    public long BytesWritten { get; private set; }

    /// <summary>Write calls issued, for budget accounting.</summary>
    public int WriteOperations { get; private set; }

    /// <summary>Creates a new segment file and writes its header.</summary>
    public static SegmentWriter Create(string path, Guid sessionId, long tickFrequency, DateTimeOffset epochUtc)
    {
        var stream = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.Write,
            Share = FileShare.Read,
            Options = FileOptions.SequentialScan,
            BufferSize = 64 * 1024,
        });

        var writer = new SegmentWriter(stream);
        writer.WriteHeader(sessionId, tickFrequency, epochUtc);
        return writer;
    }

    private void WriteHeader(Guid sessionId, long tickFrequency, DateTimeOffset epochUtc)
    {
        Span<byte> header = stackalloc byte[SegmentFormat.HeaderBytes];
        header.Clear();

        SegmentFormat.Magic.CopyTo(header);
        BinaryPrimitives.WriteUInt16LittleEndian(header[6..], SegmentFormat.CurrentVersion);
        sessionId.TryWriteBytes(header[8..24]);
        BinaryPrimitives.WriteInt64LittleEndian(header[24..], tickFrequency);
        BinaryPrimitives.WriteInt64LittleEndian(header[32..], epochUtc.UtcTicks);
        BinaryPrimitives.WriteUInt32LittleEndian(header[40..], Crc32.HashToUInt32(header[..40]));

        _stream.Write(header);
        BytesWritten += header.Length;
        WriteOperations++;
    }

    /// <summary>Appends one chunk.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The payload exceeds the maximum chunk size.</exception>
    public void WriteChunk(ChunkKind kind, long startTicks, int itemCount, ReadOnlySpan<byte> payload)
    {
        if (payload.Length > SegmentFormat.MaxChunkPayloadBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(payload), payload.Length,
                $"Chunk payload exceeds {SegmentFormat.MaxChunkPayloadBytes} bytes. " +
                "Split it: a single large write can stall the disk long enough to be the " +
                "stutter we are trying to detect.");
        }

        var header = _chunkHeader.AsSpan();
        header.Clear();

        BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(header[4..], Crc32.HashToUInt32(payload));
        header[8] = (byte)kind;
        BinaryPrimitives.WriteInt64LittleEndian(header[12..], startTicks);
        BinaryPrimitives.WriteInt32LittleEndian(header[20..], itemCount);

        _stream.Write(header);
        _stream.Write(payload);

        BytesWritten += header.Length + payload.Length;
        WriteOperations++;
    }

    /// <summary>Pushes buffered bytes to the operating system, without forcing them to the device.</summary>
    public void Flush() => _stream.Flush(flushToDisk: false);

    /// <summary>Forces bytes to the device. Called once, at finalize.</summary>
    public void FlushToDisk() => _stream.Flush(flushToDisk: true);

    public void Dispose()
    {
        _stream.Flush(flushToDisk: true);
        _stream.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        await _stream.FlushAsync().ConfigureAwait(false);
        await _stream.DisposeAsync().ConfigureAwait(false);
    }
}

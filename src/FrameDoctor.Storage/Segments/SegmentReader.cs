using System.Buffers.Binary;
using System.IO.Hashing;

namespace FrameDoctor.Storage.Segments;

/// <summary>Header of a session segment file.</summary>
public readonly record struct SegmentHeader(
    ushort Version,
    Guid SessionId,
    long TickFrequency,
    DateTimeOffset EpochUtc);

/// <summary>One chunk read back from a segment.</summary>
public sealed record SegmentChunk(
    ChunkKind Kind,
    long StartTicks,
    int ItemCount,
    byte[] Payload);

/// <summary>Why a segment stopped being readable.</summary>
public enum SegmentTermination
{
    /// <summary>Every byte in the file was consumed cleanly.</summary>
    Complete = 0,

    /// <summary>A chunk header or payload was cut short. The expected shape of a power cut.</summary>
    Truncated = 1,

    /// <summary>A chunk's payload did not match its checksum.</summary>
    ChecksumMismatch = 2,

    /// <summary>A chunk declared an implausible length.</summary>
    Malformed = 3,
}

/// <summary>Outcome of reading a segment.</summary>
/// <param name="Header">The file header.</param>
/// <param name="Chunks">Every chunk that verified, in order.</param>
/// <param name="Termination">Why reading stopped.</param>
/// <param name="GoodLength">
/// Byte offset of the end of the last chunk that verified. Truncating the file here yields a
/// valid segment.
/// </param>
public sealed record SegmentReadResult(
    SegmentHeader Header,
    IReadOnlyList<SegmentChunk> Chunks,
    SegmentTermination Termination,
    long GoodLength)
{
    public bool IsIntact => Termination == SegmentTermination.Complete;
}

/// <summary>
/// Reads a session segment, recovering everything that verifies.
/// </summary>
/// <remarks>
/// <para>
/// A partially-written segment is the <b>expected</b> outcome of a crash or a power cut, not an
/// exceptional one — the writer deliberately does not fsync during a session. So recovery is
/// the normal path, not an error path: read the longest prefix of chunks whose checksums hold,
/// report where that ended, and let the caller truncate.
/// </para>
/// <para>
/// No exception escapes for a damaged file. A user whose machine lost power mid-session should
/// still be able to open what was captured before it did.
/// </para>
/// </remarks>
public static class SegmentReader
{
    /// <summary>Reads a segment file, recovering the longest valid prefix.</summary>
    /// <exception cref="InvalidDataException">
    /// The file is not a segment at all, or its header is damaged. Distinct from a truncated
    /// body, which is recoverable and reported rather than thrown.
    /// </exception>
    public static SegmentReadResult Read(string path)
    {
        using var stream = File.OpenRead(path);
        return Read(stream);
    }

    /// <summary>Reads a segment from a stream.</summary>
    /// <summary>
    /// Reads only the header, to learn which session a file belongs to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// For the retention sweep, which has to decide whether a file on disk is an orphan left by
    /// an interrupted purge or the live segment of a session in progress. Matching on filename
    /// would be guessing; this asks the file.
    /// </para>
    /// <para>
    /// Returns null for anything that is not a segment, including a file whose header checksum
    /// fails. A file we cannot identify is one we must not delete — an unreadable header is a
    /// reason to leave it alone, not a licence to reclaim the space.
    /// </para>
    /// </remarks>
    public static SegmentHeader? TryReadHeader(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        var headerBytes = new byte[SegmentFormat.HeaderBytes];
        if (stream.ReadAtLeast(headerBytes, headerBytes.Length, throwOnEndOfStream: false)
            < headerBytes.Length)
        {
            return null;
        }

        if (!headerBytes.AsSpan(0, 6).SequenceEqual(SegmentFormat.Magic)) return null;

        var storedCrc = BinaryPrimitives.ReadUInt32LittleEndian(headerBytes.AsSpan(40));
        if (Crc32.HashToUInt32(headerBytes.AsSpan(0, 40)) != storedCrc) return null;

        return new SegmentHeader(
            BinaryPrimitives.ReadUInt16LittleEndian(headerBytes.AsSpan(6)),
            new Guid(headerBytes.AsSpan(8, 16)),
            BinaryPrimitives.ReadInt64LittleEndian(headerBytes.AsSpan(24)),
            new DateTimeOffset(BinaryPrimitives.ReadInt64LittleEndian(headerBytes.AsSpan(32)), TimeSpan.Zero));
    }

    /// <summary>Reads a file's header, or null when it is not a readable segment.</summary>
    public static SegmentHeader? TryReadHeader(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return TryReadHeader(stream);
        }
        catch (IOException)
        {
            // In use, most likely by the session writing it. Not an orphan.
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static SegmentReadResult Read(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        var headerBytes = new byte[SegmentFormat.HeaderBytes];
        if (stream.ReadAtLeast(headerBytes, headerBytes.Length, throwOnEndOfStream: false) < headerBytes.Length)
        {
            throw new InvalidDataException("File is shorter than a segment header.");
        }

        if (!headerBytes.AsSpan(0, 6).SequenceEqual(SegmentFormat.Magic))
        {
            throw new InvalidDataException("Not a FrameDoctor segment file.");
        }

        var storedCrc = BinaryPrimitives.ReadUInt32LittleEndian(headerBytes.AsSpan(40));
        if (Crc32.HashToUInt32(headerBytes.AsSpan(0, 40)) != storedCrc)
        {
            throw new InvalidDataException("Segment header checksum mismatch.");
        }

        var header = new SegmentHeader(
            BinaryPrimitives.ReadUInt16LittleEndian(headerBytes.AsSpan(6)),
            new Guid(headerBytes.AsSpan(8, 16)),
            BinaryPrimitives.ReadInt64LittleEndian(headerBytes.AsSpan(24)),
            new DateTimeOffset(BinaryPrimitives.ReadInt64LittleEndian(headerBytes.AsSpan(32)), TimeSpan.Zero));

        var chunks = new List<SegmentChunk>();
        var goodLength = (long)SegmentFormat.HeaderBytes;
        var termination = SegmentTermination.Complete;

        var chunkHeader = new byte[SegmentFormat.ChunkHeaderBytes];

        while (true)
        {
            var read = stream.ReadAtLeast(chunkHeader, chunkHeader.Length, throwOnEndOfStream: false);
            if (read == 0) break;                       // clean end of file
            if (read < chunkHeader.Length) { termination = SegmentTermination.Truncated; break; }

            var payloadLength = BinaryPrimitives.ReadInt32LittleEndian(chunkHeader);
            if (payloadLength < 0 || payloadLength > SegmentFormat.MaxChunkPayloadBytes)
            {
                termination = SegmentTermination.Malformed;
                break;
            }

            var expectedCrc = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(4));
            var kind = (ChunkKind)chunkHeader[8];
            var startTicks = BinaryPrimitives.ReadInt64LittleEndian(chunkHeader.AsSpan(12));
            var itemCount = BinaryPrimitives.ReadInt32LittleEndian(chunkHeader.AsSpan(20));

            var payload = new byte[payloadLength];
            if (stream.ReadAtLeast(payload, payloadLength, throwOnEndOfStream: false) < payloadLength)
            {
                termination = SegmentTermination.Truncated;
                break;
            }

            if (Crc32.HashToUInt32(payload) != expectedCrc)
            {
                termination = SegmentTermination.ChecksumMismatch;
                break;
            }

            chunks.Add(new SegmentChunk(kind, startTicks, itemCount, payload));
            goodLength += SegmentFormat.ChunkHeaderBytes + payloadLength;
        }

        return new SegmentReadResult(header, chunks, termination, goodLength);
    }

    /// <summary>
    /// Truncates a damaged segment to its last verifiable chunk.
    /// </summary>
    /// <returns>Bytes discarded.</returns>
    public static long Repair(string path, SegmentReadResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (result.IsIntact) return 0;

        var length = new FileInfo(path).Length;
        var discarded = length - result.GoodLength;
        if (discarded <= 0) return 0;

        using var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.None);
        stream.SetLength(result.GoodLength);
        stream.Flush(flushToDisk: true);
        return discarded;
    }
}

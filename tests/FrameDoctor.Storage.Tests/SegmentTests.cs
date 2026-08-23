using FrameDoctor.Storage.Segments;
using Shouldly;
using Xunit;

namespace FrameDoctor.Storage.Tests;

/// <summary>
/// Segment durability. A partially-written file is the expected outcome of a power cut, not an
/// exceptional one, so recovery is tested as the normal path.
/// </summary>
public sealed class SegmentTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-seg-").FullName;

    private string Path(string name) => System.IO.Path.Combine(_dir, name);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static byte[] Payload(int n, byte seed)
    {
        var b = new byte[n];
        for (var i = 0; i < n; i++) b[i] = (byte)(seed + i);
        return b;
    }

    [Fact]
    public void Chunks_round_trip_with_their_metadata()
    {
        var path = Path("ok.fdseg");
        var id = Guid.NewGuid();
        var epoch = DateTimeOffset.UtcNow;

        using (var w = SegmentWriter.Create(path, id, 10_000_000, epoch))
        {
            w.WriteChunk(ChunkKind.FrameTimeline, 1000, 3, Payload(64, 1));
            w.WriteChunk(ChunkKind.LowRateSamples, 2000, 7, Payload(128, 2));
            w.WriteChunk(ChunkKind.SessionTrailer, 3000, 0, []);
        }

        var result = SegmentReader.Read(path);

        result.IsIntact.ShouldBeTrue();
        result.Header.SessionId.ShouldBe(id);
        result.Header.TickFrequency.ShouldBe(10_000_000);
        result.Header.EpochUtc.UtcTicks.ShouldBe(epoch.UtcTicks);

        result.Chunks.Count.ShouldBe(3);
        result.Chunks[0].Kind.ShouldBe(ChunkKind.FrameTimeline);
        result.Chunks[0].StartTicks.ShouldBe(1000);
        result.Chunks[0].ItemCount.ShouldBe(3);
        result.Chunks[0].Payload.ShouldBe(Payload(64, 1));
        result.Chunks[2].Payload.ShouldBeEmpty();
    }

    [Fact]
    public void A_torn_final_write_recovers_everything_before_it()
    {
        // The power-cut case. The last chunk is lost; nothing earlier is.
        var path = Path("torn.fdseg");
        using (var w = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow))
        {
            for (var i = 0; i < 10; i++) w.WriteChunk(ChunkKind.FrameTimeline, i * 1000, 100, Payload(256, (byte)i));
        }

        // Cut the file mid-way through the final chunk.
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Write))
        {
            fs.SetLength(fs.Length - 100);
        }

        var result = SegmentReader.Read(path);

        result.IsIntact.ShouldBeFalse();
        result.Termination.ShouldBe(SegmentTermination.Truncated);
        result.Chunks.Count.ShouldBe(9);
        result.Chunks[8].Payload.ShouldBe(Payload(256, 8));

        var discarded = SegmentReader.Repair(path, result);
        discarded.ShouldBeGreaterThan(0);

        // After repair the file is clean and holds exactly what survived.
        var reread = SegmentReader.Read(path);
        reread.IsIntact.ShouldBeTrue();
        reread.Chunks.Count.ShouldBe(9);
    }

    [Fact]
    public void A_corrupted_payload_stops_reading_and_does_not_yield_bad_data()
    {
        var path = Path("bitrot.fdseg");
        using (var w = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow))
        {
            for (var i = 0; i < 5; i++) w.WriteChunk(ChunkKind.FrameTimeline, i * 1000, 10, Payload(64, (byte)i));
        }

        // Flip a bit inside the third chunk's payload.
        var bytes = File.ReadAllBytes(path);
        var thirdPayloadStart = SegmentFormat.HeaderBytes
            + (2 * (SegmentFormat.ChunkHeaderBytes + 64)) + SegmentFormat.ChunkHeaderBytes;
        bytes[thirdPayloadStart + 5] ^= 0xFF;
        File.WriteAllBytes(path, bytes);

        var result = SegmentReader.Read(path);

        result.Termination.ShouldBe(SegmentTermination.ChecksumMismatch);
        result.Chunks.Count.ShouldBe(2);   // the two good ones before it, and nothing after
    }

    [Fact]
    public void A_damaged_header_is_rejected_rather_than_producing_nonsense()
    {
        var path = Path("badheader.fdseg");
        using (var w = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow))
        {
            w.WriteChunk(ChunkKind.FrameTimeline, 0, 1, Payload(16, 1));
        }

        var bytes = File.ReadAllBytes(path);
        bytes[30] ^= 0xFF;                 // inside the header, covered by its checksum
        File.WriteAllBytes(path, bytes);

        Should.Throw<InvalidDataException>(() => SegmentReader.Read(path));
    }

    [Fact]
    public void A_file_that_is_not_a_segment_is_rejected_by_magic()
    {
        var path = Path("notours.bin");
        File.WriteAllBytes(path, new byte[256]);
        Should.Throw<InvalidDataException>(() => SegmentReader.Read(path));
    }

    [Fact]
    public void An_empty_session_still_produces_a_readable_segment()
    {
        var path = Path("empty.fdseg");
        using (var _ = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow)) { }

        var result = SegmentReader.Read(path);
        result.IsIntact.ShouldBeTrue();
        result.Chunks.ShouldBeEmpty();
    }

    [Fact]
    public void An_oversized_chunk_is_refused_rather_than_stalling_the_disk()
    {
        // A single 256 KB buffered write was measured at up to 8.95 ms - long enough to be
        // the stutter we exist to detect. The writer refuses rather than allowing it.
        var path = Path("big.fdseg");
        using var w = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow);

        Should.Throw<ArgumentOutOfRangeException>(() =>
            w.WriteChunk(ChunkKind.FrameTimeline, 0, 1, new byte[SegmentFormat.MaxChunkPayloadBytes + 1]));
    }

    [Fact]
    public void Write_accounting_supports_the_disk_budget()
    {
        // The budget is enforced by measurement, so the writer has to be able to report.
        var path = Path("accounting.fdseg");
        using var w = SegmentWriter.Create(path, Guid.NewGuid(), 10_000_000, DateTimeOffset.UtcNow);

        var before = w.WriteOperations;
        w.WriteChunk(ChunkKind.FrameTimeline, 0, 100, Payload(1024, 1));

        // One header write plus one payload write per chunk, and the file header at creation.
        w.WriteOperations.ShouldBe(before + 1);
        w.BytesWritten.ShouldBe(SegmentFormat.HeaderBytes + SegmentFormat.ChunkHeaderBytes + 1024);
    }
}

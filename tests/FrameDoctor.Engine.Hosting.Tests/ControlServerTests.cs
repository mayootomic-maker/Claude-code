using System.Buffers.Binary;
using System.Text;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Ipc.Control;
using FrameDoctor.Storage.Settings;
using Shouldly;
using Xunit;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// The serve loop, driven over an in-memory stream instead of a pipe.
/// </summary>
/// <remarks>
/// The question every test here asks is what a broken or hostile peer costs. A malformed message
/// should cost an error response; a malformed <i>frame</i> should cost the connection, because
/// there is no way to resynchronise a length-prefixed stream once a length is wrong.
/// </remarks>
public sealed class ControlServerTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-ctlsrv-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private ControlServer Server(out SettingsStore store)
    {
        store = new SettingsStore(Path.Combine(_dir, "settings.json"));
        return new ControlServer(new ControlHandler(store, "test-build"));
    }

    /// <summary>Feeds bytes in, runs the loop to completion, and reads the answers out.</summary>
    private async Task<List<ControlResponse>> Exchange(byte[] input, ControlServer? server = null)
    {
        server ??= Server(out _);

        using var incoming = new MemoryStream(input);
        using var outgoing = new MemoryStream();
        using var duplex = new SplitStream(incoming, outgoing);

        await server.ServeAsync(duplex, TestContext.Current.CancellationToken);

        outgoing.Position = 0;

        var responses = new List<ControlResponse>();
        while (true)
        {
            var (outcome, response) = await ControlFraming.ReadAsync(
                outgoing, ControlJson.Default.ControlResponse, TestContext.Current.CancellationToken);

            if (outcome is not ControlFraming.ReadOutcome.Message || response is null) break;
            responses.Add(response);
        }

        return responses;
    }

    private static async Task<byte[]> Requests(params ControlRequest[] requests)
    {
        using var stream = new MemoryStream();
        foreach (var request in requests)
        {
            await ControlFraming.WriteAsync(
                stream, request, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);
        }
        return stream.ToArray();
    }

    private static byte[] RawFrame(string payload)
    {
        var bytes = Encoding.UTF8.GetBytes(payload);
        var frame = new byte[4 + bytes.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame, bytes.Length);
        bytes.CopyTo(frame.AsSpan(4));
        return frame;
    }

    [Fact]
    public async Task Every_request_gets_exactly_one_answer_in_order()
    {
        var responses = await Exchange(await Requests(
            ControlRequest.For(1, ControlCommand.Ping),
            ControlRequest.For(2, ControlCommand.GetSettings),
            ControlRequest.For(3, ControlCommand.SetSetting, "retention-days", "30")));

        responses.Select(r => r.Id).ShouldBe([1, 2, 3]);
        responses.ShouldAllBe(r => r.Ok);
    }

    [Fact]
    public async Task A_closed_stream_ends_the_connection_quietly()
    {
        var server = Server(out _);

        (await Exchange([], server)).ShouldBeEmpty();
        server.ConnectionsRefused.ShouldBe(0);
    }

    [Fact]
    public async Task Malformed_json_is_answered_and_the_connection_continues()
    {
        // The framing held, so the stream is still aligned. Dropping the connection here would
        // make one bad message cost every message queued behind it.
        var bad = RawFrame("this is not json");
        var good = await Requests(ControlRequest.For(9, ControlCommand.Ping));

        var responses = await Exchange([.. bad, .. good]);

        responses.Count.ShouldBe(2);
        responses[0].Ok.ShouldBeFalse();
        responses[1].Id.ShouldBe(9);
        responses[1].Ok.ShouldBeTrue();
    }

    [Fact]
    public async Task A_bad_length_ends_the_connection_and_is_counted()
    {
        // No recovery is possible: the bytes after a wrong length could be anything, and
        // treating the next four as a header is how one malformed message becomes a sequence.
        var header = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, int.MaxValue);

        var server = Server(out _);
        var responses = await Exchange(
            [.. header, .. await Requests(ControlRequest.For(1, ControlCommand.Ping))], server);

        responses.ShouldBeEmpty();
        server.ConnectionsRefused.ShouldBe(1);
    }

    [Fact]
    public async Task A_truncated_frame_ends_the_connection_and_is_counted()
    {
        var frame = await Requests(ControlRequest.For(1, ControlCommand.Ping));

        var server = Server(out _);
        (await Exchange(frame[..(frame.Length - 3)], server)).ShouldBeEmpty();

        server.ConnectionsRefused.ShouldBe(1);
    }

    [Fact]
    public async Task A_change_made_over_the_channel_lands_in_the_file()
    {
        var server = Server(out var store);

        await Exchange(
            await Requests(ControlRequest.For(1, ControlCommand.SetSetting, "simulation", "true")),
            server);

        new SettingsStore(store.Path).Load().SimulationMode.ShouldBeTrue();
    }

    [Fact]
    public async Task A_refused_change_leaves_the_file_alone()
    {
        var server = Server(out var store);

        await Exchange(
            await Requests(ControlRequest.For(1, ControlCommand.SetSetting, "simulation", "maybe")),
            server);

        new SettingsStore(store.Path).Load().SimulationMode.ShouldBeFalse();
    }

    [Fact]
    public async Task Answered_requests_are_counted()
    {
        var server = Server(out _);

        await Exchange(await Requests(
            ControlRequest.For(1, ControlCommand.Ping),
            ControlRequest.For(2, ControlCommand.Ping)), server);

        server.RequestsAnswered.ShouldBe(2);
    }

    [Fact]
    public void The_control_pipe_is_a_different_pipe_from_the_telemetry_one()
    {
        // Multiplexing them would put a settings change behind a backlog of ten-hertz ticks,
        // and a change that takes effect a second late is a control that appears not to work.
        ControlServer.PipeNameFor("ada").ShouldBe("FrameDoctor.Control.ada");
        ControlServer.PipeNameFor("ada").ShouldNotBe("FrameDoctor.Telemetry.ada");
    }

    [Fact]
    public void The_server_refuses_to_be_built_without_a_handler()
    {
        Should.Throw<ArgumentNullException>(() => new ControlServer(null!));
    }

    /// <summary>Reads from one stream and writes to another, as a pipe would.</summary>
    private sealed class SplitStream(Stream read, Stream write) : Stream
    {
        public override bool CanRead => true;
        public override bool CanWrite => true;
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            read.Read(buffer, offset, count);

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            read.ReadAsync(buffer, cancellationToken);

        public override void Write(byte[] buffer, int offset, int count) =>
            write.Write(buffer, offset, count);

        public override ValueTask WriteAsync(
            ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default) =>
            write.WriteAsync(buffer, cancellationToken);

        public override void Flush() => write.Flush();

        public override Task FlushAsync(CancellationToken cancellationToken) =>
            write.FlushAsync(cancellationToken);

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();
    }
}

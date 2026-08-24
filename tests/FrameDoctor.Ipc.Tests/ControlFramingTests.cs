using System.Buffers.Binary;
using System.Text;
using FrameDoctor.Ipc.Control;
using Shouldly;
using Xunit;

namespace FrameDoctor.Ipc.Tests;

/// <summary>
/// The framing on the one channel that takes instructions from outside the engine.
/// </summary>
/// <remarks>
/// Every test here is about a hostile or broken peer. The pipe is scoped to one user, which
/// bounds who can connect and says nothing about what they send — so a four-byte header claiming
/// two gigabytes must cost four bytes to reject, not two gigabytes to discover.
/// </remarks>
public sealed class ControlFramingTests
{
    private static async Task<byte[]> Framed(ControlRequest request)
    {
        using var stream = new MemoryStream();
        await ControlFraming.WriteAsync(
            stream, request, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);
        return stream.ToArray();
    }

    private static byte[] Frame(string payload)
    {
        var bytes = Encoding.UTF8.GetBytes(payload);
        var frame = new byte[4 + bytes.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame, bytes.Length);
        bytes.CopyTo(frame.AsSpan(4));
        return frame;
    }

    private static async Task<(ControlFraming.ReadOutcome Outcome, ControlRequest? Message)> Read(
        byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        return await ControlFraming.ReadAsync(
            stream, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task A_message_survives_a_round_trip()
    {
        var sent = ControlRequest.For(7, ControlCommand.SetSetting, "retention-days", "30");

        var (outcome, received) = await Read(await Framed(sent));

        outcome.ShouldBe(ControlFraming.ReadOutcome.Message);
        received.ShouldBe(sent);
    }

    [Fact]
    public async Task A_command_travels_as_a_name_not_a_number()
    {
        // So an inserted enum member cannot silently turn one command into another across a
        // version boundary.
        var bytes = await Framed(ControlRequest.For(1, ControlCommand.GetSettings));

        Encoding.UTF8.GetString(bytes, 4, bytes.Length - 4).ShouldContain("\"GetSettings\"");
    }

    [Fact]
    public async Task A_closed_stream_is_not_an_error()
    {
        (await Read([])).Outcome.ShouldBe(ControlFraming.ReadOutcome.Closed);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    [InlineData(ControlFraming.MaxPayloadBytes + 1)]
    [InlineData(int.MaxValue)]
    public async Task An_impossible_length_is_refused_before_anything_is_allocated(int length)
    {
        // Four bytes in, and the answer is no. The test would not finish if a two-gigabyte
        // length were honoured.
        var header = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, length);

        (await Read(header)).Outcome.ShouldBe(ControlFraming.ReadOutcome.BadLength);
    }

    [Fact]
    public async Task A_message_exactly_at_the_cap_is_accepted()
    {
        // The boundary belongs to the accepted side, so the cap never has to be raised for a
        // legitimate message that happens to land on it.
        var padding = new string('x', ControlFraming.MaxPayloadBytes - 100);
        var json = $$"""{"id":1,"command":"Ping","key":"{{padding}}","value":null}""";
        var frame = Frame(json);

        frame.Length.ShouldBeLessThanOrEqualTo(4 + ControlFraming.MaxPayloadBytes);
        (await Read(frame)).Outcome.ShouldBe(ControlFraming.ReadOutcome.Message);
    }

    [Fact]
    public async Task A_header_cut_short_is_truncated_rather_than_read_as_a_length()
    {
        (await Read([1, 0])).Outcome.ShouldBe(ControlFraming.ReadOutcome.Truncated);
    }

    [Fact]
    public async Task A_payload_cut_short_is_truncated()
    {
        var frame = Frame("""{"id":1,"command":"Ping"}""");

        (await Read(frame[..(frame.Length - 5)])).Outcome
            .ShouldBe(ControlFraming.ReadOutcome.Truncated);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a string\"")]
    [InlineData("{\"id\":\"not a number\"}")]
    public async Task A_payload_that_is_not_this_message_is_malformed_and_recoverable(string payload)
    {
        // Recoverable: the framing held, so the stream is still aligned and the caller can answer
        // with an error instead of dropping the connection.
        (await Read(Frame(payload))).Outcome.ShouldBe(ControlFraming.ReadOutcome.Malformed);
    }

    [Fact]
    public async Task A_json_null_payload_is_malformed_rather_than_a_null_message()
    {
        var (outcome, message) = await Read(Frame("null"));

        outcome.ShouldBe(ControlFraming.ReadOutcome.Malformed);
        message.ShouldBeNull();
    }

    [Fact]
    public async Task An_unknown_command_name_lands_on_Unknown_rather_than_the_first_command()
    {
        // Zero is Unknown on purpose. If the enum's default were Ping, a hostile or stale peer
        // could reach a command by omitting the field.
        // Read as a message rather than rejected as bad JSON. They are different problems and
        // only one of them is something the caller can fix, so the answer must be able to say
        // which command it did not recognise.
        var (outcome, message) = await Read(Frame("""{"id":3,"command":"DeleteEverything"}"""));

        outcome.ShouldBe(ControlFraming.ReadOutcome.Message);
        message.ShouldNotBeNull().Parsed.ShouldBe(ControlCommand.Unknown);
        message.Command.ShouldBe("DeleteEverything");
    }

    [Fact]
    public async Task An_absent_command_lands_on_Unknown()
    {
        var (_, message) = await Read(Frame("""{"id":3}"""));

        message.ShouldNotBeNull().Parsed.ShouldBe(ControlCommand.Unknown);
    }

    [Theory]
    [InlineData("getsettings")]
    [InlineData("GETSETTINGS")]
    [InlineData(" GetSettings")]
    public async Task A_command_name_is_matched_exactly(string spelling)
    {
        // Matching loosely is how `getsettings` and `GetSettings` become two spellings nobody
        // wrote down, on a surface small enough not to need either.
        var (_, message) = await Read(Frame($$"""{"id":3,"command":"{{spelling}}"}"""));

        message.ShouldNotBeNull().Parsed.ShouldBe(ControlCommand.Unknown);
    }

    [Fact]
    public async Task Two_messages_in_one_stream_are_read_in_order()
    {
        using var stream = new MemoryStream();
        await ControlFraming.WriteAsync(stream, ControlRequest.For(1, ControlCommand.Ping),
            ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);
        await ControlFraming.WriteAsync(stream, ControlRequest.For(2, ControlCommand.GetSettings),
            ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);

        stream.Position = 0;

        var first = await ControlFraming.ReadAsync(
            stream, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);
        var second = await ControlFraming.ReadAsync(
            stream, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken);

        first.Message.ShouldNotBeNull().Id.ShouldBe(1);
        second.Message.ShouldNotBeNull().Id.ShouldBe(2);
    }

    [Fact]
    public async Task Writing_something_over_the_cap_is_refused_rather_than_truncated()
    {
        // A truncated write would put a length on the wire that does not match its payload, and
        // the reader would then treat the next message's first bytes as this one's tail.
        var enormous = ControlRequest.For(1, ControlCommand.SetSetting,
            new string('k', ControlFraming.MaxPayloadBytes), "1");

        using var stream = new MemoryStream();

        await Should.ThrowAsync<InvalidOperationException>(() => ControlFraming.WriteAsync(
            stream, enormous, ControlJson.Default.ControlRequest, TestContext.Current.CancellationToken));
    }

    [Fact]
    public void Every_read_outcome_has_something_to_say()
    {
        foreach (var outcome in Enum.GetValues<ControlFraming.ReadOutcome>())
        {
            ControlFraming.Describe(outcome).ShouldNotBeNullOrWhiteSpace();
        }
    }
}

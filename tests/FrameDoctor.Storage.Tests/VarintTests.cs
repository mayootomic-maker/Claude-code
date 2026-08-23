using FrameDoctor.Storage.Codecs;
using Shouldly;
using Xunit;

namespace FrameDoctor.Storage.Tests;

public sealed class VarintTests
{
    [Theory]
    [InlineData(0L)]
    [InlineData(1L)]
    [InlineData(-1L)]
    [InlineData(63L)]
    [InlineData(-64L)]
    [InlineData(long.MaxValue)]
    [InlineData(long.MinValue)]
    public void Signed_values_round_trip(long value)
    {
        Span<byte> buffer = stackalloc byte[Varint.MaxBytes];
        var written = Varint.WriteSigned(buffer, value);
        written.ShouldBe(Varint.SizeOfSigned(value));

        Varint.ReadSigned(buffer[..written], out var decoded).ShouldBe(written);
        decoded.ShouldBe(value);
    }

    [Fact]
    public void Small_magnitudes_cost_one_byte_in_both_directions()
    {
        // The property the whole encoding rests on: second differences cluster near zero,
        // and negative values must not cost ten bytes the way two's complement would.
        for (var v = -63; v <= 63; v++) Varint.SizeOfSigned(v).ShouldBe(1);
    }

    [Fact]
    public void Malformed_input_is_rejected_rather_than_looping_or_overflowing()
    {
        // Every byte has the continuation bit set: a decoder without a bound would run off
        // the end of the buffer or shift past 64 bits.
        var runaway = new byte[Varint.MaxBytes + 4];
        Array.Fill(runaway, (byte)0xFF);

        Varint.ReadUnsigned(runaway, out _).ShouldBe(0);
        Varint.ReadSigned(runaway, out _).ShouldBe(0);
    }

    [Fact]
    public void Truncated_input_is_rejected()
    {
        Span<byte> buffer = stackalloc byte[Varint.MaxBytes];
        var written = Varint.WriteSigned(buffer, long.MaxValue);
        Varint.ReadSigned(buffer[..(written - 1)], out _).ShouldBe(0);
    }
}

using System.Buffers.Binary;

namespace FrameDoctor.Storage.Encoding;

/// <summary>
/// LEB128 variable-length integers with zigzag mapping for signed values.
/// </summary>
/// <remarks>
/// Small magnitudes cost one byte, which is the entire point: the series we persist are second
/// differences of a smoothly-varying signal, so almost every value is near zero.
/// </remarks>
public static class Varint
{
    /// <summary>Largest number of bytes a 64-bit varint can occupy.</summary>
    public const int MaxBytes = 10;

    /// <summary>Maps a signed value onto an unsigned one that keeps small magnitudes small.</summary>
    /// <remarks>
    /// Two's complement would give -1 all 64 bits set and therefore ten varint bytes. Zigzag
    /// interleaves positive and negative so -1 becomes 1.
    /// </remarks>
    public static ulong ZigZagEncode(long value) => (ulong)((value << 1) ^ (value >> 63));

    public static long ZigZagDecode(ulong value) => (long)(value >> 1) ^ -(long)(value & 1);

    /// <summary>Writes an unsigned varint. Returns bytes written.</summary>
    public static int WriteUnsigned(Span<byte> destination, ulong value)
    {
        var i = 0;
        while (value >= 0x80)
        {
            destination[i++] = (byte)(value | 0x80);
            value >>= 7;
        }
        destination[i++] = (byte)value;
        return i;
    }

    /// <summary>Writes a signed varint via zigzag. Returns bytes written.</summary>
    public static int WriteSigned(Span<byte> destination, long value) =>
        WriteUnsigned(destination, ZigZagEncode(value));

    /// <summary>Reads an unsigned varint. Returns bytes consumed, or 0 if the input is truncated or malformed.</summary>
    public static int ReadUnsigned(ReadOnlySpan<byte> source, out ulong value)
    {
        value = 0;
        var shift = 0;

        for (var i = 0; i < source.Length && i < MaxBytes; i++)
        {
            var b = source[i];
            value |= (ulong)(b & 0x7F) << shift;

            if ((b & 0x80) == 0) return i + 1;

            shift += 7;
            if (shift >= 64) break;   // continuation past 64 bits is malformed
        }

        value = 0;
        return 0;
    }

    /// <summary>Reads a signed varint. Returns bytes consumed, or 0 if truncated or malformed.</summary>
    public static int ReadSigned(ReadOnlySpan<byte> source, out long value)
    {
        var read = ReadUnsigned(source, out var raw);
        value = read == 0 ? 0 : ZigZagDecode(raw);
        return read;
    }

    /// <summary>Bytes an unsigned varint will occupy.</summary>
    public static int SizeOfUnsigned(ulong value)
    {
        var n = 1;
        while (value >= 0x80) { value >>= 7; n++; }
        return n;
    }

    public static int SizeOfSigned(long value) => SizeOfUnsigned(ZigZagEncode(value));

    internal static void WriteInt32(Span<byte> destination, int value) =>
        BinaryPrimitives.WriteInt32LittleEndian(destination, value);

    internal static void WriteInt64(Span<byte> destination, long value) =>
        BinaryPrimitives.WriteInt64LittleEndian(destination, value);

    internal static int ReadInt32(ReadOnlySpan<byte> source) =>
        BinaryPrimitives.ReadInt32LittleEndian(source);

    internal static long ReadInt64(ReadOnlySpan<byte> source) =>
        BinaryPrimitives.ReadInt64LittleEndian(source);
}

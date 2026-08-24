using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace FrameDoctor.Ipc.Control;

/// <summary>
/// Length-prefixed framing for the control channel.
/// </summary>
/// <remarks>
/// <para>
/// Separate from <see cref="WireFormat"/>, and with a far smaller cap. Telemetry frames carry
/// event evidence and are allowed four megabytes; a control message carries a key and a value.
/// Sharing the telemetry cap here would mean a peer could make the engine allocate four megabytes
/// by writing four bytes, on the one channel that exists to take instructions from elsewhere.
/// </para>
/// <para>
/// Layout, little-endian: <c>[int32 payloadLength][payload]</c>, the payload being UTF-8 JSON.
/// </para>
/// </remarks>
public static class ControlFraming
{
    /// <summary>
    /// Largest control message.
    /// </summary>
    /// <remarks>
    /// Sixty-four kilobytes, which is roughly a thousand times the largest legitimate message.
    /// The margin is not generosity: it is there so the cap never becomes the thing that breaks a
    /// future command, because a cap that has to be raised under pressure gets raised too far.
    /// </remarks>
    public const int MaxPayloadBytes = 64 * 1024;

    public const int HeaderBytes = 4;

    /// <summary>Writes one message.</summary>
    public static async Task WriteAsync<T>(
        Stream stream,
        T message,
        System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(typeInfo);

        var payload = JsonSerializer.SerializeToUtf8Bytes(message, typeInfo);

        if (payload.Length > MaxPayloadBytes)
        {
            throw new InvalidOperationException(
                $"Control message is {payload.Length} bytes, over the {MaxPayloadBytes} limit.");
        }

        var frame = new byte[HeaderBytes + payload.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame, payload.Length);
        payload.CopyTo(frame.AsSpan(HeaderBytes));

        await stream.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Why a read did not produce a message.</summary>
    public enum ReadOutcome
    {
        /// <summary>A message was read.</summary>
        Message = 0,

        /// <summary>The peer closed the pipe. Not an error.</summary>
        Closed = 1,

        /// <summary>
        /// The length field was negative, zero, or over the cap.
        /// </summary>
        /// <remarks>
        /// Fatal to the connection rather than skippable. There is no way to resynchronise a
        /// length-prefixed stream after a bad length: the bytes that follow could be anything,
        /// and treating the next four of them as a header is how a malformed message becomes a
        /// sequence of them.
        /// </remarks>
        BadLength = 2,

        /// <summary>The frame ended mid-payload.</summary>
        Truncated = 3,

        /// <summary>The payload was not JSON, or not this message.</summary>
        /// <remarks>
        /// Recoverable: the framing held, so the stream is still aligned and the caller can
        /// answer with an error and keep going.
        /// </remarks>
        Malformed = 4,
    }

    /// <summary>
    /// Reads one message.
    /// </summary>
    /// <remarks>
    /// The length is validated <b>before</b> anything is allocated. A four-byte header claiming
    /// two gigabytes must cost four bytes to reject, not two gigabytes to discover.
    /// </remarks>
    public static async Task<(ReadOutcome Outcome, T? Message)> ReadAsync<T>(
        Stream stream,
        System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo,
        CancellationToken cancellationToken)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(typeInfo);

        var header = new byte[HeaderBytes];
        var read = await stream.ReadAtLeastAsync(
            header, HeaderBytes, throwOnEndOfStream: false, cancellationToken).ConfigureAwait(false);

        if (read == 0) return (ReadOutcome.Closed, null);
        if (read < HeaderBytes) return (ReadOutcome.Truncated, null);

        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 || length > MaxPayloadBytes) return (ReadOutcome.BadLength, null);

        var payload = new byte[length];
        read = await stream.ReadAtLeastAsync(
            payload, length, throwOnEndOfStream: false, cancellationToken).ConfigureAwait(false);

        if (read < length) return (ReadOutcome.Truncated, null);

        try
        {
            var message = JsonSerializer.Deserialize(payload, typeInfo);
            return message is null ? (ReadOutcome.Malformed, null) : (ReadOutcome.Message, message);
        }
        catch (JsonException)
        {
            // The framing held, so the stream is still aligned. The caller answers with an error
            // and keeps the connection.
            return (ReadOutcome.Malformed, null);
        }
    }

    /// <summary>What to tell a peer whose message could not be read.</summary>
    public static string Describe(ReadOutcome outcome) => outcome switch
    {
        ReadOutcome.BadLength =>
            $"The message length was not between 1 and {MaxPayloadBytes} bytes.",
        ReadOutcome.Truncated => "The message ended before it was complete.",
        ReadOutcome.Malformed => "The message was not valid JSON for this channel.",
        ReadOutcome.Closed => "The connection was closed.",
        _ => "The message was read.",
    };

    /// <summary>Encoding used on this channel, stated once rather than assumed at each call.</summary>
    public static Encoding Encoding => Encoding.UTF8;
}

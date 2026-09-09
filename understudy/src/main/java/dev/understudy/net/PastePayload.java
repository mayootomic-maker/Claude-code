package dev.understudy.net;

import dev.understudy.core.build.Quota;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

import java.util.ArrayList;
import java.util.List;

/**
 * A paste, on its way from a client to the server that will place it.
 *
 * This is the packet that makes "nobody needs operator" true. The client works
 * out what goes where — the design, the plot, the orientation, all the parts
 * that take the time and none that need a permission — and asks the server to
 * put it there. The server decides whether to, using its own rules, and does
 * the placing under its own authority. No player is given anything.
 *
 * Both sides read the same `Quota`, and the decode below is the first place it
 * applies. That is deliberate: a length prefix read off the wire is a number a
 * stranger chose, and allocating a list that size before checking it is how a
 * server is knocked over by one small packet. So the count is refused before a
 * single string is read.
 */
public record PastePayload(String dimension, int x, int y, int z,
                           int wide, int tall, int deep, List<String> commands)
        implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<PastePayload> TYPE =
            CustomPacketPayload.createType("understudy:paste");

    /** A dimension id is short. Anything longer is not one. */
    private static final int NAME_LIMIT = 128;
    /** A setblock with a long block state, with room to spare. */
    private static final int COMMAND_LIMIT = 512;

    public static final StreamCodec<RegistryFriendlyByteBuf, PastePayload> CODEC =
            StreamCodec.of(PastePayload::write, PastePayload::read);

    private static void write(RegistryFriendlyByteBuf buffer, PastePayload paste) {
        buffer.writeUtf(paste.dimension(), NAME_LIMIT);
        buffer.writeVarInt(paste.x());
        buffer.writeVarInt(paste.y());
        buffer.writeVarInt(paste.z());
        buffer.writeVarInt(paste.wide());
        buffer.writeVarInt(paste.tall());
        buffer.writeVarInt(paste.deep());
        buffer.writeVarInt(paste.commands().size());
        for (String command : paste.commands()) buffer.writeUtf(command, COMMAND_LIMIT);
    }

    private static PastePayload read(RegistryFriendlyByteBuf buffer) {
        String dimension = buffer.readUtf(NAME_LIMIT);
        int x = buffer.readVarInt();
        int y = buffer.readVarInt();
        int z = buffer.readVarInt();
        int wide = buffer.readVarInt();
        int tall = buffer.readVarInt();
        int deep = buffer.readVarInt();
        int count = buffer.readVarInt();
        // Checked before anything is allocated. The alternative is trusting a
        // number a stranger wrote to size a list, which is the cheapest way
        // there is to take a server down from a client.
        if (count < 0 || count > Quota.MOST_COMMANDS) {
            throw new IllegalArgumentException("paste claims " + count + " commands");
        }
        List<String> commands = new ArrayList<>(Math.min(count, 1024));
        for (int i = 0; i < count; i++) commands.add(buffer.readUtf(COMMAND_LIMIT));
        return new PastePayload(dimension, x, y, z, wide, tall, deep, List.copyOf(commands));
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}

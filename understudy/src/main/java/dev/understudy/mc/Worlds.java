package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;

/**
 * Which world this is.
 *
 * One question, in one file, because it is the only thing the mod asks that has
 * no good answer from anything it already touches — and because the names
 * involved are the sort that move between versions, so when one of them does,
 * this is the whole of the fix.
 *
 * It has to be right rather than approximately right. The atlas is keyed on it,
 * and an atlas that answers a question about the wrong world is not a slightly
 * worse atlas: it is a map that confidently sends you to a vein of iron in a
 * world you have never played, which is worse than no map at all.
 */
public final class Worlds {
    private Worlds() {}

    /**
     * A stable name for the world the player is standing in.
     *
     * The save name in single player, the server address in multiplayer, and
     * the dimension either way — the nether and the overworld of one save are
     * as different for this purpose as two saves are.
     */
    public static String key(Minecraft client) {
        if (client.level == null) return "unknown";
        // The key's own toString rather than its identifier, because the
        // accessor that returns one is renamed in this version and guessing at
        // it costs a build. It is stable within a version, which is all this
        // needs to be — and when the jar names the real accessor, this is the
        // one line that changes.
        return where(client) + "-" + client.level.dimension();
    }

    private static String where(Minecraft client) {
        if (client.getSingleplayerServer() != null) {
            return "local." + client.getSingleplayerServer().getWorldData().getLevelName();
        }
        ServerData server = client.getCurrentServer();
        return server == null ? "unknown" : "server." + server.ip;
    }
}

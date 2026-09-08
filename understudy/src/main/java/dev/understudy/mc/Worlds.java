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
        // identifier(), not location(): ResourceLocation became Identifier in
        // this version and the accessor that returns one was renamed with it.
        return where(client) + "-" + client.level.dimension().identifier().getPath();
    }

    private static String where(Minecraft client) {
        if (client.getSingleplayerServer() != null) {
            return "local." + client.getSingleplayerServer().getWorldData().getLevelName();
        }
        ServerData server = client.getCurrentServer();
        return server == null ? "unknown" : "server." + server.ip;
    }

    /**
     * Whether this world has a sky, and therefore a night to sleep through.
     *
     * Asked because getSkyDarken answers in the Nether too, and answers
     * "dark" — there is no sky light down there at all. So the sleep rule read
     * a permanent midnight, went looking for a bed, and a bed in the Nether is
     * a bomb. It is the one thing about the place that will kill you for doing
     * the ordinary thing.
     */
    public static boolean hasASky(net.minecraft.world.level.Level level) {
        String where = level.dimension().identifier().getPath();
        return !where.equals("the_nether") && !where.equals("the_end");
    }

    /** Whether this is the Nether, which changes what is safe rather than only where you are. */
    public static boolean inTheNether(net.minecraft.world.level.Level level) {
        return level.dimension().identifier().getPath().equals("the_nether");
    }
}

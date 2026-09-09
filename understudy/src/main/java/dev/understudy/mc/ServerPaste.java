package dev.understudy.mc;

import dev.understudy.net.PastePayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;

import java.util.List;

/**
 * Asking the server to place a paste, where the server is willing to.
 *
 * The willingness is not assumed and not configured: Fabric tells each side
 * which payloads the other declared a receiver for, so `available` is a fact
 * about this connection rather than a setting anybody has to find. A server
 * with the jar answers yes and the paste goes over in one packet; a server
 * without it answers no and nothing is sent, so this costs nothing and says
 * nothing on the servers where it does not apply.
 *
 * Worth being clear about what this is not. It is not a way round a
 * permission. The server decides, using rules it holds and this cannot see —
 * see `core.build.Quota` for what those are — and if it refuses, it says so to
 * the player. What it removes is the need for anybody to *hold* the permission
 * personally, which was the whole problem: operator is every command on the
 * server, and giving it to somebody so they can put up a shed is not a trade
 * worth making.
 */
final class ServerPaste {

    private ServerPaste() {}

    /** Whether this server declared it will take one. */
    static boolean available() {
        // If the channel never registered on this side there is nothing to ask
        // with, and asking would be the second half of the same crash.
        if (!dev.understudy.server.UnderstudyServer.ready()) return false;
        try {
            return ClientPlayNetworking.canSend(PastePayload.TYPE);
        } catch (RuntimeException notConnected) {
            // canSend throws rather than returning false when there is no play
            // connection at all, which is a state this is asked in during the
            // moment between worlds.
            return false;
        }
    }

    static void send(String dimension, int x, int y, int z,
                     int wide, int tall, int deep, List<String> commands) {
        ClientPlayNetworking.send(new PastePayload(
                dimension, x, y, z, wide, tall, deep, List.copyOf(commands)));
    }
}

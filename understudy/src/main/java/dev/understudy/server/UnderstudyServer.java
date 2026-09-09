package dev.understudy.server;

import dev.understudy.core.build.Quota;
import dev.understudy.net.PastePayload;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The half of this mod that runs on the server, so that no player has to be an
 * operator.
 *
 * Everything else here is client-side and stays that way. This exists for one
 * problem it cannot solve from a client: a block only exists once the server
 * agrees to it, and a server agrees to a conjured one only from an operator.
 * Handing operator to everyone who wants to build a shed is not a trade
 * anybody should make — it is every command on the server, and a group who all
 * have it is a group where one bad afternoon cannot be undone.
 *
 * So the permission stays where it was and the work moves. A client sends what
 * it wants placed; this decides whether that is allowed and does the placing
 * itself. Nobody is promoted. Whoever runs the server drops the same jar in
 * their mods folder once, and which players install the client half remains
 * entirely their own business — somebody who wants nothing to do with it
 * installs nothing and notices nothing.
 *
 * What keeps that from being operator by another name is `Quota`, which is
 * tested away from the game: blocks only, a bounded region, a bounded number
 * of commands, and a cooldown. Every refusal goes back to the player who tried
 * it, and every paste that happens is written to the server log with a name and
 * a place, because a thing that edits the world silently is a thing nobody can
 * hold anybody to.
 */
public final class UnderstudyServer implements ModInitializer {

    /**
     * Last paste per player, by tick.
     *
     * Not persisted. A restart forgiving a cooldown is not worth a file, and
     * the entry costs two longs for somebody who has actually pasted.
     */
    private static final Logger LOGGER = LoggerFactory.getLogger("understudy");

    private final Map<UUID, Long> lastPaste = new HashMap<>();

    /**
     * Whether the channel came up, so the client half can stop asking if not.
     */
    private static volatile boolean ready;

    public static boolean ready() {
        return ready;
    }

    @Override
    public void onInitialize() {
        // Everything here is inside a catch, and that is not laziness.
        //
        // This entrypoint runs on the client too — it is the one that runs on
        // both, which is why the payload is registered from it rather than
        // twice. Which means anything that throws in here does not break a
        // feature, it stops Minecraft from starting, for somebody who was
        // never going to use the server half in the first place. A whole game
        // that will not launch is a far worse failure than a paste that has to
        // take the long way.
        //
        // It is said loudly rather than swallowed. A channel that quietly
        // failed to register looks exactly like a server that does not have
        // the mod, and those want completely different things done about them.
        try {
            // Registered from the entrypoint that runs on both sides, so the
            // type exists exactly once whichever half is loaded. Doing it in
            // each half registers it twice on a client, which throws.
            PayloadTypeRegistry.serverboundPlay().register(PastePayload.TYPE, PastePayload.CODEC);
            ServerPlayNetworking.registerGlobalReceiver(PastePayload.TYPE,
                    (paste, context) -> placeSafely(context.server(), context.player(), paste));
            ready = true;
        } catch (Throwable failed) {
            ready = false;
            LOGGER.error("[understudy] the paste channel would not register, so this "
                    + "server cannot place pastes for anyone. Everything else still works.",
                    failed);
        }
    }

    private void place(MinecraftServer server, ServerPlayer who, PastePayload paste) {
        // The overworld's game time rather than a tick counter on the server:
        // it is the clock the rest of this mod already measures cooldowns
        // against, and it is there on every server whatever else is not.
        long now = server.overworld().getGameTime();
        long since = now - lastPaste.getOrDefault(who.getUUID(), Long.MIN_VALUE / 2);

        Quota.Verdict verdict = Quota.check(
                paste.wide(), paste.tall(), paste.deep(), paste.commands(), since);
        if (!verdict.allowed()) {
            who.sendSystemMessage(Component.literal("paste refused: " + verdict.why()));
            return;
        }

        ServerLevel level = levelNamed(server, paste.dimension());
        if (level == null) {
            who.sendSystemMessage(Component.literal(
                    "paste refused: this server has no " + paste.dimension()));
            return;
        }

        lastPaste.put(who.getUUID(), now);
        // Logged before it happens rather than after, so a paste that stalls
        // the server still says who asked for it.
        server.sendSystemMessage(Component.literal(
                "[understudy] " + who.getName().getString() + " pasted "
                        + paste.wide() + "x" + paste.tall() + "x" + paste.deep()
                        + " at " + paste.x() + " " + paste.y() + " " + paste.z()
                        + " in " + paste.dimension()
                        + " (" + paste.commands().size() + " commands)"));

        // The console's own source rather than the player's, which is the whole
        // point: the authority is the server's, and the player is never given
        // any of it. Output suppressed or a big paste is a thousand lines of
        // "Changed the block" in everybody's chat.
        CommandSourceStack source = server.createCommandSourceStack()
                .withSuppressedOutput()
                .withLevel(level);
        int done = 0;
        for (String command : paste.commands()) {
            // Checked again here, one line at a time. Quota.check already
            // walked the list, and this is cheap next to running the command —
            // the cost of being wrong once is somebody else's server.
            if (!Quota.placesABlock(command)) continue;
            server.getCommands().performPrefixedCommand(source, "/" + command);
            done++;
        }
        who.sendSystemMessage(Component.literal("pasted — " + done + " commands"));
    }

    /** Guarded the same way, for the same reason: a bad paste is not a crash. */
    private void placeSafely(MinecraftServer server, ServerPlayer who, PastePayload paste) {
        try {
            place(server, who, paste);
        } catch (Throwable failed) {
            LOGGER.error("[understudy] a paste from {} failed part way through",
                    who.getName().getString(), failed);
            who.sendSystemMessage(Component.literal(
                    "that paste failed part way through — the server log says why"));
        }
    }

    /**
     * The level with this id, or null.
     *
     * Walked rather than looked up, because building a dimension key from a
     * string means naming classes that move between versions, and the list of
     * levels is four entries on almost every server.
     */
    private static ServerLevel levelNamed(MinecraftServer server, String dimension) {
        for (ServerLevel level : server.getAllLevels()) {
            if (level.dimension().identifier().toString().equals(dimension)) return level;
        }
        return null;
    }
}

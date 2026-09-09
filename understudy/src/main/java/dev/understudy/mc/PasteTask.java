package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Paste;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Puts a whole building into the world at once, with no materials and no walking.
 *
 * The honest shape of the problem first, because it decides everything else. A
 * client mod cannot make a block appear. The server owns the world; a placement
 * it did not authorise did not happen, and there is no packet that means "here
 * are six hundred blocks, have them". So a paste is not the mod writing to the
 * world — it is the mod asking the server to, in the only language the server
 * already understands, which is its own commands.
 *
 * That gives two routes and no others:
 *
 *  - **Your own world.** The server is in this process, so the commands go
 *    straight to its dispatcher under the console's own authority. That is
 *    permission four whether or not cheats are switched on, which is why this
 *    works in a survival world you never enabled cheats in.
 *  - **Somebody's server.** They go as you, and land only if you may run
 *    setblock there — which means being an operator.
 *
 * And operator is not a thing to ask a friend for so you can put up a shed. It
 * is every command on the server, and a group of people who all have it is a
 * group where one bad afternoon is unrecoverable. So without it, in creative,
 * the paste is not refused — it is *built*, walked up block by block at instant
 * speed, which needs no permission at all because placing a block is what a
 * player does and creative supplies the blocks.
 *
 * In survival without the permission there is no third route and this does not
 * invent one. The server owns the world and it owns your inventory: a command
 * needs the permission, a placement needs the item, and the count of items is
 * the server's. See buildInstead for what is said instead.
 *
 * The permission is worked out before anything is sent. The client is told its
 * own permissions at login, so on a server where you are not an operator
 * nothing is attempted, no red refusal appears in your chat, and the build
 * simply begins. Where the permission is there it is still only a maybe — a
 * plugin, a claim or a plot world can refuse setblock from someone the server
 * calls an operator — so one real block is set and looked at, once, and a
 * refusal is remembered for as long as you are in that world.
 *
 * Rate. In your own world there is no packet and no limit, so it goes in one
 * go. On a server every command is a packet and servers kick for sending too
 * many, so they are paced. A manor is about 560 commands and lands in a few
 * seconds, which is not the single frame the word promises and is close enough
 * to be worth the honesty.
 */
public final class PasteTask {

    /**
     * Commands per tick on somebody else's server.
     *
     * Deliberately timid. Vanilla tracks command spam and disconnects for it,
     * and being kicked halfway through leaves a half-built house and no
     * explanation. Eight a tick is a hundred and sixty a second, which puts any
     * of these designs in within a few seconds.
     */
    private static final int PER_TICK_REMOTE = 8;
    /** In your own world there is no packet to spam, so there is no reason to wait. */
    private static final int PER_TICK_LOCAL = 4096;
    /** How long to give the server to answer the probe before believing it. */
    private static final int PROBE_TICKS = 20;

    /**
     * What the server last said about whether commands from here land.
     *
     * Cached per world so the one-block question is asked once rather than
     * before every paste, and so the second paste on a server where you are not
     * an operator goes straight to building with nothing sent at all.
     */
    private enum Allowed { UNKNOWN, YES, NO }

    private final Minecraft client;
    private final Consumer<String> report;
    /**
     * Where a paste goes when commands are not available: the ordinary builder.
     *
     * Held as a callback rather than a BuildTask because the fallback is not
     * only "build it" — it is the whole gather-then-build flow, which knows to
     * skip the gathering in creative and to go shopping in survival. That
     * decision already lives in one place and should not live in two.
     */
    private final java.util.function.BiConsumer<Blueprint, BlockPos> otherwise;

    private Allowed allowed = Allowed.UNKNOWN;
    private String verdictFor = "";

    private List<String> commands = List.of();
    private int next;
    private boolean running;
    private String what = "";

    /**
     * The one command sent first, to find out whether any of them will work.
     *
     * Asking the server whether you have permission is not a thing a client can
     * do reliably, but doing one and looking is. It goes at a block the paste
     * is about to overwrite anyway, so a permitted paste costs nothing and a
     * refused one changes nothing.
     */
    /**
     * What has been pasted this session, newest last.
     *
     * Six numbers and a dimension each, which is all an undo needs: the box a
     * paste occupies is the box it cleared, so taking it away is the same fill
     * that made room for it. Kept as a stack because pasting three things and
     * being able to remove only the third would be a strange kind of undo.
     *
     * It does not put back what was there before. That was never recorded and
     * recording it would be a copy of every block in the box; what an undo does
     * is remove the building, and it says so rather than implying more.
     */
    private record Pasted(String what, String dimension, int x, int y, int z,
                          int wide, int tall, int deep) {}

    private final java.util.ArrayDeque<Pasted> done = new java.util.ArrayDeque<>();

    private BlockPos probe;
    private BlockState probeWas;
    private int probeTicks = -1;
    /** Kept only so a refused probe can hand the same plan to the builder. */
    private Blueprint pending;
    private BlockPos pendingAt;

    public PasteTask(Minecraft client, Consumer<String> report,
                     java.util.function.BiConsumer<Blueprint, BlockPos> otherwise) {
        this.client = client;
        this.report = report;
        this.otherwise = otherwise;
    }

    /** How many pastes back it can go. Longer than anyone undoes in one sitting. */
    private static final int REMEMBERED = 32;

    public boolean running() {
        return running;
    }

    /**
     * Take the last paste away again.
     *
     * The same route as putting it there, because it is the same kind of work:
     * the server does it, or nobody does. Only a paste that actually went
     * through commands is recorded, so an undo is only ever offered for
     * something that can be undone — a paste that fell back to being built has
     * no entry here, and comes down the way anything built comes down.
     */
    public void undo() {
        if (running) {
            stop("stopped the paste that was running");
            return;
        }
        if (done.isEmpty()) {
            report.accept("nothing pasted this session to undo — anything built block "
                    + "by block comes down the same way");
            return;
        }
        if (local() == null && (client.player == null || !mayCommand(client.player))) {
            // Only a paste that went through commands is ever recorded, so
            // reaching here means the permission was taken away in between.
            report.accept("this server will not run fill for you any more — "
                    + "what was pasted has to come down by hand");
            return;
        }
        Pasted last = done.peekLast();
        if (!last.dimension().equals(dimension())) {
            report.accept("the last paste was in " + last.dimension() + " — go there to undo it");
            return;
        }
        done.removeLast();

        this.what = "undo of the " + last.what();
        this.commands = Paste.erase(last.x(), last.y(), last.z(),
                last.wide(), last.tall(), last.deep());
        this.next = 0;
        this.running = true;
        this.probeTicks = -1;
        this.pending = null;
        Ghosts.hide();
        report.accept("removing the " + last.what() + " at "
                + last.x() + " " + last.y() + " " + last.z()
                + " — the ground it was cleared off does not come back");
    }

    private String dimension() {
        return client.level == null ? "?" : client.level.dimension().identifier().toString();
    }

    public void start(Blueprint plan, BlockPos origin) {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            report.accept("not in a world yet");
            return;
        }
        // The outline goes now. A build replaces it with its own progress
        // drawing; a paste has no progress to draw, so nothing else would ever
        // take it down and it would hang in the air over the finished house.
        Ghosts.hide();

        if (local() == null && !mayCommand(player)) {
            buildInstead(plan, origin, allowed == Allowed.NO
                    ? "this server already refused to place blocks for you"
                    : "you are not an operator on this server, so nothing can be conjured here");
            return;
        }

        this.what = plan.name();
        this.commands = Paste.commands(plan, origin.getX(), origin.getY(), origin.getZ(), true);
        this.next = 0;
        this.running = true;
        this.probeTicks = -1;
        this.pending = plan;
        this.pendingAt = origin;

        done.addLast(new Pasted(plan.name(), dimension(), origin.getX(), origin.getY(),
                origin.getZ(), plan.sizeX(), plan.sizeY(), plan.sizeZ()));
        while (done.size() > REMEMBERED) done.removeFirst();

        int blocks = Paste.blockCount(plan, origin.getX(), origin.getY(), origin.getZ());
        report.accept("pasting the " + what + " — " + blocks + " blocks, "
                + commands.size() + " commands");
        report.accept("clearing " + plan.sizeX() + "x" + plan.sizeY() + "x" + plan.sizeZ()
                + " at " + origin.getX() + " " + origin.getY() + " " + origin.getZ() + " first");

        if (local() == null && allowed == Allowed.UNKNOWN) askPermission(plan, origin);
    }

    /**
     * Whether a command sent from here has any chance of landing.
     *
     * Two questions, cheapest first. The client is sent its own permissions at
     * login, and setblock is gated on what used to be level two and is now
     * COMMANDS_GAMEMASTER, so most of the time this is answered for free and
     * without sending anything — which is the point, because the alternative is
     * a red refusal in the chat of everyone who is not an operator.
     *
     * Having the permission is not the same as being allowed, though: a plugin,
     * a claim or a plot world can still refuse. So where the answer is yes it
     * is a maybe, and the one-block probe settles it. A refusal there is kept
     * for as long as you are in that world, so it is asked once rather than
     * before every paste.
     */
    private boolean mayCommand(LocalPlayer player) {
        String world = Worlds.key(client);
        if (!world.equals(verdictFor)) {
            verdictFor = world;
            allowed = Allowed.UNKNOWN;
        }
        if (allowed == Allowed.NO) return false;
        return player.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER);
    }

    /**
     * What is left when the commands are not available.
     *
     * In creative, the whole thing: the blocks cost nothing, so it is the same
     * building in the same place from the same plan and all it costs is the
     * walk. That is a real answer and it is taken without asking.
     *
     * In survival on somebody else's server, nothing is left, and this says so
     * rather than starting something that cannot finish. There is no client-side
     * route to a block appearing out of nothing there: the server owns the world
     * and it owns your inventory. A command needs the permission. A placement
     * needs the item, and the server is the one counting the items — a client
     * cannot add to that count, and a client that pretends to only draws blocks
     * that vanish on the next update. The three things that do work are all
     * somebody granting something, so they are named instead of guessed at.
     *
     * Falling through to the gatherer was the wrong call and it is why this is
     * written out at length. It is technically the same building, and it means
     * an evening of mining for a house that was supposed to take a second —
     * which is not the feature with a caveat, it is a different feature.
     */
    private void buildInstead(Blueprint plan, BlockPos origin, String why) {
        running = false;
        commands = List.of();
        pending = null;
        if (Hotbar.creative(client.player)) {
            report.accept(why + " — building it instead, at instant speed");
            report.accept("creative, so the blocks cost nothing; it just has to walk it");
            BuildTask.speed(BuildTask.Speed.INSTANT);
            otherwise.accept(plan, origin);
            return;
        }
        report.accept(why + ", and in survival there is nothing this can do about it");
        report.accept("blocks come from the server. Without the permission it can only "
                + "place what you are actually carrying, which is /build, not a paste.");
        report.accept("what does work: creative on that server (not op — much less to "
                + "give away), or an operator running the paste, or your own world");
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        commands = List.of();
        if (why != null) report.accept(why);
    }

    public void tick() {
        if (!running) return;
        if (client.level == null) {
            stop("lost the world");
            return;
        }

        MinecraftServer server = local();
        if (server == null && probeTicks >= 0) {
            if (++probeTicks < PROBE_TICKS) return;
            probeTicks = -1;
            if (client.level.getBlockState(probe).equals(probeWas)) {
                // Level two and still refused: a plugin, a claim, or a plot
                // world. Remembered so the next paste does not ask again.
                allowed = Allowed.NO;
                done.pollLast();
                Blueprint plan = pending;
                BlockPos at = pendingAt;
                if (plan == null) {
                    stop("the server would not let that block be set");
                    return;
                }
                buildInstead(plan, at, "the server would not run setblock for you");
                return;
            }
            allowed = Allowed.YES;
        }

        int budget = server != null ? PER_TICK_LOCAL : PER_TICK_REMOTE;
        List<String> batch = new ArrayList<>();
        while (next < commands.size() && batch.size() < budget) batch.add(commands.get(next++));

        if (server != null) run(server, batch);
        else for (String command : batch) send(command);

        if (next >= commands.size()) {
            running = false;
            report.accept(what.startsWith("undo") ? "removed it" : "pasted the " + what);
        }
    }

    /** The server running inside this game, or null on somebody else's. */
    private MinecraftServer local() {
        return client.getSingleplayerServer();
    }

    /**
     * Run them on the integrated server, under its own authority.
     *
     * On the server thread, because that is the only one allowed to touch the
     * world, and pinned to the dimension the player is standing in — the
     * console's source sits in the overworld, so a paste made in the Nether
     * would otherwise land somewhere nobody was looking.
     */
    private void run(MinecraftServer server, List<String> batch) {
        String dimension = client.level.dimension().identifier().toString();
        server.execute(() -> {
            CommandSourceStack source = server.createCommandSourceStack().withSuppressedOutput();
            for (String command : batch) {
                server.getCommands().performPrefixedCommand(source,
                        "/execute in " + dimension + " run " + command);
            }
        });
    }

    private void send(String command) {
        ClientPacketListener connection = client.getConnection();
        if (connection != null) connection.sendCommand(command);
    }

    /**
     * Change one block and see whether it changed.
     *
     * The probe is the design's own lowest corner, which the clear is about to
     * empty in any case, and the block chosen is one it is not already.
     */
    private void askPermission(Blueprint plan, BlockPos origin) {
        probe = origin;
        probeWas = client.level.getBlockState(probe);
        String marker = probeWas.isAir() ? "minecraft:stone" : "minecraft:air";
        send("setblock " + probe.getX() + " " + probe.getY() + " " + probe.getZ() + " " + marker);
        probeTicks = 0;
    }
}

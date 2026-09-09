package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Paste;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
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
 * group where one bad afternoon is unrecoverable. So the second route is a
 * bonus rather than a requirement: if the permission is there it is used
 * because it is instant, and if it is not, the paste is not refused — it is
 * *built*. The character walks it up block by block at instant speed, which
 * needs no permission at all because placing a block is what a player does. In
 * creative it costs nothing; in survival it costs the materials, and it says
 * which before it starts.
 *
 * Whether the permission is there is settled by asking, once: one real block is
 * set and looked at. That is the only reliable question, because being an
 * operator is not the same as being allowed — a plugin, a claim or a plot world
 * can refuse setblock from someone the server calls one. A refusal is kept for
 * as long as you are in that world, so the first paste on a server without the
 * permission costs one refused command and every paste after it costs nothing.
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
        if (local() == null && !mayCommand()) {
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

        if (local() == null && !mayCommand()) {
            buildInstead(plan, origin, "this server already refused to place blocks for you");
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
     * Asked of the server rather than assumed, because the client's own idea of
     * its permissions is not the whole answer anyway: a plugin, a claim or a
     * plot world can refuse setblock from someone the server calls an operator.
     * So the question is one real block, and the answer is kept for as long as
     * you are in that world — a server that said no once is asked once, and
     * every paste after the first goes straight to building with nothing sent.
     */
    private boolean mayCommand() {
        String world = Worlds.key(client);
        if (!world.equals(verdictFor)) {
            verdictFor = world;
            allowed = Allowed.UNKNOWN;
        }
        return allowed != Allowed.NO;
    }

    /**
     * Put it up the long way instead, and say why before anything happens.
     *
     * Not a consolation prize. It is the same building in the same place from
     * the same plan; what it costs is a walk, and in survival the materials —
     * which is the honest price of not being an operator, and is worth stating
     * rather than discovering when the gatherer wanders off after oak logs.
     */
    private void buildInstead(Blueprint plan, BlockPos origin, String why) {
        running = false;
        commands = List.of();
        pending = null;
        report.accept(why + " — building it instead, at instant speed");
        report.accept(Hotbar.creative(client.player)
                ? "creative, so the blocks cost nothing; it just has to walk it"
                : "survival, so it needs the materials — /plan " + plan.name()
                        + " says what they are");
        BuildTask.speed(BuildTask.Speed.INSTANT);
        otherwise.accept(plan, origin);
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

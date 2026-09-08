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
 *    setblock there. Nothing is installed on the server and nothing is asked of
 *    the other players — which is the point — but the permission is real and it
 *    is not this mod's to grant.
 *
 * If you may not, that is said plainly rather than dressed up: the alternative
 * is a progress bar that counts to six hundred while nothing appears.
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

    private final Minecraft client;
    private final Consumer<String> report;

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
    private BlockPos probe;
    private BlockState probeWas;
    private int probeTicks = -1;

    public PasteTask(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean running() {
        return running;
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
        this.what = plan.name();
        this.commands = Paste.commands(plan, origin.getX(), origin.getY(), origin.getZ(), true);
        this.next = 0;
        this.running = true;
        this.probeTicks = -1;

        int blocks = Paste.blockCount(plan, origin.getX(), origin.getY(), origin.getZ());
        report.accept("pasting the " + what + " — " + blocks + " blocks, "
                + commands.size() + " commands");
        report.accept("clearing " + plan.sizeX() + "x" + plan.sizeY() + "x" + plan.sizeZ()
                + " at " + origin.getX() + " " + origin.getY() + " " + origin.getZ() + " first");

        if (local() == null) askPermission(plan, origin);
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
                stop("the server did not accept it — pasting needs permission to run "
                        + "/setblock there. /build will do it the long way, with materials.");
                return;
            }
        }

        int budget = server != null ? PER_TICK_LOCAL : PER_TICK_REMOTE;
        List<String> batch = new ArrayList<>();
        while (next < commands.size() && batch.size() < budget) batch.add(commands.get(next++));

        if (server != null) run(server, batch);
        else for (String command : batch) send(command);

        if (next >= commands.size()) {
            running = false;
            report.accept("pasted the " + what);
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

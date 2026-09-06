package dev.understudy.mc;

import dev.understudy.core.craft.Planner;
import dev.understudy.core.path.Spiral;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;

import java.util.List;
import java.util.function.Consumer;

/**
 * Actually going and getting the materials the plan asks for.
 *
 * The planner works out what to gather and in what order; this walks to it and
 * breaks it. It only does the gathering half — a crafting step in the plan is
 * left to the player for now, and says so rather than stalling silently.
 *
 * Progress is measured by what ends up in the inventory, not by how many blocks
 * were broken. Those are different numbers: a drop can land in water, roll into
 * a hole, or be picked up by somebody else, and counting swings rather than
 * items is how a gatherer decides it is finished while holding nothing.
 */
public final class GatherTask {

    /** Close enough to break a block. Vanilla reach is a little over four. */
    private static final double REACH = 4.2;
    /** Give up on a block that will not break in fifteen seconds. */
    private static final int MAX_MINING_TICKS = 300;
    /** Re-scan for a target no more than this often; a full scan is not free. */
    private static final int SCAN_INTERVAL = 10;

    private final Minecraft client;
    private final TravelTask travel;
    private final CraftTask craft;
    private final Consumer<String> report;

    private List<Planner.Action> plan = List.of();
    private int step;
    private boolean running;

    private BlockPos target;
    private Direction face = Direction.UP;
    private int miningTicks;
    private int sinceScan;
    private int gathered;
    private String waitingOn;
    private boolean attempted;
    private Runnable onDone;

    public GatherTask(Minecraft client, TravelTask travel, CraftTask craft,
                      Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.craft = craft;
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    public void start(Planner.Plan wanted, Runnable then) {
        this.onDone = then;
        this.plan = wanted.actions();
        this.step = 0;
        this.running = !plan.isEmpty();
        this.target = null;
        this.gathered = 0;
        this.waitingOn = null;
        this.attempted = false;
        if (running) {
            report.accept("gathering: " + plan.size() + " steps, about "
                    + Math.round(wanted.seconds() / 60) + " minutes");
        }
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        onDone = null; // a cancelled gather must not go on to build
        plan = List.of();
        target = null;
        releaseMining();
        report.accept("stopped gathering — " + why);
    }

    public String status() {
        if (!running) return "idle";
        if (step >= plan.size()) return "gathering: done";
        return "gathering: " + plan.get(step).describe()
                + (waitingOn == null ? "" : " (" + waitingOn + ")");
    }

    public void tick() {
        if (!running) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null || client.gameMode == null) return;

        if (step >= plan.size()) {
            finish();
            return;
        }

        Planner.Action action = plan.get(step);
        if (action instanceof Planner.Collect collect) {
            collect(player, collect);
        } else if (action instanceof Planner.Make make) {
            make(player, make);
        }
    }

    /**
     * Craft a step, or wait for the crafter to finish the one it is on.
     *
     * Smelting is not crafting and the crafter says so, so a furnace step is
     * announced and skipped rather than silently stalling the rest of the plan.
     */
    private void make(LocalPlayer player, Planner.Make wanted) {
        if (Hotbar.count(player, wanted.item()) >= wanted.count()) {
            waitingOn = null;
            attempted = false;
            step++;
            return;
        }
        if (craft.running()) return;

        if (!attempted) {
            attempted = true;
            Hud.setStatus(wanted.describe());
            if (craft.start(wanted)) return;
            waitingOn = "needs a furnace: " + wanted.describe();
            report.accept(waitingOn + " — do that one and it carries on by itself");
            return;
        }
        // The crafter had a go and the count did not move, so something is
        // missing that the plan thought would be there. Moving on beats
        // repeating the same failed attempt every tick.
        report.accept("could not " + wanted.describe() + " — moving on");
        attempted = false;
        step++;
    }

    private void collect(LocalPlayer player, Planner.Collect wanted) {
        if (Hotbar.count(player, wanted.item()) >= wanted.count()) {
            releaseMining();
            target = null;
            step++;
            gathered = 0;
            Hud.setStatus("");
            return;
        }

        if (wanted.tool() != null && !Hotbar.hold(client, wanted.tool())) {
            if (waitingOn == null) {
                waitingOn = "no " + wanted.tool() + " to mine " + wanted.item() + " with";
                report.accept(waitingOn);
            }
            return;
        }
        waitingOn = null;

        if (target == null || !matches(target, wanted)) {
            if (sinceScan-- > 0) return;
            sinceScan = SCAN_INTERVAL;
            target = findNearest(player, wanted);
            miningTicks = 0;
            if (target == null) {
                if (!travel.running()) {
                    report.accept("no " + wanted.item() + " in sight — move somewhere it grows"
                            + " and it will pick up again");
                }
                return;
            }
        }

        double distance = Math.sqrt(player.blockPosition().distSqr(target));
        Hud.setStatus(String.format("gathering %s (%d of %d)", wanted.item(),
                Hotbar.count(player, wanted.item()), wanted.count()));

        if (distance > REACH) {
            // Walking is somebody else's job, and it already knows how to do it
            // smoothly and how to get unstuck.
            if (!travel.running()) travel.start(target.above());
            return;
        }
        if (travel.running()) travel.stop("arrived");
        mine(player);
    }

    private void mine(LocalPlayer player) {
        face = faceToward(player, target);
        lookAt(player, target);

        if (miningTicks == 0) {
            client.gameMode.startDestroyBlock(target, face);
        }
        client.gameMode.continueDestroyBlock(target, face);
        player.swing(net.minecraft.world.InteractionHand.MAIN_HAND);
        miningTicks++;

        if (client.level.getBlockState(target).isAir()) {
            gathered++;
            releaseMining();
            target = null;
            sinceScan = 0; // the next one is probably right here
            return;
        }
        if (miningTicks > MAX_MINING_TICKS) {
            // Bedrock, an unbreakable block, or something being protected.
            releaseMining();
            target = null;
        }
    }

    private void releaseMining() {
        if (client.gameMode != null) client.gameMode.stopDestroyBlock();
        miningTicks = 0;
    }

    private void finish() {
        running = false;
        Hud.setStatus("");
        report.accept("everything on the list is gathered");
        Runnable next = onDone;
        onDone = null;
        if (next != null) next.run();
    }

    /** The closest block that drops what is wanted, searched outward. */
    private BlockPos findNearest(LocalPlayer player, Planner.Collect wanted) {
        BlockPos from = player.blockPosition();
        for (int[] offset : Spiral.offsets()) {
            BlockPos at = from.offset(offset[0], offset[1], offset[2]);
            if (!matches(at, wanted)) continue;
            // Skip anything walled in on all six sides: it cannot be reached
            // without digging a tunnel, and the next one probably can be.
            if (buried(at)) continue;
            return at;
        }
        return null;
    }

    private boolean matches(BlockPos at, Planner.Collect wanted) {
        if (client.level == null || !client.level.hasChunk(at.getX() >> 4, at.getZ() >> 4)) {
            return false;
        }
        BlockState state = client.level.getBlockState(at);
        if (state.isAir()) return false;
        String name = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
        return Planner.sourcesOf(wanted.item()).contains(name);
    }

    private boolean buried(BlockPos at) {
        for (Direction direction : Direction.values()) {
            if (client.level.getBlockState(at.relative(direction)).isAir()) return false;
        }
        return true;
    }

    private Direction faceToward(LocalPlayer player, BlockPos at) {
        BlockPos eye = BlockPos.containing(player.getEyePosition());
        for (Direction direction : Direction.values()) {
            BlockPos neighbour = at.relative(direction);
            if (client.level.getBlockState(neighbour).isAir()
                    && neighbour.distSqr(eye) < at.distSqr(eye)) {
                return direction;
            }
        }
        return Direction.UP;
    }

    private void lookAt(LocalPlayer player, BlockPos at) {
        double dx = at.getX() + 0.5 - player.getX();
        double dy = at.getY() + 0.5 - (player.getY() + player.getEyeHeight());
        double dz = at.getZ() + 0.5 - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYRot((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setXRot((float) -Math.toDegrees(Math.atan2(dy, horizontal)));
    }
}

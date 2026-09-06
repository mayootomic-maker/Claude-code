package dev.understudy.mc;

import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Gather;
import dev.understudy.core.craft.Planner;
import dev.understudy.core.path.Spiral;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    /**
     * Offsets looked at per tick.
     *
     * The search volume is a third of a million blocks. Doing it in one go is a
     * visible hitch every half second even once each block is cheap, and a
     * hitch every half second is what "the UI lags" means. So it is resumable:
     * a slice per tick, nearest first, which in practice finds something in the
     * first few hundred anyway.
     */
    private static final int SCAN_BUDGET = 12_000;
    /** How far each leg of a strip mine goes. Half the scan radius, so no gaps. */
    private static final int STRIDE = 24;
    /** Legs before admitting this stretch of world does not have any. */
    private static final int MAX_LEGS = 14;
    /** Deep enough that it is dark and things spawn. */
    private static final int DARK_BELOW = 40;
    /** The four compass headings a strip mine can run along. */
    private static final int[][] LEGS = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}};

    private final Minecraft client;
    private final TravelTask travel;
    private final CraftTask craft;
    private final SmeltTask smelt;
    private final Consumer<String> report;

    private List<Planner.Action> plan = new ArrayList<>();
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
    private int legs;
    private int heading;
    private int scanCursor;
    private BlockPos scanBuried;
    private List<Block> wantedBlocks = List.of();
    private String wantedFor;
    private final Set<String> fetched = new HashSet<>();

    public GatherTask(Minecraft client, TravelTask travel, CraftTask craft, SmeltTask smelt,
                      Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.craft = craft;
        this.smelt = smelt;
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    public void start(Planner.Plan wanted, Runnable then) {
        this.onDone = then;
        // Copied rather than referenced: a missing tool splices its own steps
        // into this list, and a plan is not the sort of thing that arrives
        // knowing it will be edited.
        this.plan = new ArrayList<>(wanted.actions());
        this.step = 0;
        this.running = !plan.isEmpty();
        this.target = null;
        this.gathered = 0;
        this.waitingOn = null;
        this.attempted = false;
        this.legs = 0;
        this.heading = 0;
        this.fetched.clear();
        if (running) {
            report.accept("gathering: " + plan.size() + " steps, about "
                    + Math.round(wanted.seconds() / 60) + " minutes");
        }
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        onDone = null; // a cancelled gather must not go on to build
        plan = new ArrayList<>();
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
     * Make a step: at a grid if it is a recipe, at a furnace if it is a smelt.
     *
     * Which of the two it is comes from the plan rather than from guessing, and
     * each of them says up front whether it can take the job — so a step that
     * neither can do is reported as such instead of stalling the plan behind it.
     */
    private void make(LocalPlayer player, Planner.Make wanted) {
        if (Hotbar.count(player, wanted.item()) >= wanted.count()) {
            waitingOn = null;
            attempted = false;
            step++;
            return;
        }
        if (craft.running() || smelt.running()) return;

        if (!attempted) {
            attempted = true;
            Hud.setStatus(wanted.describe());
            if (craft.start(wanted)) return;
            if (smelt.start(wanted)) return;
            waitingOn = "cannot " + wanted.describe() + " by itself";
            report.accept(waitingOn + " — do that one and it carries on");
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
            // Not having the tool is not a reason to stop; it is a reason to go
            // and make one. The plan thought there would be one here — it broke,
            // or a craft failed upstream — so work out what a fresh one costs
            // and put those steps in front of this one.
            if (fetchTool(player, wanted.tool())) return;
            if (waitingOn == null) {
                waitingOn = "no " + wanted.tool() + " to mine " + wanted.item()
                        + " with, and no way to make one";
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
                // Still walking or digging somewhere it might be: let that finish.
                if (travel.running()) return;
                if (prospect(player, wanted)) return;
                report.accept("no " + wanted.item() + " anywhere around here"
                        + (wanted.bestY() == Gather.ANYWHERE
                                ? " — move somewhere it grows and it will pick up again"
                                : " — dug " + legs + " legs at y=" + wanted.bestY()
                                        + " and found none; try somewhere else"));
                releaseMining();
                step++;
                legs = 0;
                return;
            }
            legs = 0; // found some: the search starts over if this vein runs out
        }

        double distance = Math.sqrt(player.blockPosition().distSqr(target));
        Hud.setStatus(String.format("gathering %s (%d of %d)", wanted.item(),
                Hotbar.count(player, wanted.item()), wanted.count()));

        if (distance > REACH) {
            // Walking is somebody else's job, and it already knows how to do it
            // smoothly and how to get unstuck.
            // Digging allowed: the block may well be sealed in rock, and
            // walking to a seam of ore is a contradiction in terms.
            if (!travel.running()) travel.start(target.above(), true);
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

    /**
     * The closest block that drops what is wanted, searched outward.
     *
     * Exposed ones first, and only then the ones sealed in rock. That order is
     * the whole difference between walking to a tree you can see and tunnelling
     * to it. But "sealed in rock" is where every ore in the game is — and so is
     * the stone three blocks under a grass field — so refusing those outright,
     * which is what this used to do, meant the gatherer could mine only what
     * somebody had already dug a cave to.
     */
    private BlockPos findNearest(LocalPlayer player, Planner.Collect wanted) {
        resolveWanted(wanted);
        BlockPos from = player.blockPosition();
        List<int[]> offsets = Spiral.offsets();

        int looked = 0;
        while (scanCursor < offsets.size() && looked++ < SCAN_BUDGET) {
            int[] offset = offsets.get(scanCursor++);
            BlockPos at = from.offset(offset[0], offset[1], offset[2]);
            if (!isWanted(at)) continue;
            // Exposed wins outright — it is reachable by walking. A buried one
            // is worth a tunnel, but only once nothing better turns up, so it
            // is remembered rather than returned.
            if (!buried(at)) {
                restartScan();
                return at;
            }
            if (scanBuried == null) scanBuried = at;
        }

        if (scanCursor < offsets.size()) return null; // more to look at next tick
        BlockPos buriedOne = scanBuried;
        restartScan();
        return buriedOne;
    }

    private void restartScan() {
        scanCursor = 0;
        scanBuried = null;
    }

    /**
     * Turn the step's item into the blocks that drop it, once.
     *
     * This used to happen per candidate block, and behind it was a list the
     * catalogue rebuilt from scratch on every call. Two lookups that each look
     * free, inside a loop that runs a third of a million times.
     */
    private void resolveWanted(Planner.Collect wanted) {
        if (wanted.item().equals(wantedFor)) return;
        wantedFor = wanted.item();
        restartScan();
        List<Block> blocks = new ArrayList<>();
        for (String name : Planner.sourcesOf(wanted.item())) {
            Block block = BuiltInRegistries.BLOCK.getValue(ResourceLocation.withDefaultNamespace(name));
            if (block != null) blocks.add(block);
        }
        wantedBlocks = List.copyOf(blocks);
    }

    /** Identity against a resolved block, so no string is built per candidate. */
    private boolean isWanted(BlockPos at) {
        if (client.level == null) return false;
        BlockState state = client.level.getBlockState(at);
        if (state.isAir()) return false;
        return wantedBlocks.contains(state.getBlock());
    }

    /**
     * Nothing in range. Go where it is instead of saying there is none.
     *
     * Ore does not come to you, and "no diamond in sight" while standing in a
     * field is true and useless. So: down to the height the game actually puts
     * it at, and then a strip mine — one straight leg at a time, rescanning
     * between them, because the scan reaches further than a leg is long and a
     * straight tunnel exposes more new rock than a wandering one.
     *
     * It is bounded. Fourteen legs is about three hundred blocks of tunnel, and
     * if that turns up nothing the honest answer is that this stretch of world
     * does not have any, not another hour of digging.
     */
    private boolean prospect(LocalPlayer player, Planner.Collect wanted) {
        if (wanted.bestY() == Gather.ANYWHERE) return false;
        if (legs >= MAX_LEGS) return false;
        BlockPos from = player.blockPosition();

        BlockPos goal;
        if (Math.abs(from.getY() - wanted.bestY()) > 4) {
            goal = new BlockPos(from.getX(), wanted.bestY(), from.getZ());
            report.accept("no " + wanted.item() + " up here — digging down to y="
                    + wanted.bestY());
        } else {
            // One heading for the whole search, picked from where we happen to
            // be so two jobs in the same spot do not retrace the same tunnel.
            if (heading == 0) heading = 1 + Math.floorMod(from.getX() + from.getZ(), 4);
            int[] along = LEGS[heading - 1];
            goal = from.offset(along[0] * STRIDE, 0, along[1] * STRIDE);
            Hud.setStatus("looking for " + wanted.item() + " (leg " + (legs + 1) + ")");
        }
        legs++;
        lightTheWay(player);
        travel.start(goal, true);
        return true;
    }

    /**
     * A torch, if there is one to spare and it is dark enough to matter.
     *
     * Not decoration: a fresh tunnel at y=-59 is pitch black, things spawn in
     * it, and the guardian will quite rightly abort the whole job over a
     * skeleton that a torch would have prevented. Nothing is placed if there
     * are no torches — the plan asks for some when it knows it is going
     * underground, and if there are none anyway, that is the player's call.
     */
    private void lightTheWay(LocalPlayer player) {
        if (player.blockPosition().getY() > DARK_BELOW) return;
        if (Hotbar.count(player, "torch") == 0 || !Hotbar.hold(client, "torch")) return;
        BlockPos spot = Placement.spotBeside(client, player);
        if (spot != null) Placement.put(client, player, spot, "torch");
    }

    /**
     * Plan a replacement tool and splice it in ahead of the step that needs it.
     *
     * Once per tool per job: if a fresh wooden pickaxe still leaves us without
     * one, the problem is not that nobody tried, and repeating the attempt for
     * the rest of the session would hide whatever the real failure is.
     */
    private boolean fetchTool(LocalPlayer player, String tool) {
        if (!fetched.add(tool)) return false;
        Planner.Plan makeIt = new Planner(Catalogue.solver())
                .plan(Map.of(tool, 1), Carried.contents(player));
        if (!makeIt.possible() || makeIt.actions().isEmpty()) return false;

        report.accept("no " + tool + " — making one first ("
                + makeIt.actions().size() + " steps)");
        plan.addAll(step, makeIt.actions());
        attempted = false;
        return true;
    }

    private boolean matches(BlockPos at, Planner.Collect wanted) {
        resolveWanted(wanted);
        return isWanted(at);
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

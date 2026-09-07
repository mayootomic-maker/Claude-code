package dev.understudy.mc;

import dev.understudy.core.adapt.Timings;
import dev.understudy.core.memory.Atlas;
import dev.understudy.core.mind.Agenda;
import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Facing;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Builds a blueprint, one block per few ticks, from where it stands.
 *
 * The order comes from the blueprint, which rises layer by layer and works away
 * from the door. The only thing this adds is the physical business of being
 * close enough: it walks to each block it cannot reach and places from there.
 *
 * A block it cannot place is deferred rather than fatal. Optional pieces —
 * windows, furniture, torches — are skipped outright if the material ran out,
 * so a missing pane of glass does not stop a house.
 */
public final class BuildTask {

    /** Maximum reach for placing; the game allows a little more. */
    private static final double REACH = 4.0;

    /**
     * How fast to build, and whether to keep looking like a person while doing it.
     *
     * The blocks-a-tick numbers were never the real limit and it took a
     * stopwatch to notice. Every placement waits for the head to be pointing at
     * the block, the head is a spring that settles in about a third of a
     * second, and two blocks side by side in arm's reach are twenty or thirty
     * degrees apart — so all three settings placed two or three blocks a second
     * and "flat out" was, in practice, identical to "steady".
     *
     * So the setting is now about the head rather than about a counter. The two
     * human speeds still turn to look at what they are doing and are capped by
     * that, which is a real cap and is what the advertised rate says. Flat out
     * snaps the view instead — no spring, no reaction time — which is visibly a
     * mod to anyone watching and is roughly fifty times quicker.
     */
    public enum Speed {
        STEADY("steady, like a person", 1, 4, true, 2),
        BRISK("brisk, like a fast one", 2, 2, true, 3),
        FLAT_OUT("flat out, like a mod", 8, 1, false, 160);

        public final String describe;
        final int perTick;
        final int cooldown;
        /** Whether to wait for the head to turn, which is the whole difference. */
        final boolean turnsItsHead;
        private final int aboutPerSecond;

        Speed(String describe, int perTick, int cooldown, boolean turnsItsHead,
              int aboutPerSecond) {
            this.describe = describe;
            this.perTick = perTick;
            this.cooldown = cooldown;
            this.turnsItsHead = turnsItsHead;
            this.aboutPerSecond = aboutPerSecond;
        }

        /**
         * What it actually places, not what the counters would allow.
         *
         * perTick * 20 / cooldown is the mechanical ceiling and for the two
         * human speeds it is off by a factor of seven, because the head-turn
         * they wait for is slower than the counter they are throttled by.
         */
        public int blocksPerSecond() {
            return aboutPerSecond;
        }
    }

    private static Speed speed = Speed.BRISK;

    public static Speed speed() {
        return speed;
    }

    public static void speed(Speed chosen) {
        speed = chosen;
    }

    /** How many times a stubborn block is retried before being given up on. */
    private static final int MAX_ATTEMPTS = 3;
    /** Give up clearing a block that will not break — bedrock, or a claim. */
    private static final int MAX_CLEAR_TICKS = 200;
    /** Fluids are placed into rather than broken; nothing else is left standing. */
    private static final Set<String> POUR_INTO =
            Set.of("water", "lava", "bubble_column", "flowing_water", "flowing_lava");

    private final Minecraft client;
    private final Consumer<String> report;
    private final TravelTask travel;
    /**
     * Where things have been built.
     *
     * A project asks "is there a house here" and the only honest answer comes
     * from having written it down when one went up. The atlas is already the
     * thing that remembers where everything is, and a building is a fact about
     * a place in exactly the way a vein of iron is.
     */
    private final Atlas atlas;

    private List<Blueprint.Placement> queue = List.of();
    private BlockPos origin = BlockPos.ZERO;
    private String building = "";
    private int index;
    private int cooldown;
    private int placed;
    private int skipped;
    private boolean running;
    private final Map<String, Integer> attempts = new LinkedHashMap<>();
    private final Map<String, Integer> missing = new LinkedHashMap<>();
    private BlockPos clearing;
    private int clearTicks;
    private int cleared;
    private final List<Blueprint.Placement> deferred = new ArrayList<>();
    private boolean secondPass;
    private final Set<Long> planned = new HashSet<>();
    private final List<BlockPos> scaffolds = new ArrayList<>();

    public BuildTask(Minecraft client, TravelTask travel, Atlas atlas, Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.atlas = atlas;
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    /**
     * What a blueprint still needs, given what is carried.
     *
     * Answering this before starting is the point of having a blueprint at all
     * — you find out you are eighty cobblestone short before you have dug the
     * foundations, not halfway up the second wall.
     */
    public Map<String, Integer> shortfall(Blueprint blueprint) {
        LocalPlayer player = client.player;
        Map<String, Integer> short_ = new LinkedHashMap<>();
        if (player == null) return short_;
        for (Map.Entry<String, Integer> entry : blueprint.essentialMaterials().entrySet()) {
            int have = Hotbar.count(player, entry.getKey());
            if (have < entry.getValue()) short_.put(entry.getKey(), entry.getValue() - have);
        }
        return short_;
    }

    public void start(Blueprint blueprint, BlockPos at) {
        this.origin = at;
        this.building = blueprint.name();
        this.queue = blueprint.buildOrder();
        this.index = 0;
        this.placed = 0;
        this.skipped = 0;
        this.cleared = 0;
        this.cooldown = 0;
        this.running = true;
        this.secondPass = false;
        this.attempts.clear();
        this.missing.clear();
        this.deferred.clear();
        this.scaffolds.clear();
        this.planned.clear();
        for (Blueprint.Placement p : queue) {
            planned.add(pack(at.getX() + p.x(), at.getY() + p.y(), at.getZ() + p.z()));
        }
        this.clearing = null;
        // Show it standing there while it goes up, so what is left is visible
        // rather than something you infer from a block count in chat.
        Ghosts.show(blueprint, at);
        report.accept("building " + blueprint.name() + ": " + queue.size() + " blocks");
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        Ghosts.hide();
        queue = List.of();
        if (why != null) report.accept(why);
    }

    /**
     * The standing job, as the agenda understands it.
     *
     * The materials are the blocks still to go in that are not to hand — which
     * is the one case where carrying on is pointless and going to get something
     * is not. Optional pieces are left out on purpose: a build that skips a
     * decorative slab is still a finished build, and stopping to fetch one is
     * not what a person would do.
     */
    public Agenda.Job job() {
        if (!running) return null;
        LocalPlayer player = client.player;
        List<String> short_ = new ArrayList<>();
        for (int i = index; i < queue.size(); i++) {
            Blueprint.Placement placement = queue.get(i);
            if (placement.optional() || short_.contains(placement.block())) continue;
            if (player == null || Hotbar.count(player, placement.block()) == 0) {
                short_.add(placement.block());
            }
        }
        return new Agenda.Job("building", List.of(), short_);
    }

    public Timings.Phase phase() {
        if (travel != null && travel.running()) return Timings.Phase.TRAVELLING;
        return cooldown > 0 ? Timings.Phase.WAITING : Timings.Phase.PLACING;
    }

    public void tick() {
        if (!running) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop("lost the world");
            return;
        }
        Ghosts.progress(index, index);
        if (travel != null && travel.running()) return; // walking to the site
        if (cooldown-- > 0) return;

        // A build at night is a build with things spawning in it, and the
        // guardian will end the job over a skeleton a torch would have
        // prevented. One torch costs a tick and buys the rest of the night.
        if (Torchlight.keepLit(client, player)) return;

        // Everything within arm's reach goes down in one tick. Walking to the
        // next spot is what a build actually spends its time on, so placing one
        // block per visit and strolling off was most of the wait.
        for (int done = 0; done < speed.perTick; done++) {
            if (!one(player)) return;
        }
        cooldown = speed.cooldown;
    }

    /** One block. False when the tick is over, whatever the reason. */
    private boolean one(LocalPlayer player) {
        if (index >= queue.size()) {
            // The retry pass first, and the props come down after it. The other
            // way round takes away the very thing a deferred block was waiting
            // for something to place against — which is the whole reason the
            // prop went in.
            //
            // A block in mid-air cannot be placed at all: the game wants a
            // neighbouring face to click. By the end of a pass its neighbours
            // usually exist.
            if (!deferred.isEmpty() && !secondPass) {
                secondPass = true;
                queue = new ArrayList<>(deferred);
                deferred.clear();
                attempts.clear();
                index = 0;
                return true;
            }
            // Now take the props back down. They were never part of the design,
            // and leaving them up is the difference between a finished building
            // and one with the scaffolding still on it.
            if (!scaffolds.isEmpty()) {
                BlockPos prop = scaffolds.get(0);
                if (client.level.getBlockState(prop).isAir()) {
                    scaffolds.remove(0);
                    return true;
                }
                return clear(player, prop);
            }
            finish();
            return false;
        }

        Blueprint.Placement next = queue.get(index);
        BlockPos target = origin.offset(next.x(), next.y(), next.z());

        BlockState standing = client.level.getBlockState(target);
        if (!standing.isAir()) {
            if (nameOf(standing).equals(next.block())) {
                index++;      // already right: a resumed build skips its own work
                return true;
            }
            if (!POUR_INTO.contains(nameOf(standing))) {
                // The site is not a bare plain. Grass, a hillside, somebody's
                // fence — it was all being counted as "already built", which is
                // how a house comes out with a tree standing in the hall.
                return clear(player, target);
            }
        }

        double distance = Math.sqrt(player.blockPosition().distSqr(target));
        if (distance > REACH) {
            // Stand next to it rather than trying to place from across the room.
            travel.start(standingSpotFor(target));
            return false;
        }

        // Look at it first, and — importantly — do not let the turn count as a
        // failed placement. Three ticks of turning would otherwise use up the
        // three attempts and skip the block entirely, which would have turned
        // "looks more human" into "builds with holes in it".
        if (speed.turnsItsHead) {
            Aim.at(player, target);
            if (!Aim.onTarget()) return false;
        } else {
            // Flat out is the setting that says it does not care how this
            // looks, and waiting a third of a second per block for a spring is
            // the only reason it was not faster than the other two.
            Aim.snapAt(player, target);
        }

        if (!Hotbar.holdOrConjure(client, next.block())) {
            missing.merge(next.block(), 1, Integer::sum);
            index++;
            skipped++;
            return true;
        }

        if (place(player, target, next.facing())) {
            placed++;
            index++;
            return true;
        }
        // Nothing to click on. A block in mid-air cannot be placed at all, so
        // prop it: an ordinary block underneath, which comes back out once the
        // building is finished. This is what a person does, and without it a
        // model whose shell steps diagonally loses every course above the first.
        if (nothingToPlaceAgainst(target) && prop(player, target)) return false;

        String key = target.toShortString();
        if (attempts.merge(key, 1, Integer::sum) >= MAX_ATTEMPTS) {
            index++;
            if (!secondPass && nothingToPlaceAgainst(target)) deferred.add(next);
            else skipped++;
            return true;
        }
        return false; // let the world catch up before trying that one again
    }

    /**
     * Put a temporary block under something that has nothing to rest against.
     *
     * Only one deep, and only where the design does not want a block itself —
     * a prop standing where a block belongs would be mistaken for finished work
     * and never replaced. Returns whether one went down, in which case the real
     * block is tried again next tick with something to click on.
     */
    private boolean prop(LocalPlayer player, BlockPos target) {
        BlockPos under = target.below();
        if (!client.level.getBlockState(under).isAir()) return false;
        if (planned.contains(pack(under.getX(), under.getY(), under.getZ()))) return false;
        if (nothingToPlaceAgainst(under)) return false;

        String block = Walker.spare(player);
        if (block == null || !Hotbar.hold(client, block)) return false;
        if (!place(player, under, null)) return false;
        scaffolds.add(under);
        return true;
    }

    private static long pack(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 38) | ((long) (z & 0x3FFFFFF) << 12) | (y & 0xFFF);
    }

    /**
     * Break what is standing where a block is meant to go.
     *
     * Returns false while it is still breaking, so the tick belongs to this.
     * Levelling the site is not a separate phase on purpose: doing it block by
     * block as the build reaches each one means a build can be stopped halfway
     * without having flattened a hill it never got round to using.
     */
    private boolean clear(LocalPlayer player, BlockPos target) {
        if (client.gameMode == null) return false;
        if (player.blockPosition().distSqr(target) > REACH * REACH) {
            travel.start(standingSpotFor(target));
            return false;
        }
        if (!target.equals(clearing)) {
            clearing = target;
            clearTicks = 0;
            client.gameMode.startDestroyBlock(target, Direction.UP);
        }
        look(player, Vec3.atCenterOf(target));
        client.gameMode.continueDestroyBlock(target, Direction.UP);
        player.swing(InteractionHand.MAIN_HAND);

        if (client.level.getBlockState(target).isAir()) {
            cleared++;
            clearing = null;
            return true;
        }
        if (++clearTicks > MAX_CLEAR_TICKS) {
            // Bedrock, or a block a server will not let this player break.
            clearing = null;
            index++;
            skipped++;
        }
        return false;
    }

    /** Whether the game would refuse this placement for having no face to click. */
    private boolean nothingToPlaceAgainst(BlockPos target) {
        for (Direction direction : Direction.values()) {
            BlockState state = client.level.getBlockState(target.relative(direction));
            if (!state.isAir() && state.getFluidState().isEmpty()) return false;
        }
        return true;
    }

    private static String nameOf(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
    }

    private void finish() {
        running = false;
        Ghosts.hide();
        if (placed == 0) {
            // Saying "done" over a building that never appeared is worse than
            // saying nothing: it stops you looking for the reason, which is
            // always right here in the numbers.
            report.accept("built nothing — " + whyNothing());
            if (atlas != null && client.level != null) {
                // And it is not recorded as standing, or a project would tick
                // off a house that does not exist.
                report.accept("not counting that as built");
            }
            return;
        }
        // Written down whether or not every optional block went in: a house
        // missing two decorative slabs is a house, and a project that refuses
        // to admit it is standing would build a second one beside it.
        if (atlas != null && client.level != null) {
            atlas.saw(Atlas.BUILT + building, origin.getX(), origin.getY(), origin.getZ(),
                    client.level.getGameTime());
        }
        StringBuilder message = new StringBuilder("done: placed " + placed + " blocks");
        if (cleared > 0) message.append(", cleared ").append(cleared);
        if (!scaffolds.isEmpty()) {
            message.append(", left ").append(scaffolds.size()).append(" props up");
        }
        if (skipped > 0) message.append(", skipped ").append(skipped);
        if (!missing.isEmpty()) {
            message.append(" (ran out of: ");
            message.append(String.join(", ", missing.keySet()));
            message.append(")");
        }
        if (skipped > placed) {
            message.append(" — more was skipped than placed, so it is not finished");
        }
        report.accept(message.toString());
    }

    /**
     * Why a build placed nothing.
     *
     * There are only a few reasons and they are all knowable from what the run
     * recorded, so this is a sentence rather than a shrug.
     */
    private String whyNothing() {
        if (!missing.isEmpty()) {
            String short_ = String.join(", ", missing.keySet().stream().limit(4).toList());
            return "nothing to build with: no " + short_
                    + (missing.size() > 4 ? " and " + (missing.size() - 4) + " more" : "")
                    + (Hotbar.creative(client.player)
                            ? " (and creative could not conjure them — that is a bug, please say so)"
                            : " — /get them first, or use /build from the menu which fetches them");
        }
        if (cleared > 0) return "the whole site was in the way and clearing it used the run";
        return "nothing was reachable from where it stood";
    }

    /**
     * Place a block by clicking the face of a neighbour, which is the only way
     * the game lets anything be placed.
     */
    private boolean place(LocalPlayer player, BlockPos target) {
        return place(player, target, null);
    }

    /**
     * Place a block, and if it cares which way it faces, face that way first.
     *
     * Stairs, doors and trapdoors take their orientation from where the player
     * is looking, not from the face that was clicked. So the yaw is set after
     * aiming at the block and before the click — a roof built without this has
     * every step pointing the same wrong way.
     */
    private boolean place(LocalPlayer player, BlockPos target, Facing facing) {
        if (client.gameMode == null || client.level == null) return false;

        for (Direction direction : Direction.values()) {
            BlockPos reference = target.relative(direction);
            BlockState state = client.level.getBlockState(reference);
            if (state.isAir() || !state.getFluidState().isEmpty()) continue;

            Direction face = direction.getOpposite();
            Vec3 hit = Vec3.atCenterOf(reference).add(
                    face.getStepX() * 0.5, face.getStepY() * 0.5, face.getStepZ() * 0.5);

            // Face the block, and for something with a front — stairs, a door —
            // face the way it has to be placed instead.
            if (facing != null) Aim.at(facing.yaw(), 0);
            else look(player, hit);
            BlockHitResult result = new BlockHitResult(hit, face, reference, false);
            client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, result);
            player.swing(InteractionHand.MAIN_HAND);

            if (!client.level.getBlockState(target).isAir()) return true;
        }
        return false;
    }

    /** A request rather than a snap; Aim turns the head. */
    private void look(LocalPlayer player, Vec3 at) {
        Aim.at(player, at);
    }

    /** A spot beside the target that is worth standing in to reach it. */
    private BlockPos standingSpotFor(BlockPos target) {
        List<BlockPos> candidates = new ArrayList<>();
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                if (dx == 0 && dz == 0) continue;
                candidates.add(target.offset(dx, 0, dz));
                candidates.add(target.offset(dx, 1, dz));
            }
        }
        ClientBlockView view = new ClientBlockView(client.level);
        for (BlockPos candidate : candidates) {
            if (view.passable(candidate.getX(), candidate.getY(), candidate.getZ())
                    && view.passable(candidate.getX(), candidate.getY() + 1, candidate.getZ())
                    && view.solid(candidate.getX(), candidate.getY() - 1, candidate.getZ())) {
                return candidate;
            }
        }
        return target.offset(1, 0, 0);
    }

    public String status() {
        if (!running) return "idle";
        return "building: " + index + " of " + queue.size() + " (" + placed + " placed)";
    }
}

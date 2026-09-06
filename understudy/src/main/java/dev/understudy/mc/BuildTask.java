package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Facing;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
     * How hard to go at it.
     *
     * The old rate was one block every four ticks, which is five a second and
     * about what a person does. That is the right default for a server, where
     * anything faster is a thing a person cannot do and a thing a server can
     * see. It is the wrong default for someone who wants their house now, so it
     * is a choice rather than a constant, and the middle one — ten a second, a
     * fast clicker — is where it starts.
     */
    public enum Speed {
        STEADY("steady, like a person", 1, 4),
        BRISK("brisk, like a fast one", 2, 2),
        FLAT_OUT("flat out, like a mod", 8, 1);

        public final String describe;
        final int perTick;
        final int cooldown;

        Speed(String describe, int perTick, int cooldown) {
            this.describe = describe;
            this.perTick = perTick;
            this.cooldown = cooldown;
        }

        public int blocksPerSecond() {
            return perTick * 20 / cooldown;
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

    private final Minecraft client;
    private final Consumer<String> report;
    private final TravelTask travel;

    private List<Blueprint.Placement> queue = List.of();
    private BlockPos origin = BlockPos.ZERO;
    private int index;
    private int cooldown;
    private int placed;
    private int skipped;
    private boolean running;
    private final Map<String, Integer> attempts = new LinkedHashMap<>();
    private final Map<String, Integer> missing = new LinkedHashMap<>();

    public BuildTask(Minecraft client, TravelTask travel, Consumer<String> report) {
        this.client = client;
        this.travel = travel;
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
        this.queue = blueprint.buildOrder();
        this.index = 0;
        this.placed = 0;
        this.skipped = 0;
        this.cooldown = 0;
        this.running = true;
        this.attempts.clear();
        this.missing.clear();
        report.accept("building " + blueprint.name() + ": " + queue.size() + " blocks");
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        queue = List.of();
        if (why != null) report.accept(why);
    }

    public void tick() {
        if (!running) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop("lost the world");
            return;
        }
        if (travel != null && travel.running()) return; // walking to the site
        if (cooldown-- > 0) return;

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
            finish();
            return false;
        }

        Blueprint.Placement next = queue.get(index);
        BlockPos target = origin.offset(next.x(), next.y(), next.z());

        // Already correct — a resumed build skips everything it did last time.
        if (!client.level.getBlockState(target).isAir()) {
            index++;
            return true;
        }

        double distance = Math.sqrt(player.blockPosition().distSqr(target));
        if (distance > REACH) {
            // Stand next to it rather than trying to place from across the room.
            travel.start(standingSpotFor(target));
            return false;
        }

        if (!Hotbar.hold(client, next.block())) {
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
        String key = target.toShortString();
        if (attempts.merge(key, 1, Integer::sum) >= MAX_ATTEMPTS) {
            index++;
            skipped++;
            return true;
        }
        return false; // let the world catch up before trying that one again
    }

    private void finish() {
        running = false;
        StringBuilder message = new StringBuilder("done: placed " + placed + " blocks");
        if (skipped > 0) message.append(", skipped ").append(skipped);
        if (!missing.isEmpty()) {
            message.append(" (ran out of: ");
            message.append(String.join(", ", missing.keySet()));
            message.append(")");
        }
        report.accept(message.toString());
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

            look(player, hit);
            if (facing != null) player.setYRot(facing.yaw());
            BlockHitResult result = new BlockHitResult(hit, face, reference, false);
            client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, result);
            player.swing(InteractionHand.MAIN_HAND);

            if (!client.level.getBlockState(target).isAir()) return true;
        }
        return false;
    }

    private void look(LocalPlayer player, Vec3 at) {
        double dx = at.x - player.getX();
        double dy = at.y - (player.getY() + player.getEyeHeight());
        double dz = at.z - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYRot((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setXRot((float) -Math.toDegrees(Math.atan2(dy, horizontal)));
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

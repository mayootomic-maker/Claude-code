package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import net.minecraft.block.BlockState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

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
    /** Ticks between placements. Instant placement is both a tell and unstable. */
    private static final int PLACE_INTERVAL = 4;
    /** How many times a stubborn block is retried before being given up on. */
    private static final int MAX_ATTEMPTS = 3;

    private final MinecraftClient client;
    private final Consumer<String> report;
    private final TravelTask travel;

    private List<Blueprint.Placement> queue = List.of();
    private BlockPos origin = BlockPos.ORIGIN;
    private int index;
    private int cooldown;
    private int placed;
    private int skipped;
    private boolean running;
    private final Map<String, Integer> attempts = new LinkedHashMap<>();
    private final Map<String, Integer> missing = new LinkedHashMap<>();

    public BuildTask(MinecraftClient client, TravelTask travel, Consumer<String> report) {
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
        ClientPlayerEntity player = client.player;
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
        ClientPlayerEntity player = client.player;
        if (player == null || client.world == null) {
            stop("lost the world");
            return;
        }
        if (travel != null && travel.running()) return; // walking to the site
        if (cooldown-- > 0) return;

        if (index >= queue.size()) {
            finish();
            return;
        }

        Blueprint.Placement next = queue.get(index);
        BlockPos target = origin.add(next.x(), next.y(), next.z());

        // Already correct — a resumed build skips everything it did last time.
        if (!client.world.getBlockState(target).isAir()) {
            index++;
            return;
        }

        double distance = Math.sqrt(player.getBlockPos().getSquaredDistance(target));
        if (distance > REACH) {
            // Stand next to it rather than trying to place from across the room.
            travel.start(standingSpotFor(target));
            return;
        }

        if (!Hotbar.hold(client, next.block())) {
            missing.merge(next.block(), 1, Integer::sum);
            index++;
            skipped++;
            return;
        }

        if (place(player, target)) {
            placed++;
            index++;
            cooldown = PLACE_INTERVAL;
        } else {
            String key = target.toShortString();
            int tries = attempts.merge(key, 1, Integer::sum);
            if (tries >= MAX_ATTEMPTS) {
                index++;
                skipped++;
            }
            cooldown = PLACE_INTERVAL;
        }
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
    private boolean place(ClientPlayerEntity player, BlockPos target) {
        if (client.interactionManager == null || client.world == null) return false;

        for (Direction direction : Direction.values()) {
            BlockPos reference = target.offset(direction);
            BlockState state = client.world.getBlockState(reference);
            if (state.isAir() || !state.getFluidState().isEmpty()) continue;

            Direction face = direction.getOpposite();
            Vec3d hit = Vec3d.ofCenter(reference).add(
                    face.getOffsetX() * 0.5, face.getOffsetY() * 0.5, face.getOffsetZ() * 0.5);

            look(player, hit);
            BlockHitResult result = new BlockHitResult(hit, face, reference, false);
            client.interactionManager.interactBlock(player, Hand.MAIN_HAND, result);
            player.swingHand(Hand.MAIN_HAND);

            if (!client.world.getBlockState(target).isAir()) return true;
        }
        return false;
    }

    private void look(ClientPlayerEntity player, Vec3d at) {
        double dx = at.x - player.getX();
        double dy = at.y - (player.getY() + player.getStandingEyeHeight());
        double dz = at.z - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYaw((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setPitch((float) -Math.toDegrees(Math.atan2(dy, horizontal)));
    }

    /** A spot beside the target that is worth standing in to reach it. */
    private BlockPos standingSpotFor(BlockPos target) {
        List<BlockPos> candidates = new ArrayList<>();
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                if (dx == 0 && dz == 0) continue;
                candidates.add(target.add(dx, 0, dz));
                candidates.add(target.add(dx, 1, dz));
            }
        }
        ClientBlockView view = new ClientBlockView(client.world);
        for (BlockPos candidate : candidates) {
            if (view.passable(candidate.getX(), candidate.getY(), candidate.getZ())
                    && view.passable(candidate.getX(), candidate.getY() + 1, candidate.getZ())
                    && view.solid(candidate.getX(), candidate.getY() - 1, candidate.getZ())) {
                return candidate;
            }
        }
        return target.add(1, 0, 0);
    }

    public String status() {
        if (!running) return "idle";
        return "building: " + index + " of " + queue.size() + " (" + placed + " placed)";
    }
}

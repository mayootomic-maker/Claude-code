package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Finding a workstation, or putting one down.
 *
 * A crafting table and a furnace are the same problem twice: look around for
 * one within arm's reach, and if there is none, place the one you are carrying
 * on a clear patch of ground beside you. The only thing that differs is the
 * name of the block, so it lives here rather than twice.
 */
final class Placement {
    private Placement() {}

    /** Vanilla reach is a little over four; stay inside it. */
    static final double REACH = 4.0;

    static boolean is(Minecraft client, BlockPos at, String block) {
        if (client.level == null) return false;
        BlockState state = client.level.getBlockState(at);
        return !state.isAir()
                && BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath().equals(block);
    }

    /** The closest one of these within reach, or null. */
    static BlockPos nearest(Minecraft client, BlockPos from, String block) {
        BlockPos best = null;
        double nearest = REACH * REACH;
        for (int dx = -4; dx <= 4; dx++) {
            for (int dy = -3; dy <= 3; dy++) {
                for (int dz = -4; dz <= 4; dz++) {
                    BlockPos at = from.offset(dx, dy, dz);
                    if (!is(client, at, block)) continue;
                    double distance = at.distSqr(from);
                    if (distance < nearest) {
                        nearest = distance;
                        best = at;
                    }
                }
            }
        }
        return best;
    }

    /** Somewhere within arm's reach with air above it and ground under it. */
    static BlockPos spotBeside(Minecraft client, LocalPlayer player) {
        if (client.level == null) return null;
        BlockPos feet = player.blockPosition();
        for (Direction direction : Direction.Plane.HORIZONTAL) {
            BlockPos at = feet.relative(direction);
            if (client.level.getBlockState(at).isAir()
                    && client.level.getBlockState(at.above()).isAir()
                    && !client.level.getBlockState(at.below()).isAir()) {
                return at;
            }
        }
        return null;
    }

    /**
     * Put the held block down at `at`, aiming at the top of the block beneath
     * it the way you do. Returns whether it is actually there afterwards.
     */
    static boolean put(Minecraft client, LocalPlayer player, BlockPos at, String block) {
        if (client.gameMode == null) return false;
        BlockPos under = at.below();
        Vec3 hit = Vec3.atCenterOf(under).add(0, 0.5, 0);
        lookAt(player, hit);
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                new BlockHitResult(hit, Direction.UP, under, false));
        player.swing(InteractionHand.MAIN_HAND);
        return is(client, at, block);
    }

    /** Right-click a block that is already there, to open whatever it holds. */
    static void use(Minecraft client, LocalPlayer player, BlockPos at) {
        if (client.gameMode == null) return;
        Vec3 hit = Vec3.atCenterOf(at);
        lookAt(player, hit);
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                new BlockHitResult(hit, Direction.UP, at, false));
    }

    static void lookAt(LocalPlayer player, Vec3 at) {
        double dx = at.x - player.getX();
        double dy = at.y - (player.getY() + player.getEyeHeight());
        double dz = at.z - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYRot((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setXRot((float) -Math.toDegrees(Math.atan2(dy, horizontal)));
    }
}

package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Keeping a light on where the work is.
 *
 * Not decoration and not a nicety. Every long job the mod does — a night-time
 * build, a strip mine at y minus fifty — happens in the dark, things spawn in
 * the dark, and the guardian quite correctly abandons the whole job over a
 * skeleton. A torch every few blocks prevents the spawn that ends the task, so
 * this is the difference between a build that finishes and one that keeps being
 * interrupted by a creeper it invited.
 *
 * Two ways it knows it is dark, both from things that have not moved between
 * versions: below the surface it always is, and above it, the time of day says
 * so. Asking the light engine for a block's brightness would be exact and is
 * exactly the sort of call that gets renamed.
 */
final class Torchlight {
    private Torchlight() {}

    /** Deep enough that daylight never reaches, whatever the clock says. */
    private static final int UNDERGROUND = 40;
    /** Minecraft's night, in ticks of a twenty-thousand-tick day. */
    private static final long DUSK = 13_000;
    private static final long DAWN = 23_000;
    /** How far apart torches go. Vanilla spawning needs a gap wider than this. */
    private static final int SPACING = 6;

    static boolean dark(Minecraft client, LocalPlayer player) {
        if (client.level == null) return false;
        if (player.blockPosition().getY() < UNDERGROUND) return true;
        long time = client.level.getDayTime() % 24_000L;
        return time >= DUSK && time < DAWN;
    }

    /**
     * Put a torch down if it is dark here and there is not one already.
     *
     * Returns whether it placed one, so a caller can spend the tick on it.
     * Silently does nothing without torches: the plan asks for some when it
     * knows it is going underground, and if there are none anyway that is the
     * player's call rather than something to nag about every tick.
     */
    static boolean keepLit(Minecraft client, LocalPlayer player) {
        if (client.level == null || !dark(client, player)) return false;
        if (Hotbar.count(player, "torch") == 0) return false;
        if (litNearby(client, player.blockPosition())) return false;
        if (!Hotbar.hold(client, "torch")) return false;

        BlockPos spot = Placement.spotBeside(client, player);
        return spot != null && Placement.put(client, player, spot, "torch");
    }

    /**
     * Whether there is already a torch within its own spacing.
     *
     * A cube rather than a sphere, and a small one: this runs while a build is
     * placing blocks, and the point is to avoid a torch every single step, not
     * to compute a lighting plan.
     */
    private static boolean litNearby(Minecraft client, BlockPos from) {
        for (int dx = -SPACING; dx <= SPACING; dx++) {
            for (int dy = -2; dy <= 2; dy++) {
                for (int dz = -SPACING; dz <= SPACING; dz++) {
                    BlockState state = client.level.getBlockState(from.offset(dx, dy, dz));
                    if (state.isAir()) continue;
                    String name = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
                    if (name.endsWith("torch") || name.equals("lantern")
                            || name.equals("glowstone") || name.equals("sea_lantern")) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Sleep, if there is a bed within reach and it is night.
     *
     * The honest limit: the game refuses if a monster is nearby, and it says so
     * in chat rather than in anything this can read. So this asks once and the
     * caller does not wait on the answer — a refused sleep costs a click and
     * the night goes on being dealt with by torches.
     */
    static BlockPos bedNearby(Minecraft client, LocalPlayer player) {
        BlockPos from = player.blockPosition();
        for (int dx = -3; dx <= 3; dx++) {
            for (int dy = -2; dy <= 2; dy++) {
                for (int dz = -3; dz <= 3; dz++) {
                    BlockPos at = from.offset(dx, dy, dz);
                    BlockState state = client.level.getBlockState(at);
                    if (state.isAir()) continue;
                    if (BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath().endsWith("_bed")) {
                        return at;
                    }
                }
            }
        }
        return null;
    }

    /** The face of a block a torch or a block goes against, from where you stand. */
    static Direction toward(BlockPos from, BlockPos to) {
        int dx = to.getX() - from.getX();
        int dz = to.getZ() - from.getZ();
        if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? Direction.EAST : Direction.WEST;
        return dz > 0 ? Direction.SOUTH : Direction.NORTH;
    }
}

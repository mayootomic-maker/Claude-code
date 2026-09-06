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
 * How it knows it is dark: below the surface it always is, whatever the clock
 * says. Reading the clock as well needs a call this version renamed, so that
 * half waits for an answer rather than a guess.
 */
final class Torchlight {
    private Torchlight() {}

    /** Deep enough that daylight never reaches, whatever the clock says. */
    private static final int UNDERGROUND = 40;
    /** How far apart torches go. Vanilla spawning needs a gap wider than this. */
    private static final int SPACING = 6;

    static boolean dark(Minecraft client, LocalPlayer player) {
        if (client.level == null) return false;
        // Underground only, for now. Telling the time turned out to need a call
        // that does not exist in this version — getDayTime is gone — and a
        // wrong guess about the clock is not worth a broken build when the half
        // that matters most needs no clock at all: a tunnel at y minus fifty is
        // dark at noon. The night half is waiting on one answer from CI.
        return player.blockPosition().getY() < UNDERGROUND;
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

    /** The face of a block a torch or a block goes against, from where you stand. */
    static Direction toward(BlockPos from, BlockPos to) {
        int dx = to.getX() - from.getX();
        int dz = to.getZ() - from.getZ();
        if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? Direction.EAST : Direction.WEST;
        return dz > 0 ? Direction.SOUTH : Direction.NORTH;
    }
}

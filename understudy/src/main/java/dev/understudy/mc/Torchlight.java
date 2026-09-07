package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;

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
 * How it knows it is dark: it asks. getMaxLocalRawBrightness is the same number
 * the game uses to decide whether something spawns here, which makes it a
 * better question than the one I set out to ask. A clock cannot tell you that a
 * cave mouth at noon is pitch black, or that the tunnel you just lit is fine
 * now — this can, and it needs no separate rule for being underground.
 */
final class Torchlight {
    private Torchlight() {}

    /**
     * Dark enough for something to spawn in.
     *
     * Seven is the game's own threshold for hostiles. A placed torch takes its
     * own block to fourteen, so this stops asking for another one immediately
     * afterwards without needing to remember where it put them.
     */
    private static final int SPAWNS_BELOW = 8;

    static boolean dark(Minecraft client, LocalPlayer player) {
        return client.level != null
                && client.level.getMaxLocalRawBrightness(player.blockPosition()) < SPAWNS_BELOW;
    }

    /**
     * Put a torch down if it is dark enough here for something to spawn.
     *
     * Returns whether it placed one, so a caller can spend the tick on it.
     * Silently does nothing without torches: the plan asks for some when it
     * knows it is going underground, and if there are none anyway that is the
     * player's call rather than something to nag about every tick.
     */
    static boolean keepLit(Minecraft client, LocalPlayer player) {
        if (client.level == null || !dark(client, player)) return false;
        if (Hotbar.count(player, "torch") == 0) return false;
        if (!Hotbar.hold(client, "torch")) return false;

        BlockPos spot = Placement.spotBeside(client, player);
        return spot != null && Placement.put(client, player, spot, "torch");
    }

    /** The face of a block a torch or a block goes against, from where you stand. */
    static Direction toward(BlockPos from, BlockPos to) {
        int dx = to.getX() - from.getX();
        int dz = to.getZ() - from.getZ();
        if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? Direction.EAST : Direction.WEST;
        return dz > 0 ? Direction.SOUTH : Direction.NORTH;
    }
}

package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

import java.util.function.Consumer;

/**
 * Going to bed.
 *
 * The last thing on the list of what it could not do for itself, and the one
 * that was blocked on a fact rather than on effort: Level.getDayTime() does not
 * exist in this version, so nothing here could tell night from day. What does
 * exist is getSkyDarken — how far the sky light is knocked down, which is zero
 * in daylight and eleven at midnight — and that is a better question anyway,
 * because it is the same number the game uses to decide what spawns.
 *
 * Why an autopilot should sleep at all, when it can now fight: because the
 * night is the expensive part of an unattended session even when every
 * individual fight is won. Phantoms arrive after three days awake and attack
 * from above, where nothing here can reach them. Skipping the night costs eight
 * seconds and removes all of it.
 *
 * It gives up quickly and says so. Sleeping fails for reasons the client cannot
 * see — a monster nearby, the wrong dimension, a server that does not skip the
 * night — and a mod that stands in front of a bed clicking it until morning is
 * worse than one that goes back to work.
 */
public final class Bedtime {
    private Bedtime() {}

    /**
     * Sky light knocked down by more than this and it is night rather than
     * weather. Rain reaches about five; midnight is eleven.
     */
    private static final int NIGHT = 7;
    /** How many goes at getting into a bed before accepting it is not working. */
    private static final int TRIES = 3;
    /** Ticks between attempts, so the game has time to answer the first one. */
    private static final int BETWEEN = 40;
    /** How far to look for a bed already standing. */
    private static final int LOOK = 8;

    private static int tried;
    private static int wait;
    private static boolean saidItCannot;

    /** Morning, or a new world: everything about last night is irrelevant. */
    public static void reset() {
        tried = 0;
        wait = 0;
        saidItCannot = false;
    }

    public static boolean night(Minecraft client) {
        if (client.level == null || !Worlds.hasASky(client.level)) return false;
        return client.level.getSkyDarken() > NIGHT;
    }

    /**
     * Deal with the night, if there is one to deal with.
     *
     * @return whether it is handling it, and the caller should do nothing else
     */
    public static boolean tick(Minecraft client, LocalPlayer player, Consumer<String> report) {
        if (!night(client)) {
            reset();
            return false;
        }
        if (tried >= TRIES) return false;
        if (wait-- > 0) return true;
        wait = BETWEEN;

        BlockPos bed = nearestBed(client, player);
        if (bed == null) {
            if (!layOne(client, player, report)) {
                // No bed and nothing to make one from is not a failure worth
                // announcing every night. It is the ordinary state of the first
                // day, and the torches already deal with what it costs.
                tried = TRIES;
                return false;
            }
            return true;
        }

        tried++;
        report.accept("night — turning in");
        Placement.use(client, player, bed);
        return true;
    }

    /** A bed already standing within a short walk of here. */
    private static BlockPos nearestBed(Minecraft client, LocalPlayer player) {
        if (client.level == null) return null;
        BlockPos from = player.blockPosition();
        BlockPos best = null;
        double nearest = Double.MAX_VALUE;
        for (int dx = -LOOK; dx <= LOOK; dx++) {
            for (int dy = -2; dy <= 2; dy++) {
                for (int dz = -LOOK; dz <= LOOK; dz++) {
                    BlockPos at = from.offset(dx, dy, dz);
                    if (!isBed(client, at)) continue;
                    double distance = at.distSqr(from);
                    if (distance < nearest) {
                        nearest = distance;
                        best = at;
                    }
                }
            }
        }
        // Only a bed you can actually reach from where you stand. Walking to a
        // distant one is the pathfinder's job and not worth starting at dusk.
        return best != null && nearest <= Placement.REACH * Placement.REACH ? best : null;
    }

    private static boolean isBed(Minecraft client, BlockPos at) {
        return Placement.isAny(client, at, "_bed");
    }

    /** Put one down, if one is being carried. */
    private static boolean layOne(Minecraft client, LocalPlayer player, Consumer<String> report) {
        String carried = bedInBag(player);
        if (carried == null) return false;
        BlockPos spot = Placement.spotBeside(client, player);
        if (spot != null && Hotbar.hold(client, carried)
                && Placement.put(client, player, spot, carried)) {
            return true;
        }
        if (!saidItCannot) {
            saidItCannot = true;
            // A bed needs two clear blocks side by side. "There is nowhere flat
            // here" is the honest reason rather than a silent nothing.
            report.accept("carrying a bed and nowhere flat to put it down");
        }
        return false;
    }

    /** Any colour. They are sixteen names and one block. */
    private static String bedInBag(LocalPlayer player) {
        for (String item : Carried.contents(player).keySet()) {
            if (item.endsWith("_bed")) return item;
        }
        return null;
    }
}

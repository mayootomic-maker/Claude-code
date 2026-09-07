package dev.understudy.mc;

import dev.understudy.core.mind.Agenda;
import dev.understudy.core.survive.Armoury;
import dev.understudy.core.survive.Combat;
import dev.understudy.core.sort.Category;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Monster;

import java.util.Map;

/**
 * Reading the world into the one record the Agenda reasons over.
 *
 * Everything here is a live reading rather than a remembered one. A decision
 * made on a stale health value is worse than no decision, and this is the only
 * place the game gets turned into something the thinking half can see — which
 * is what lets that half be tested without a game at all.
 */
public final class Senses {
    private Senses() {}

    /** How far a building counts as being "here". */
    private static final double NEARBY_BUILD = 64;

    /** Close enough that a hostile is about you rather than merely present. */
    private static final double NEARBY = 144; // twelve blocks, squared

    /**
     * What a project is judged against.
     *
     * Everything read fresh, which is the property that makes a project
     * resumable: quit, reload, wander off, do half of it by hand, and the same
     * facts give the same answer about what is left.
     */
    public static dev.understudy.core.mind.Project.Facts facts(
            Minecraft client, LocalPlayer player, dev.understudy.core.memory.Atlas atlas) {
        Map<String, Integer> carried = Carried.contents(player);

        java.util.Set<String> built = new java.util.HashSet<>();
        for (dev.understudy.core.memory.Atlas.Sighting seen : atlas.all()) {
            if (!seen.what().startsWith(dev.understudy.core.memory.Atlas.BUILT)) continue;
            if (seen.distanceTo(player.getBlockX(), player.getBlockY(), player.getBlockZ())
                    > NEARBY_BUILD) {
                continue;
            }
            built.add(seen.what().substring(dev.understudy.core.memory.Atlas.BUILT.length()));
        }

        // What is in the bag that belongs in a chest — the same question the
        // sorter asks, so "put everything away" means the same thing to the
        // project as it does to the task that does it.
        java.util.Set<String> keeping = dev.understudy.core.sort.Sorter.keepBack(carried);
        int spare = 0;
        for (Map.Entry<String, Integer> held : carried.entrySet()) {
            if (!keeping.contains(held.getKey())) spare++;
        }

        return new dev.understudy.core.mind.Project.Facts(carried, built,
                client.level == null ? 15
                        : client.level.getMaxLocalRawBrightness(player.blockPosition()),
                spare);
    }

    public static Agenda.Situation read(Minecraft client, LocalPlayer player,
                                        Agenda.Job job, double damageRecently) {
        Map<String, Integer> carried = Carried.contents(player);

        int free = 0;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            if (player.getInventory().getItem(slot).isEmpty()) free++;
        }

        int hostiles = 0;
        double nearest = Double.MAX_VALUE;
        if (client.level != null) {
            for (Entity entity : client.level.entitiesForRendering()) {
                if (!(entity instanceof Monster) || !entity.isAlive()) continue;
                double distanceSqr = player.distanceToSqr(entity);
                if (distanceSqr >= NEARBY) continue;
                hostiles++;
                nearest = Math.min(nearest, distanceSqr);
            }
        }

        return new Agenda.Situation(
                player.getHealth(), player.getMaxHealth(), damageRecently,
                player.getFoodData().getFoodLevel(),
                carried.keySet().stream().anyMatch(item -> Category.of(item) == Category.FOOD),
                client.level == null ? 15
                        : client.level.getMaxLocalRawBrightness(player.blockPosition()),
                carried.getOrDefault("torch", 0) > 0,
                free, hostiles,
                nearest == Double.MAX_VALUE ? Double.MAX_VALUE : Math.sqrt(nearest),
                // What it would fight with, and what it would be hit in. The
                // agenda used to reason about threats without either, which is
                // how it ended up deciding to stand and fight bare-handed.
                Combat.bestWeaponDps(carried),
                Armoury.pointsOf(Fight.wornBy(player)),
                carried, job);
    }
}

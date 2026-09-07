package dev.understudy.mc;

import dev.understudy.core.mind.Agenda;
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

    /** Close enough that a hostile is about you rather than merely present. */
    private static final double NEARBY = 144; // twelve blocks, squared

    public static Agenda.Situation read(Minecraft client, LocalPlayer player,
                                        Agenda.Job job, double damageRecently) {
        Map<String, Integer> carried = Carried.contents(player);

        int free = 0;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            if (player.getInventory().getItem(slot).isEmpty()) free++;
        }

        int hostiles = 0;
        if (client.level != null) {
            for (Entity entity : client.level.entitiesForRendering()) {
                if (entity instanceof Monster && entity.isAlive()
                        && player.distanceToSqr(entity) < NEARBY) {
                    hostiles++;
                }
            }
        }

        return new Agenda.Situation(
                player.getHealth(), player.getMaxHealth(), damageRecently,
                player.getFoodData().getFoodLevel(),
                carried.keySet().stream().anyMatch(item -> Category.of(item) == Category.FOOD),
                client.level == null ? 15
                        : client.level.getMaxLocalRawBrightness(player.blockPosition()),
                carried.getOrDefault("torch", 0) > 0,
                free, hostiles, carried, job);
    }
}

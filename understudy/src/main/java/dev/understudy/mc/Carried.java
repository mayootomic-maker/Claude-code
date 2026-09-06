package dev.understudy.mc;

import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.item.ItemStack;

import java.util.LinkedHashMap;
import java.util.Map;

/** What you are carrying, as the plain name-to-count map the planner reads. */
public final class Carried {

    private Carried() {}

    public static Map<String, Integer> contents(LocalPlayer player) {
        Map<String, Integer> held = new LinkedHashMap<>();
        if (player == null) return held;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            String name = Hotbar.nameOf(stack);
            if (name != null) held.merge(name, stack.getCount(), Integer::sum);
        }
        return held;
    }
}

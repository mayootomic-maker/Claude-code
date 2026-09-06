package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.inventory.ContainerInput;

/**
 * Getting the right thing into your hand.
 *
 * Placing a block means holding it, and the thing you need is usually in the
 * main inventory rather than the hotbar. Swapping it down is a slot click on
 * the player's own screen handler — the same action as pressing a number key
 * with the inventory open, so the server sees nothing unusual.
 */
public final class Hotbar {
    private Hotbar() {}

    /** Slot the mod borrows for materials, so it does not disturb your kit. */
    private static final int SCRATCH_SLOT = 8;

    public static String nameOf(ItemStack stack) {
        return stack.isEmpty() ? null : BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
    }

    /** How many of an item the player is carrying, hotbar included. */
    public static int count(LocalPlayer player, String itemName) {
        int total = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (itemName.equals(nameOf(stack))) total += stack.getCount();
        }
        return total;
    }

    /**
     * Whether another one of these would actually fit.
     *
     * Progress through a gather is measured by what is in the inventory, which
     * is the honest measure — a drop can land in water or roll into a hole. But
     * a full inventory means the count can never rise however much is mined, and
     * the gatherer will happily mine the same seam until the world ends. This is
     * the question that stops that.
     */
    public static boolean roomFor(LocalPlayer player, String itemName) {
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack.isEmpty()) return true;
            if (itemName.equals(nameOf(stack)) && stack.getCount() < stack.getMaxStackSize()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Put `itemName` in the player's hand, moving it to the hotbar if needed.
     * Returns false when there is none to hold.
     */
    public static boolean hold(Minecraft client, String itemName) {
        LocalPlayer player = client.player;
        if (player == null) return false;

        // Already in the hotbar: just select it.
        for (int slot = 0; slot < 9; slot++) {
            if (itemName.equals(nameOf(player.getInventory().getItem(slot)))) {
                player.getInventory().setSelectedSlot(slot);
                return true;
            }
        }

        // In the main inventory: swap it down into the scratch slot.
        for (int slot = 9; slot < player.getInventory().getContainerSize(); slot++) {
            if (!itemName.equals(nameOf(player.getInventory().getItem(slot)))) continue;
            if (client.gameMode == null) return false;
            // Main inventory slots keep their index in the player screen
            // handler; the hotbar sits at 36-44, which is why only the
            // 9-and-above case needs converting.
            client.gameMode.handleContainerInput(
                    player.inventoryMenu.containerId, slot, SCRATCH_SLOT,
                    ContainerInput.SWAP, player);
            player.getInventory().setSelectedSlot(SCRATCH_SLOT);
            return true;
        }
        return false;
    }
}

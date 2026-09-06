package dev.understudy.mc;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.screen.slot.SlotActionType;

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
        return stack.isEmpty() ? null : Registries.ITEM.getId(stack.getItem()).getPath();
    }

    /** How many of an item the player is carrying, hotbar included. */
    public static int count(ClientPlayerEntity player, String itemName) {
        int total = 0;
        for (int i = 0; i < player.getInventory().size(); i++) {
            ItemStack stack = player.getInventory().getStack(i);
            if (itemName.equals(nameOf(stack))) total += stack.getCount();
        }
        return total;
    }

    /**
     * Put `itemName` in the player's hand, moving it to the hotbar if needed.
     * Returns false when there is none to hold.
     */
    public static boolean hold(MinecraftClient client, String itemName) {
        ClientPlayerEntity player = client.player;
        if (player == null) return false;

        // Already in the hotbar: just select it.
        for (int slot = 0; slot < 9; slot++) {
            if (itemName.equals(nameOf(player.getInventory().getStack(slot)))) {
                player.getInventory().setSelectedSlot(slot);
                return true;
            }
        }

        // In the main inventory: swap it down into the scratch slot.
        for (int slot = 9; slot < player.getInventory().size(); slot++) {
            if (!itemName.equals(nameOf(player.getInventory().getStack(slot)))) continue;
            if (client.interactionManager == null) return false;
            // Main inventory slots keep their index in the player screen
            // handler; the hotbar sits at 36-44, which is why only the
            // 9-and-above case needs converting.
            client.interactionManager.clickSlot(
                    player.playerScreenHandler.syncId, slot, SCRATCH_SLOT,
                    SlotActionType.SWAP, player);
            player.getInventory().setSelectedSlot(SCRATCH_SLOT);
            return true;
        }
        return false;
    }
}

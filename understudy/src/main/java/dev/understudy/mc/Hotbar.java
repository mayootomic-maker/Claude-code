package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.item.Item;
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
     * How much life is left in the best one of these, from one to nothing.
     *
     * Returns one for anything that does not wear out, so a caller can ask the
     * question of everything without knowing which things have durability.
     *
     * This exists because the mod handled a broken pickaxe well and a nearly
     * broken one not at all: the recovery is to work out what a fresh one costs
     * and go and get the materials, which at the bottom of a mine means walking
     * back up. Noticing thirty blocks earlier — while standing on the
     * cobblestone a new one is made of — is the same recovery for none of the
     * walk.
     */
    public static double lifeLeft(LocalPlayer player, String itemName) {
        double best = 0;
        boolean found = false;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (!itemName.equals(nameOf(stack))) continue;
            found = true;
            if (!stack.isDamageableItem()) return 1;
            double left = 1 - stack.getDamageValue() / (double) stack.getMaxDamage();
            best = Math.max(best, left);
        }
        return found ? best : 0;
    }

    /**
     * Whether the game is handing out blocks.
     *
     * In creative there is no such thing as not having something, and a builder
     * that walks off to mine cobblestone in creative mode is not being careful,
     * it is being obtuse.
     */
    public static boolean creative(LocalPlayer player) {
        return player != null && player.getAbilities().instabuild;
    }

    /**
     * Hold it, and in creative simply have it.
     *
     * This is the whole of why a build did nothing on the first real run. The
     * builder asks for a block, `hold` cannot find one, and every placement is
     * counted as skipped — six thousand times, in a creative world where the
     * blocks were always available for the asking.
     */
    public static boolean holdOrConjure(Minecraft client, String itemName) {
        if (hold(client, itemName)) return true;
        LocalPlayer player = client.player;
        if (player == null || client.gameMode == null || !creative(player)) return false;

        Item item = itemNamed(itemName);
        if (item == null) return false;
        ItemStack stack = new ItemStack(item, item.getDefaultMaxStackSize());
        player.getInventory().setItem(SCRATCH_SLOT, stack);
        player.getInventory().setSelectedSlot(SCRATCH_SLOT);
        // The server has to be told, or the stack exists on this client only and
        // every placement is rejected — which looks exactly like the bug above.
        client.gameMode.handleCreativeModeItemAdd(stack, HOTBAR_IN_MENU + SCRATCH_SLOT);
        return true;
    }

    /** Where the hotbar sits in the player's own screen handler. */
    private static final int HOTBAR_IN_MENU = 36;

    /**
     * An item by its plain name.
     *
     * The registry is walked and cached rather than asked for an identifier,
     * because building one means naming a class this version renamed — and the
     * rest of this mod already resolves blocks the same way for the same reason.
     */
    private static Item itemNamed(String name) {
        if (BY_NAME.isEmpty()) {
            for (Item item : BuiltInRegistries.ITEM) {
                BY_NAME.put(BuiltInRegistries.ITEM.getKey(item).getPath(), item);
            }
        }
        return BY_NAME.get(name);
    }

    private static final java.util.Map<String, Item> BY_NAME = new java.util.HashMap<>();

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

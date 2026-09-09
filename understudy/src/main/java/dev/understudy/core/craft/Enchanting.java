package dev.understudy.core.craft;

import java.util.List;

/**
 * Whether to enchant this, now, with that.
 *
 * The mod would mine diamonds, make a diamond pickaxe, and then mine with a
 * plain diamond pickaxe for the rest of the session. Efficiency alone is
 * roughly double the mining speed for every block after it, and Unbreaking is
 * three times the tool — so this is the largest permanent speed increase
 * available anywhere in the game, and it was simply not being taken.
 *
 * What makes it a decision rather than a button is that an item can only be
 * enchanted at a table once. Whatever comes out is what that pickaxe is for the
 * rest of its life. So the mistake everybody makes at least once — taking the
 * cheap offer because it is affordable right now — is permanent, and it is
 * exactly the mistake a mod with perfect patience should never make.
 *
 * Three rules, in the order they bind:
 *
 *  - Fifteen bookshelves or wait. Below that the table cannot offer the good
 *    enchantments at all, and spending the item's one chance on what a bare
 *    table can produce is the whole error.
 *  - The top offer or wait. Levels come back; the pickaxe does not.
 *  - Lapis is cheap and it is not free.
 *
 * No Minecraft types, so all of it is tested.
 */
public final class Enchanting {

    /** One of the three lines on the table, as the screen shows it. */
    public record Offer(int slot, int levelCost, String hint) {}

    public enum Act {
        /** Take this offer. */
        ENCHANT,
        /** Not enough shelves for the table to offer anything worth having. */
        BUILD_SHELVES,
        /** The good offer is there and unaffordable. Come back. */
        EARN_LEVELS,
        /** Three lapis is the price of admission. */
        GET_LAPIS,
        /** Nothing on the table is worth this item's one chance. */
        WAIT
    }

    public record Choice(Act act, int slot, String because) {}

    /**
     * What a full set of bookshelves is.
     *
     * Fifteen, and the number is not a preference: it is the point at which the
     * table can offer level thirty, and level thirty is where the enchantments
     * worth having live. Fourteen is meaningfully worse and looks identical.
     */
    public static final int FULL_SHELVES = 15;
    /** Lapis per enchant, at the top slot. */
    public static final int LAPIS_FOR_THE_TOP = 3;

    private Enchanting() {}

    /**
     * The one decision.
     *
     * @param level       experience levels in hand
     * @param lapis       lapis lazuli in the bag
     * @param bookshelves shelves within range of the table
     * @param offers      the three lines the table is showing, any of which may
     *                    be absent when the table cannot offer that slot yet
     */
    public static Choice decide(int level, int lapis, int bookshelves, List<Offer> offers) {
        if (offers.isEmpty()) {
            return new Choice(Act.WAIT, -1, "the table is not offering anything");
        }
        if (bookshelves < FULL_SHELVES) {
            return new Choice(Act.BUILD_SHELVES, -1,
                    bookshelves + " bookshelves of " + FULL_SHELVES
                            + " — an item gets one enchant ever, and this table cannot"
                            + " offer the good ones yet");
        }
        if (lapis < LAPIS_FOR_THE_TOP) {
            return new Choice(Act.GET_LAPIS, -1,
                    "needs " + LAPIS_FOR_THE_TOP + " lapis and has " + lapis);
        }

        Offer best = top(offers);
        if (level < best.levelCost()) {
            return new Choice(Act.EARN_LEVELS, -1,
                    "level " + level + " of " + best.levelCost()
                            + " — levels come back, the pickaxe does not");
        }
        return new Choice(Act.ENCHANT, best.slot(),
                "slot " + (best.slot() + 1) + " at level " + best.levelCost()
                        + (best.hint() == null || best.hint().isBlank()
                                ? "" : ": " + best.hint()));
    }

    /**
     * The dearest offer on the table.
     *
     * Dearest rather than cheapest, which is the opposite of how the rest of
     * this mod chooses anything and is right here for one reason: the cost is
     * levels, which regenerate, and the thing being spent is an item's only
     * chance at ever being enchanted.
     */
    public static Offer top(List<Offer> offers) {
        Offer best = null;
        for (Offer offer : offers) {
            if (offer.levelCost() <= 0) continue; // a slot the table cannot fill yet
            if (best == null || offer.levelCost() > best.levelCost()) best = offer;
        }
        return best == null ? offers.get(0) : best;
    }

    /** Whether enchanting this is worth anyone's time. */
    public static boolean worthEnchanting(String item) {
        if (item == null) return false;
        return item.endsWith("_pickaxe") || item.endsWith("_axe") || item.endsWith("_shovel")
                || item.endsWith("_sword") || item.endsWith("_helmet")
                || item.endsWith("_chestplate") || item.endsWith("_leggings")
                || item.endsWith("_boots") || item.equals("bow") || item.equals("crossbow")
                || item.equals("trident") || item.equals("shears") || item.equals("book");
    }
}

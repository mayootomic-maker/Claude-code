package dev.understudy.core.gear;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What goes in a chest you leave behind in case you die.
 *
 * A death chest is not a storage chest and the difference is the whole design.
 * Storage is about everything you own; this is about the twenty minutes after
 * you respawn with nothing, in your underwear, a thousand blocks from your
 * things. So it holds one of each of the four tools, one set of armour, a
 * weapon, food, torches, and enough stone to wall yourself in — and nothing
 * else, because a chest with sixty items in it is a chest you have to read.
 *
 * The rule that makes it safe to use is `keepBack`. Stocking a spare set is
 * only sensible if it does not strip the set you are wearing: donating your
 * only pickaxe to a box and then walking into a cave is worse than not having
 * the box at all. Every line says how many of that thing must stay with you,
 * and only the surplus above that is ever given away. In creative there is no
 * surplus and no scarcity, so the whole list is simply granted.
 *
 * There is no Minecraft in here, which is what lets the tests check the
 * arithmetic — and the arithmetic is the part that can quietly rob you.
 */
public final class Kit {
    private Kit() {}

    /** The block the kit goes into. Named once so nothing has to spell it. */
    public static final String CONTAINER = "chest";

    /** A single chest is 27 slots; the list is kept comfortably inside that. */
    public static final int SLOTS = 27;

    /**
     * @param item     registry path, the same plain name the rest of the mod uses
     * @param want     how many to put in the chest
     * @param keepBack how many must stay in your own inventory, always
     */
    public record Line(String item, int want, int keepBack) {}

    /**
     * One line of the kit and the most of it that may leave your inventory.
     *
     * A ceiling rather than a promise, and the distinction is real. In creative
     * the stack is conjured to exactly this size, so it is also the amount. In
     * survival the mod moves whole stacks — there is no click that moves
     * twenty-four of a stack of forty, only sequences of clicks that take
     * seconds each — so it moves the stacks that fit under this and leaves the
     * rest alone. Under-filling the chest is a disappointment; going below
     * `keepBack` is how you die, so the ceiling is the side it errs on.
     */
    public record Give(String item, int count) {}

    /**
     * @param giving  what can be put in, in kit order
     * @param shortOf what cannot, because there is none spare
     */
    public record Stocked(List<Give> giving, List<String> shortOf) {
        public boolean isEmpty() {
            return giving.isEmpty();
        }

        public int items() {
            int total = 0;
            for (Give give : giving) total += give.count();
            return total;
        }
    }

    /**
     * The kit, in the order it matters after a death.
     *
     * Armour and a sword first because whatever killed you is still there;
     * then the tools, then the things that keep you alive while you walk back.
     * A partial stock is therefore still a useful one, which matters in
     * survival where it usually will be partial.
     */
    public static List<Line> recovery() {
        return List.of(
                new Line("iron_sword", 1, 1),
                new Line("shield", 1, 1),
                new Line("iron_helmet", 1, 1),
                new Line("iron_chestplate", 1, 1),
                new Line("iron_leggings", 1, 1),
                new Line("iron_boots", 1, 1),
                new Line("iron_pickaxe", 1, 1),
                new Line("iron_axe", 1, 1),
                new Line("iron_shovel", 1, 1),
                new Line("cooked_beef", 32, 8),
                new Line("torch", 64, 16),
                new Line("cobblestone", 64, 32),
                new Line("oak_log", 16, 16),
                new Line("crafting_table", 1, 1),
                new Line("water_bucket", 1, 1),
                new Line("coal", 32, 16));
    }

    /**
     * Work out what this inventory can actually spare.
     *
     * `free` is creative: there is no such thing as not having something, so
     * the list is granted whole and nothing is short. Everywhere else the
     * surplus above `keepBack` is the ceiling, and a line with no surplus is
     * reported rather than silently dropped — a chest that is missing the
     * pickaxe should say so while you are standing next to it, not when you
     * come back to it dead.
     */
    public static Stocked from(Map<String, Integer> carried, boolean free) {
        List<Give> giving = new ArrayList<>();
        List<String> shortOf = new ArrayList<>();
        for (Line line : recovery()) {
            int count = free ? line.want() : spare(carried, line);
            if (count > 0) giving.add(new Give(line.item(), count));
            else shortOf.add(line.item());
        }
        return new Stocked(List.copyOf(giving), List.copyOf(shortOf));
    }

    /** How many of this line may leave the inventory, never below keepBack. */
    public static int spare(Map<String, Integer> carried, Line line) {
        int have = carried.getOrDefault(line.item(), 0);
        return Math.max(0, Math.min(line.want(), have - line.keepBack()));
    }

    /**
     * The kit as a shopping list, for someone who wants to stock one properly.
     *
     * Want plus keepBack, because to put a spare pickaxe in a box you need two
     * pickaxes — which is the thing that is obvious afterwards and not before.
     */
    public static Map<String, Integer> shoppingList() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Line line : recovery()) out.put(line.item(), line.want() + line.keepBack());
        return out;
    }

    /** One line of chat: what it is going to try to put in. */
    public static String describe(Stocked stocked) {
        if (stocked.isEmpty()) return "nothing";
        List<String> parts = new ArrayList<>();
        for (Give give : stocked.giving()) {
            parts.add(give.count() == 1 ? give.item() : give.count() + " " + give.item());
        }
        return String.join(", ", parts);
    }
}

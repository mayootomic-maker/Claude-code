package dev.understudy.core.sort;

import java.util.List;
import java.util.Map;

/**
 * What it would cost to throw this away.
 *
 * There for one situation, and it is a situation the mod used to simply lose
 * to: the bag fills up halfway through a job and everything stops. The message
 * was honest — "your inventory is full, nothing else will fit" — and the
 * behaviour was not what a person does. A person glances at the bag, throws out
 * the two stacks of cobblestone they picked up on the way down, and carries on.
 *
 * So this answers one question: of everything being carried, what is the least
 * painful thing to be rid of. It is deliberately conservative, because being
 * wrong here means destroying something of someone else's:
 *
 *  - Only a fixed list of genuinely plentiful stone and dirt is ever a
 *    candidate. Not "the cheapest thing in the bag" — the cheapest thing in a
 *    bag of diamonds is still a diamond.
 *  - Nothing the current job asked for, however plentiful, because the whole
 *    point of the job may be six hundred cobblestone.
 *  - Nothing that is a tool, a weapon, armour, food or a light, at any price.
 *
 * If nothing qualifies, the answer is nothing, and stopping with an honest
 * message is still the right behaviour — it is just no longer the first one.
 */
public final class Worth {

    /**
     * Blocks the world has effectively an unlimited supply of, and which
     * everyone throws away.
     *
     * A list rather than a rule, for the same reason the gather sources are a
     * list: every rule that tries to derive "is this plentiful" gets the
     * exceptions wrong in both directions, and being wrong here throws away
     * someone's blocks.
     */
    private static final List<String> SPOIL = List.of(
            "cobblestone", "stone", "cobbled_deepslate", "deepslate", "granite", "diorite",
            "andesite", "tuff", "dirt", "gravel", "netherrack", "sand", "sandstone",
            "rotten_flesh", "dead_bush", "cobweb", "calcite", "smooth_basalt", "basalt",
            "blackstone", "end_stone", "flint", "kelp", "seagrass", "poisonous_potato");

    /** Below this many of a thing, it is not spare, whatever it is. */
    private static final int A_SPARE_STACK = 64;

    private Worth() {}

    public static boolean spoil(String item) {
        return SPOIL.contains(item);
    }

    /**
     * The best thing to throw away to make room, or null when there is nothing
     * that can be thrown away in good conscience.
     *
     * Biggest pile first, because the point is to free a slot and the biggest
     * pile is the one most likely to be sitting in several of them.
     *
     * @param needed what the job is for. Never a candidate, however common —
     *               a gather of six hundred cobblestone must not decide the
     *               cobblestone is the problem.
     */
    public static String leastMissed(Map<String, Integer> carried, java.util.Set<String> needed) {
        String best = null;
        int most = 0;
        for (Map.Entry<String, Integer> held : carried.entrySet()) {
            String item = held.getKey();
            if (!spoil(item) || needed.contains(item)) continue;
            if (held.getValue() < A_SPARE_STACK) continue;
            if (held.getValue() > most) {
                most = held.getValue();
                best = item;
            }
        }
        return best;
    }

    /**
     * Whether this is something to keep no matter what.
     *
     * Not used to choose what to drop — the spoil list already handles that —
     * but as the second half of the same rule, so anything that ever grows a
     * cleverer way of choosing has to get past this too.
     */
    public static boolean precious(String item) {
        Category category = Category.of(item);
        return category == Category.TOOLS || category == Category.WEAPONS
                || category == Category.ARMOUR || category == Category.FOOD
                || category == Category.VALUABLES || category == Category.BREWING;
    }
}

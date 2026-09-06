package dev.understudy.core.craft;

/**
 * How a thing enters the world in the first place: a block you break, or an
 * animal you find.
 *
 * Only what is listed here can be gathered, and that is load-bearing. An
 * earlier version of this planner decided the cheapest way to get iron was to
 * mine an iron block, and the cheapest way to get redstone was to mine redstone
 * wire — both of which are things players make, not things the world contains.
 * Deriving "is this natural?" from a rule about craftability got the exceptions
 * wrong in both directions. A list is dull and it is right.
 *
 * The two time fields are deliberately separate, because one is known and the
 * other is a guess, and mixing them would hide which is which.
 *
 * @param item        what you end up holding
 * @param amount      how many one block yields
 * @param digSeconds  break time from the vanilla formula: hardness * 1.5 / tool
 *                    speed. A fact about the game.
 * @param findSeconds rough time to find a deposit — travel and searching, paid
 *                    once per trip and not per block. An estimate, and the only
 *                    guessed number in the model. It exists because a plan that
 *                    treats iron ore and grass as equally available is not a
 *                    plan. Only the ratios matter.
 * @param perTrip     how many you get before having to go and find another one.
 *                    A tree is about five logs; once you are standing in a
 *                    deepslate layer there is effectively no limit. Charging the
 *                    search per block instead made six hundred deepslate cost
 *                    five hours of "finding" while standing in the middle of it.
 * @param tool        the tool that must be held, or null when bare hands will do
 * @param toolUses    durability of that tool, for amortising its cost per block
 * @param bestY       the height this is most common at, or ANYWHERE for things
 *                    found wherever you happen to be standing. Ore does not
 *                    come to you: without this the gatherer looks around, sees
 *                    no diamond on the surface, and says so — which is true and
 *                    useless. With it, it knows where to go and dig.
 * @param from        the blocks that drop it. Usually one name, but iron comes
 *                    out of both iron_ore and deepslate_iron_ore, and a gatherer
 *                    that only knows the first walks past half the ore it sees.
 */
public record Gather(String item, int amount, double digSeconds, double findSeconds,
                     int perTrip, String tool, int toolUses, int bestY,
                     java.util.List<String> from) {

    /** Found at whatever height you are already at: wood, sand, animals. */
    public static final int ANYWHERE = Integer.MIN_VALUE;

    public boolean underground() {
        return bestY != ANYWHERE;
    }

    /** Time for one block: the dig, plus this block's share of finding the deposit. */
    public double seconds() {
        return digSeconds + findSeconds / Math.max(1, perTrip);
    }

    public double perUnit() {
        return seconds() / Math.max(1, amount);
    }

    public static Gather byHand(String item, double digSeconds, double findSeconds, int perTrip,
                                String... from) {
        return new Gather(item, 1, digSeconds, findSeconds, perTrip, null, 0, ANYWHERE,
                blocks(item, from));
    }

    public static Gather with(String item, double digSeconds, double findSeconds, int perTrip,
                              String tool, int toolUses, String... from) {
        return new Gather(item, 1, digSeconds, findSeconds, perTrip, tool, toolUses, ANYWHERE,
                blocks(item, from));
    }

    /**
     * Something you have to go down for, with the height it is most common at.
     *
     * The numbers are the game's own distribution peaks — diamond at -59, gold
     * at -16, iron at 15 — rather than folklore. They are where a strip mine
     * goes, and being a dozen blocks out costs time, not correctness.
     */
    public static Gather deep(String item, double digSeconds, double findSeconds, int perTrip,
                              String tool, int toolUses, int bestY, String... from) {
        return new Gather(item, 1, digSeconds, findSeconds, perTrip, tool, toolUses, bestY,
                blocks(item, from));
    }

    /** Most things drop from the block of the same name; the rest say so. */
    private static java.util.List<String> blocks(String item, String[] from) {
        return from.length == 0 ? java.util.List.of(item) : java.util.List.of(from);
    }
}

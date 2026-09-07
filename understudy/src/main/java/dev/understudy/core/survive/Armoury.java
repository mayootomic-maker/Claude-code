package dev.understudy.core.survive;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What you are wearing, and what you should be.
 *
 * The mod fought bare-chested. It would happily carry a full set of iron in the
 * bag while trading hits with a zombie in a shirt, which is not a subtle
 * mistake — a full iron set is eighty per cent damage reduction, so it is the
 * difference between a fight costing two hearts and costing ten, and it is
 * available for free at the moment the fight starts.
 *
 * The numbers are the game's own. Armour points reduce damage by four per cent
 * each up to eighty; toughness, which only diamond and netherite have, blunts
 * the big hits specifically, which is why a diamond set survives a creeper and
 * an iron set does not. Both are here because the difference decides whether
 * standing next to something is a plan.
 *
 * No Minecraft types, so all of it is tested.
 */
public final class Armoury {

    /** The four places a piece can go. Order is head to foot, as it is worn. */
    public enum Slot { HEAD, CHEST, LEGS, FEET }

    /** One piece: what it is worth, and where it goes. */
    public record Piece(String item, Slot slot, int points, double toughness) {}

    /**
     * Every piece worth wearing, best material last.
     *
     * Written out rather than derived from a pattern, for the same reason the
     * building materials are: the pattern does not hold. Chainmail is
     * "chainmail_helmet" and gold is "golden_helmet", leather leggings are the
     * only leather piece worth more than one point, and a turtle shell is a
     * helmet that is not called one.
     */
    private static final List<Piece> PIECES = List.of(
            new Piece("leather_helmet", Slot.HEAD, 1, 0),
            new Piece("leather_chestplate", Slot.CHEST, 3, 0),
            new Piece("leather_leggings", Slot.LEGS, 2, 0),
            new Piece("leather_boots", Slot.FEET, 1, 0),

            new Piece("golden_helmet", Slot.HEAD, 2, 0),
            new Piece("golden_chestplate", Slot.CHEST, 5, 0),
            new Piece("golden_leggings", Slot.LEGS, 3, 0),
            new Piece("golden_boots", Slot.FEET, 1, 0),

            new Piece("chainmail_helmet", Slot.HEAD, 2, 0),
            new Piece("chainmail_chestplate", Slot.CHEST, 5, 0),
            new Piece("chainmail_leggings", Slot.LEGS, 4, 0),
            new Piece("chainmail_boots", Slot.FEET, 1, 0),

            new Piece("turtle_helmet", Slot.HEAD, 2, 0),

            new Piece("iron_helmet", Slot.HEAD, 2, 0),
            new Piece("iron_chestplate", Slot.CHEST, 6, 0),
            new Piece("iron_leggings", Slot.LEGS, 5, 0),
            new Piece("iron_boots", Slot.FEET, 2, 0),

            new Piece("diamond_helmet", Slot.HEAD, 3, 2),
            new Piece("diamond_chestplate", Slot.CHEST, 8, 2),
            new Piece("diamond_leggings", Slot.LEGS, 6, 2),
            new Piece("diamond_boots", Slot.FEET, 3, 2),

            new Piece("netherite_helmet", Slot.HEAD, 3, 3),
            new Piece("netherite_chestplate", Slot.CHEST, 8, 3),
            new Piece("netherite_leggings", Slot.LEGS, 6, 3),
            new Piece("netherite_boots", Slot.FEET, 3, 3));

    /** Full diamond. The ceiling worth comparing anything against. */
    public static final int BEST_POSSIBLE = 20;

    private Armoury() {}

    public static Piece of(String item) {
        for (Piece piece : PIECES) if (piece.item().equals(item)) return piece;
        return null;
    }

    public static boolean isArmour(String item) {
        return of(item) != null;
    }

    /**
     * The best thing in the bag for each slot.
     *
     * Compared by points and then by toughness, so a diamond helmet beats an
     * iron one and an iron one beats a chainmail one of the same value — which
     * matters because the tie is common and the wrong side of it is a worse
     * helmet worn for the rest of the session.
     */
    public static Map<Slot, String> bestSet(Map<String, Integer> carried) {
        Map<Slot, Piece> best = new LinkedHashMap<>();
        for (Piece piece : PIECES) {
            if (carried.getOrDefault(piece.item(), 0) <= 0) continue;
            Piece standing = best.get(piece.slot());
            if (standing == null || better(piece, standing)) best.put(piece.slot(), piece);
        }
        Map<Slot, String> out = new LinkedHashMap<>();
        for (Slot slot : Slot.values()) {
            Piece piece = best.get(slot);
            if (piece != null) out.put(slot, piece.item());
        }
        return out;
    }

    private static boolean better(Piece candidate, Piece standing) {
        if (candidate.points() != standing.points()) return candidate.points() > standing.points();
        return candidate.toughness() > standing.toughness();
    }

    /** Armour points of a worn set, out of twenty. */
    public static int pointsOf(Map<Slot, String> worn) {
        int total = 0;
        for (String item : worn.values()) {
            Piece piece = of(item);
            if (piece != null) total += piece.points();
        }
        return total;
    }

    public static double toughnessOf(Map<Slot, String> worn) {
        double total = 0;
        for (String item : worn.values()) {
            Piece piece = of(item);
            if (piece != null) total += piece.toughness();
        }
        return total;
    }

    /**
     * What fraction of an incoming hit gets through.
     *
     * The game's own formula, and it is not linear in either input, which is
     * the whole reason it is written down rather than estimated: four points of
     * armour stop sixteen per cent of everything, and two points of toughness
     * change how a twenty-damage creeper lands far more than another two points
     * of armour would.
     *
     * @param damage the size of the incoming hit, because toughness only helps
     *               against the big ones
     */
    public static double taken(int points, double toughness, double damage) {
        double reduction = Math.min(20, Math.max(points / 5.0,
                points - damage / (2 + toughness / 4)));
        return 1 - reduction / 25.0;
    }

    /** How complete a set is, from nothing to full diamond. */
    public static double fractionOfBest(Map<Slot, String> worn) {
        return pointsOf(worn) / (double) BEST_POSSIBLE;
    }

    /**
     * How many times more punishment a set absorbs than bare skin.
     *
     * Capped, and the cap is the point. Full diamond really does cut an
     * ordinary hit to about a quarter, but four times the headroom is not four
     * times the hearts: a creeper at point blank still ends a fight at two
     * hearts however good the trousers are. So this is allowed to move where
     * the lines are and not to move them somewhere silly.
     *
     * @param typicalHit the size of hit to reckon against, since toughness only
     *                   helps against the big ones
     */
    public static double survivability(int points, double toughness, double typicalHit) {
        double through = Math.max(0.2, taken(points, toughness, typicalHit));
        return Math.min(2.0, 1 / through);
    }

    /** Every armour piece, for anything that needs to know what one looks like. */
    public static List<Piece> all() {
        return PIECES;
    }
}

package dev.understudy.core.adapt;

import java.util.List;
import java.util.Map;

/**
 * What the mod has learned about how you play.
 *
 * The point is that "do it the way I would" is not something you should have to
 * configure. If you always bridge across ravines rather than climbing down, the
 * pathfinder should bridge. If every house you build is spruce, a house it
 * builds for you should be spruce. If you mine at y=-54, that is where it looks
 * for diamonds.
 *
 * Everything here is derived from watching, and everything decays, so the
 * profile follows you rather than fossilising around whatever you happened to
 * do first. A brand-new profile answers every question with a sensible default
 * and says it is not confident yet, which is what `confidence` is for — the mod
 * should not reorganise your base on the strength of six observations.
 */
public final class PlayerProfile {

    /** Observations before the profile trusts itself on a given signal. */
    private static final double CONFIDENT_AT = 40;

    private final Tally placed = new Tally();
    private final Tally mined = new Tally();
    private final Tally crafted = new Tally();
    private final Tally biomes = new Tally();
    /** Depth histogram, keyed by 8-block band, e.g. "-56" for y in [-56,-49]. */
    private final Tally depths = new Tally();

    private double travelled;
    private double sprinted;
    private double dug;
    private double bridged;
    private double swam;
    private double fightsSeen;
    private double fightsTaken;
    private double sessionTicks;

    // ------------------------------------------------------------- observing

    public void placedBlock(String block) {
        placed.add(block);
    }

    public void minedBlock(String block, int y) {
        mined.add(block);
        if (isOre(block)) depths.add(band(y));
    }

    public void craftedItem(String item, int count) {
        crafted.add(item, Math.max(1, count));
    }

    public void enteredBiome(String biome) {
        biomes.add(biome);
    }

    /**
     * A stretch of the player's own travel, and how they got through it.
     *
     * These are the signals that tune the pathfinder to your habits: someone
     * who tunnels through hills wants a route that tunnels, and someone who
     * never touches water wants one that goes round.
     */
    public void travelled(double blocks, boolean sprinting, boolean digging, boolean bridging, boolean swimming) {
        if (blocks <= 0) return;
        travelled += blocks;
        if (sprinting) sprinted += blocks;
        if (digging) dug += blocks;
        if (bridging) bridged += blocks;
        if (swimming) swam += blocks;
    }

    public void sawHostile(boolean engaged) {
        fightsSeen++;
        if (engaged) fightsTaken++;
    }

    public void tick() {
        sessionTicks++;
    }

    // ------------------------------------------------------------ preferences

    /** The block you build with most, or null if you have not built enough yet. */
    public String favouriteBuildingBlock() {
        return placed.total() >= 12 ? placed.favourite() : null;
    }

    /** Your building blocks in order, for filling out a whole palette. */
    public List<String> buildingBlocks(int limit) {
        return placed.top(limit);
    }

    public List<String> mostMined(int limit) {
        return mined.top(limit);
    }

    public String favouriteBiome() {
        return biomes.favourite();
    }

    /**
     * The y-level you actually mine at.
     *
     * Worth more than it sounds: it is the difference between the mod searching
     * for diamonds where the wiki says they are and searching where *you* have
     * been finding them, which accounts for your world's caves and your habits
     * at once.
     */
    public Integer preferredMiningDepth() {
        String band = depths.favourite();
        if (band == null || depths.total() < 8) return null;
        try {
            return Integer.parseInt(band);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 0 = never digs through, 1 = tunnels everywhere. */
    public double digTolerance() {
        return ratio(dug);
    }

    /** 0 = always goes round a gap, 1 = bridges it. */
    public double bridgeTolerance() {
        return ratio(bridged);
    }

    /** 0 = avoids water, 1 = swims happily. */
    public double swimTolerance() {
        return ratio(swam);
    }

    /** 0 = walks everywhere, 1 = always sprinting. */
    public double haste() {
        return ratio(sprinted);
    }

    /** 0 = avoids every fight, 1 = takes all of them. */
    public double aggression() {
        return fightsSeen < 4 ? 0.5 : fightsTaken / fightsSeen;
    }

    private double ratio(double part) {
        return travelled <= 0 ? 0.5 : clamp(part / travelled);
    }

    /**
     * How much to trust the profile at all, 0 to 1.
     *
     * Reported rather than hidden, so the caller can behave differently when
     * the mod is guessing: a fresh profile should fall back to sane defaults
     * instead of confidently imitating six minutes of play.
     */
    public double confidence() {
        double signals = Math.min(placed.total(), CONFIDENT_AT)
                + Math.min(mined.total(), CONFIDENT_AT)
                + Math.min(travelled / 20, CONFIDENT_AT);
        return clamp(signals / (CONFIDENT_AT * 3));
    }

    public boolean confident() {
        return confidence() >= 0.5;
    }

    /** How much of the day you have actually spent playing this session. */
    public double sessionMinutes() {
        return sessionTicks / 20.0 / 60.0;
    }

    // --------------------------------------------------------- serialisation

    public Map<String, Object> save() {
        return Map.of(
                "placed", placed.snapshot(),
                "mined", mined.snapshot(),
                "crafted", crafted.snapshot(),
                "biomes", biomes.snapshot(),
                "depths", depths.snapshot(),
                "travel", Map.of(
                        "total", travelled,
                        "sprinted", sprinted,
                        "dug", dug,
                        "bridged", bridged,
                        "swam", swam),
                "combat", Map.of("seen", fightsSeen, "taken", fightsTaken));
    }

    @SuppressWarnings("unchecked")
    public void load(Map<String, Object> saved) {
        if (saved == null) return;
        placed.restore((Map<String, Double>) saved.get("placed"));
        mined.restore((Map<String, Double>) saved.get("mined"));
        crafted.restore((Map<String, Double>) saved.get("crafted"));
        biomes.restore((Map<String, Double>) saved.get("biomes"));
        depths.restore((Map<String, Double>) saved.get("depths"));

        Map<String, Object> travel = (Map<String, Object>) saved.get("travel");
        if (travel != null) {
            travelled = number(travel.get("total"));
            sprinted = number(travel.get("sprinted"));
            dug = number(travel.get("dug"));
            bridged = number(travel.get("bridged"));
            swam = number(travel.get("swam"));
        }
        Map<String, Object> combat = (Map<String, Object>) saved.get("combat");
        if (combat != null) {
            fightsSeen = number(combat.get("seen"));
            fightsTaken = number(combat.get("taken"));
        }
    }

    private static double number(Object value) {
        return value instanceof Number n ? n.doubleValue() : 0;
    }

    /** Eight-block bands, so a y-level histogram does not have 400 buckets. */
    static String band(int y) {
        return Integer.toString(Math.floorDiv(y, 8) * 8);
    }

    private static boolean isOre(String block) {
        return block != null && (block.contains("_ore") || block.equals("ancient_debris"));
    }

    private static double clamp(double v) {
        return v < 0 ? 0 : Math.min(v, 1);
    }
}

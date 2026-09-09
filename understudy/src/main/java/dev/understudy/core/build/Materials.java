package dev.understudy.core.build;

import java.util.List;

/**
 * The materials a build can be made of, as whole coordinated sets rather than
 * one block at a time.
 *
 * Picking "spruce" has to change the planks, the logs, the stairs, the slabs,
 * the fences, the door and the trapdoor together, because a house with spruce
 * walls and oak stairs looks like a mistake. So a choice is a set, not a block.
 *
 * The names are spelled out rather than derived from a pattern, because the
 * pattern does not hold: stone_bricks makes stone_brick_stairs without the s,
 * bricks makes brick_stairs, and getting that wrong produces a blueprint full of
 * blocks that do not exist — which fails at the last possible moment, in the
 * game, one block at a time.
 */
public final class Materials {

    /** Everything that follows from choosing a wood. */
    public record Wood(String name, String planks, String log, String strippedLog,
                       String stairs, String slab, String fence, String door,
                       String trapdoor, String sign) {}

    /** Everything that follows from choosing a masonry. */
    public record Stone(String name, String block, String stairs, String slab, String wall) {}

    private Materials() {}

    private static Wood wood(String name, String id) {
        return new Wood(name, id + "_planks", id + "_log", "stripped_" + id + "_log",
                id + "_stairs", id + "_slab", id + "_fence", id + "_door",
                id + "_trapdoor", id + "_sign");
    }

    private static final List<Wood> WOODS = List.of(
            wood("Oak", "oak"),
            wood("Spruce", "spruce"),
            wood("Birch", "birch"),
            wood("Jungle", "jungle"),
            wood("Acacia", "acacia"),
            wood("Dark oak", "dark_oak"),
            wood("Mangrove", "mangrove"),
            wood("Cherry", "cherry"));

    private static final List<Stone> STONES = List.of(
            new Stone("Cobblestone", "cobblestone", "cobblestone_stairs", "cobblestone_slab",
                    "cobblestone_wall"),
            new Stone("Stone brick", "stone_bricks", "stone_brick_stairs", "stone_brick_slab",
                    "stone_brick_wall"),
            new Stone("Deepslate brick", "deepslate_bricks", "deepslate_brick_stairs",
                    "deepslate_brick_slab", "deepslate_brick_wall"),
            new Stone("Brick", "bricks", "brick_stairs", "brick_slab", "brick_wall"),
            new Stone("Sandstone", "sandstone", "sandstone_stairs", "sandstone_slab",
                    "sandstone_wall"),
            new Stone("Andesite", "polished_andesite", "polished_andesite_stairs",
                    "polished_andesite_slab", "andesite_wall"),
            new Stone("Blackstone", "polished_blackstone", "polished_blackstone_stairs",
                    "polished_blackstone_slab", "polished_blackstone_wall"));

    public static List<Wood> woods() {
        return WOODS;
    }

    public static List<Stone> stones() {
        return STONES;
    }

    public static Wood wood(int index) {
        return WOODS.get(Math.floorMod(index, WOODS.size()));
    }

    public static Stone stone(int index) {
        return STONES.get(Math.floorMod(index, STONES.size()));
    }

    public static Wood woodNamed(String name) {
        for (Wood wood : WOODS) {
            if (wood.name().equalsIgnoreCase(name) || wood.planks().startsWith(lower(name))) return wood;
        }
        return WOODS.get(0);
    }

    public static Stone stoneNamed(String name) {
        for (Stone stone : STONES) {
            if (stone.name().equalsIgnoreCase(name) || stone.block().startsWith(lower(name))) return stone;
        }
        return STONES.get(1);
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(java.util.Locale.ROOT).replace(' ', '_');
    }
}

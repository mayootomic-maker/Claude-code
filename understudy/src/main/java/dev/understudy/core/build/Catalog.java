package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Everything the mod knows how to build, as a list rather than a switch.
 *
 * The picker, the /build command and its tab completion all read this, so a new
 * design appears in all three by adding one entry. The alternative — a switch in
 * the command and a hardcoded grid in the menu — is how a menu ends up offering
 * something the command cannot build.
 *
 * Size is a single number per design because a menu with three spinners per
 * entry is a worse menu. What that number means is the design's business: for a
 * house it is the width and the depth follows, for a tower it is the height.
 */
public final class Catalog {

    /**
     * @param id      what /build takes
     * @param name    what the menu shows
     * @param summary one line, so the menu can say what this actually is
     * @param minSize smallest sensible size
     * @param maxSize largest before it stops being a build and starts being a project
     */
    public record Entry(String id, String name, String summary,
                        int minSize, int maxSize, int defaultSize) {}

    private static final List<Entry> ENTRIES = List.of(
            new Entry("hut", "Shelter", "One room and a door. What you build when the sun is going down.",
                    3, 9, 5),
            new Entry("house", "House", "Rooms, windows, a gabled roof, and a bench to work at.",
                    5, 20, 9),
            new Entry("tower", "Tower", "A lookout with a ladder up the middle and a light on top.",
                    6, 24, 12),
            new Entry("storage", "Storage room", "Walls of chests, lit, with room to walk between them.",
                    2, 20, 6),
            new Entry("manor", "Manor",
                    "Two floors, a pitched roof and a chimney. Kitchen, workbench, table, "
                            + "beds, bookshelves and a wall of chests.",
                    11, 23, 15));

    private Catalog() {}

    public static List<Entry> entries() {
        return ENTRIES;
    }

    public static Entry byId(String id) {
        for (Entry entry : ENTRIES) if (entry.id().equals(id)) return entry;
        return null;
    }

    public static List<String> ids() {
        List<String> ids = new ArrayList<>();
        for (Entry entry : ENTRIES) ids.add(entry.id());
        return ids;
    }

    /** Build the blueprint an entry describes, at a size and in a material. */
    public static Blueprint build(Entry entry, int size, Materials.Wood wood,
                                  Materials.Stone stone) {
        return build(entry, size, wood, stone, Designs.paletteOf(wood, stone));
    }

    /**
     * The same, with the palette chosen separately.
     *
     * Two sources rather than one, and they are not redundant. The palette says
     * what the flat surfaces are made of, and can be overridden by what the
     * player actually builds with; the wood and stone say which *family* the
     * shaped pieces come from, which a palette of block names cannot express —
     * "oak_planks" does not tell you that the matching stair is oak_stairs and
     * the matching one for bricks is brick_stairs without the s.
     */
    public static Blueprint build(Entry entry, int size, Materials.Wood wood,
                                  Materials.Stone stone, Map<Blueprint.Role, String> palette) {
        int clamped = Math.max(entry.minSize(), Math.min(entry.maxSize(), size));
        return switch (entry.id()) {
            case "hut" -> Designs.hut(clamped, palette, wood, stone);
            // Depth follows width at roughly the proportions of a room you would
            // actually live in, rather than a square box.
            case "house" -> Designs.house(clamped, Math.max(5, clamped * 3 / 4), 4, palette,
                    wood, stone);
            case "tower" -> Designs.tower(clamped, 5, palette, wood, stone);
            case "storage" -> Designs.storage(clamped, palette, wood, stone);
            case "manor" -> Manor.build(clamped, wood, stone);
            default -> throw new IllegalArgumentException("no design called " + entry.id());
        };
    }

    public static Blueprint build(String id, int size, Materials.Wood wood,
                                  Materials.Stone stone) {
        Entry entry = byId(id);
        if (entry == null) throw new IllegalArgumentException("no design called " + id);
        return build(entry, size, wood, stone);
    }
}

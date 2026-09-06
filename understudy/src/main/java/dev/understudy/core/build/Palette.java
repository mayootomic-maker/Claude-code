package dev.understudy.core.build;

import java.util.HashMap;
import java.util.Map;

/**
 * What each block looks like, for drawing a preview of a structure that does
 * not exist yet.
 *
 * These are approximations of the average colour of each block's texture,
 * eyeballed against the game rather than sampled from it — the mod cannot read
 * a texture atlas at the point a menu needs to draw. That is fine for the job:
 * a preview has to show the shape of a building and which parts are wood, stone
 * or glass. It is not trying to be a screenshot.
 *
 * An unknown block gets a mid grey rather than throwing, because a new entry in
 * Designs should show up as a plain box, not as a crash in the menu.
 */
public final class Palette {

    private static final int UNKNOWN = 0xFF8A8A8A;

    private static final Map<String, Integer> COLOURS = buildColours();

    private static Map<String, Integer> buildColours() {
        Map<String, Integer> map = new HashMap<>();
        // Woods, keyed by the family name so planks, logs, stairs, slabs,
        // fences, doors and trapdoors all pick up the same colour without eight
        // entries each.
        family(map, "oak", 0xFFB08B54, 0xFF6B5330);
        family(map, "spruce", 0xFF7A5A34, 0xFF4B3721);
        family(map, "birch", 0xFFD7C9A0, 0xFFC8BD8B);
        family(map, "jungle", 0xFFB1805A, 0xFF564125);
        family(map, "acacia", 0xFFBA6337, 0xFF6A5B33);
        family(map, "dark_oak", 0xFF4B3218, 0xFF3B2A16);
        family(map, "mangrove", 0xFF773A31, 0xFF5A3428);
        family(map, "cherry", 0xFFE0B4B0, 0xFF6E4B50);

        masonry(map, "cobblestone", 0xFF7E7E7E);
        masonry(map, "stone_brick", 0xFF7A7A7A);
        masonry(map, "stone", 0xFF8F8F8F);
        masonry(map, "deepslate_brick", 0xFF4A4A4E);
        masonry(map, "brick", 0xFF97584B);
        masonry(map, "sandstone", 0xFFDBD3A0);
        masonry(map, "polished_andesite", 0xFF8A8A85);
        masonry(map, "polished_blackstone", 0xFF3B363E);
        masonry(map, "mud_brick", 0xFF9A7B62);

        map.put("glass", 0xFFC8E4E8);
        map.put("glass_pane", 0xFFC8E4E8);
        map.put("torch", 0xFFFFD966);
        map.put("lantern", 0xFFFFD966);
        map.put("white_wool", 0xFFEDEDED);
        map.put("white_bed", 0xFFB03030);
        map.put("chest", 0xFF8B6D3F);
        map.put("crafting_table", 0xFF8B6D3F);
        map.put("furnace", 0xFF6E6E6E);
        map.put("ladder", 0xFF9C7A49);
        map.put("bookshelf", 0xFF9A7B4F);
        map.put("dirt", 0xFF79553A);
        map.put("sand", 0xFFDBD3A0);
        return Map.copyOf(map);
    }

    /** Planks tone for the worked shapes, bark tone for the logs. */
    private static void family(Map<String, Integer> map, String id, int planks, int bark) {
        map.put(id + "_planks", planks);
        map.put(id + "_stairs", planks);
        map.put(id + "_slab", planks);
        map.put(id + "_fence", planks);
        map.put(id + "_door", mix(planks, bark));
        map.put(id + "_trapdoor", mix(planks, bark));
        map.put(id + "_sign", planks);
        map.put(id + "_log", bark);
        map.put("stripped_" + id + "_log", planks);
    }

    private static void masonry(Map<String, Integer> map, String id, int colour) {
        map.put(id, colour);
        map.put(id + "s", colour);
        map.put(id + "_stairs", colour);
        map.put(id + "_slab", colour);
        map.put(id + "_wall", colour);
    }

    private static int mix(int a, int b) {
        int r = (((a >> 16) & 0xFF) + ((b >> 16) & 0xFF)) / 2;
        int g = (((a >> 8) & 0xFF) + ((b >> 8) & 0xFF)) / 2;
        int bl = ((a & 0xFF) + (b & 0xFF)) / 2;
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }

    private Palette() {}

    public static int colourOf(String block) {
        return COLOURS.getOrDefault(block, UNKNOWN);
    }

    /** Whether a block should be drawn see-through, so windows read as windows. */
    public static boolean translucent(String block) {
        return block.contains("glass");
    }

    /** Lights are drawn at full brightness rather than shaded by face. */
    public static boolean emissive(String block) {
        return block.contains("torch") || block.contains("lantern");
    }
}

package dev.understudy.core.build;

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

    private static final Map<String, Integer> COLOURS = Map.ofEntries(
            Map.entry("oak_planks", 0xFFB08B54),
            Map.entry("oak_log", 0xFF6B5330),
            Map.entry("oak_stairs", 0xFFB08B54),
            Map.entry("oak_slab", 0xFFB08B54),
            Map.entry("oak_door", 0xFF7B5D34),
            Map.entry("oak_fence", 0xFF9C7A49),
            Map.entry("cobblestone", 0xFF7E7E7E),
            Map.entry("stone", 0xFF8F8F8F),
            Map.entry("stone_bricks", 0xFF7A7A7A),
            Map.entry("bricks", 0xFF97584B),
            Map.entry("glass", 0xFFC8E4E8),
            Map.entry("glass_pane", 0xFFC8E4E8),
            Map.entry("torch", 0xFFFFD966),
            Map.entry("white_wool", 0xFFEDEDED),
            Map.entry("white_bed", 0xFFB03030),
            Map.entry("chest", 0xFF8B6D3F),
            Map.entry("crafting_table", 0xFF8B6D3F),
            Map.entry("furnace", 0xFF6E6E6E),
            Map.entry("ladder", 0xFF9C7A49),
            Map.entry("bookshelf", 0xFF9A7B4F),
            Map.entry("dirt", 0xFF79553A),
            Map.entry("sand", 0xFFDBD3A0));

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

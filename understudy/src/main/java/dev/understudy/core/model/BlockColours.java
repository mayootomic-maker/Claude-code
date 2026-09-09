package dev.understudy.core.model;

import dev.understudy.core.build.Palette;
import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Solver;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Picks the closest block to a colour, from the blocks that can actually be got.
 *
 * The palette is built by intersecting "has a known colour" with "the planner
 * knows how to obtain one", so the matcher cannot propose something the mod
 * would then refuse to build. That constraint is the whole design: a matcher
 * over every block in the game gives lovely colour coverage and a build order
 * full of concrete nobody can make, because concrete needs dye and dye needs
 * flowers and none of that is in the catalogue.
 *
 * What is left is mostly earth tones — whites, greys, browns, one red, one
 * pink, one pale yellow — which is a genuine limitation and an honest one. A
 * model imported for its shape comes out right; a model imported for its
 * colours comes out muted.
 *
 * Distance is weighted toward green because eyes are: matching in flat RGB puts
 * noticeably wrong greens next to noticeably right blues.
 */
public final class BlockColours {

    /**
     * Colour-bearing blocks worth building with, in a rough spread from light to
     * dark. Only names the catalogue can reach; anything else is filtered out
     * below, so adding a recipe automatically widens the palette.
     */
    private static final List<String> CANDIDATES = List.of(
            "white_wool", "birch_planks", "sandstone", "cherry_planks",
            "oak_planks", "bricks", "mangrove_planks", "acacia_planks",
            "jungle_planks", "spruce_planks", "dark_oak_planks",
            "stone", "cobblestone", "polished_andesite", "stone_bricks",
            "gravel", "dirt", "cobbled_deepslate", "deepslate_bricks",
            "polished_blackstone", "glass");

    private static final Map<String, Integer> PALETTE = build();

    private BlockColours() {}

    private static Map<String, Integer> build() {
        Map<String, Solver.Cost> reachable = Catalogue.solver().solve(Map.of());
        Map<String, Integer> palette = new LinkedHashMap<>();
        for (String block : CANDIDATES) {
            Solver.Cost cost = reachable.get(block);
            if (cost == null || !cost.reachable()) continue;
            int colour = Palette.colourOf(block);
            palette.put(block, colour);
        }
        return Map.copyOf(palette);
    }

    public static Map<String, Integer> palette() {
        return PALETTE;
    }

    /** The closest buildable block to a colour. */
    public static String nearest(int argb) {
        String best = "stone";
        double nearest = Double.MAX_VALUE;
        for (Map.Entry<String, Integer> entry : PALETTE.entrySet()) {
            double distance = distance(argb, entry.getValue());
            if (distance < nearest) {
                nearest = distance;
                best = entry.getKey();
            }
        }
        return best;
    }

    static double distance(int a, int b) {
        double dr = ((a >> 16) & 0xFF) - ((b >> 16) & 0xFF);
        double dg = ((a >> 8) & 0xFF) - ((b >> 8) & 0xFF);
        double db = (a & 0xFF) - (b & 0xFF);
        // Roughly how much each channel contributes to perceived brightness.
        return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    }
}

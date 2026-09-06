package dev.understudy.core.craft;

import java.util.List;

/**
 * The recipes and sources the planner reasons over.
 *
 * Not all of Minecraft, and deliberately not. This covers what the builder
 * places, the tools needed to gather it, and the fuel to smelt it — a few dozen
 * entries whose numbers can each be checked by hand. A generated dump of every
 * recipe in the game would be larger, no more correct, and impossible to review.
 *
 * Break times are the vanilla formula, hardness * 1.5 / tool speed:
 * stone is hardness 1.5, a wooden pickaxe has speed 2, so 1.13 seconds. Search
 * times are estimates and marked as such on the record.
 */
public final class Catalogue {

    private Catalogue() {}

    /** Wooden tools take 59 uses, stone 131, iron 250. */
    private static final int WOOD_USES = 59;
    private static final int STONE_USES = 131;

    public static List<Gather> gathers() {
        return List.of(
                // Wood: hardness 2, by hand speed 1 -> 3s. Trees are everywhere.
                Gather.byHand("oak_log", 3.0, 3.0),
                // Dirt and sand: hardness 0.5, by hand -> 0.75s.
                Gather.byHand("dirt", 0.75, 1.5),
                Gather.byHand("sand", 0.75, 20.0),
                Gather.byHand("gravel", 0.9, 12.0),
                Gather.byHand("clay_ball", 0.9, 40.0),
                // Sugar cane and cactus need no tool and grow on the surface.
                Gather.byHand("sugar_cane", 0.0, 25.0),
                // Wool: shearing is instant once you have found the sheep, which
                // is the entire cost.
                Gather.byHand("white_wool", 0.0, 45.0),
                // Stone: hardness 1.5, wooden pickaxe speed 2 -> 1.13s.
                Gather.with("cobblestone", 1.13, 2.0, "wooden_pickaxe", WOOD_USES),
                // Coal ore: hardness 3, wooden pickaxe -> 2.25s. Common near the
                // surface, so the search is short.
                Gather.with("coal", 2.25, 12.0, "wooden_pickaxe", WOOD_USES),
                // Iron ore needs stone or better. Hardness 3, stone speed 4.
                Gather.with("raw_iron", 1.13, 50.0, "stone_pickaxe", STONE_USES),
                Gather.with("raw_copper", 1.13, 35.0, "stone_pickaxe", STONE_USES));
    }

    public static List<Recipe> recipes() {
        return List.of(
                // Crafting in the inventory grid costs about a second of menu work.
                Recipe.hand("oak_planks", 4, 1.0, "oak_log", 1),
                Recipe.hand("stick", 4, 1.0, "oak_planks", 2),
                Recipe.hand("crafting_table", 1, 1.0, "oak_planks", 4),
                Recipe.hand("torch", 4, 1.0, "stick", 1, "coal", 1),

                // At a table. Walking to it and back is why these cost more.
                Recipe.table("furnace", 1, 3.0, "cobblestone", 8),
                Recipe.table("chest", 1, 3.0, "oak_planks", 8),
                Recipe.table("oak_door", 3, 3.0, "oak_planks", 6),
                Recipe.table("oak_stairs", 4, 3.0, "oak_planks", 6),
                Recipe.table("oak_slab", 6, 3.0, "oak_planks", 3),
                Recipe.table("oak_fence", 3, 3.0, "oak_planks", 4, "stick", 2),
                Recipe.table("ladder", 3, 3.0, "stick", 7),
                Recipe.table("glass_pane", 16, 3.0, "glass", 6),
                Recipe.table("white_bed", 1, 3.0, "white_wool", 3, "oak_planks", 3),
                Recipe.table("bookshelf", 1, 3.0, "oak_planks", 6, "book", 3),
                Recipe.table("book", 1, 3.0, "paper", 3, "leather", 1),
                Recipe.table("paper", 3, 3.0, "sugar_cane", 3),
                Recipe.table("stone_bricks", 4, 3.0, "stone", 4),

                Recipe.table("wooden_pickaxe", 1, 3.0, "oak_planks", 3, "stick", 2),
                Recipe.table("wooden_axe", 1, 3.0, "oak_planks", 3, "stick", 2),
                Recipe.table("wooden_shovel", 1, 3.0, "oak_planks", 1, "stick", 2),
                Recipe.table("stone_pickaxe", 1, 3.0, "cobblestone", 3, "stick", 2),
                Recipe.table("stone_axe", 1, 3.0, "cobblestone", 3, "stick", 2),
                Recipe.table("iron_pickaxe", 1, 3.0, "iron_ingot", 3, "stick", 2),
                Recipe.table("shears", 1, 3.0, "iron_ingot", 2),

                // A furnace run is ten seconds a piece and needs fuel, which the
                // planner accounts for as an ingredient rather than pretending
                // smelting is free.
                new Recipe("stone", 1, java.util.Map.of("cobblestone", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),
                new Recipe("glass", 1, java.util.Map.of("sand", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),
                new Recipe("iron_ingot", 1, java.util.Map.of("raw_iron", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),
                new Recipe("copper_ingot", 1, java.util.Map.of("raw_copper", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),
                new Recipe("brick", 1, java.util.Map.of("clay_ball", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),
                Recipe.table("bricks", 1, 3.0, "brick", 4));
    }

    public static Solver solver() {
        return new Solver(recipes(), gathers());
    }
}

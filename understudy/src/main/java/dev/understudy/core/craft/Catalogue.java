package dev.understudy.core.craft;

import dev.understudy.core.build.Materials;

import java.util.ArrayList;
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
        List<Gather> all = new ArrayList<>(List.of(
                // Dirt and sand: hardness 0.5, by hand -> 0.75s.
                Gather.byHand("dirt", 0.75, 1.5, 64),
                Gather.byHand("sand", 0.75, 25.0, 64),
                Gather.byHand("gravel", 0.9, 12.0, 32),
                Gather.byHand("clay_ball", 0.9, 60.0, 16),
                Gather.byHand("sugar_cane", 0.0, 25.0, 6),
                // Wool: shearing is instant once the sheep is found, which is
                // the entire cost.
                Gather.byHand("white_wool", 0.0, 45.0, 3),
                // Stone: hardness 1.5, wooden pickaxe speed 2 -> 1.13s.
                Gather.with("cobblestone", 1.13, 20.0, 64, "wooden_pickaxe", WOOD_USES),
                Gather.with("cobblestone", 0.6, 20.0, 64, "stone_pickaxe", STONE_USES),
                Gather.with("andesite", 1.13, 40.0, 32, "wooden_pickaxe", WOOD_USES),
                Gather.with("andesite", 0.6, 40.0, 32, "stone_pickaxe", STONE_USES),
                // Deepslate is hardness 3, so the tool matters most here: 2.63s
                // with wood against 1.13s with stone, and a stone pickaxe lasts
                // more than twice as long.
                Gather.with("cobbled_deepslate", 2.63, 90.0, 64, "wooden_pickaxe", WOOD_USES),
                Gather.with("cobbled_deepslate", 1.13, 90.0, 64, "stone_pickaxe", STONE_USES),
                // Blackstone is only in the nether. The four minutes is getting
                // there, and the menu shows the total so the choice is informed
                // rather than surprising.
                Gather.with("blackstone", 1.13, 600.0, 64, "wooden_pickaxe", WOOD_USES),
                Gather.with("blackstone", 0.6, 600.0, 64, "stone_pickaxe", STONE_USES),
                // Coal ore: hardness 3, wooden pickaxe -> 2.25s.
                Gather.with("coal", 2.25, 25.0, 8, "wooden_pickaxe", WOOD_USES),
                Gather.with("coal", 1.15, 25.0, 8, "stone_pickaxe", STONE_USES),
                // Iron ore needs stone or better. Hardness 3, stone speed 4.
                Gather.with("raw_iron", 1.13, 90.0, 4, "stone_pickaxe", STONE_USES),
                Gather.with("raw_copper", 1.13, 60.0, 6, "stone_pickaxe", STONE_USES)));

        // Every wood the material picker offers, or choosing spruce produces a
        // plan that says spruce planks cannot be obtained. Logs are all hardness
        // 2 and all equally common; what differs is which biome you are in, and
        // the planner has no way to know that from here.
        for (Materials.Wood wood : Materials.woods()) {
            all.add(Gather.byHand(wood.log(), 3.0, 20.0, 5)); // about five logs a tree
        }
        return List.copyOf(all);
    }

    public static List<Recipe> recipes() {
        List<Recipe> all = new ArrayList<>(List.of(
                Recipe.hand("crafting_table", 1, 1.0, "oak_planks", 4),
                Recipe.hand("torch", 4, 1.0, "stick", 1, "coal", 1),

                Recipe.table("furnace", 1, 3.0, "cobblestone", 8),
                Recipe.table("chest", 1, 3.0, "oak_planks", 8),
                Recipe.table("ladder", 3, 3.0, "stick", 7),
                Recipe.table("glass_pane", 16, 3.0, "glass", 6),
                Recipe.table("white_bed", 1, 3.0, "white_wool", 3, "oak_planks", 3),
                Recipe.table("bookshelf", 1, 3.0, "oak_planks", 6, "book", 3),
                Recipe.table("book", 1, 3.0, "paper", 3, "leather", 1),
                Recipe.table("paper", 3, 3.0, "sugar_cane", 3),

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
                new Recipe("deepslate", 1, java.util.Map.of("cobbled_deepslate", 1, "coal", 1),
                        Recipe.Station.FURNACE, 10.0),

                // Masonry chains, each ending at the stairs and slabs a roof
                // needs. Written out rather than generated because the names do
                // not follow one pattern: stone_bricks makes stone_brick_stairs
                // without the s, and bricks makes brick_stairs.
                Recipe.table("stone_bricks", 4, 3.0, "stone", 4),
                Recipe.table("polished_deepslate", 4, 3.0, "cobbled_deepslate", 4),
                Recipe.table("deepslate_bricks", 4, 3.0, "polished_deepslate", 4),
                Recipe.table("bricks", 1, 3.0, "brick", 4),
                Recipe.table("sandstone", 1, 3.0, "sand", 4),
                Recipe.table("polished_andesite", 4, 3.0, "andesite", 4),
                Recipe.table("polished_blackstone", 4, 3.0, "blackstone", 4)));

        for (String stone : List.of("cobblestone", "stone_brick", "deepslate_brick", "brick",
                "sandstone", "polished_andesite", "polished_blackstone")) {
            String block = switch (stone) {
                case "stone_brick", "deepslate_brick", "brick" -> stone + "s";
                default -> stone;
            };
            all.add(Recipe.table(stone + "_stairs", 4, 3.0, block, 6));
            all.add(Recipe.table(stone + "_slab", 6, 3.0, block, 3));
            all.add(Recipe.table(stone + "_wall", 6, 3.0, block, 6));
        }

        // The wood families. Every one of these is the same six recipes with a
        // different prefix, so generating them is the only way the picker and
        // the planner stay in step when a wood is added.
        for (Materials.Wood wood : Materials.woods()) {
            all.add(Recipe.hand(wood.planks(), 4, 1.0, wood.log(), 1));
            all.add(Recipe.table(wood.stairs(), 4, 3.0, wood.planks(), 6));
            all.add(Recipe.table(wood.slab(), 6, 3.0, wood.planks(), 3));
            all.add(Recipe.table(wood.fence(), 3, 3.0, wood.planks(), 4, "stick", 2));
            all.add(Recipe.table(wood.door(), 3, 3.0, wood.planks(), 6));
            all.add(Recipe.table(wood.trapdoor(), 2, 3.0, wood.planks(), 6));
        }
        // Sticks come from any planks, but the planner only needs one way and
        // oak is the cheapest to reach from nothing.
        all.add(Recipe.hand("stick", 4, 1.0, "oak_planks", 2));
        return List.copyOf(all);
    }

    public static Solver solver() {
        return new Solver(recipes(), gathers());
    }
}

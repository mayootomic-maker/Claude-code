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

    /** Wooden tools take 59 uses, stone 131, iron 250, diamond 1561. */
    private static final int WOOD_USES = 59;
    private static final int STONE_USES = 131;
    private static final int IRON_USES = 250;
    private static final int DIAMOND_USES = 1561;

    /**
     * Built once, not per call.
     *
     * This is a constant that happens to be written as code, and it was being
     * rebuilt — fifty records and three lists — every single time anything
     * asked. The gatherer asks once per candidate block while scanning, which
     * is a third of a million blocks a scan, six times a second. That was not a
     * slow frame, it was tens of millions of allocations a second.
     */
    private static final List<Gather> GATHERS = buildGathers();
    private static final List<Recipe> RECIPES = buildRecipes();

    public static List<Gather> gathers() {
        return GATHERS;
    }

    public static List<Recipe> recipes() {
        return RECIPES;
    }

    private static List<Gather> buildGathers() {
        List<Gather> all = new ArrayList<>(List.of(
                // Dirt and sand: hardness 0.5, by hand -> 0.75s.
                Gather.byHand("dirt", 0.75, 1.5, 64),
                Gather.byHand("sand", 0.75, 25.0, 64),
                Gather.byHand("gravel", 0.9, 12.0, 32),
                Gather.byHand("clay_ball", 0.9, 60.0, 16, "clay"),
                Gather.byHand("sugar_cane", 0.0, 25.0, 6),
                // Wheat off a field, so bread is reachable without a farm. A
                // wild patch is rarer than grass and there is only so much of
                // it, which is what the low perTrip says.
                Gather.byHand("wheat", 0.0, 90.0, 6),

                // Meat. Nothing here could hunt until it could fight, so the
                // only honest thing the autopilot could say about food was that
                // food was your problem. The kill is a handful of seconds; the
                // walk to find the next animal is nearly all of the cost, which
                // is why findSeconds dwarfs the rest and perTrip is two.
                // Leather is the other half of a cow, and it is the difference
                // between fighting in a shirt and fighting in something. Early
                // on it is the only armour there is.
                Gather.hunt("leather", 1, 6.0, 40.0, 2, "cow"),
                Gather.hunt("beef", 2, 6.0, 40.0, 2, "cow"),
                Gather.hunt("porkchop", 2, 6.0, 45.0, 2, "pig"),
                Gather.hunt("mutton", 2, 6.0, 45.0, 2, "sheep"),
                Gather.hunt("chicken", 1, 4.0, 45.0, 1, "chicken"),
                Gather.hunt("rabbit", 1, 5.0, 120.0, 1, "rabbit"),
                // Wool: shearing is instant once the sheep is found, which is
                // the entire cost.
                Gather.byHand("white_wool", 0.0, 45.0, 3, "white_wool"),
                // Stone: hardness 1.5, wooden pickaxe speed 2 -> 1.13s.
                Gather.with("cobblestone", 1.13, 20.0, 64, "wooden_pickaxe", WOOD_USES, "stone"),
                Gather.with("cobblestone", 0.6, 20.0, 64, "stone_pickaxe", STONE_USES, "stone"),
                Gather.deep("andesite", 1.13, 40.0, 32, "wooden_pickaxe", WOOD_USES, 10),
                Gather.deep("andesite", 0.6, 40.0, 32, "stone_pickaxe", STONE_USES, 10),
                // Deepslate is hardness 3, so the tool matters most here: 2.63s
                // with wood against 1.13s with stone, and a stone pickaxe lasts
                // more than twice as long.
                Gather.deep("cobbled_deepslate", 2.63, 90.0, 64, "wooden_pickaxe", WOOD_USES, -10,
                        "deepslate"),
                Gather.deep("cobbled_deepslate", 1.13, 90.0, 64, "stone_pickaxe", STONE_USES, -10,
                        "deepslate"),
                // Blackstone is only in the nether. The four minutes is getting
                // there, and the menu shows the total so the choice is informed
                // rather than surprising.
                Gather.with("blackstone", 1.13, 600.0, 64, "wooden_pickaxe", WOOD_USES),
                Gather.with("blackstone", 0.6, 600.0, 64, "stone_pickaxe", STONE_USES),
                // Coal ore: hardness 3, wooden pickaxe -> 2.25s.
                Gather.with("coal", 2.25, 25.0, 8, "wooden_pickaxe", WOOD_USES, "coal_ore", "deepslate_coal_ore"),
                Gather.with("coal", 1.15, 25.0, 8, "stone_pickaxe", STONE_USES, "coal_ore", "deepslate_coal_ore"),
                // Iron ore needs stone or better. Hardness 3, stone speed 4.
                Gather.deep("raw_iron", 1.13, 90.0, 4, "stone_pickaxe", STONE_USES, 15,
                        "iron_ore", "deepslate_iron_ore"),
                Gather.deep("raw_copper", 1.13, 60.0, 6, "stone_pickaxe", STONE_USES, 48,
                        "copper_ore", "deepslate_copper_ore"),

                // The rest of the ladder. Each of these is gated on a tool that
                // is itself two or three levels of this same list deep, which is
                // the entire point: asking for a diamond with nothing in your
                // pockets has to come out as a plan that starts by punching a
                // tree, and it does.
                //
                // The heights are the game's own distribution peaks. Iron has a
                // second peak up at 232 that this ignores, because 15 is the one
                // you can walk to from a hole in the ground.
                Gather.deep("raw_gold", 1.13, 150.0, 4, "iron_pickaxe", IRON_USES, -16,
                        "gold_ore", "deepslate_gold_ore"),
                Gather.deep("redstone", 1.13, 120.0, 20, "iron_pickaxe", IRON_USES, -58,
                        "redstone_ore", "deepslate_redstone_ore"),
                Gather.deep("lapis_lazuli", 1.13, 180.0, 8, "stone_pickaxe", STONE_USES, 0,
                        "lapis_ore", "deepslate_lapis_ore"),
                Gather.deep("diamond", 1.13, 300.0, 4, "iron_pickaxe", IRON_USES, -59,
                        "diamond_ore", "deepslate_diamond_ore"),
                // Emerald is the exception that has no depth worth digging to:
                // it is mountains-only and sits in exposed stone high up, so a
                // strip mine at any height finds nothing. Left at the surface on
                // purpose — it mines what it sees and says so when it sees none,
                // which beats tunnelling for an hour under the wrong biome.
                Gather.with("emerald", 1.13, 900.0, 1, "iron_pickaxe", IRON_USES,
                        "emerald_ore", "deepslate_emerald_ore"),
                // Obsidian: the top of the ladder, and the reason the ladder
                // ends at a diamond pickaxe. 9.4s a block even with diamond.
                Gather.deep("obsidian", 9.4, 240.0, 8, "diamond_pickaxe", DIAMOND_USES, -20,
                        "obsidian")));

        // Every wood the material picker offers, or choosing spruce produces a
        // plan that says spruce planks cannot be obtained. Logs are all hardness
        // 2 and all equally common; what differs is which biome you are in, and
        // the planner has no way to know that from here.
        for (Materials.Wood wood : Materials.woods()) {
            all.add(Gather.byHand(wood.log(), 3.0, 20.0, 5)); // about five logs a tree
        }
        return List.copyOf(all);
    }

    private static List<Recipe> buildRecipes() {
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
                Recipe.table("bread", 1, 3.0, "wheat", 3),

                // The enchanting setup. It is the largest permanent speed gain
                // in the game — roughly double the mining rate, for every block
                // after it — and the mod could not so much as make the table.
                Recipe.table("enchanting_table", 1, 5.0,
                        "obsidian", 4, "diamond", 2, "book", 1),

                // Something to fight with. A sword is three ingredients and it
                // is the difference between a zombie costing two hearts and
                // costing eight, so the autopilot makes one before it makes
                // anything else it is not standing in.
                Recipe.table("wooden_sword", 1, 3.0, "oak_planks", 2, "stick", 1),
                Recipe.table("stone_sword", 1, 3.0, "cobblestone", 2, "stick", 1),
                Recipe.table("iron_sword", 1, 3.0, "iron_ingot", 2, "stick", 1),
                Recipe.table("diamond_sword", 1, 3.0, "diamond", 2, "stick", 1),
                // Wood and one iron, and it turns a skeleton from a problem
                // into a nuisance.
                Recipe.table("shield", 1, 3.0, "oak_planks", 6, "iron_ingot", 1),

                // Armour, in the two materials that are actually reachable: a
                // cow's worth of leather on the first day, and iron once there
                // is a pickaxe. Eighty per cent damage reduction is the single
                // largest thing that can be crafted for a fight.
                Recipe.table("leather_helmet", 1, 3.0, "leather", 5),
                Recipe.table("leather_chestplate", 1, 3.0, "leather", 8),
                Recipe.table("leather_leggings", 1, 3.0, "leather", 7),
                Recipe.table("leather_boots", 1, 3.0, "leather", 4),
                Recipe.table("iron_helmet", 1, 3.0, "iron_ingot", 5),
                Recipe.table("iron_chestplate", 1, 3.0, "iron_ingot", 8),
                Recipe.table("iron_leggings", 1, 3.0, "iron_ingot", 7),
                Recipe.table("iron_boots", 1, 3.0, "iron_ingot", 4),
                Recipe.table("diamond_helmet", 1, 3.0, "diamond", 5),
                Recipe.table("diamond_chestplate", 1, 3.0, "diamond", 8),
                Recipe.table("diamond_leggings", 1, 3.0, "diamond", 7),
                Recipe.table("diamond_boots", 1, 3.0, "diamond", 4),

                // Cooking. Raw meat feeds you badly and cooked meat feeds you
                // well, and the difference is one furnace the mod already knows
                // how to load — so "get eight cooked beef" is two hunts and a
                // smelt, planned exactly like eight iron ingots.
                Recipe.smelt("cooked_beef", "beef", 10.0),
                Recipe.smelt("cooked_porkchop", "porkchop", 10.0),
                Recipe.smelt("cooked_mutton", "mutton", 10.0),
                Recipe.smelt("cooked_chicken", "chicken", 10.0),
                Recipe.smelt("cooked_rabbit", "rabbit", 10.0),

                Recipe.table("wooden_pickaxe", 1, 3.0, "oak_planks", 3, "stick", 2),
                Recipe.table("wooden_axe", 1, 3.0, "oak_planks", 3, "stick", 2),
                Recipe.table("wooden_shovel", 1, 3.0, "oak_planks", 1, "stick", 2),
                Recipe.table("stone_pickaxe", 1, 3.0, "cobblestone", 3, "stick", 2),
                Recipe.table("stone_axe", 1, 3.0, "cobblestone", 3, "stick", 2),
                Recipe.table("iron_pickaxe", 1, 3.0, "iron_ingot", 3, "stick", 2),
                Recipe.table("diamond_pickaxe", 1, 3.0, "diamond", 3, "stick", 2),
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
                new Recipe("gold_ingot", 1, java.util.Map.of("raw_gold", 1, "coal", 1),
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

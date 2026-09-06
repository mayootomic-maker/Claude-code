package dev.understudy.core.sort;

import java.util.List;

/**
 * What kind of thing an item is, for putting it in the right chest.
 *
 * Worked out from the item's name rather than from the game's tags. Tags would
 * be more principled, but they are a runtime lookup that drags the whole
 * registry into what is otherwise pure logic — and Minecraft's naming is
 * regular enough that suffix matching gets it right. Anything unrecognised
 * lands in MISC rather than being forced into a category it does not belong to.
 *
 * Order is the whole trick. A diamond pickaxe is a tool, not a valuable, and a
 * redstone torch is redstone, not a light — so the specific rules are tested
 * before the general ones and the first match wins.
 */
public enum Category {
    TOOLS,
    WEAPONS,
    ARMOUR,
    VALUABLES,
    ORES,
    REDSTONE,
    BUILDING,
    FOOD,
    PLANTS,
    BREWING,
    MISC;

    private record Rule(Category category, List<String> patterns, boolean suffix) {}

    /**
     * Checked in order; first match wins.
     *
     * The tool, weapon and armour rules come first precisely because their
     * names contain the material — without that ordering, every diamond tool
     * ends up in the valuables chest and the tool chest stays empty.
     */
    private static final List<Rule> RULES = List.of(
            new Rule(TOOLS, List.of("_pickaxe", "_axe", "_shovel", "_hoe"), true),
            new Rule(TOOLS, List.of("shears", "flint_and_steel", "fishing_rod", "brush",
                    "spyglass", "compass", "clock", "bucket", "lead", "name_tag"), false),
            new Rule(WEAPONS, List.of("_sword"), true),
            new Rule(WEAPONS, List.of("bow", "crossbow", "trident", "arrow", "shield",
                    "firework_rocket"), false),
            new Rule(ARMOUR, List.of("_helmet", "_chestplate", "_leggings", "_boots"), true),
            new Rule(ARMOUR, List.of("elytra", "turtle_helmet", "shulker_shell"), false),

            new Rule(BREWING, List.of("potion", "nether_wart", "blaze_powder", "blaze_rod",
                    "glass_bottle", "spider_eye", "ghast_tear", "magma_cream", "glistering",
                    "dragon_breath", "phantom_membrane", "brewing_stand", "cauldron"), false),

            new Rule(REDSTONE, List.of("redstone", "repeater", "comparator", "piston",
                    "observer", "hopper", "dropper", "dispenser", "lever", "button",
                    "pressure_plate", "rail", "tripwire", "target", "daylight_detector",
                    "note_block", "dust"), false),

            new Rule(VALUABLES, List.of("diamond", "emerald", "netherite", "ancient_debris",
                    "totem", "enchanted_book", "nether_star", "beacon", "heart_of_the_sea",
                    "echo_shard", "amethyst"), false),

            // Plants before food, so wheat and sugar cane are the crop rather
            // than the meal, and both before ores — otherwise a golden carrot
            // matches "gold" and ends up filed with the ingots.
            new Rule(PLANTS, List.of("sapling", "seeds", "flower", "leaves", "vine",
                    "mushroom", "bamboo", "sugar_cane", "cactus", "wheat", "bone_meal",
                    "moss", "lily", "roots", "fungus", "kelp", "coral", "propagule",
                    "dandelion", "poppy", "orchid", "allium", "tulip", "daisy",
                    "cornflower", "sunflower", "lilac", "peony", "rose_bush"), false),

            new Rule(FOOD, List.of("bread", "apple", "carrot", "potato", "beetroot", "beef",
                    "porkchop", "chicken", "mutton", "rabbit", "cod", "salmon", "stew",
                    "cake", "cookie", "melon_slice", "berries", "pumpkin_pie",
                    "honey_bottle", "milk", "egg", "sugar", "chorus_fruit"), false),

            // Named precisely rather than by metal. A bare "gold" or "iron"
            // swallows golden carrots, golden apples and anything else that
            // merely happens to contain the word.
            new Rule(ORES, List.of("_ore", "raw_", "_ingot", "_nugget", "coal", "lapis_lazuli",
                    "quartz", "scrap", "iron_block", "gold_block", "copper_block"), false),

            new Rule(BUILDING, List.of("planks", "_log", "_wood", "stem", "stone", "cobble",
                    "deepslate", "brick", "concrete", "terracotta", "sandstone", "glass",
                    "wool", "slab", "stairs", "_wall", "fence", "dirt", "sand", "gravel",
                    "andesite", "diorite", "granite", "tuff", "calcite", "basalt",
                    "netherrack", "obsidian", "prismarine", "purpur", "door", "trapdoor",
                    "carpet", "scaffolding", "ladder", "torch", "lantern", "chest",
                    "barrel", "furnace", "crafting_table", "grass_block", "clay", "ice",
                    "snow", "packed", "mud", "shroomlight", "glowstone"), false));

    public static Category of(String itemName) {
        if (itemName == null || itemName.isEmpty()) return MISC;
        String name = itemName.toLowerCase();
        // Strip a namespace if one came along, e.g. "minecraft:oak_planks".
        int colon = name.indexOf(':');
        if (colon >= 0) name = name.substring(colon + 1);

        for (Rule rule : RULES) {
            for (String pattern : rule.patterns()) {
                boolean hit = rule.suffix() ? name.endsWith(pattern) : name.contains(pattern);
                if (hit) return rule.category();
            }
        }
        return MISC;
    }

    /** A short label for a chest sign or a chat line. */
    public String label() {
        return switch (this) {
            case TOOLS -> "tools";
            case WEAPONS -> "weapons";
            case ARMOUR -> "armour";
            case VALUABLES -> "valuables";
            case ORES -> "ores & metals";
            case REDSTONE -> "redstone";
            case BUILDING -> "building";
            case FOOD -> "food";
            case PLANTS -> "plants";
            case BREWING -> "brewing";
            case MISC -> "odds and ends";
        };
    }
}

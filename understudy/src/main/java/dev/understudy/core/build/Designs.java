package dev.understudy.core.build;

import dev.understudy.core.build.Blueprint.Role;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The things it knows how to build, and the materials it builds them from.
 *
 * Shape and palette are separate on purpose. "A house" does not mean an oak
 * house — it means a floor, walls, a roof, windows and a door, made of whatever
 * you actually have or actually use. `paletteFrom` takes the blocks you build
 * with most and fills the roles with them, so a house it builds for you comes
 * out looking like the ones you build.
 */
public final class Designs {
    private Designs() {}

    /**
     * The bay spacing: posts on every fourth block, windows in the two between.
     *
     * One number rather than two, because the posts and the openings have to
     * agree — a window through an upright is the mistake that happens the
     * moment the two rhythms are worked out separately.
     */
    private static final int WINDOW_EVERY = 4;

    public static Map<Role, String> defaultPalette() {
        Map<Role, String> palette = new EnumMap<>(Role.class);
        palette.put(Role.FLOOR, "oak_planks");
        palette.put(Role.WALL, "oak_planks");
        palette.put(Role.ACCENT, "oak_log");
        palette.put(Role.ROOF, "cobblestone");
        palette.put(Role.WINDOW, "glass");
        palette.put(Role.LIGHT, "torch");
        palette.put(Role.DOOR, "oak_door");
        palette.put(Role.FURNITURE, "chest");
        return palette;
    }

    /**
     * A palette from a chosen wood and masonry.
     *
     * The small designs speak in roles rather than block names, so this is how a
     * material choice in the menu reaches them. Picking spruce has to move the
     * planks, the logs and the door together or the result looks like a mistake.
     */
    public static Map<Role, String> paletteOf(Materials.Wood wood, Materials.Stone stone) {
        Map<Role, String> palette = new EnumMap<>(Role.class);
        palette.put(Role.FLOOR, wood.planks());
        palette.put(Role.WALL, wood.planks());
        palette.put(Role.ACCENT, wood.log());
        palette.put(Role.ROOF, stone.block());
        palette.put(Role.WINDOW, "glass");
        palette.put(Role.LIGHT, "torch");
        palette.put(Role.DOOR, wood.door());
        palette.put(Role.FURNITURE, "chest");
        return palette;
    }

    /** Candidates per role, so a preferred block is only used where it fits. */
    private static final Map<Role, List<String>> SUITABLE = Map.of(
            Role.FLOOR, List.of("planks", "stone", "cobble", "deepslate", "bricks", "terracotta", "concrete", "sandstone", "dirt", "log"),
            Role.WALL, List.of("planks", "stone", "cobble", "deepslate", "bricks", "terracotta", "concrete", "sandstone", "log"),
            Role.ROOF, List.of("stone", "cobble", "deepslate", "bricks", "planks", "terracotta", "concrete", "sandstone"),
            Role.ACCENT, List.of("log", "stem", "bricks", "stone", "deepslate"));

    /**
     * Build a palette out of the blocks the player actually uses.
     *
     * Only roles with a sensible candidate are overridden: a preference for
     * glass should not end up as the walls, and one for torches should not end
     * up as the floor. Anything unmatched keeps its default.
     */
    public static Map<Role, String> paletteFrom(List<String> preferredBlocks, Map<Role, String> base) {
        Map<Role, String> palette = new EnumMap<>(base);
        for (Map.Entry<Role, List<String>> entry : SUITABLE.entrySet()) {
            for (String block : preferredBlocks) {
                if (block == null) continue;
                boolean fits = entry.getValue().stream().anyMatch(block::contains);
                if (fits) {
                    palette.put(entry.getKey(), block);
                    break;
                }
            }
        }
        return palette;
    }

    /**
     * A house: two rooms' worth of floor, posts, glazed windows with sills, a
     * pitched roof that overhangs, a porch, and enough inside it to live in.
     *
     * It occupies x in 1..w and z in 1..d, with the plinth one block proud all
     * round — the Manor's convention, and the reason every coordinate here is
     * non-negative and the blueprint's bounds are its real footprint. The old
     * version put its roof at x = -1, which put a third of the building outside
     * the box the site marker drew.
     */
    public static Blueprint house(int width, int depth, int height, Map<Role, String> p,
                                  Materials.Wood wood, Materials.Stone stone) {
        int w = clamp(width, 5, 24);
        int d = clamp(depth, 5, 24);
        int h = clamp(height, 3, 8);
        int doorX = (w + 1) / 2;
        Draft draft = new Draft("house");

        Trim.plinth(draft, w, d, stone.block());
        draft.box(1, 0, 1, w, 0, d, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(1, 1, 1, w, h, d, p.get(Role.WALL), Role.WALL);
        Trim.posts(draft, w, d, 1, h, WINDOW_EVERY, p.get(Role.ACCENT));
        Trim.baseCourse(draft, w, d, 1, stone.block());

        int sill = 2;
        int head = Math.min(h - 1, sill + 1);
        Trim.windows(draft, w, d, sill, head, WINDOW_EVERY, p.get(Role.WINDOW), doorX);
        Trim.dressWindows(draft, w, d, sill, head, WINDOW_EVERY, stone.slab());
        Trim.eaves(draft, w, d, h, wood.slab());
        Trim.doorway(draft, doorX, 1, p.get(Role.DOOR), stone.block());
        porch(draft, doorX, wood, stone);

        int ridge = Trim.gable(draft, w, d, h + 1, stone.stairs(), stone.slab(),
                p.get(Role.WALL));
        chimney(draft, w, d, ridge, stone.block());

        // A kitchen wall you can work at without moving, a table to sit at, a
        // bed, and light. A house with nothing in it is a shed.
        int back = d - 1;
        draft.set(w - 1, 1, back, "furnace", Role.FURNITURE, true);
        draft.set(w - 2, 1, back, "crafting_table", Role.FURNITURE, true);
        draft.set(w - 3, 1, back, "chest", Role.FURNITURE, true);
        table(draft, (w + 1) / 2, d / 2, wood);
        draft.facing(2, 1, 2, "white_bed", Role.FURNITURE, Facing.SOUTH);
        draft.set(3, 1, 2, "bookshelf", Role.FURNITURE, true);
        Trim.lights(draft, w, d, 3, 3);

        return draft.finish(doorX, 1, 0);
    }

    /**
     * A one-room shelter. What you build when the sun is going down — which is
     * the whole design brief, and the reason it is still small and still cheap
     * after the detailing.
     *
     * Everything that costs a ring of blocks is here; everything that costs a
     * second trip for materials is not.
     */
    public static Blueprint hut(int size, Map<Role, String> p, Materials.Wood wood,
                                Materials.Stone stone) {
        int s = clamp(size, 3, 9);
        int doorX = (s + 1) / 2;
        int h = 3;
        Draft draft = new Draft("hut");

        Trim.plinth(draft, s, s, stone.block());
        draft.box(1, 0, 1, s, 0, s, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(1, 1, 1, s, h, s, p.get(Role.WALL), Role.WALL);
        Trim.posts(draft, s, s, 1, h, s - 1, p.get(Role.ACCENT));
        Trim.baseCourse(draft, s, s, 1, stone.block());

        // One opening in the middle of each wall, at eye level. The rhythm rule
        // the bigger designs use needs a wall long enough to have a rhythm.
        if (s >= 5) {
            int middle = (s + 1) / 2;
            draft.set(middle, 2, s, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(1, 2, middle, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(s, 2, middle, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(middle, 1, s + 1, stone.slab(), Role.ACCENT, true);
            draft.set(0, 1, middle, stone.slab(), Role.ACCENT, true);
            draft.set(s + 1, 1, middle, stone.slab(), Role.ACCENT, true);
        }

        Trim.eaves(draft, s, s, h, wood.slab());
        Trim.doorway(draft, doorX, 1, p.get(Role.DOOR), stone.block());
        Trim.gable(draft, s, s, h + 1, stone.stairs(), stone.slab(), p.get(Role.WALL));

        draft.facing(2, 1, s - 1, "white_bed", Role.FURNITURE, Facing.NORTH);
        draft.set(s - 1, 1, s - 1, "crafting_table", Role.FURNITURE, true);
        draft.set(s - 1, 1, 2, "chest", Role.FURNITURE, true);
        draft.set(2, 3, 2, p.get(Role.LIGHT), Role.LIGHT, true);

        return draft.finish(doorX, 1, 0);
    }

    /**
     * A lookout: a shaft with a ladder up the inside, floors to break the fall,
     * arrow slits on the way up, and a battlemented walk on top.
     *
     * The old tower was a hollow shell with a lid, which meant it was both
     * featureless and unclimbable — the one thing a tower has to be. The ladder
     * is the functional half and the battlements are the half you see from the
     * ground.
     */
    public static Blueprint tower(int height, int size, Map<Role, String> p,
                                  Materials.Wood wood, Materials.Stone stone) {
        int h = clamp(height, 4, 40);
        int s = clamp(size, 3, 9);
        int doorX = (s + 1) / 2;
        Draft draft = new Draft("tower");

        Trim.plinth(draft, s, s, stone.block());
        draft.box(1, 0, 1, s, 0, s, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(1, 1, 1, s, h, s, p.get(Role.WALL), Role.WALL);
        Trim.posts(draft, s, s, 1, h, s - 1, p.get(Role.ACCENT));
        Trim.baseCourse(draft, s, s, 1, stone.block());

        // Arrow slits, two courses tall, every few floors and on every face —
        // which is also what stops the shaft being pitch dark.
        for (int y = 3; y < h - 1; y += 4) {
            int middle = (s + 1) / 2;
            draft.set(middle, y, 1, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(middle, y, s, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(1, y, middle, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(s, y, middle, p.get(Role.WINDOW), Role.WINDOW, true);
        }

        // The climb. A ladder needs the wall behind it, so it runs up the face
        // opposite the door, and a landing every few storeys means a slip costs
        // a few hearts rather than the whole bar.
        int ladderX = (s + 1) / 2;
        for (int y = 1; y <= h; y++) {
            draft.facing(ladderX, y, s - 1, "ladder", Role.FURNITURE, Facing.NORTH);
        }
        for (int y = 5; y < h; y += 5) {
            for (int x = 1; x <= s; x++) {
                for (int z = 1; z <= s; z++) {
                    if (x == ladderX && z == s - 1) continue;
                    draft.set(x, y, z, p.get(Role.FLOOR), Role.FLOOR);
                }
            }
            draft.set(2, y + 1, 2, p.get(Role.LIGHT), Role.LIGHT, true);
        }

        // A course standing proud under the parapet, which is the detail that
        // makes a tower top read as a tower top rather than as a wider bit.
        Trim.eaves(draft, s, s, h, stone.slab());

        int deck = h + 1;
        draft.box(1, deck, 1, s, deck, s, p.get(Role.FLOOR), Role.FLOOR);
        draft.clear(ladderX, deck, s - 1);
        // Battlements: solid, gap, solid, all the way round, with a rail across
        // the gaps so the walk is not a hole you fall out of.
        for (int x = 1; x <= s; x++) {
            crenel(draft, x, deck + 1, 1, x % 2 == 1, stone, wood);
            crenel(draft, x, deck + 1, s, x % 2 == 1, stone, wood);
        }
        for (int z = 2; z < s; z++) {
            crenel(draft, 1, deck + 1, z, z % 2 == 1, stone, wood);
            crenel(draft, s, deck + 1, z, z % 2 == 1, stone, wood);
        }
        draft.set((s + 1) / 2, deck + 1, (s + 1) / 2, p.get(Role.LIGHT), Role.LIGHT, true);

        Trim.doorway(draft, doorX, 1, p.get(Role.DOOR), stone.block());
        return draft.finish(doorX, 1, 0);
    }

    /** One merlon of a parapet, or the embrasure between two of them. */
    private static void crenel(Draft draft, int x, int y, int z, boolean solid,
                               Materials.Stone stone, Materials.Wood wood) {
        if (solid) draft.set(x, y, z, stone.block(), Role.WALL);
        else draft.set(x, y, z, wood.fence(), Role.ACCENT, true);
    }

    /**
     * A storage room sized from the number of chests asked for.
     *
     * "Somewhere to put sixteen chests" should produce a room that fits sixteen
     * chests, rather than a room of a fixed size you then discover is too small.
     *
     * The one rule that governs the layout is not aesthetic: a chest with a
     * solid block directly above it will not open. So the shelf above the run
     * of chests is deliberately a course of slabs set into the wall line rather
     * than a full block, and nothing is ever placed in the column above a chest.
     */
    public static Blueprint storage(int chests, Map<Role, String> p, Materials.Wood wood,
                                    Materials.Stone stone) {
        int n = clamp(chests, 2, 32);
        int w = 5;
        int d = clamp((n + 1) / 2 + 3, 5, 24);
        int h = 4;
        int doorX = (w + 1) / 2;
        Draft draft = new Draft("storage");

        Trim.plinth(draft, w, d, stone.block());
        draft.box(1, 0, 1, w, 0, d, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(1, 1, 1, w, h, d, p.get(Role.WALL), Role.WALL);
        Trim.posts(draft, w, d, 1, h, WINDOW_EVERY, p.get(Role.ACCENT));
        Trim.baseCourse(draft, w, d, 1, stone.block());

        // Windows high up, above the chests rather than behind them: a store
        // room wants its wall space, and light from over the shelves is what a
        // real one has.
        for (int z = 2; z < d; z += 2) {
            draft.set(1, h - 1, z, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(w, h - 1, z, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(0, h - 2, z, stone.slab(), Role.ACCENT, true);
            draft.set(w + 1, h - 2, z, stone.slab(), Role.ACCENT, true);
        }

        Trim.eaves(draft, w, d, h, wood.slab());
        Trim.doorway(draft, doorX, 1, p.get(Role.DOOR), stone.block());
        int ridge = Trim.gable(draft, w, d, h + 1, stone.stairs(), stone.slab(),
                p.get(Role.WALL));

        int placed = 0;
        for (int z = 2; z < d && placed < n; z++) {
            draft.set(2, 1, z, "chest", Role.FURNITURE);
            placed++;
            if (placed < n) {
                draft.set(w - 1, 1, z, "chest", Role.FURNITURE);
                placed++;
            }
        }
        // The back wall is the workspace, so sorting and smelting happen where
        // the chests are instead of somewhere else in the base.
        draft.set(2, 1, d - 1, "crafting_table", Role.FURNITURE, true);
        draft.set(w - 1, 1, d - 1, "furnace", Role.FURNITURE, true);
        // Torches on the wall above head height, clear of every chest lid.
        for (int z = 2; z < d; z += 3) {
            draft.set(2, 3, z, "torch", Role.LIGHT, true);
            draft.set(w - 1, 3, z, "torch", Role.LIGHT, true);
        }
        chimney(draft, w, d, ridge, stone.block());

        return draft.finish(doorX, 1, 0);
    }

    /** A covered step outside the door, so the entrance is somewhere. */
    private static void porch(Draft draft, int doorX, Materials.Wood wood, Materials.Stone stone) {
        draft.set(doorX - 1, 1, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX + 1, 1, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX - 1, 2, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX + 1, 2, 0, wood.fence(), Role.ACCENT, true);
        for (int x = doorX - 1; x <= doorX + 1; x++) {
            draft.set(x, 3, 0, wood.slab(), Role.ROOF, true);
        }
    }

    /** Posts with a slab top and a chair either side: a table you can sit at. */
    private static void table(Draft draft, int x, int z, Materials.Wood wood) {
        draft.set(x, 1, z, wood.fence(), Role.FURNITURE, true);
        draft.set(x, 2, z, wood.slab(), Role.FURNITURE, true);
        draft.facing(x, 1, z - 1, wood.stairs(), Role.FURNITURE, Facing.SOUTH);
        draft.facing(x, 1, z + 1, wood.stairs(), Role.FURNITURE, Facing.NORTH);
    }

    /** A stack from the fire out through the roof, because a chimney reads as a house. */
    private static void chimney(Draft draft, int w, int d, int ridge, String stone) {
        for (int y = 1; y <= ridge + 1; y++) {
            draft.set(w, y, d + 1, stone, Role.ACCENT);
        }
    }

    private static int clamp(int value, int min, int max) {
        return value < min ? min : Math.min(value, max);
    }
}

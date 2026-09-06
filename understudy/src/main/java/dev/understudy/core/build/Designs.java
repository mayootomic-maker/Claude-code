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
     * A house: floor, walls with corner posts, windows, a doorway, a pitched
     * roof, and enough furniture to live in.
     *
     * The roof is a gable rather than a flat lid, because a flat lid is what
     * makes a build read as "something automated did this". It steps out of
     * full blocks with a one-block overhang, and the triangular gable ends are
     * filled in — the part that is easy to forget, and forgetting it leaves two
     * openings under the roof for anything to wander through.
     */
    public static Blueprint house(int width, int depth, int height, Map<Role, String> p) {
        int w = clamp(width, 5, 24);
        int d = clamp(depth, 5, 24);
        int h = clamp(height, 3, 8);
        Draft draft = new Draft("house");
        int maxX = w - 1;
        int maxZ = d - 1;

        draft.box(0, 0, 0, maxX, 0, maxZ, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(0, 1, 0, maxX, h, maxZ, p.get(Role.WALL), Role.WALL);

        for (int y = 1; y <= h; y++) {
            draft.set(0, y, 0, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(0, y, maxZ, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(maxX, y, 0, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(maxX, y, maxZ, p.get(Role.ACCENT), Role.ACCENT);
        }

        int doorX = w / 2;
        draft.clear(doorX, 1, 0);
        draft.clear(doorX, 2, 0);
        draft.set(doorX, 1, 0, p.get(Role.DOOR), Role.DOOR, true);

        // Windows at eye level, skipping the corners and the doorway.
        for (int x = 2; x <= maxX - 2; x += 2) {
            if (x != doorX) draft.set(x, 2, 0, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(x, 2, maxZ, p.get(Role.WINDOW), Role.WINDOW, true);
        }
        for (int z = 2; z <= maxZ - 2; z += 2) {
            draft.set(0, 2, z, p.get(Role.WINDOW), Role.WINDOW, true);
            draft.set(maxX, 2, z, p.get(Role.WINDOW), Role.WINDOW, true);
        }

        gableRoof(draft, w, d, h, p);

        int centre = w / 2;
        draft.set(centre - 1, 1, d - 2, "crafting_table", Role.FURNITURE, true);
        draft.set(centre, 1, d - 2, "furnace", Role.FURNITURE, true);
        draft.set(centre + 1, 1, d - 2, "chest", Role.FURNITURE, true);
        draft.set(1, 1, 1, p.get(Role.LIGHT), Role.LIGHT, true);
        draft.set(maxX - 1, 1, 1, p.get(Role.LIGHT), Role.LIGHT, true);
        draft.set(1, 1, maxZ - 1, p.get(Role.LIGHT), Role.LIGHT, true);
        draft.set(maxX - 1, 1, maxZ - 1, p.get(Role.LIGHT), Role.LIGHT, true);

        return draft.finish(doorX, 1, -1);
    }

    private static void gableRoof(Draft draft, int w, int d, int h, Map<Role, String> p) {
        int left = -1;
        int right = w;
        int courses = (right - left) / 2 + 1;

        for (int k = 0; k < courses; k++) {
            int y = h + 1 + k;
            int lx = left + k;
            int rx = right - k;
            if (lx > rx) break;

            for (int z = -1; z <= d; z++) {
                draft.set(lx, y, z, p.get(Role.ROOF), Role.ROOF);
                if (rx != lx) draft.set(rx, y, z, p.get(Role.ROOF), Role.ROOF);
            }
            // The gable ends: the wall triangle between the two roof edges.
            for (int x = lx + 1; x <= rx - 1; x++) {
                if (x < 0 || x > w - 1) continue;
                draft.set(x, y, 0, p.get(Role.WALL), Role.WALL);
                draft.set(x, y, d - 1, p.get(Role.WALL), Role.WALL);
            }
        }
    }

    /** A one-room shelter. What you build when the sun is going down. */
    public static Blueprint hut(int size, Map<Role, String> p) {
        int s = clamp(size, 3, 9);
        Draft draft = new Draft("hut");
        int max = s - 1;
        draft.box(0, 0, 0, max, 0, max, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(0, 1, 0, max, 3, max, p.get(Role.WALL), Role.WALL);
        draft.box(0, 4, 0, max, 4, max, p.get(Role.ROOF), Role.ROOF);
        int doorX = s / 2;
        draft.clear(doorX, 1, 0);
        draft.clear(doorX, 2, 0);
        draft.set(1, 1, 1, p.get(Role.LIGHT), Role.LIGHT, true);
        return draft.finish(doorX, 1, -1);
    }

    /** A lookout tower with a railed platform on top. */
    public static Blueprint tower(int height, int size, Map<Role, String> p) {
        int h = clamp(height, 4, 40);
        int s = clamp(size, 3, 9);
        Draft draft = new Draft("tower");
        int max = s - 1;
        draft.shell(0, 0, 0, max, h - 1, max, p.get(Role.WALL), Role.WALL);
        for (int y = 0; y < h; y++) {
            draft.set(0, y, 0, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(0, y, max, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(max, y, 0, p.get(Role.ACCENT), Role.ACCENT);
            draft.set(max, y, max, p.get(Role.ACCENT), Role.ACCENT);
        }
        draft.box(0, h, 0, max, h, max, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(0, h + 1, 0, max, h + 1, max, p.get(Role.WALL), Role.WALL);
        draft.set(1, h + 1, 1, p.get(Role.LIGHT), Role.LIGHT, true);
        int doorX = s / 2;
        draft.clear(doorX, 0, 0);
        draft.clear(doorX, 1, 0);
        return draft.finish(doorX, 0, -1);
    }

    /**
     * A storage room lined with chests, sized from the number asked for.
     *
     * "Somewhere to put sixteen chests" should produce a room that fits sixteen
     * chests, rather than a room of a fixed size you then discover is too small.
     */
    public static Blueprint storage(int chests, Map<Role, String> p) {
        int n = clamp(chests, 2, 32);
        int depth = clamp((n + 1) / 2 + 3, 5, 24);
        int w = 5;
        Draft draft = new Draft("storage");
        int maxX = w - 1;
        int maxZ = depth - 1;

        draft.box(0, 0, 0, maxX, 0, maxZ, p.get(Role.FLOOR), Role.FLOOR);
        draft.shell(0, 1, 0, maxX, 3, maxZ, p.get(Role.WALL), Role.WALL);
        draft.box(0, 4, 0, maxX, 4, maxZ, p.get(Role.ROOF), Role.ROOF);

        int doorX = w / 2;
        draft.clear(doorX, 1, 0);
        draft.clear(doorX, 2, 0);

        int placed = 0;
        for (int z = 2; z < maxZ && placed < n; z++) {
            draft.set(1, 1, z, "chest", Role.FURNITURE);
            placed++;
            if (placed < n) {
                draft.set(maxX - 1, 1, z, "chest", Role.FURNITURE);
                placed++;
            }
        }
        draft.set(2, 1, 1, p.get(Role.LIGHT), Role.LIGHT, true);
        draft.set(2, 1, maxZ - 1, p.get(Role.LIGHT), Role.LIGHT, true);
        return draft.finish(doorX, 1, -1);
    }

    private static int clamp(int value, int min, int max) {
        return value < min ? min : Math.min(value, max);
    }
}

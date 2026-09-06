package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A scratchpad for assembling a design without index arithmetic everywhere.
 *
 * Later writes to a cell win, which is what lets a design lay down a solid wall
 * and then punch a window through it — the natural way to describe a building,
 * and far less error-prone than working out in advance which cells the window
 * will occupy.
 */
public final class Draft {
    private final String name;
    private final Map<Long, Blueprint.Placement> cells = new LinkedHashMap<>();

    public Draft(String name) {
        this.name = name;
    }

    private static long key(int x, int y, int z) {
        return ((long) (x + 512) << 40) | ((long) (y + 512) << 20) | (z + 512);
    }

    public Draft set(int x, int y, int z, String block, Blueprint.Role role) {
        return set(x, y, z, block, role, false);
    }

    public Draft set(int x, int y, int z, String block, Blueprint.Role role, boolean optional) {
        return set(x, y, z, block, role, optional, null);
    }

    public Draft facing(int x, int y, int z, String block, Blueprint.Role role, Facing facing) {
        return set(x, y, z, block, role, false, facing);
    }

    public Draft set(int x, int y, int z, String block, Blueprint.Role role, boolean optional,
                     Facing facing) {
        cells.put(key(x, y, z), new Blueprint.Placement(x, y, z, block, role, optional, facing));
        return this;
    }

    /** Remove a cell, so a doorway can be cut out of a finished wall. */
    public Draft clear(int x, int y, int z) {
        cells.remove(key(x, y, z));
        return this;
    }

    public boolean has(int x, int y, int z) {
        return cells.containsKey(key(x, y, z));
    }

    public Draft box(int x0, int y0, int z0, int x1, int y1, int z1, String block, Blueprint.Role role) {
        for (int x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            for (int y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
                for (int z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
                    set(x, y, z, block, role);
        return this;
    }

    /** Only the outer wall of a box; the inside is left untouched. */
    public Draft shell(int x0, int y0, int z0, int x1, int y1, int z1, String block, Blueprint.Role role) {
        int ax = Math.min(x0, x1), bx = Math.max(x0, x1);
        int az = Math.min(z0, z1), bz = Math.max(z0, z1);
        for (int x = ax; x <= bx; x++)
            for (int y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
                for (int z = az; z <= bz; z++)
                    if (x == ax || x == bx || z == az || z == bz) set(x, y, z, block, role);
        return this;
    }

    public Blueprint finish(int entranceX, int entranceY, int entranceZ) {
        List<Blueprint.Placement> placements = new ArrayList<>(cells.values());
        int maxX = 0, maxY = 0, maxZ = 0;
        for (Blueprint.Placement p : placements) {
            maxX = Math.max(maxX, p.x());
            maxY = Math.max(maxY, p.y());
            maxZ = Math.max(maxZ, p.z());
        }
        return new Blueprint(name, placements, maxX + 1, maxY + 1, maxZ + 1,
                entranceX, entranceY, entranceZ);
    }
}

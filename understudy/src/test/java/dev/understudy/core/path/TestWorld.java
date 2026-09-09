package dev.understudy.core.path;

import java.util.HashSet;
import java.util.Set;

/**
 * A voxel world built by hand, so the search can be tested against terrain
 * whose right answer is known by construction.
 *
 * Solid below y=0 by default, so every test starts on ground rather than
 * needing a floor spelled out.
 */
final class TestWorld implements BlockView {
    private final Set<Long> solids = new HashSet<>();
    private final Set<Long> hazards = new HashSet<>();
    private final Set<Long> liquids = new HashSet<>();
    private final Set<Long> unbreakable = new HashSet<>();
    private final Set<Long> unknown = new HashSet<>();
    private final int groundLevel;

    TestWorld(int groundLevel) {
        this.groundLevel = groundLevel;
    }

    TestWorld setSolid(int x, int y, int z) {
        solids.add(PathFinder.key(x, y, z));
        return this;
    }

    TestWorld wall(int x0, int x1, int y0, int y1, int z0, int z1) {
        for (int x = x0; x <= x1; x++)
            for (int y = y0; y <= y1; y++)
                for (int z = z0; z <= z1; z++) setSolid(x, y, z);
        return this;
    }

    private final Set<Long> talls = new HashSet<>();
    private final Set<Long> doors = new HashSet<>();

    /** A fence: solid, one and a half blocks high, impossible to jump onto. */
    TestWorld setFence(int x, int y, int z) {
        setSolid(x, y, z);
        talls.add(PathFinder.key(x, y, z));
        return this;
    }

    /** A shut door: solid to a collision test, and openable. */
    TestWorld setDoor(int x, int y, int z) {
        setSolid(x, y, z);
        doors.add(PathFinder.key(x, y, z));
        return this;
    }

    @Override
    public boolean tall(int x, int y, int z) {
        return talls.contains(PathFinder.key(x, y, z));
    }

    @Override
    public boolean openable(int x, int y, int z) {
        return doors.contains(PathFinder.key(x, y, z));
    }

    TestWorld setHazard(int x, int y, int z) {
        hazards.add(PathFinder.key(x, y, z));
        return this;
    }

    TestWorld setLiquid(int x, int y, int z) {
        liquids.add(PathFinder.key(x, y, z));
        return this;
    }

    TestWorld setUnbreakable(int x, int y, int z) {
        setSolid(x, y, z);
        unbreakable.add(PathFinder.key(x, y, z));
        return this;
    }

    TestWorld unknown(int x, int y, int z) {
        unknown.add(PathFinder.key(x, y, z));
        return this;
    }

    /** Carve a hole in the default ground, e.g. a ravine. */
    TestWorld hole(int x0, int x1, int z0, int z1, int depth) {
        for (int x = x0; x <= x1; x++)
            for (int z = z0; z <= z1; z++)
                for (int y = groundLevel - depth; y <= groundLevel; y++) holes.add(PathFinder.key(x, y, z));
        return this;
    }

    private final Set<Long> holes = new HashSet<>();

    @Override
    public boolean passable(int x, int y, int z) {
        return !solid(x, y, z) || liquid(x, y, z);
    }

    @Override
    public boolean solid(int x, int y, int z) {
        long k = PathFinder.key(x, y, z);
        if (holes.contains(k)) return false;
        if (solids.contains(k)) return true;
        return y <= groundLevel && !liquids.contains(k);
    }

    @Override
    public boolean hazard(int x, int y, int z) {
        return hazards.contains(PathFinder.key(x, y, z));
    }

    @Override
    public boolean liquid(int x, int y, int z) {
        return liquids.contains(PathFinder.key(x, y, z));
    }

    @Override
    public double breakSeconds(int x, int y, int z) {
        if (unbreakable.contains(PathFinder.key(x, y, z))) return -1;
        return solid(x, y, z) ? 0.5 : -1;
    }

    @Override
    public boolean known(int x, int y, int z) {
        return !unknown.contains(PathFinder.key(x, y, z));
    }
}

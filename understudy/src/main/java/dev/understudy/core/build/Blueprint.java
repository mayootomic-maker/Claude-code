package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A structure, as data.
 *
 * Everything downstream reads from this one representation: the bill of
 * materials, the order to place things in, the footprint to level, and the
 * progress check that lets a half-built house be resumed. Keeping the design
 * separate from the act of building is what makes "work out the whole thing,
 * then go and do it" possible at all — you cannot cost a house you are
 * discovering as you place it.
 *
 * Coordinates are relative to the blueprint's own origin, with y=0 the floor.
 */
public record Blueprint(String name, List<Placement> placements, int sizeX, int sizeY, int sizeZ,
                        int entranceX, int entranceY, int entranceZ) {

    /** What a block is for, so its material can be chosen separately. */
    public enum Role { FLOOR, WALL, ACCENT, ROOF, WINDOW, LIGHT, DOOR, FURNITURE }

    /**
     * One block, and which way round it goes.
     *
     * facing is null for everything that does not care, which is most blocks.
     * It is not decoration: stairs take their orientation from where the player
     * is looking, so a roof built without it points the wrong way everywhere.
     */
    public record Placement(int x, int y, int z, String block, Role role, boolean optional,
                            Facing facing) {
        public Placement(int x, int y, int z, String block, Role role, boolean optional) {
            this(x, y, z, block, role, optional, null);
        }
    }

    /** Block name to how many are needed, optional pieces included. */
    public Map<String, Integer> materials() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Placement p : placements) out.merge(p.block(), 1, Integer::sum);
        return out;
    }

    /** Only what the build genuinely cannot proceed without. */
    public Map<String, Integer> essentialMaterials() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Placement p : placements) {
            if (!p.optional()) out.merge(p.block(), 1, Integer::sum);
        }
        return out;
    }

    public int blockCount() {
        return placements.size();
    }

    /**
     * The order to place them in: bottom layer first, and within a layer,
     * furthest from the door first.
     *
     * The height ordering is not optional — you cannot place a block against
     * nothing, so a course has to exist before the one above it. The
     * within-layer ordering is what stops the builder walling itself into a
     * corner: working away from the entrance means the last block placed on
     * each course is the one nearest the way out, so there is always a route
     * back to open ground.
     */
    public List<Placement> buildOrder() {
        List<Placement> ordered = new ArrayList<>(placements);
        ordered.sort((a, b) -> {
            if (a.y() != b.y()) return Integer.compare(a.y(), b.y());
            // Furniture and lights go in after the shell of their layer, since
            // they need a floor and a wall to sit against.
            boolean fittingA = a.role() == Role.FURNITURE || a.role() == Role.LIGHT || a.role() == Role.DOOR;
            boolean fittingB = b.role() == Role.FURNITURE || b.role() == Role.LIGHT || b.role() == Role.DOOR;
            if (fittingA != fittingB) return fittingA ? 1 : -1;
            double da = distanceFromEntrance(a);
            double db = distanceFromEntrance(b);
            return Double.compare(db, da);
        });
        return ordered;
    }

    private double distanceFromEntrance(Placement p) {
        double dx = p.x() - entranceX;
        double dz = p.z() - entranceZ;
        return Math.sqrt(dx * dx + dz * dz);
    }
}

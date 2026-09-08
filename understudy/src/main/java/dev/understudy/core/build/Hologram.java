package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What a holographic blueprint should show, decided away from how to draw it.
 *
 * Drawing is a dozen lines against an API that moved three times this version;
 * deciding is the part with judgement in it, and it belongs where it can be
 * tested. Given a blueprint, where it sits and how far the build has got, this
 * says which boxes to outline and in what colour.
 *
 * The judgement is mostly about restraint. A manor is eleven hundred blocks and
 * outlining all of them is a solid glowing lump you cannot see the shape of,
 * let alone see through to place anything. So: only what is not built yet, only
 * what is near enough to matter, and the surface rather than the interior —
 * because a wireframe of a filled volume is a scribble, and its outside is the
 * shape you actually wanted to check.
 */
public final class Hologram {

    /** One block's worth of outline. Colours are ARGB. */
    public record Ghost(int x, int y, int z, int argb) {}

    /** Far enough to see the whole building, near enough not to draw a city. */
    /**
     * How far a ghost is worth drawing.
     *
     * Was sixty-four, which on a six-thousand-block import meant thousands of
     * outlines drawn through the terrain in every direction — which is both
     * where the frame rate went and why it looked like x-ray vision. Twenty-four
     * is the part of the build you are actually standing in.
     */
    public static final int RANGE = 24;
    /** Above this many boxes even a good machine starts to feel it. */
    /**
     * A hard ceiling on how many outlines a frame may carry.
     *
     * Every one of these is a shape allocated and submitted, so this number is
     * a frame-time budget rather than a matter of taste. Seven hundred fills the
     * space around you; four thousand — the old number — is a slideshow.
     */
    public static final int MAX_GHOSTS = 700;

    /** Still to do: the plan, in the blueprint's own material colours. */
    private static final int PENDING_ALPHA = 0xB0000000;
    /** The next block to be placed, called out so you can see where it is up to. */
    public static final int NEXT = 0xFFFFFFFF;
    /** Done, and dimmed almost to nothing: confirmation, not decoration. */
    public static final int PLACED = 0x30707070;
    /** Which way it faces, and where the way in is. Read before anything else. */
    public static final int FRONT = 0xFFFFC24D;
    public static final int DOORWAY = 0xFF6BE38A;

    /**
     * An arrow on the ground pointing out of the front, and a mark on the door.
     *
     * The outline of a building tells you where it will be and nothing about
     * which way round it is. On this mod's own designs that is the difference
     * between a door onto your path and a door into a hillside; on an import it
     * is the difference between the front of the house and the back of it. You
     * cannot read it off a wireframe — every wall looks like every other wall
     * from outside — so it is drawn.
     *
     * The arrow lies flat on the ground in front of the building rather than
     * floating in the outline, because the one place there is definitely
     * nothing else drawn is the ground outside it.
     *
     * @param facing which way the front points: 0 north, 1 east, 2 south, 3 west
     */
    public static List<Ghost> orientation(Blueprint plan, int originX, int originY, int originZ,
                                          int facing) {
        List<Ghost> out = new ArrayList<>();
        int midX = originX + plan.sizeX() / 2;
        int midZ = originZ + plan.sizeZ() / 2;
        int stepX = switch (facing) { case 1 -> 1; case 3 -> -1; default -> 0; };
        int stepZ = switch (facing) { case 0 -> -1; case 2 -> 1; default -> 0; };

        // Start at the middle of the face it points out of, not at the middle
        // of the building, or the arrow begins inside the walls.
        int fromX = midX + stepX * (stepX == 0 ? 0 : plan.sizeX() / 2);
        int fromZ = midZ + stepZ * (stepZ == 0 ? 0 : plan.sizeZ() / 2);

        for (int step = 1; step <= ARROW; step++) {
            out.add(new Ghost(fromX + stepX * step, originY, fromZ + stepZ * step, FRONT));
        }
        // Two barbs, across the direction of travel, at the far end.
        int tipX = fromX + stepX * ARROW;
        int tipZ = fromZ + stepZ * ARROW;
        out.add(new Ghost(tipX - stepX + stepZ, originY, tipZ - stepZ + stepX, FRONT));
        out.add(new Ghost(tipX - stepX - stepZ, originY, tipZ - stepZ - stepX, FRONT));

        // And the way in, which is a fact about the design rather than about
        // the rotation, and the thing you actually want to line up.
        out.add(new Ghost(originX + plan.entranceX(), originY + plan.entranceY(),
                originZ + plan.entranceZ(), DOORWAY));
        return out;
    }

    /** Long enough to read at a distance, short enough not to be a runway. */
    private static final int ARROW = 3;

    private Hologram() {}

    /**
     * @param blueprint what is being built
     * @param originX   where the blueprint's own corner sits in the world
     * @param placed    how many of the build order are already done
     * @param nextIndex the one about to be placed, or -1
     * @param eyeX      where the player is, for range and for what to bother with
     * @param showDone  whether to dim in the finished blocks as well
     */
    /**
     * The part of the answer that depends only on the blueprint.
     *
     * Worked out once when a build starts rather than once a frame, which is
     * the whole of a performance bug that made a six-thousand-block import
     * unplayable: `buildOrder` sorts the entire design, and it was being sorted
     * sixty times a second, alongside a fresh set of six thousand positions and
     * a fresh list of four thousand shapes. None of that changes while a
     * building goes up.
     */
    public record Shape(List<Blueprint.Placement> order, java.util.Set<Long> filled,
                        Map<String, Integer> colours) {}

    public static Shape shapeOf(Blueprint blueprint) {
        return shapeOf(blueprint, blueprint.buildOrder());
    }

    /**
     * The same, over an order somebody else owns.
     *
     * The builder takes blocks out of turn to save itself a walk, so the order
     * it is working through stops matching the one this would compute for
     * itself the moment it does. "Done" here is the first n of a list, so two
     * different lists means the finished part of the drawing is not the
     * finished part of the building — ghosts dimmed over empty air and solid
     * blocks still drawn as plans.
     *
     * Handing the list in rather than deriving it keeps them the same list,
     * which is a stronger guarantee than keeping them in step would be.
     */
    public static Shape shapeOf(Blueprint blueprint, List<Blueprint.Placement> order) {
        java.util.Set<Long> filled = new java.util.HashSet<>();
        Map<String, Integer> colours = new java.util.HashMap<>();
        for (Blueprint.Placement p : order) {
            filled.add(cell(p.x(), p.y(), p.z()));
            colours.computeIfAbsent(p.block(), Palette::colourOf);
        }
        return new Shape(order, filled, colours);
    }

    public static List<Ghost> of(Blueprint blueprint, int originX, int originY, int originZ,
                                 int placed, int nextIndex,
                                 double eyeX, double eyeY, double eyeZ, boolean showDone) {
        return of(shapeOf(blueprint), originX, originY, originZ, placed, nextIndex,
                eyeX, eyeY, eyeZ, showDone);
    }

    public static List<Ghost> of(Shape shape, int originX, int originY, int originZ,
                                 int placed, int nextIndex,
                                 double eyeX, double eyeY, double eyeZ, boolean showDone) {
        List<Blueprint.Placement> order = shape.order();
        Map<String, Integer> colours = shape.colours();
        java.util.Set<Long> filled = shape.filled();
        List<Ghost> ghosts = new ArrayList<>();

        for (int i = 0; i < order.size() && ghosts.size() < MAX_GHOSTS; i++) {
            Blueprint.Placement p = order.get(i);
            boolean done = i < placed;
            if (done && !showDone) continue;

            int x = originX + p.x();
            int y = originY + p.y();
            int z = originZ + p.z();
            if (far(x, y, z, eyeX, eyeY, eyeZ)) continue;
            // The inside of a solid wall contributes nothing you can see and
            // everything to the mess. Only the faces that are exposed.
            if (!done && buried(filled, p)) continue;

            int argb;
            if (i == nextIndex) argb = NEXT;
            else if (done) argb = PLACED;
            else {
                argb = PENDING_ALPHA | (colours.getOrDefault(p.block(), 0xFFFFFF) & 0xFFFFFF);
            }
            ghosts.add(new Ghost(x, y, z, argb));
        }
        return ghosts;
    }

    private static boolean far(int x, int y, int z, double eyeX, double eyeY, double eyeZ) {
        double dx = x + 0.5 - eyeX;
        double dy = y + 0.5 - eyeY;
        double dz = z + 0.5 - eyeZ;
        return dx * dx + dy * dy + dz * dz > (double) RANGE * RANGE;
    }

    /**
     * Whether every side of this block is another block of the same plan.
     *
     * Such a block is invisible in the finished building and worse than
     * invisible in a wireframe, where it is a box drawn inside a box.
     */
    private static boolean buried(java.util.Set<Long> filled, Blueprint.Placement p) {
        return filled.contains(cell(p.x() + 1, p.y(), p.z()))
                && filled.contains(cell(p.x() - 1, p.y(), p.z()))
                && filled.contains(cell(p.x(), p.y() + 1, p.z()))
                && filled.contains(cell(p.x(), p.y() - 1, p.z()))
                && filled.contains(cell(p.x(), p.y(), p.z() + 1))
                && filled.contains(cell(p.x(), p.y(), p.z() - 1));
    }

    private static long cell(int x, int y, int z) {
        return ((long) (x & 0xFFFF) << 32) | ((long) (z & 0xFFFF) << 16) | (y & 0xFFFF);
    }
}

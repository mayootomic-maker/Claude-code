package dev.understudy.core.path;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;

/**
 * A* over the blocks a player can actually stand in.
 *
 * A node is a cell the feet occupy. A cell is standable when the feet and head
 * are clear and there is something underneath — or when it is fluid, which you
 * swim in rather than stand on. From there the moves are the ones a player has:
 * walk, walk diagonally, step up one, drop several, swim, and optionally dig
 * through or bridge across.
 *
 * Two details do most of the work of making a route look sane rather than
 * merely valid. Diagonals refuse to cut corners, so the path never tries to
 * squeeze between two blocks that meet at an edge — a move the game itself will
 * not let you make, and the most common way a naive path silently stalls. And
 * every move type carries its own cost, so digging and bridging are available
 * but expensive, and a route that walks thirty blocks around a hill wins over
 * one that tunnels ten blocks through it.
 *
 * The search is budgeted rather than exhaustive. A player asking to travel two
 * thousand blocks does not want the client to freeze while it proves the route
 * exists, so when the budget runs out the best node reached so far is returned
 * as a partial path, and the caller walks it and searches again from there.
 */
public final class PathFinder {

    /** Per-move costs, in rough seconds. */
    public static final double WALK_COST = 1.0;
    public static final double DIAGONAL_COST = 1.414;
    public static final double JUMP_COST = 1.6;
    public static final double FALL_COST = 0.8;
    public static final double SWIM_COST = 3.2;
    public static final double BRIDGE_COST = 4.0;
    /** Added on top of the block's own break time, for the walking and aiming. */
    public static final double DIG_OVERHEAD = 2.0;

    /** Falling further than this hurts; the search will not do it voluntarily. */
    public static final int MAX_SAFE_FALL = 3;

    public static final class Options {
        public boolean allowDig = true;
        public boolean allowBridge = true;
        public boolean allowSwim = true;
        /** How many nodes to expand before giving up and returning the best so far. */
        public int budget = 12_000;
        /** How close to the goal counts as arrived. */
        public int range = 1;
        /** Ceiling on a single break, so it never decides to chew through obsidian. */
        public double maxBreakSeconds = 6.0;

        public Options allowDig(boolean value) { this.allowDig = value; return this; }
        public Options allowBridge(boolean value) { this.allowBridge = value; return this; }
        public Options allowSwim(boolean value) { this.allowSwim = value; return this; }
        public Options budget(int value) { this.budget = value; return this; }
        public Options range(int value) { this.range = value; return this; }
    }

    public record Result(List<Step> steps, boolean complete, int expanded, double cost) {
        public boolean empty() {
            return steps.isEmpty();
        }
    }

    private final BlockView world;
    private final Options options;

    public PathFinder(BlockView world, Options options) {
        this.world = world;
        this.options = options;
    }

    public Result find(int fromX, int fromY, int fromZ, int toX, int toY, int toZ) {
        long start = key(fromX, fromY, fromZ);
        long goal = key(toX, toY, toZ);

        Map<Long, Node> seen = new HashMap<>();
        PriorityQueue<Node> open = new PriorityQueue<>((a, b) -> Double.compare(a.f, b.f));

        Node origin = new Node(fromX, fromY, fromZ, 0, heuristic(fromX, fromY, fromZ, toX, toY, toZ), null, null);
        seen.put(start, origin);
        open.add(origin);

        Node best = origin;
        double bestScore = origin.h;
        int expanded = 0;

        while (!open.isEmpty() && expanded < options.budget) {
            Node current = open.poll();
            if (current.closed) continue;
            current.closed = true;
            expanded++;

            if (within(current, toX, toY, toZ)) {
                return new Result(reconstruct(current), true, expanded, current.g);
            }
            if (current.h < bestScore) {
                bestScore = current.h;
                best = current;
            }

            for (Step move : moves(current.x, current.y, current.z)) {
                long id = key(move.x(), move.y(), move.z());
                double g = current.g + move.cost();
                Node existing = seen.get(id);
                if (existing != null && g >= existing.g) continue;

                Node next = new Node(
                        move.x(), move.y(), move.z(),
                        g,
                        heuristic(move.x(), move.y(), move.z(), toX, toY, toZ),
                        current,
                        move);
                seen.put(id, next);
                open.add(next);
            }
        }

        // Out of budget, or genuinely boxed in. Either way the best node reached
        // is a real, walkable prefix — hand it back rather than nothing.
        List<Step> partial = reconstruct(best);
        return new Result(partial, false, expanded, best.g);
    }

    private boolean within(Node node, int toX, int toY, int toZ) {
        int dx = Math.abs(node.x - toX);
        int dy = Math.abs(node.y - toY);
        int dz = Math.abs(node.z - toZ);
        return dx <= options.range && dz <= options.range && dy <= Math.max(options.range, 1);
    }

    /**
     * Octile distance, which is admissible for a grid that allows diagonals:
     * it never overestimates, so A* still returns an optimal path.
     */
    private static double heuristic(int x, int y, int z, int toX, int toY, int toZ) {
        int dx = Math.abs(x - toX);
        int dz = Math.abs(z - toZ);
        int dy = Math.abs(y - toY);
        int min = Math.min(dx, dz);
        int max = Math.max(dx, dz);
        return (DIAGONAL_COST * min + WALK_COST * (max - min)) + dy * 0.4;
    }

    private List<Step> reconstruct(Node node) {
        Deque<Step> out = new ArrayDeque<>();
        Node current = node;
        while (current != null && current.via != null) {
            out.addFirst(current.via);
            current = current.parent;
        }
        return new ArrayList<>(out);
    }

    /** Every move available from a standing position. */
    List<Step> moves(int x, int y, int z) {
        List<Step> out = new ArrayList<>(12);

        for (Dir dir : Dir.CARDINAL) {
            horizontal(out, x, y, z, dir.dx, dir.dz, WALK_COST);
        }
        for (Dir dir : Dir.DIAGONAL) {
            // No corner cutting: both orthogonal cells must be open, or the game
            // will refuse the move and the walker will stall against the corner.
            if (!clearColumn(x + dir.dx, y, z) || !clearColumn(x, y, z + dir.dz)) continue;
            horizontal(out, x, y, z, dir.dx, dir.dz, DIAGONAL_COST);
        }
        return out;
    }

    private void horizontal(List<Step> out, int x, int y, int z, int dx, int dz, double base) {
        int nx = x + dx;
        int nz = z + dz;
        if (!world.known(nx, y, nz)) return;

        // Straight across.
        if (standable(nx, y, nz)) {
            out.add(new Step(nx, y, nz, world.liquid(nx, y, nz) ? Step.Kind.SWIM : Step.Kind.WALK,
                    world.liquid(nx, y, nz) ? SWIM_COST : base));
            return;
        }

        // Up one, if there is headroom to jump into.
        if (clearColumn(nx, y + 1, nz) && world.solid(nx, y, nz) && passableAt(x, y + 2, z)) {
            out.add(new Step(nx, y + 1, nz, Step.Kind.JUMP, base + JUMP_COST));
            return;
        }

        // Down, as far as is safe.
        if (clearColumn(nx, y, nz)) {
            for (int drop = 1; drop <= MAX_SAFE_FALL; drop++) {
                int ny = y - drop;
                if (!world.known(nx, ny, nz)) break;
                if (!clearColumn(nx, ny, nz)) break;
                if (standable(nx, ny, nz)) {
                    out.add(new Step(nx, ny, nz, Step.Kind.FALL, base + FALL_COST * drop));
                    return;
                }
            }
            // Nothing to land on, but we could put something there ourselves.
            if (options.allowBridge && supported(x, y, z)) {
                out.add(new Step(nx, y, nz, Step.Kind.BRIDGE, base + BRIDGE_COST));
            }
            return;
        }

        // Blocked. Digging through is a last resort and priced like one.
        if (options.allowDig) {
            double feet = world.breakSeconds(nx, y, nz);
            double head = world.breakSeconds(nx, y + 1, nz);
            double total = 0;
            if (!passableAt(nx, y, nz)) {
                if (feet < 0 || feet > options.maxBreakSeconds) return;
                total += feet;
            }
            if (!passableAt(nx, y + 1, nz)) {
                if (head < 0 || head > options.maxBreakSeconds) return;
                total += head;
            }
            if (total <= 0) return;
            if (!world.solid(nx, y - 1, nz) && !world.liquid(nx, y - 1, nz)) return;
            out.add(new Step(nx, y, nz, Step.Kind.DIG, base + total + DIG_OVERHEAD));
        }
    }

    /** Feet and head clear, and something to stand on or swim in. */
    private boolean standable(int x, int y, int z) {
        if (!clearColumn(x, y, z)) return false;
        if (world.liquid(x, y, z)) return options.allowSwim;
        return supported(x, y, z);
    }

    private boolean supported(int x, int y, int z) {
        return world.solid(x, y - 1, z);
    }

    /** Two blocks of clearance for the player, and neither of them dangerous. */
    private boolean clearColumn(int x, int y, int z) {
        return passableAt(x, y, z) && passableAt(x, y + 1, z);
    }

    private boolean passableAt(int x, int y, int z) {
        if (!world.known(x, y, z)) return false;
        if (world.hazard(x, y, z)) return false;
        return world.passable(x, y, z);
    }

    /** Pack a block position into a long, so the open set keys are cheap. */
    public static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 38) | ((long) (z & 0x3FFFFFF) << 12) | (y & 0xFFF);
    }

    private static final class Node {
        final int x;
        final int y;
        final int z;
        final double g;
        final double h;
        final double f;
        final Node parent;
        final Step via;
        boolean closed;

        Node(int x, int y, int z, double g, double h, Node parent, Step via) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.g = g;
            this.h = h;
            this.f = g + h;
            this.parent = parent;
            this.via = via;
        }
    }

    private record Dir(int dx, int dz) {
        static final Dir[] CARDINAL = {new Dir(1, 0), new Dir(-1, 0), new Dir(0, 1), new Dir(0, -1)};
        static final Dir[] DIAGONAL = {new Dir(1, 1), new Dir(1, -1), new Dir(-1, 1), new Dir(-1, -1)};
    }
}

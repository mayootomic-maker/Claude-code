package dev.understudy.core.path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PathFinderTest {

    private static PathFinder.Options options() {
        return new PathFinder.Options();
    }

    private static PathFinder.Result run(BlockView world, PathFinder.Options opts,
                                         int fx, int fy, int fz, int tx, int ty, int tz) {
        return new PathFinder(world, opts).find(fx, fy, fz, tx, ty, tz);
    }

    /** Walk the path and assert every step is adjacent to the last. */
    private static void assertContinuous(int fx, int fy, int fz, List<Step> steps) {
        int x = fx, y = fy, z = fz;
        for (Step step : steps) {
            int dx = Math.abs(step.x() - x);
            int dz = Math.abs(step.z() - z);
            int dy = step.y() - y;
            assertTrue(dx <= 1 && dz <= 1, "step jumped horizontally: " + step);
            assertTrue(dy <= 1, "step rose more than one block: " + step);
            assertTrue(dy >= -PathFinder.MAX_SAFE_FALL, "step fell too far: " + step);
            assertTrue(dx + dz > 0 || dy != 0, "step went nowhere: " + step);
            x = step.x();
            y = step.y();
            z = step.z();
        }
    }

    @Test
    @DisplayName("crosses flat ground in a straight line")
    void flat() {
        TestWorld world = new TestWorld(63);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 10, 64, 0);
        assertTrue(result.complete(), "did not reach the goal");
        assertContinuous(0, 64, 0, result.steps());
        // Ten blocks of walking, allowing for the arrival range.
        assertTrue(result.steps().size() <= 11, "wandered: " + result.steps().size() + " steps");
    }

    @Test
    @DisplayName("uses diagonals rather than staircasing")
    void diagonals() {
        TestWorld world = new TestWorld(63);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 10, 64, 10);
        assertTrue(result.complete());
        // A pure-orthogonal path would need about twenty steps; diagonals halve it.
        assertTrue(result.steps().size() <= 12, "not using diagonals: " + result.steps().size());
    }

    @Test
    @DisplayName("refuses to cut a corner between two blocks")
    void noCornerCutting() {
        // Blocks at (1,64,0) and (0,64,1) meet at an edge. Moving diagonally
        // from (0,64,0) to (1,64,1) is a move the game will not allow, and a
        // path that contains it stalls forever against the corner.
        TestWorld world = new TestWorld(63);
        world.setSolid(1, 64, 0).setSolid(0, 64, 1);
        PathFinder finder = new PathFinder(world, options());
        List<Step> moves = finder.moves(0, 64, 0);
        assertTrue(moves.stream().noneMatch(s -> s.x() == 1 && s.z() == 1 && s.y() == 64),
                "produced an illegal corner cut");
    }

    @Test
    @DisplayName("steps up a one-block ledge")
    void stepUp() {
        TestWorld world = new TestWorld(63);
        world.wall(3, 3, 64, 64, -2, 2);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 6, 65, 0);
        assertTrue(result.complete(), "could not climb the ledge");
        assertTrue(result.steps().stream().anyMatch(s -> s.kind() == Step.Kind.JUMP), "never jumped");
        assertContinuous(0, 64, 0, result.steps());
    }

    @Test
    @DisplayName("drops down a safe ledge but not a lethal one")
    void falling() {
        TestWorld shallow = new TestWorld(63);
        shallow.hole(2, 8, -3, 3, 2);
        PathFinder.Result over = run(shallow, options(), 0, 64, 0, 10, 62, 0);
        assertTrue(over.complete(), "would not take a safe drop");

        // A twenty-block shaft is not a route; the search must go round.
        TestWorld deep = new TestWorld(63);
        deep.hole(2, 4, -1, 1, 20);
        PathFinder.Result around = run(deep, options(), 0, 64, 0, 8, 64, 0);
        assertTrue(around.complete());
        for (Step step : around.steps()) {
            assertTrue(step.y() >= 62, "dropped into the shaft: " + step);
        }
    }

    @Test
    @DisplayName("walks round a wall rather than through it when digging is off")
    void goesAround() {
        TestWorld world = new TestWorld(63);
        world.wall(5, 5, 64, 68, -6, 6);
        PathFinder.Result result = run(world, options().allowDig(false), 0, 64, 0, 10, 64, 0);
        assertTrue(result.complete(), "could not find a way round");
        assertContinuous(0, 64, 0, result.steps());
        assertTrue(result.steps().stream().noneMatch(s -> s.kind() == Step.Kind.DIG));
        // It has to detour past the end of the wall.
        assertTrue(result.steps().stream().anyMatch(s -> Math.abs(s.z()) > 5), "did not detour");
    }

    @Test
    @DisplayName("digs through when going round is far enough to be worse")
    void digsThrough() {
        TestWorld world = new TestWorld(63);
        world.wall(5, 5, 64, 68, -400, 400);
        PathFinder.Result result = run(world, options().budget(60_000), 0, 64, 0, 10, 64, 0);
        assertTrue(result.complete(), "never got through");
        assertTrue(result.steps().stream().anyMatch(s -> s.kind() == Step.Kind.DIG), "did not dig");
    }

    @Test
    @DisplayName("will not dig through something it cannot break")
    void respectsUnbreakable() {
        TestWorld world = new TestWorld(63);
        for (int z = -400; z <= 400; z++)
            for (int y = 64; y <= 68; y++) world.setUnbreakable(5, y, z);
        PathFinder.Result result = run(world, options().budget(30_000), 0, 64, 0, 10, 64, 0);
        assertFalse(result.complete(), "claimed to pass through bedrock");
        assertTrue(result.steps().stream().noneMatch(s -> s.x() >= 5), "got past the barrier");
    }

    @Test
    @DisplayName("routes around lava instead of into it")
    void avoidsHazards() {
        TestWorld world = new TestWorld(63);
        for (int z = -2; z <= 2; z++) world.setHazard(4, 64, z);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 8, 64, 0);
        assertTrue(result.complete());
        for (Step step : result.steps()) {
            assertFalse(step.x() == 4 && Math.abs(step.z()) <= 2 && step.y() == 64,
                    "walked into lava: " + step);
        }
    }

    @Test
    @DisplayName("bridges a gap when there is nothing to walk on")
    void bridges() {
        TestWorld world = new TestWorld(63);
        world.hole(3, 6, -1, 1, 30);
        PathFinder.Result result = run(world, options().budget(40_000), 0, 64, 0, 9, 64, 0);
        assertTrue(result.complete(), "could not cross the chasm");
        assertContinuous(0, 64, 0, result.steps());
    }

    @Test
    @DisplayName("prefers dry land to swimming")
    void prefersLand() {
        TestWorld world = new TestWorld(63);
        for (int x = 2; x <= 6; x++)
            for (int z = -1; z <= 1; z++) world.setLiquid(x, 64, z);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 8, 64, 0);
        assertTrue(result.complete());
        long swum = result.steps().stream().filter(s -> s.kind() == Step.Kind.SWIM).count();
        assertEquals(0, swum, "swam when it could have walked round");
    }

    @Test
    @DisplayName("swims when there is no way round")
    void swims() {
        TestWorld world = new TestWorld(63);
        for (int x = 2; x <= 6; x++)
            for (int z = -60; z <= 60; z++) world.setLiquid(x, 64, z);
        PathFinder.Result result = run(world, options().budget(40_000), 0, 64, 0, 8, 64, 0);
        assertTrue(result.complete(), "would not cross the water");
        assertTrue(result.steps().stream().anyMatch(s -> s.kind() == Step.Kind.SWIM));
    }

    @Test
    @DisplayName("will not path into unloaded chunks")
    void respectsUnknown() {
        TestWorld world = new TestWorld(63);
        for (int x = 4; x <= 6; x++)
            for (int y = 60; y <= 70; y++)
                for (int z = -5; z <= 5; z++) world.unknown(x, y, z);
        PathFinder.Result result = run(world, options(), 0, 64, 0, 10, 64, 0);
        for (Step step : result.steps()) {
            assertTrue(step.x() < 4 || step.x() > 6 || Math.abs(step.z()) > 5,
                    "pathed into an unloaded chunk: " + step);
        }
    }

    @Test
    @DisplayName("returns a usable prefix rather than nothing when the budget runs out")
    void partialPath() {
        TestWorld world = new TestWorld(63);
        PathFinder.Result result = run(world, options().budget(200), 0, 64, 0, 3000, 64, 0);
        assertFalse(result.complete());
        assertFalse(result.empty(), "gave up with nothing to walk");
        assertContinuous(0, 64, 0, result.steps());
        // The prefix must actually make progress toward the goal.
        Step last = result.steps().get(result.steps().size() - 1);
        assertTrue(last.x() > 5, "prefix went nowhere useful: " + last);
    }

    @Test
    @DisplayName("says so when the goal is walled in")
    void impossible() {
        TestWorld world = new TestWorld(63);
        // A sealed 1x1 box around the goal.
        for (int y = 63; y <= 67; y++)
            for (int x = 9; x <= 11; x++)
                for (int z = -1; z <= 1; z++)
                    if (x != 10 || z != 0) world.setUnbreakable(x, y, z);
        world.setUnbreakable(10, 66, 0);
        PathFinder.Result result = run(world, options().budget(20_000), 0, 64, 0, 10, 64, 0);
        assertFalse(result.complete());
    }

    @Test
    @DisplayName("stays within its budget on an impossible search")
    void budgetIsRespected() {
        TestWorld world = new TestWorld(63);
        for (int y = 60; y <= 70; y++)
            for (int z = -500; z <= 500; z++) world.setUnbreakable(5, y, z);
        long started = System.nanoTime();
        PathFinder.Result result = run(world, options().budget(5_000), 0, 64, 0, 200, 64, 0);
        long ms = (System.nanoTime() - started) / 1_000_000;
        assertTrue(result.expanded() <= 5_000, "blew the budget: " + result.expanded());
        assertTrue(ms < 4_000, "took too long: " + ms + "ms");
    }
}

package dev.understudy.core.path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Random;

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
    @DisplayName("goes round deep water rather than along the bottom of it")
    void staysAtTheSurface() {
        // A barrier with two crossings: a deep one straight ahead, where the
        // water is over your head, and a shallow one eight blocks off to the
        // side. Wading further is better than drowning nearer.
        TestWorld world = new TestWorld(63);
        for (int x = 4; x <= 7; x++)
            for (int y = 64; y <= 70; y++)
                for (int z = -25; z <= 25; z++) {
                    if (z == 0 || z == 8) continue;
                    world.setUnbreakable(x, y, z);
                }
        for (int x = 4; x <= 7; x++) {
            world.setLiquid(x, 64, 0).setLiquid(x, 65, 0);
            world.setLiquid(x, 64, 8);
        }

        PathFinder.Result careful = run(world, options().budget(60_000), 0, 64, 0, 11, 64, 0);
        assertTrue(careful.complete(), "did not get across");
        assertTrue(careful.steps().stream().allMatch(s -> s.z() != 0 || s.x() < 4 || s.x() > 7),
                "swam through the deep crossing");

        // And that it is the penalty doing it, not the geometry.
        PathFinder.Result reckless =
                run(world, withoutSubmergedPenalty(), 0, 64, 0, 11, 64, 0);
        assertTrue(reckless.steps().stream().anyMatch(s -> s.z() == 0 && s.x() >= 4 && s.x() <= 7),
                "without the penalty it should take the short deep route");
    }

    private static PathFinder.Options withoutSubmergedPenalty() {
        PathFinder.Options opts = options().budget(60_000);
        opts.submergedPenalty = 0;
        return opts;
    }

    @Test
    @DisplayName("walks out of a dead end rather than reporting no route")
    void leavesAPocket() {
        // The goal is due east; the only way out of here is west. Every cell
        // reachable is further from the goal than this one, which used to come
        // back as an empty path — read by the caller as "nowhere to go" while
        // standing in a perfectly walkable corridor.
        TestWorld world = new TestWorld(63);
        for (int y = 64; y <= 66; y++) {
            for (int x = -11; x <= 1; x++) {
                world.setUnbreakable(x, y, 1);
                world.setUnbreakable(x, y, -1);
            }
            world.setUnbreakable(1, y, 0);
            world.setUnbreakable(-11, y, 0);
        }

        PathFinder.Result result = run(world, options().budget(20_000), 0, 64, 0, 20, 64, 0);
        assertFalse(result.complete());
        assertFalse(result.empty(), "gave up standing in an open corridor");
        assertFalse(result.progress(), "claimed to have got closer when it went the other way");
        assertContinuous(0, 64, 0, result.steps());
        assertTrue(result.steps().get(result.steps().size() - 1).x() < 0,
                "did not actually leave");
    }

    @Test
    @DisplayName("leans on the estimate so a budgeted search commits to a direction")
    void weightedHeuristicCommits() {
        // Broken ground — scattered rocks and one- to three-block rises, which
        // is what ordinary terrain looks like to a pathfinder. On a billiard
        // table every route is optimal and it makes no difference; the moment
        // there is anything to step round, an admissible estimate has a fan of
        // equally optimal routes to separate and spends the whole budget doing
        // it, while the goal is still two hundred blocks away.
        TestWorld world = new TestWorld(63);
        Random rocks = new Random(7);
        for (int x = -20; x <= 300; x++)
            for (int z = -80; z <= 80; z++)
                if (rocks.nextInt(100) < 12)
                    for (int y = 64, top = 64 + rocks.nextInt(3); y <= top; y++)
                        world.setSolid(x, y, z);

        PathFinder.Options budgeted = options().budget(4_000);
        budgeted.allowDig = false;
        PathFinder.Result weighted = run(world, budgeted, 0, 65, 0, 250, 65, 0);

        PathFinder.Options admissible = options().heuristicWeight(1.0).budget(4_000);
        admissible.allowDig = false;
        PathFinder.Result textbook = run(world, admissible, 0, 65, 0, 250, 65, 0);

        assertTrue(weighted.complete(), "the weighted search should just walk it");
        assertContinuous(0, 65, 0, weighted.steps());
        assertFalse(textbook.complete(), "the premise of the weighting no longer holds");
        int fanned = textbook.steps().isEmpty() ? 0
                : textbook.steps().get(textbook.steps().size() - 1).x();
        assertTrue(fanned < 250, "expected a prefix, got the whole way: " + fanned);
        // And it is not paying much for it: a route a few per cent longer than
        // the provably optimal one, found in a fraction of the search.
        assertTrue(weighted.expanded() < textbook.expanded() / 2,
                "no cheaper to search: " + weighted.expanded() + " vs " + textbook.expanded());
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

    @Test
    @DisplayName("never plans to jump onto a fence")
    void willNotJumpOntoAFence() {
        // A fence line across the way, with a gap round the end. The route must
        // go round. Jumping onto a fence is a move the game refuses, so a path
        // that contains it is a path that ends with the walker pressed against
        // a fence post until something gives up.
        TestWorld world = new TestWorld(63);
        for (int z = -6; z <= 6; z++) world.setFence(5, 64, z);

        PathFinder.Result result = run(world, options().budget(40_000), 0, 64, 0, 10, 64, 0);
        assertTrue(result.complete(), "could not get past a fence at all");
        assertContinuous(0, 64, 0, result.steps());
        for (Step step : result.steps()) {
            assertFalse(step.x() == 5 && step.y() == 65 && Math.abs(step.z()) <= 6,
                    "planned to stand on a fence: " + step);
        }
    }

    @Test
    @DisplayName("walks through a door instead of reporting no way round")
    void opensDoorsRatherThanGivingUp() {
        // A room with one door. Treating a shut door as a wall is how a route
        // inside a building comes back empty while you are standing in it.
        TestWorld world = new TestWorld(63);
        for (int y = 64; y <= 66; y++) {
            for (int x = 3; x <= 9; x++) {
                world.setUnbreakable(x, y, 3);
                world.setUnbreakable(x, y, 9);
            }
            for (int z = 3; z <= 9; z++) {
                world.setUnbreakable(3, y, z);
                world.setUnbreakable(9, y, z);
            }
        }
        // The doorway, shut.
        world.setDoor(3, 64, 6);
        world.setDoor(3, 65, 6);

        PathFinder.Result result = run(world, options().budget(40_000), 0, 64, 6, 6, 64, 6);
        assertTrue(result.complete(), "would not go through a door");
        assertTrue(result.steps().stream().anyMatch(s -> s.x() == 3 && s.z() == 6),
                "got in some other way: " + result.steps());
    }

    @Test
    @DisplayName("does not drop onto a fence as if it were ground")
    void doesNotLandOnFences() {
        TestWorld world = new TestWorld(63);
        // A pit with a fence at the bottom of one column: standing there is not
        // something the game lets you do at the height the search assumes.
        world.hole(4, 6, -1, 1, 3);
        world.setFence(5, 61, 0);
        PathFinder.Result result = run(world, options().budget(40_000), 0, 64, 0, 10, 64, 0);
        for (Step step : result.steps()) {
            assertFalse(step.x() == 5 && step.z() == 0 && step.y() == 62,
                    "planned to stand on top of a fence: " + step);
        }
    }
}

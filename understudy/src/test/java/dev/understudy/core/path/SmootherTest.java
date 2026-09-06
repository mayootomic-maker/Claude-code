package dev.understudy.core.path;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SmootherTest {

    private static List<Step> walk(int[][] cells) {
        List<Step> path = new ArrayList<>();
        for (int[] cell : cells) path.add(new Step(cell[0], cell[1], cell[2], Step.Kind.WALK, 1));
        return path;
    }

    @Test
    void collapsesAStaircaseIntoItsDiagonal() {
        // The shape A* returns crossing open ground: alternating east and south.
        List<Step> staircase = walk(new int[][]{
                {0, 1, 0}, {1, 1, 0}, {1, 1, 1}, {2, 1, 1},
                {2, 1, 2}, {3, 1, 2}, {3, 1, 3}, {4, 1, 3}, {4, 1, 4}});
        List<Step> smoothed = Smoother.smooth(staircase, new TestWorld(0));

        assertTrue(smoothed.size() < staircase.size(),
                "open ground should not need nine waypoints");
        assertEquals(staircase.get(0), smoothed.get(0), "must start where the path started");
        assertEquals(staircase.get(staircase.size() - 1), smoothed.get(smoothed.size() - 1),
                "must end where the path ended");
    }

    @Test
    void keepsCornersItCannotSeeThrough() {
        // A wall between the ends, with the path going round it. Shortcutting
        // the corner here would walk into stone.
        TestWorld world = new TestWorld(0).wall(2, 2, 1, 2, -5, 3);
        List<Step> around = walk(new int[][]{
                {0, 1, 0}, {1, 1, 0}, {1, 1, 4}, {2, 1, 4}, {3, 1, 4}, {3, 1, 0}});
        List<Step> smoothed = Smoother.smooth(around, world);

        boolean crosses = smoothed.stream().anyMatch(s -> s.x() >= 2 && s.z() < 4 && s.z() > 0);
        assertFalse(crosses, "smoothing must not cut through the wall");
    }

    @Test
    void neverShortcutsPastAnAction() {
        // A dig in the middle: skipping it would describe a route through a
        // block that is still there.
        List<Step> path = List.of(
                new Step(0, 1, 0, Step.Kind.WALK, 1),
                new Step(1, 1, 0, Step.Kind.WALK, 1),
                new Step(2, 1, 0, Step.Kind.DIG, 8),
                new Step(3, 1, 0, Step.Kind.WALK, 1),
                new Step(4, 1, 0, Step.Kind.WALK, 1));
        List<Step> smoothed = Smoother.smooth(path, new TestWorld(0));

        assertTrue(smoothed.stream().anyMatch(s -> s.kind() == Step.Kind.DIG),
                "the dig step must survive smoothing");
    }

    @Test
    void neverShortcutsAcrossAHeightChange() {
        List<Step> path = List.of(
                new Step(0, 1, 0, Step.Kind.WALK, 1),
                new Step(1, 1, 0, Step.Kind.WALK, 1),
                new Step(2, 2, 0, Step.Kind.JUMP, 2),
                new Step(3, 2, 0, Step.Kind.WALK, 1));
        List<Step> smoothed = Smoother.smooth(path, new TestWorld(0));

        assertTrue(smoothed.stream().anyMatch(s -> s.kind() == Step.Kind.JUMP),
                "the climb must survive smoothing");
    }

    @Test
    void leavesShortPathsAlone() {
        List<Step> two = walk(new int[][]{{0, 1, 0}, {1, 1, 0}});
        assertEquals(two, Smoother.smooth(two, new TestWorld(0)));
    }

    @Test
    void refusesToCutThroughAHazard() {
        TestWorld world = new TestWorld(0).setHazard(2, 1, 0);
        List<Step> path = walk(new int[][]{
                {0, 1, 0}, {1, 1, 0}, {2, 1, 0}, {3, 1, 0}, {4, 1, 0}});
        List<Step> smoothed = Smoother.smooth(path, world);

        // The straight line runs through the lava, so no shortcut spans it.
        assertTrue(smoothed.size() >= 2);
        boolean spansHazard = smoothed.get(0).x() == 0
                && smoothed.get(1).x() > 2;
        assertFalse(spansHazard, "must not smooth a line that crosses a hazard");
    }
}

package dev.understudy.core.path;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PursuitTest {

    private static List<Step> line(int length) {
        List<Step> path = new ArrayList<>();
        for (int x = 0; x < length; x++) path.add(new Step(x, 0, 0, Step.Kind.WALK, 1));
        return path;
    }

    @Test
    void aimsAheadRatherThanAtTheNextBlock() {
        Pursuit.Aim aim = Pursuit.aim(line(10), 0, 0.5, 0.5);
        assertTrue(aim.x() >= Pursuit.LOOK_AHEAD - 1,
                "should steer toward a point ahead, not the block underfoot (was " + aim.x() + ")");
    }

    @Test
    void doesNotAimPastTheEnd() {
        Pursuit.Aim aim = Pursuit.aim(line(3), 0, 0.5, 0.5);
        assertEquals(2.5, aim.x(), 1e-9, "the last waypoint is as far as it goes");
    }

    @Test
    void consumesEveryWaypointAlreadyReached() {
        // Smoothing can leave two waypoints within one radius of each other, so
        // advancing by one per tick would stall.
        List<Step> bunched = List.of(
                new Step(0, 0, 0, Step.Kind.WALK, 1),
                new Step(0, 0, 0, Step.Kind.WALK, 1),
                new Step(1, 0, 0, Step.Kind.WALK, 1),
                new Step(6, 0, 0, Step.Kind.WALK, 1));
        Pursuit.Aim aim = Pursuit.aim(bunched, 0, 0.5, 0.5);
        assertTrue(aim.index() >= 2, "should skip past all the reached waypoints at once");
    }

    @Test
    void reportsHowMuchPathIsLeft() {
        Pursuit.Aim aim = Pursuit.aim(line(11), 0, 0.5, 0.5);
        assertEquals(10, aim.remaining(), 0.5);
    }

    @Test
    void seesACornerComing() {
        List<Step> corner = List.of(
                new Step(0, 0, 0, Step.Kind.WALK, 1),
                new Step(1, 0, 0, Step.Kind.WALK, 1),
                new Step(1, 0, 1, Step.Kind.WALK, 1),
                new Step(1, 0, 2, Step.Kind.WALK, 1));
        Pursuit.Aim aim = Pursuit.aim(corner, 0, 0.5, 0.5);
        assertTrue(aim.bend() > 1.0, "a right angle should read as about ninety degrees");
    }

    @Test
    void readsAStraightLineAsStraight() {
        Pursuit.Aim aim = Pursuit.aim(line(10), 3, 3.5, 0.5);
        assertEquals(0, aim.bend(), 1e-9);
    }

    @Test
    void survivesAnEmptyPath() {
        Pursuit.Aim aim = Pursuit.aim(List.of(), 0, 4, 9);
        assertEquals(4, aim.x(), 1e-9);
        assertEquals(9, aim.z(), 1e-9);
    }
}

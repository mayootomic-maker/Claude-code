package dev.understudy.core.path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class LeanTest {

    @Test
    @DisplayName("left is left")
    void knowsWhichWayIsLeft() {
        // Facing south — yaw zero, plus Z — your left hand points east. Getting
        // this backwards produces a mod that leans into the wall it is stuck
        // on, which from outside looks identical to being stuck.
        int[] left = Lean.cell(10.5, 64, 10.5, 0, true);
        assertEquals(11, left[0], "leaning left while facing south should go east");
        assertEquals(10, left[2]);

        int[] right = Lean.cell(10.5, 64, 10.5, 0, false);
        assertEquals(9, right[0]);

        // And facing east — yaw minus ninety — left is north.
        int[] north = Lean.cell(10.5, 64, 10.5, -90, true);
        assertEquals(9, north[2]);
    }

    @Test
    @DisplayName("never onto nothing")
    void refusesTheCliff() {
        // Blind leaning is a fine way off a fence and an excellent way off the
        // cliff you were stuck at the edge of. The second one costs a life.
        TestWorld world = new TestWorld(0);
        assertTrue(Lean.safe(world, 5, 1, 5), "would not step onto ordinary ground");

        TestWorld hole = new TestWorld(-50);
        assertFalse(Lean.safe(hole, 5, 1, 5), "stepped into a fifty-block drop");
    }

    @Test
    @DisplayName("never into lava, and never into a wall")
    void refusesTheObvious() {
        TestWorld lava = new TestWorld(0).setHazard(5, 1, 5);
        assertFalse(Lean.safe(lava, 5, 1, 5));

        TestWorld pit = new TestWorld(-10).setHazard(5, 0, 5);
        assertFalse(Lean.safe(pit, 5, 1, 5), "stepped onto a magma block");

        TestWorld wall = new TestWorld(0).setSolid(5, 1, 5);
        assertFalse(Lean.safe(wall, 5, 1, 5));

        TestWorld lowCeiling = new TestWorld(0).setSolid(5, 2, 5);
        assertFalse(Lean.safe(lowCeiling, 5, 1, 5), "stepped somewhere with no headroom");
    }

    @Test
    @DisplayName("water is somewhere you can step")
    void waterIsFine() {
        // A block of water is a block you fall into without noticing, which is
        // the difference between it and a hole.
        TestWorld pond = new TestWorld(-3).setLiquid(5, 0, 5);
        assertTrue(Lean.safe(pond, 5, 1, 5));
    }

    @Test
    @DisplayName("never into chunks that have not arrived")
    void refusesTheUnknown() {
        TestWorld edge = new TestWorld(0).unknown(5, 1, 5);
        assertFalse(Lean.safe(edge, 5, 1, 5),
                "leaned into terrain the client has not been sent");
    }
}

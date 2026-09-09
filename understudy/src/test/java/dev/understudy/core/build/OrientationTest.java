package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Which way round a building ends up, and whether you can see that before it
 * goes up rather than after.
 */
class OrientationTest {

    private static Blueprint oblong(int n) {
        List<Blueprint.Placement> blocks = new ArrayList<>();
        blocks.add(new Blueprint.Placement(0, 0, 0, "stone", Blueprint.Role.FLOOR, false));
        return new Blueprint("oblong " + n, blocks, n, 3, n - 2, n / 2, 1, 0);
    }

    /**
     * The turn a plot applies is knowable without applying it.
     *
     * It used to happen inside the fitting and come back only as a building
     * that was a quarter turn from where you expected — you dragged a
     * rectangle, it quietly spun the design to match, and the first you knew
     * was which wall the door was in.
     */
    @Test
    void theTurnAPlotAppliesCanBeAskedForSeparately() {
        Sized design = Sized.of(oblong(9), OrientationTest::oblong, 5, 21);
        // Wide and shallow against a design that is wide and shallow: no turn.
        assertEquals(0, design.turnsFor(30, 20));
        // Deep and narrow: a quarter, and the answer matches what fitting does.
        assertEquals(1, design.turnsFor(20, 30));
        Blueprint fitted = design.fitting(20, 30);
        assertTrue(fitted.sizeZ() > fitted.sizeX());
    }

    @Test
    void aFixedDesignIsNeverTurnedBehindYourBack() {
        Sized fixed = Sized.fixed(oblong(9));
        assertEquals(0, fixed.turnsFor(50, 3));
        assertEquals(0, fixed.turnsFor(3, 50));
    }

    /** The arrow leaves the face it points out of, not the middle of the walls. */
    @Test
    void theArrowStartsOutsideTheBuilding() {
        Blueprint plan = oblong(9);
        for (int facing = 0; facing < 4; facing++) {
            List<Hologram.Ghost> marks =
                    Hologram.orientation(plan, 100, 64, 100, facing);
            assertTrue(marks.size() >= 4, "no arrow at all");
            for (Hologram.Ghost mark : marks) {
                if (mark.argb() != Hologram.FRONT) continue;
                boolean insideX = mark.x() > 100 && mark.x() < 100 + plan.sizeX() - 1;
                boolean insideZ = mark.z() > 100 && mark.z() < 100 + plan.sizeZ() - 1;
                assertTrue(!(insideX && insideZ),
                        "an arrow mark at " + mark.x() + "," + mark.z()
                                + " is inside the walls, where nothing can see it");
            }
        }
    }

    @Test
    void theDoorIsMarkedWhereTheDesignPutsIt() {
        Blueprint plan = oblong(9);
        List<Hologram.Ghost> marks = Hologram.orientation(plan, 100, 64, 100, 0);
        assertTrue(marks.stream().anyMatch(g -> g.argb() == Hologram.DOORWAY
                        && g.x() == 100 + plan.entranceX()
                        && g.y() == 64 + plan.entranceY()
                        && g.z() == 100 + plan.entranceZ()),
                "the way in is not marked");
    }

    /** Turning it four times is the same as not turning it, arrow included. */
    @Test
    void aFullTurnComesBackToWhereItStarted() {
        Blueprint plan = oblong(9);
        assertEquals(Hologram.orientation(plan, 0, 0, 0, 0).toString(),
                Hologram.orientation(plan, 0, 0, 0, 4 % 4).toString());
    }
}

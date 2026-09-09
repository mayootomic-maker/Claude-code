package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SizedTest {

    /** A stand-in design: n wide, n-2 deep, so it is never square. */
    private static Blueprint oblong(int n) {
        List<Blueprint.Placement> blocks = new ArrayList<>();
        blocks.add(new Blueprint.Placement(0, 0, 0, "stone", Blueprint.Role.FLOOR, false));
        return new Blueprint("oblong " + n, blocks, n, 3, n - 2, 0, 0, 0);
    }

    private static Sized design() {
        return Sized.of(oblong(9), SizedTest::oblong, 5, 21);
    }

    @Test
    void takesTheBiggestSizeThatFitsThePlot() {
        // Size 14 is 14x12, which fills the plot exactly; 15 would be 15x13.
        assertEquals(14, design().fitting(14, 12).sizeX());
        assertEquals(12, design().fitting(14, 12).sizeZ());
    }

    @Test
    void aPlotTooSmallForAnythingStillGivesTheSmallest() {
        Blueprint made = design().fitting(2, 2);
        assertEquals(5, made.sizeX());
    }

    @Test
    void turnsTheDesignToLieTheSameWayRoundAsThePlot() {
        // The plot is deep and narrow; the design is wide and shallow, so it
        // has to turn a quarter or it hangs out of the sides.
        Blueprint made = design().fitting(11, 13);
        assertTrue(made.sizeZ() > made.sizeX(),
                "a deep plot should get a deep building, got "
                        + made.sizeX() + "x" + made.sizeZ());
    }

    @Test
    void aSizeIsOnlyEverGeneratedOnce() {
        int[] calls = {0};
        Sized design = Sized.of(oblong(9), n -> {
            calls[0]++;
            return oblong(n);
        }, 5, 21);
        design.atSize(11);
        design.atSize(11);
        assertEquals(1, calls[0]);
    }

    @Test
    void aFixedDesignIsNeverRegenerated() {
        Blueprint only = oblong(9);
        Sized fixed = Sized.fixed(only);
        assertFalse(fixed.adjustable());
        assertSame(only, fixed.atSize(3));
        // It may still be turned to suit the plot — that does not damage it —
        // but the plot never changes what size it is.
        assertEquals(9, Math.max(fixed.fitting(40, 40).sizeX(), fixed.fitting(40, 40).sizeZ()));
    }

    @Test
    void aSquarePlotLeavesTheOrientationAlone() {
        Blueprint made = design().fitting(30, 30);
        assertEquals(21, made.sizeX());
        assertEquals(19, made.sizeZ());
    }
}

package dev.understudy.core.build;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class HologramTest {

    private static Blueprint manor() {
        return Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 9,
                Materials.wood(0), Materials.stone(0));
    }

    @Test
    @DisplayName("does not draw the inside of a wall")
    void skipsBuriedBlocks() {
        // A solid cube: only its shell should be outlined. Drawing the middle
        // is a box inside a box, which is invisible and still costs a frame.
        Draft draft = new Draft("cube");
        for (int x = 0; x < 5; x++)
            for (int y = 0; y < 5; y++)
                for (int z = 0; z < 5; z++) draft.set(x, y, z, "stone", Blueprint.Role.WALL, false);
        Blueprint cube = draft.finish(0, 0, 0);

        List<Hologram.Ghost> ghosts = Hologram.of(cube, 0, 0, 0, 0, -1, 2, 2, 2, false);
        assertEquals(125 - 27, ghosts.size(), "drew the interior");
    }

    @Test
    @DisplayName("shows what is left, not what is done")
    void onlyThePlan() {
        Blueprint manor = manor();
        List<Hologram.Ghost> fresh = Hologram.of(manor, 0, 0, 0, 0, -1, 0, 0, 0, false);
        List<Hologram.Ghost> halfway =
                Hologram.of(manor, 0, 0, 0, manor.blockCount() / 2, -1, 0, 0, 0, false);
        assertTrue(halfway.size() < fresh.size(), "a half-built house shows as much as an empty plot");

        List<Hologram.Ghost> finished =
                Hologram.of(manor, 0, 0, 0, manor.blockCount(), -1, 0, 0, 0, false);
        assertTrue(finished.isEmpty(), "still drawing a finished building");
    }

    @Test
    @DisplayName("calls out the block it is about to place")
    void marksTheNextOne() {
        Blueprint manor = manor();
        List<Hologram.Ghost> ghosts = Hologram.of(manor, 0, 0, 0, 10, 10, 0, 0, 0, true);
        long highlighted = ghosts.stream().filter(g -> g.argb() == Hologram.NEXT).count();
        assertEquals(1, highlighted, "no single next block, or more than one");
    }

    @Test
    @DisplayName("stays inside its budget on something enormous")
    void bounded() {
        // A hundred thousand blocks of imported model must not become a
        // hundred thousand outlines: the point is to see the shape, and a
        // frame that takes a second shows you nothing.
        Draft draft = new Draft("slab");
        for (int x = 0; x < 60; x++)
            for (int y = 0; y < 30; y++)
                for (int z = 0; z < 60; z++) draft.set(x, y, z, "stone", Blueprint.Role.WALL, false);
        Blueprint huge = draft.finish(0, 0, 0);

        List<Hologram.Ghost> ghosts = Hologram.of(huge, 0, 0, 0, 0, -1, 30, 15, 30, false);
        assertTrue(ghosts.size() <= Hologram.MAX_GHOSTS, "drew " + ghosts.size());
    }

    @Test
    @DisplayName("draws nothing on the far side of the world")
    void rangeLimited() {
        Blueprint manor = manor();
        assertTrue(Hologram.of(manor, 0, 0, 0, 0, -1, 5000, 70, 5000, false).isEmpty());
        assertFalse(Hologram.of(manor, 0, 0, 0, 0, -1, 5, 70, 5, false).isEmpty());
    }

    @Test
    @DisplayName("pending blocks are drawn in their own material's colour")
    void coloursByMaterial() {
        // A single grey plan is a plan you cannot read. Stone and planks have
        // to be distinguishable or the picture says nothing the outline did not.
        Draft draft = new Draft("two");
        draft.set(0, 0, 0, "stone", Blueprint.Role.WALL, false);
        draft.set(2, 0, 0, "oak_planks", Blueprint.Role.WALL, false);
        List<Hologram.Ghost> ghosts =
                Hologram.of(draft.finish(0, 0, 0), 0, 0, 0, 0, -1, 1, 0, 0, false);

        assertEquals(2, ghosts.size());
        assertNotEquals(ghosts.get(0).argb(), ghosts.get(1).argb(), "both drawn the same colour");
        for (Hologram.Ghost ghost : ghosts) {
            int alpha = (ghost.argb() >>> 24) & 0xFF;
            assertTrue(alpha > 0 && alpha < 0xFF, "not translucent: alpha " + alpha);
        }
    }
}

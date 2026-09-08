package dev.understudy.core.nether;

import dev.understudy.core.build.Blueprint;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PortalTest {

    private static Set<String> cells(Blueprint plan) {
        Set<String> out = new HashSet<>();
        for (Blueprint.Placement p : plan.placements()) out.add(p.x() + "," + p.y());
        return out;
    }

    @Test
    void tenObsidianInTheRightShape() {
        Blueprint frame = Portal.frame();
        assertEquals(Portal.OBSIDIAN, frame.blockCount());
        assertEquals(Portal.OBSIDIAN, frame.essentialMaterials().get("obsidian"));
        assertEquals(4, frame.sizeX());
        assertEquals(5, frame.sizeY());
        assertEquals(1, frame.sizeZ());
    }

    @Test
    void theCornersAreLeftOutBecauseTheGameIgnoresThem() {
        // Four blocks of obsidian is a diamond pickaxe and the better part of a
        // minute, for four blocks nothing ever looks at.
        Set<String> filled = cells(Portal.frame());
        assertFalse(filled.contains("0,0"), "bottom left corner");
        assertFalse(filled.contains("3,0"), "bottom right corner");
        assertFalse(filled.contains("0,4"), "top left corner");
        assertFalse(filled.contains("3,4"), "top right corner");
    }

    @Test
    void theInsideIsEmptyAndTheRightSize() {
        Set<String> filled = cells(Portal.frame());
        List<int[]> inside = Portal.inside();
        assertEquals(Portal.INSIDE_WIDE * Portal.INSIDE_TALL, inside.size());
        for (int[] cell : inside) {
            assertFalse(filled.contains(cell[0] + "," + cell[1]),
                    "obsidian at " + cell[0] + "," + cell[1] + ", which is inside the frame");
        }
    }

    @Test
    void theWayInIsTheBottomOfTheOpening() {
        Blueprint frame = Portal.frame();
        // Reachable standing on the ground, which the top of the opening is not.
        assertEquals(1, frame.entranceY());
        assertTrue(Portal.inside().stream()
                .anyMatch(c -> c[0] == frame.entranceX() && c[1] == frame.entranceY()));
    }

    @Test
    void oneBlockDownThereIsEightUpHere() {
        assertEquals(125, Portal.across(1000, 2000, true)[0]);
        assertEquals(250, Portal.across(1000, 2000, true)[1]);
        assertEquals(1000, Portal.across(125, 250, false)[0]);
        assertEquals(8000, Portal.worthUpstairs(1000));
    }

    @Test
    void negativeCoordinatesRoundTheSameWayAsTheGame() {
        // Floor division, not truncation: -1 is in the block west of zero, and
        // truncating would put it in the block east of it.
        assertEquals(-1, Portal.across(-1, -1, true)[0]);
        assertEquals(-2, Portal.across(-9, -9, true)[0]);
    }

    @Test
    void aShortJourneyIsNotWorthDigging() {
        assertFalse(Portal.worthGoingUnder(200));
        assertTrue(Portal.worthGoingUnder(5000));
    }
}

package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Turning a building has to turn what its blocks say about themselves.
 *
 * Moving the blocks is the obvious half and it was the only half. A building
 * dragged out the other way round had every stair still claiming to face east,
 * which is a roof laid sideways, and every log still claiming axis=x, which is
 * a beam through the wall.
 */
class StatesTest {

    @Test
    void facingGoesRoundWithTheBuilding() {
        assertEquals("facing=east", States.turned("facing=north", 1));
        assertEquals("facing=south", States.turned("facing=north", 2));
        assertEquals("facing=west", States.turned("facing=north", 3));
        assertEquals("facing=north", States.turned("facing=north", 4));
    }

    @Test
    void upAndDownDoNotTurn() {
        // A dropper pointing at the floor points at the floor from every angle.
        assertEquals("facing=down", States.turned("facing=down", 1));
        assertEquals("facing=up", States.turned("facing=up", 3));
    }

    @Test
    void anAxisIsALineRatherThanADirection() {
        // Which is why it swaps on an odd turn and not on an even one — a beam
        // turned twice lies exactly where it did.
        assertEquals("axis=z", States.turned("axis=x", 1));
        assertEquals("axis=x", States.turned("axis=x", 2));
        assertEquals("axis=z", States.turned("axis=x", 3));
        assertEquals("axis=y", States.turned("axis=y", 1));
    }

    @Test
    void aSignsRotationIsInSixteenths() {
        assertEquals("rotation=4", States.turned("rotation=0", 1));
        assertEquals("rotation=1", States.turned("rotation=13", 1));
    }

    @Test
    void everythingElseIsLeftAlone() {
        // A stair's shape is described relative to its own facing, so turning
        // the facing has already turned the shape. Touching it would turn it
        // twice.
        assertEquals("facing=east,half=top,shape=inner_left,waterlogged=false",
                States.turned("facing=north,half=top,shape=inner_left,waterlogged=false", 1));
    }

    @Test
    void nothingToSayMeansNoEmptyBrackets() {
        assertNull(States.turned(null, 3));
        assertEquals("", States.turned("", 3));
    }

    @Test
    void upsideDownSwapsWhicheverWordTheBlockUsesForHalf() {
        assertEquals("half=bottom", States.flipped("half=top"));
        assertEquals("type=top", States.flipped("type=bottom"));
        assertEquals("type=double", States.flipped("type=double"));
        assertEquals("face=ceiling", States.flipped("face=floor"));
        assertEquals("facing=up", States.flipped("facing=down"));
        assertEquals("facing=north", States.flipped("facing=north"));
    }

    @Test
    void readingAndSettingOneProperty() {
        assertEquals("top", States.value("facing=north,half=top", "half"));
        assertNull(States.value("facing=north", "half"));
        assertNull(States.value(null, "half"));
        assertEquals("facing=north,half=top", States.with("facing=north", "half", "top"));
        assertEquals("half=bottom", States.with("half=top", "half", "bottom"));
        assertEquals("half=top", States.with(null, "half", "top"));
    }

    @Test
    void aTurnedBuildingCarriesItsPropertiesRound() {
        Blueprint plan = new Blueprint("one",
                java.util.List.of(new Blueprint.Placement(0, 0, 0, "oak_stairs",
                        Blueprint.Role.ROOF, false, Facing.NORTH, "facing=north,half=top")),
                1, 1, 1, 0, 0, 0);
        assertEquals("facing=east,half=top", plan.turned(1, false).placements().get(0).properties());
    }
}

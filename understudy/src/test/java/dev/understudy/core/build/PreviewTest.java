package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PreviewTest {

    private static Blueprint house() {
        return Designs.house(9, 7, 4, Designs.defaultPalette());
    }

    @Test
    void drawsSomethingForEveryDesign() {
        Map<Blueprint.Role, String> palette = Designs.defaultPalette();
        for (Blueprint blueprint : List.of(
                Designs.hut(5, palette),
                Designs.house(9, 7, 4, palette),
                Designs.tower(12, 5, palette),
                Designs.storage(6, palette))) {
            Preview.Image image = Preview.of(blueprint);
            assertFalse(image.isEmpty(), blueprint.name() + " rendered nothing");
            assertTrue(image.width() > 0 && image.height() > 0);
        }
    }

    @Test
    void fitsInsideItsOwnCanvas() {
        Preview.Image image = Preview.of(house());
        for (Preview.Run run : image.runs()) {
            assertTrue(run.x() >= 0 && run.x() + run.length() <= image.width(),
                    "run runs off the side: " + run);
            assertTrue(run.y() >= 0 && run.y() < image.height(), "run runs off the bottom: " + run);
            assertTrue(run.length() > 0, "empty run");
        }
    }

    @Test
    void isCheapEnoughToDrawInAMenu() {
        // One rectangle per pixel would be tens of thousands of draw calls. The
        // whole point of runs is that a building is mostly flat colour.
        Preview.Image image = Preview.of(house());
        int pixels = image.width() * image.height();
        assertTrue(image.runs().size() < pixels / 8,
                image.runs().size() + " runs for " + pixels + " pixels is not much of a saving");
    }

    @Test
    void showsTheMaterialsTheBuildActuallyUses() {
        // A stone house and a wooden one must not render identically, or the
        // preview is decoration rather than information.
        Map<Blueprint.Role, String> wood = Designs.defaultPalette();
        Map<Blueprint.Role, String> stone = Designs.paletteFrom(
                List.of("stone_bricks", "cobblestone"), Designs.defaultPalette());
        Set<Integer> woodColours = coloursOf(Preview.of(Designs.house(9, 7, 4, wood)));
        Set<Integer> stoneColours = coloursOf(Preview.of(Designs.house(9, 7, 4, stone)));
        assertFalse(woodColours.equals(stoneColours),
                "changing the palette should change the picture");
    }

    @Test
    void growsWithTheBuilding() {
        Preview.Image small = Preview.of(Designs.house(5, 5, 3, Designs.defaultPalette()));
        Preview.Image large = Preview.of(Designs.house(16, 12, 6, Designs.defaultPalette()));
        assertTrue(large.width() > small.width());
        assertTrue(large.height() > small.height());
    }

    @Test
    void anUnknownBlockStillDraws() {
        // A new entry in Designs should look like a plain box in the menu, not
        // take the menu down.
        Blueprint odd = new Blueprint("odd",
                List.of(new Blueprint.Placement(0, 0, 0, "prismarine_whatsit",
                        Blueprint.Role.WALL, false)),
                1, 1, 1, 0, 0, 0);
        assertFalse(Preview.of(odd).isEmpty());
    }

    @Test
    void everyHouseHasARoofOverEveryPartOfItsFloor() {
        // Not about drawing: this is the structure itself. A design with a gap
        // in the roof builds a house you can be rained on inside, and the
        // preview is the only place anybody would notice before it is built.
        for (int[] dims : new int[][]{{9, 7, 4}, {7, 7, 3}, {12, 9, 5}, {5, 5, 3}, {24, 24, 8}}) {
            Blueprint blueprint = Designs.house(dims[0], dims[1], dims[2], Designs.defaultPalette());
            int lowest = blueprint.placements().stream()
                    .filter(p -> p.role() == Blueprint.Role.FLOOR)
                    .mapToInt(Blueprint.Placement::y).min().orElseThrow();
            Set<Long> floor = new HashSet<>();
            Set<Long> covered = new HashSet<>();
            for (Blueprint.Placement p : blueprint.placements()) {
                long column = (long) p.x() << 32 | (p.z() & 0xffffffffL);
                if (p.role() == Blueprint.Role.FLOOR && p.y() == lowest) floor.add(column);
                if (p.y() > lowest) covered.add(column);
            }
            floor.removeAll(covered);
            assertTrue(floor.isEmpty(),
                    "house " + dims[0] + "x" + dims[1] + "x" + dims[2]
                            + " has " + floor.size() + " floor columns with nothing above them");
        }
    }

    private static Set<Integer> coloursOf(Preview.Image image) {
        Set<Integer> colours = new HashSet<>();
        for (Preview.Run run : image.runs()) colours.add(run.argb());
        return colours;
    }
}

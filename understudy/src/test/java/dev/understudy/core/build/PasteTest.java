package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The commands are checked by running them.
 *
 * Not against a game — against a map, which is all a setblock is. Reading the
 * strings back and rebuilding the world from them is the only test that
 * actually says the paste and the build produce the same building, and it
 * catches the whole class of mistake this file is prone to: a fill whose run is
 * one short, a merge that eats the last block of a row, a door with one half.
 */
class PasteTest {

    private static final Materials.Wood OAK = Materials.woodNamed("oak");
    private static final Materials.Stone BRICK = Materials.stoneNamed("stone brick");
    /** What the game itself refuses to send. */
    private static final int CHAT_LIMIT = 256;

    private static Blueprint design(String id) {
        return Catalog.build(id, Catalog.byId(id).defaultSize(), OAK, BRICK);
    }

    /** Run the commands the way a server would, into a map of position to block. */
    private static Map<String, String> run(List<String> commands) {
        Map<String, String> world = new HashMap<>();
        for (String command : commands) {
            String[] bits = command.split(" ");
            if (bits[0].equals("setblock")) {
                world.put(bits[1] + "," + bits[2] + "," + bits[3], bits[4]);
            } else if (bits[0].equals("fill")) {
                for (int x = Integer.parseInt(bits[1]); x <= Integer.parseInt(bits[4]); x++) {
                    for (int y = Integer.parseInt(bits[2]); y <= Integer.parseInt(bits[5]); y++) {
                        for (int z = Integer.parseInt(bits[3]); z <= Integer.parseInt(bits[6]); z++) {
                            if (bits[7].equals("air")) world.remove(x + "," + y + "," + z);
                            else world.put(x + "," + y + "," + z, bits[7]);
                        }
                    }
                }
            }
        }
        return world;
    }

    @Test
    void whatTheCommandsBuildIsWhatTheBlueprintAsksFor() {
        for (String id : Catalog.ids()) {
            Blueprint plan = design(id);
            Map<String, String> world = run(Paste.commands(plan, 100, 64, 100, true));
            for (Blueprint.Placement p : plan.placements()) {
                String at = (100 + p.x()) + "," + (64 + p.y()) + "," + (100 + p.z());
                String got = world.get(at);
                assertNotNull(got, id + " left " + p.block() + " out at " + at);
                assertTrue(got.startsWith("minecraft:" + p.block()),
                        id + " put " + got + " where " + p.block() + " belongs");
            }
        }
    }

    @Test
    void theClearDoesNotSurviveIntoTheFinishedBuilding() {
        // The air fill runs first and everything after it puts blocks back. A
        // command order that cleared afterwards would produce an empty box and
        // a very confident report about it.
        Blueprint plan = design("hut");
        assertEquals(Paste.blockCount(plan, 0, 0, 0),
                run(Paste.commands(plan, 0, 0, 0, true)).size());
    }

    @Test
    void aDoorGetsBothOfItsHalvesAndABedBothOfItsEnds() {
        Map<String, String> world = run(Paste.commands(design("house"), 0, 0, 0, true));
        long doors = world.values().stream().filter(v -> v.contains("_door[")).count();
        long beds = world.values().stream().filter(v -> v.contains("_bed[")).count();
        assertTrue(world.values().stream().anyMatch(v -> v.contains("half=lower")), "no door bottom");
        assertTrue(world.values().stream().anyMatch(v -> v.contains("half=upper")), "no door top");
        assertEquals(0, doors % 2, "a door with an odd number of halves");
        assertTrue(world.values().stream().anyMatch(v -> v.contains("part=head")), "no bed head");
        assertTrue(world.values().stream().anyMatch(v -> v.contains("part=foot")), "no bed foot");
        assertEquals(0, beds % 2, "a bed with an odd number of ends");
    }

    @Test
    void mergingRunsActuallySavesCommands() {
        Blueprint plan = design("manor");
        int blocks = Paste.blockCount(plan, 0, 0, 0);
        int commands = Paste.commands(plan, 0, 0, 0, false).size();
        assertTrue(commands < blocks * 3 / 4,
                "merging saved nothing: " + commands + " commands for " + blocks + " blocks");
    }

    @Test
    void everyCommandIsOneTheGameWouldAccept() {
        for (String id : Catalog.ids()) {
            for (String command : Paste.commands(design(id), -3000, 12, 4000, true)) {
                assertTrue(command.length() <= CHAT_LIMIT, id + ": too long — " + command);
                assertTrue(command.startsWith("setblock ") || command.startsWith("fill "), command);
                if (!command.startsWith("fill ")) continue;
                String[] b = command.split(" ");
                long volume = (long) (Integer.parseInt(b[4]) - Integer.parseInt(b[1]) + 1)
                        * (Integer.parseInt(b[5]) - Integer.parseInt(b[2]) + 1)
                        * (Integer.parseInt(b[6]) - Integer.parseInt(b[3]) + 1);
                assertTrue(volume <= Paste.FILL_LIMIT,
                        id + ": a fill of " + volume + ", which the game refuses");
            }
        }
    }
}

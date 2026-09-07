package dev.understudy.core.memory;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AtlasFileTest {

    private static Atlas withSightings(int count) {
        Atlas atlas = new Atlas();
        for (int i = 0; i < count; i++) {
            atlas.saw(i % 2 == 0 ? "iron_ore" : "coal_ore", i, -20 - i, i * 2, 100L + i);
        }
        return atlas;
    }

    private static Atlas roundTrip(Atlas source, String wroteAs, String readAs) throws IOException {
        StringWriter out = new StringWriter();
        AtlasFile.write(source, wroteAs, out);
        Atlas back = new Atlas();
        AtlasFile.read(back, readAs, new StringReader(out.toString()));
        return back;
    }

    @Test
    @DisplayName("what it saw survives the game being closed")
    void survivesARoundTrip() throws IOException {
        Atlas back = roundTrip(withSightings(50), "local.Home-overworld", "local.Home-overworld");
        assertEquals(50, back.size());
        Atlas.Sighting iron = back.nearest("iron_ore", 0, -20, 0);
        assertNotNull(iron, "lost the iron");
        assertEquals(0, iron.x());
        assertEquals(-20, iron.y());
        assertEquals(100L, iron.tick(), "lost when it was seen, so ageing is wrong from now on");
    }

    @Test
    @DisplayName("a file from another world is refused rather than believed")
    void refusesTheWrongWorld() throws IOException {
        // The failure this guards against is not a crash. It is a map that
        // confidently points at a vein of iron in a save you have never played,
        // which is worse than having no map at all.
        Atlas back = roundTrip(withSightings(20), "local.Home-overworld", "server.example.com-nether");
        assertEquals(0, back.size());
    }

    @Test
    @DisplayName("ageing order survives, so it forgets the right things")
    void keepsTheOrder() throws IOException {
        Atlas back = roundTrip(withSightings(10), "w", "w");
        List<Atlas.Sighting> all = back.all();
        for (int i = 1; i < all.size(); i++) {
            assertTrue(all.get(i).tick() >= all.get(i - 1).tick(),
                    "sightings came back shuffled: eviction would drop the wrong ones");
        }
    }

    @Test
    @DisplayName("a half-written file costs one sighting, not the file")
    void survivesTruncation() throws IOException {
        StringWriter out = new StringWriter();
        AtlasFile.write(withSightings(30), "w", out);
        String truncated = out.toString();
        truncated = truncated.substring(0, truncated.length() - 6); // killed mid-write

        Atlas back = new Atlas();
        int taken = AtlasFile.read(back, "w", new StringReader(truncated));
        assertTrue(taken >= 28, "threw away the whole memory over one bad line: " + taken);
    }

    @Test
    @DisplayName("nonsense in the middle is skipped, not thrown")
    void skipsRubbish() throws IOException {
        String file = "understudy-atlas 1 w\n"
                + "iron_ore 1 2 3 400\n"
                + "coal_ore not a number here\n"
                + "\n"
                + "gold_ore 9 -50 9 500\n";
        Atlas back = new Atlas();
        assertEquals(2, AtlasFile.read(back, "w", new StringReader(file)));
        assertNotNull(back.nearest("gold_ore", 0, 0, 0));
    }

    @Test
    @DisplayName("a file that is not one of ours is not read at all")
    void refusesAForeignFile() throws IOException {
        Atlas back = new Atlas();
        assertEquals(0, AtlasFile.read(back, "w", new StringReader("some other program's data\n")));
        assertEquals(0, AtlasFile.read(back, "w", new StringReader("")));
    }

    @Test
    @DisplayName("a world name never breaks the header it lives in")
    void sanitisesTheWorldName() {
        assertEquals("My_Save_2", AtlasFile.sanitise("My Save 2"));
        assertEquals("unknown", AtlasFile.sanitise("   "));
        assertEquals("unknown", AtlasFile.sanitise(null));
        assertFalse(AtlasFile.sanitise("a b\nc").contains("\n"));
    }
}

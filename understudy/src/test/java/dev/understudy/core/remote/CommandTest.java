package dev.understudy.core.remote;

import dev.understudy.core.build.Materials;
import dev.understudy.core.sort.Category;
import org.junit.jupiter.api.Test;

import java.util.Locale;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The panel's security boundary, which had no test at all.
 *
 * This is the only place in the mod where something arriving over a socket
 * decides what the character does, so "a whitelist by construction" is a claim
 * that ought to be checked rather than asserted in a comment.
 */
class CommandTest {

    private static Map<String, String> query(String... pairs) {
        Map<String, String> out = new java.util.HashMap<>();
        for (int at = 0; at + 1 < pairs.length; at += 2) out.put(pairs[at], pairs[at + 1]);
        return out;
    }

    @Test
    void aVerbItDoesNotKnowIsRefusedRatherThanGuessedAt() {
        assertNull(Command.parse(query("a", "setblock")));
        assertNull(Command.parse(query("a", "")));
        assertNull(Command.parse(query()));
    }

    @Test
    void aNameIsAnIdentifierOrItIsNothing() {
        assertEquals("iron_ingot", Command.clean("iron_ingot"));
        assertEquals("iron_ingot", Command.clean("  Iron_Ingot  "));
        assertEquals("iron_ingot", Command.clean("minecraft:iron_ingot"));
        assertEquals("iron_ingot+coal", Command.clean("iron_ingot+coal"));

        // Everything that is not one, including the shapes somebody would try.
        assertNull(Command.clean("iron ingot"));
        assertNull(Command.clean("../../etc/passwd"));
        assertNull(Command.clean("say hello"));
        assertNull(Command.clean("iron\nkill"));
        assertNull(Command.clean("\"});drop"));
        assertNull(Command.clean(""));
        assertNull(Command.clean(null));
        assertNull(Command.clean("x".repeat(65)));
    }

    @Test
    void aVerbThatNeedsANameIsRefusedWithoutOne() {
        assertNull(Command.parse(query("a", "get")));
        assertNull(Command.parse(query("a", "get", "name", "not a name")));
        assertNotNull(Command.parse(query("a", "get", "name", "coal")));
    }

    @Test
    void countsAndCoordinatesAreClampedRatherThanTrusted() {
        Command.Action many = Command.parse(query("a", "get", "name", "coal", "n", "999999999"));
        assertNotNull(many);
        assertEquals(4096, many.count());

        Command.Action far = Command.parse(
                query("a", "travel", "x", "99999999", "y", "9999", "z", "-99999999"));
        assertNotNull(far);
        assertEquals(30_000_000, far.x());
        assertEquals(1024, far.y());
        assertEquals(-30_000_000, far.z());
    }

    @Test
    void rubbishWhereANumberBelongsFallsBackRatherThanThrowing() {
        Command.Action action = Command.parse(query("a", "get", "name", "coal", "n", "lots"));
        assertNotNull(action);
        assertEquals(1, action.count());
    }

    /**
     * The mod worked everywhere except Turkey.
     *
     * Java's default-locale toLowerCase turns "I" into a dotless ı in Turkish
     * and Azeri, so IRON_INGOT became ıron_ıngot — which is not an identifier,
     * so the panel refused it; and the same call sat in the item categoriser and
     * the material lookup, so sorting and building failed too. Nothing logged
     * anything. It is the sort of fault that is invisible unless you own the
     * machine it happens on, so it is pinned here rather than hoped about.
     */
    @Test
    void namesAreReadTheSameWayInEveryLocale() {
        Locale was = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr"));
            assertEquals("iron_ingot", Command.clean("IRON_INGOT"));
            assertNotNull(Command.parse(query("a", "get", "name", "IRON_INGOT")));
            assertEquals(Category.of("iron_ingot"), Category.of("IRON_INGOT"));
            // The same wood whichever case it is typed in, which is the
            // property; name() is the label, not the identifier.
            assertEquals(Materials.woodNamed("spruce"), Materials.woodNamed("SPRUCE"));
        } finally {
            Locale.setDefault(was);
        }
    }
}

package dev.understudy.core.remote;

import dev.understudy.core.remote.Command.Verb;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class RemoteTest {

    private static Command.Action parse(String query) {
        return Command.parse(Query.parse(query));
    }

    @Test
    @DisplayName("reads the arguments off a request")
    void parsesAQuery() {
        Map<String, String> query = Query.parse("a=get&name=iron_ore&n=8");
        assertEquals("get", query.get("a"));
        assertEquals("iron_ore", query.get("name"));
        assertEquals(8, Query.number(query, "n", 1, 1, 4096));
    }

    @Test
    @DisplayName("a malformed escape is a shrug, not an exception")
    void survivesRubbish() {
        // This arrives on a socket thread inside a running game. Throwing there
        // is how a control panel takes the client down with it.
        assertDoesNotThrow(() -> Query.parse("a=get&name=%zz%&n=%"));
        assertDoesNotThrow(() -> Query.parse("&&&=&=x&"));
        assertEquals("", Query.decode(null));
        assertEquals("a b", Query.decode("a+b"));
        assertEquals("a b", Query.decode("a%20b"));
        assertEquals("\u00e9", Query.decode("%c3%a9"), "utf-8 arrives as two bytes");
    }

    @Test
    @DisplayName("nothing reaches the game that is not one of a dozen verbs")
    void isAWhitelist() {
        // The whole security boundary. There is no path from the network to
        // "run this text": a request names a known verb or it is refused.
        assertNull(parse("a=say&name=hello"));
        assertNull(parse("a=%2Fkill"));
        assertNull(parse("name=iron_ore&n=8"), "acted with no verb at all");
        assertNull(parse(""));
        assertNotNull(parse("a=stop"));
    }

    @Test
    @DisplayName("a name is a Minecraft name or it is nothing")
    void checksNames() {
        assertEquals("iron_ore", Command.clean("iron_ore"));
        assertEquals("iron_ore", Command.clean("minecraft:iron_ore"), "a pasted namespace");
        assertEquals("iron_ore", Command.clean("  IRON_ORE  "));
        assertEquals("iron_ingot+coal", Command.clean("iron_ingot+coal"), "a list of two");

        assertNull(Command.clean("iron ore; /op me"));
        assertNull(Command.clean("../../etc/passwd"));
        assertNull(Command.clean("<script>"));
        assertNull(Command.clean(""));
        assertNull(Command.clean(null));
        assertNull(Command.clean("x".repeat(200)));
    }

    @Test
    @DisplayName("a verb that needs a name will not act without one")
    void refusesHalfARequest() {
        assertNull(parse("a=get&n=8"));
        assertNull(parse("a=build"));
        assertNull(parse("a=project&name=%3Bdrop"));
        assertNotNull(parse("a=get&name=iron_ore"));
    }

    @Test
    @DisplayName("numbers are clamped to what the game can mean")
    void clampsNumbers() {
        assertEquals(4096, parse("a=get&name=dirt&n=999999999").count());
        assertEquals(1, parse("a=get&name=dirt&n=-5").count());
        assertEquals(1, parse("a=get&name=dirt&n=lots").count());

        Command.Action far = parse("a=travel&x=999999999&y=9999&z=-999999999");
        assertTrue(far.x() <= 30_000_000 && far.z() >= -30_000_000);
        assertTrue(far.y() <= 1024);
    }

    @Test
    @DisplayName("every verb the panel can name is one the mod has")
    void verbsAreComplete() {
        for (String verb : Command.verbs()) {
            assertNotNull(parse("a=" + verb + "&name=iron_ore&x=1&y=2&z=3"),
                    verb + " is offered and not understood");
        }
        assertEquals(Verb.AUTO_OFF, parse("a=auto-off").what(), "a hyphen is how a URL says it");
    }

    @Test
    @DisplayName("json escapes what would otherwise end the document")
    void escapesProperly() {
        String json = new Json()
                .put("said", "he said \"go\" then\nleft\tquickly\\")
                .put("health", 12.5)
                .put("whole", 20.0)
                .put("broken", Double.NaN)
                .put("running", true)
                .strings("log", List.of("one \"two\"", "three"))
                .counts("carried", Map.of("iron_ore", 4))
                .done();

        assertTrue(json.contains("\\\"go\\\""), "an unescaped quote ends the document early");
        assertTrue(json.contains("\\n") && json.contains("\\t"));
        assertTrue(json.contains("\"whole\":20"), "wrote 20.0 where 20 was meant");
        assertTrue(json.contains("\"health\":12.5"));
        assertTrue(json.contains("\"broken\":0"), "wrote NaN, which is not JSON");
        assertTrue(json.startsWith("{") && json.endsWith("}"));
    }

    @Test
    @DisplayName("a control character in a chat line does not blank the panel")
    void escapesControlCharacters() {
        String json = new Json().put("line", "a\u0001b").done();
        assertTrue(json.contains("\\u0001"), "raw control character left in the document");
    }

    @Test
    @DisplayName("an empty document is still a document")
    void emptyIsValid() {
        assertEquals("{}", new Json().done());
        assertEquals("[]", Json.array(List.of()));
        assertEquals("[{},{}]", Json.array(List.of("{}", "{}")));
    }

    @Test
    @DisplayName("a repeated key keeps the first, not the last")
    void repeatedKeys() {
        // Belt and braces: a second a= cannot override the first and smuggle a
        // different verb past a reader that stopped at the first one.
        Map<String, String> query = Query.parse("a=stop&a=get&name=dirt");
        assertEquals("stop", query.get("a"));
    }

    @Test
    @DisplayName("nothing absurdly long gets through")
    void boundsEverything() {
        Map<String, String> query = Query.parse("name=" + "a".repeat(10_000));
        assertTrue(query.get("name").length() <= 256);
        assertNull(Command.parse(new LinkedHashMap<>(query)), "acted on a request with no verb");
    }
}

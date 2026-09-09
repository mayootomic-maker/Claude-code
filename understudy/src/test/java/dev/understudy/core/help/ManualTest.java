package dev.understudy.core.help;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ManualTest {

    @Test
    void everySummaryFitsOnOneLine() {
        for (Manual.Section section : Manual.sections()) {
            for (Manual.Entry entry : section.entries()) {
                assertTrue(entry.what().length() <= Manual.SUMMARY_LIMIT,
                        entry.usage() + " has a " + entry.what().length()
                                + " character summary, which will wrap");
            }
        }
    }

    @Test
    void nothingIsListedTwice() {
        Set<String> seen = new HashSet<>();
        for (Manual.Section section : Manual.sections()) {
            for (Manual.Entry entry : section.entries()) {
                assertTrue(seen.add(entry.usage()), entry.usage() + " is listed twice");
            }
        }
    }

    @Test
    void everySectionCanBeLookedUpByTheNameItAdvertises() {
        for (String topic : Manual.topics()) {
            assertNotNull(Manual.section(topic), topic);
            assertNotNull(Manual.section(topic.toUpperCase()), topic + " in capitals");
        }
        assertNull(Manual.section("nonsense"));
        assertNull(Manual.section(null));
    }

    @Test
    void everyTypedCommandStartsWithASlash() {
        for (Manual.Section section : Manual.sections()) {
            // The site section is keys rather than commands, and saying "/R"
            // would be worse than useless.
            if (section.id().equals("site")) continue;
            for (Manual.Entry entry : section.entries()) {
                assertTrue(entry.usage().startsWith("/"), entry.usage());
            }
        }
    }

    @Test
    void theWrittenReferenceSaysTheSameThingAsTheGame() {
        String markdown = Manual.markdown();
        for (Manual.Section section : Manual.sections()) {
            assertTrue(markdown.contains(section.title()), section.title());
            for (Manual.Entry entry : section.entries()) {
                assertTrue(markdown.contains(entry.usage()), entry.usage());
                assertTrue(markdown.contains(entry.what()), entry.what());
            }
        }
        assertFalse(markdown.contains("§"), "colour codes have no business in a file");
    }

    /**
     * The file in the repository is the manual, not a copy of it.
     *
     * A written command reference drifts from the code within a week of nobody
     * checking, and a reference that is wrong is worse than none — it is the
     * one place somebody looks before concluding a command does not exist. So
     * it is generated, and this fails the build the moment the two disagree.
     */
    @Test
    void theFileInTheRepositoryIsUpToDate() throws Exception {
        Path file = findUpwards("COMMANDS.md");
        assertNotNull(file, "COMMANDS.md is missing from the repository");
        assertEquals(Manual.markdown(), Files.readString(file),
                "COMMANDS.md is out of date — regenerate it from Manual.markdown()");
    }

    /** The tests' working directory varies; the repository root does not. */
    private static Path findUpwards(String name) {
        Path here = Path.of("").toAbsolutePath();
        for (int up = 0; up < 5 && here != null; up++, here = here.getParent()) {
            Path candidate = here.resolve(name);
            if (Files.isRegularFile(candidate)) return candidate;
        }
        return null;
    }
}

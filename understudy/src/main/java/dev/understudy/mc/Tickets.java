package dev.understudy.mc;

import dev.understudy.core.build.Ticket;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The folder tickets live in, and getting them in and out of it.
 *
 * Next to the schematics folder and made on first look for the same reason:
 * "where do I put it" should be answered by a directory that already exists
 * rather than by a line in a README. A ticket is a small text file, so it goes
 * over Discord or a message like any other attachment, which is the whole
 * point — the person who may run the paste and the person who designed it do
 * not have to be at the same keyboard or even online at the same time.
 */
public final class Tickets {

    /** A ticket is text. Anything this size is not one. */
    private static final long MAX_BYTES = 4L * 1024 * 1024;

    private Tickets() {}

    public static Path folder() {
        return FabricLoader.getInstance().getGameDir().resolve("understudy-tickets");
    }

    /** Every ticket, newest first, so one just dropped in is at the top. */
    public static List<Path> list() {
        try {
            Files.createDirectories(folder());
            try (var entries = Files.list(folder())) {
                List<Path> found = new ArrayList<>();
                for (Path path : entries.toList()) {
                    if (!Files.isRegularFile(path)) continue;
                    String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
                    if (!name.endsWith(".ticket") && !name.endsWith(".txt")) continue;
                    if (Files.size(path) > MAX_BYTES) continue;
                    found.add(path);
                }
                found.sort(Comparator.comparing(Tickets::changed).reversed());
                return found;
            }
        } catch (IOException error) {
            return List.of();
        }
    }

    private static java.nio.file.attribute.FileTime changed(Path path) {
        try {
            return Files.getLastModifiedTime(path);
        } catch (IOException error) {
            return java.nio.file.attribute.FileTime.fromMillis(0);
        }
    }

    /**
     * The one whose name starts with what was typed.
     *
     * By prefix rather than exactly, because the names carry coordinates and
     * nobody is typing "cottage_120_64_-300.ticket" into chat. Ambiguity is an
     * error rather than a guess: two matching tickets and the wrong building
     * goes up in the wrong place, which is not a mistake a person would enjoy
     * discovering.
     */
    public static Path matching(String typed) {
        String wanted = typed.toLowerCase(Locale.ROOT);
        Path found = null;
        for (Path path : list()) {
            String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
            if (!name.startsWith(wanted)) continue;
            if (name.equals(wanted) || name.equals(wanted + ".ticket")) return path;
            if (found != null) return null;
            found = path;
        }
        return found;
    }

    /** Write one out, returning where it went. Throws with a readable reason. */
    public static Path save(Ticket.Paperwork paste) throws IOException {
        Files.createDirectories(folder());
        Path path = folder().resolve(Ticket.fileName(paste));
        Files.writeString(path, Ticket.write(paste), StandardCharsets.UTF_8);
        return path;
    }

    /**
     * Read one in.
     *
     * The file is somebody else's, so this is where a bad one has to be caught
     * — Ticket.read does the refusing and says which line, and everything that
     * can go wrong with a file goes wrong here rather than mid-paste.
     */
    public static Ticket.Paperwork load(Path path) throws IOException {
        if (Files.size(path) > MAX_BYTES) {
            throw new Ticket.Unreadable("that file is far too big to be a ticket");
        }
        return Ticket.read(Files.readString(path, StandardCharsets.UTF_8));
    }
}

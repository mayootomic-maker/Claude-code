package dev.understudy.core.memory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;

/**
 * Writing the atlas down, and reading it back.
 *
 * The atlas is the one place this mod is plainly better than a person — it
 * remembers every ore it has ever walked past — and until now it threw all of it
 * away on quit. A session-long memory is a nice trick; a world-long one changes
 * what "go and get iron" means, because the fourteenth time you ask, it starts
 * from fourteen known veins instead of from a strip mine.
 *
 * Plain text, one sighting per line, because this is a file a person may
 * reasonably want to look at, delete, or copy to another machine, and because a
 * binary format would buy a few hundred kilobytes and cost all of that.
 *
 * It is deliberately forgiving on read. A truncated last line — the game was
 * killed mid-write — costs one sighting, not the file, and an entry from an
 * older version that no longer parses is skipped rather than thrown. The worst
 * case for a bad line is a walk to somewhere there is no iron, and the atlas
 * already handles that: it forgets what it finds gone.
 */
public final class AtlasFile {
    private AtlasFile() {}

    /** Bumped only if the line format changes incompatibly. */
    private static final String HEADER = "understudy-atlas 1";

    public static void write(Atlas atlas, String world, Writer out) throws IOException {
        out.write(HEADER + " " + sanitise(world) + "\n");
        for (Atlas.Sighting sighting : atlas.all()) {
            out.write(sighting.what() + " " + sighting.x() + " " + sighting.y() + " "
                    + sighting.z() + " " + sighting.tick() + "\n");
        }
    }

    /**
     * Load into an atlas, returning how many sightings were taken.
     *
     * A file whose header names a different world is refused outright and
     * reported as zero. Loading it would produce a map that is confidently,
     * silently wrong about somewhere you have never been, which is worse than
     * having no map at all — the whole reason the atlas is a memory rather than
     * an index.
     */
    public static int read(Atlas atlas, String world, Reader source) throws IOException {
        BufferedReader lines = new BufferedReader(source);
        String header = lines.readLine();
        if (header == null || !header.startsWith(HEADER)) return 0;
        String named = header.length() > HEADER.length() ? header.substring(HEADER.length() + 1) : "";
        if (!named.equals(sanitise(world))) return 0;

        int taken = 0;
        String line;
        while ((line = lines.readLine()) != null) {
            String[] parts = line.split(" ");
            if (parts.length != 5) continue;
            try {
                atlas.saw(parts[0], Integer.parseInt(parts[1]), Integer.parseInt(parts[2]),
                        Integer.parseInt(parts[3]), Long.parseLong(parts[4]));
                taken++;
            } catch (NumberFormatException malformed) {
                // One unreadable line is one lost sighting. Stopping here would
                // throw away every good line after it for no gain.
            }
        }
        return taken;
    }

    /** No spaces or newlines, so the header stays one field. */
    public static String sanitise(String world) {
        if (world == null || world.isBlank()) return "unknown";
        return world.trim().replaceAll("[^A-Za-z0-9._:-]", "_");
    }
}

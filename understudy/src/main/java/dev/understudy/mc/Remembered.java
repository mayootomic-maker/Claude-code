package dev.understudy.mc;

import dev.understudy.core.adapt.Measured;
import dev.understudy.core.memory.Atlas;
import dev.understudy.core.memory.AtlasFile;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Consumer;

/**
 * Keeping what it has seen between sessions.
 *
 * The atlas was a session memory, which meant the single most useful thing this
 * mod knows — every ore, every tree, every cave mouth it has walked past — was
 * thrown away every time the game closed. Two hours of walking, discarded on
 * quit, every time.
 *
 * Saving is periodic rather than only on the way out, because the way out is the
 * one moment you cannot rely on: a crash, a kill, a laptop lid. Every couple of
 * minutes costs a file write of a few hundred kilobytes and means the worst case
 * is losing two minutes of looking rather than all of it.
 *
 * Failures here are reported and then ignored. A read-only config directory or a
 * full disk is a real thing that happens, and it is not a reason to stop mining
 * — but it is absolutely a reason to say so, because a memory that silently
 * stopped persisting looks exactly like a memory that is working.
 */
public final class Remembered {
    private Remembered() {}

    /** Two minutes. Long enough to be free, short enough to lose nothing. */
    private static final int SAVE_EVERY = 20 * 120;

    private static String loadedFor;
    private static int untilSave = SAVE_EVERY;
    private static boolean complained;

    /**
     * Load on arrival, save on a timer, and reload when the world changes.
     *
     * Called once a tick. The world key is cheap and changes when you go through
     * a portal or join a different server, which is exactly when the memory
     * being carried needs swapping out.
     */
    public static void tick(Minecraft client, Atlas atlas, Measured measured,
                            Consumer<String> report) {
        if (client.level == null || client.player == null) return;
        String world = Worlds.key(client);

        if (!world.equals(loadedFor)) {
            if (loadedFor != null) save(atlas, measured, loadedFor, report);
            atlas.clear();
            measured.clear();
            load(atlas, measured, world, report);
            loadedFor = world;
            untilSave = SAVE_EVERY;
            return;
        }
        if (untilSave-- > 0) return;
        untilSave = SAVE_EVERY;
        save(atlas, measured, world, report);
    }

    /** Write it out now — on the way out of a world, or when asked. */
    public static void flush(Atlas atlas, Measured measured, Consumer<String> report) {
        if (loadedFor == null) return;
        save(atlas, measured, loadedFor, report);
    }

    /** Forget which world was loaded, so the next tick loads afresh. */
    public static void left() {
        loadedFor = null;
    }

    public static Path fileFor(String world) {
        return dirFor(world).resolve("atlas-" + AtlasFile.sanitise(world) + ".txt");
    }

    /** What things cost here, beside what is here. */
    public static Path timesFor(String world) {
        return dirFor(world).resolve("times-" + AtlasFile.sanitise(world) + ".txt");
    }

    private static Path dirFor(String world) {
        return FabricLoader.getInstance().getConfigDir().resolve("understudy");
    }

    private static void load(Atlas atlas, Measured measured, String world,
                             Consumer<String> report) {
        Path file = fileFor(world);
        if (Files.isReadable(file)) {
            try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                int taken = AtlasFile.read(atlas, world, in);
                if (taken > 0) report.accept("remembered " + taken + " places from last time");
            } catch (IOException problem) {
                complain(report, "could not read what it remembered: " + problem.getMessage());
            }
        }
        Path times = timesFor(world);
        if (!Files.isReadable(times)) return;
        try (Reader in = Files.newBufferedReader(times, StandardCharsets.UTF_8)) {
            int taken = measured.read(in);
            if (taken > 0) {
                report.accept("and what " + taken + " of them really cost");
            }
        } catch (IOException problem) {
            complain(report, "could not read what things cost: " + problem.getMessage());
        }
    }

    private static void save(Atlas atlas, Measured measured, String world,
                             Consumer<String> report) {
        try {
            if (atlas.size() > 0) {
                write(fileFor(world), out -> AtlasFile.write(atlas, world, out));
            }
            if (measured.size() > 0) {
                write(timesFor(world), measured::write);
            }
            complained = false;
        } catch (IOException problem) {
            complain(report, "could not save what it has learned: " + problem.getMessage());
        }
    }

    /** What a Writer is handed, so both files are saved the same careful way. */
    private interface Writes {
        void into(Writer out) throws IOException;
    }

    /**
     * Written beside and moved into place, so a crash mid-write leaves the
     * previous version intact rather than half of a new one.
     */
    private static void write(Path file, Writes writes) throws IOException {
        Files.createDirectories(file.getParent());
        Path draft = file.resolveSibling(file.getFileName() + ".writing");
        try (Writer out = Files.newBufferedWriter(draft, StandardCharsets.UTF_8)) {
            writes.into(out);
        }
        Files.move(draft, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    /** Say it once. A disk that is full is full every two minutes. */
    private static void complain(Consumer<String> report, String line) {
        if (complained) return;
        complained = true;
        report.accept(line);
    }
}

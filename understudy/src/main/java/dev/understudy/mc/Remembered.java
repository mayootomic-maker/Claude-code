package dev.understudy.mc;

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
    public static void tick(Minecraft client, Atlas atlas, Consumer<String> report) {
        if (client.level == null || client.player == null) return;
        String world = Worlds.key(client);

        if (!world.equals(loadedFor)) {
            if (loadedFor != null) save(atlas, loadedFor, report);
            atlas.clear();
            load(atlas, world, report);
            loadedFor = world;
            untilSave = SAVE_EVERY;
            return;
        }
        if (untilSave-- > 0) return;
        untilSave = SAVE_EVERY;
        save(atlas, world, report);
    }

    /** Write it out now — on the way out of a world, or when asked. */
    public static void flush(Atlas atlas, Consumer<String> report) {
        if (loadedFor == null) return;
        save(atlas, loadedFor, report);
    }

    /** Forget which world was loaded, so the next tick loads afresh. */
    public static void left() {
        loadedFor = null;
    }

    public static Path fileFor(String world) {
        return FabricLoader.getInstance().getConfigDir()
                .resolve("understudy")
                .resolve("atlas-" + AtlasFile.sanitise(world) + ".txt");
    }

    private static void load(Atlas atlas, String world, Consumer<String> report) {
        Path file = fileFor(world);
        if (!Files.isReadable(file)) return;
        try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            int taken = AtlasFile.read(atlas, world, in);
            if (taken > 0) report.accept("remembered " + taken + " places from last time");
        } catch (IOException problem) {
            complain(report, "could not read what it remembered: " + problem.getMessage());
        }
    }

    private static void save(Atlas atlas, String world, Consumer<String> report) {
        if (atlas.size() == 0) return;
        Path file = fileFor(world);
        try {
            Files.createDirectories(file.getParent());
            // Written beside and moved into place, so a crash mid-write leaves
            // the previous memory intact rather than half of a new one.
            Path draft = file.resolveSibling(file.getFileName() + ".writing");
            try (Writer out = Files.newBufferedWriter(draft, StandardCharsets.UTF_8)) {
                AtlasFile.write(atlas, world, out);
            }
            Files.move(draft, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            complained = false;
        } catch (IOException problem) {
            complain(report, "could not save what it has seen: " + problem.getMessage());
        }
    }

    /** Say it once. A disk that is full is full every two minutes. */
    private static void complain(Consumer<String> report, String line) {
        if (complained) return;
        complained = true;
        report.accept(line);
    }
}

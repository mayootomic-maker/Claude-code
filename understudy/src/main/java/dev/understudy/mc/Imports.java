package dev.understudy.mc;

import dev.understudy.core.build.Schematic;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Schematics the player has dropped in a folder, ready to be built.
 *
 * The folder is made on first look rather than only read, so the answer to
 * "where do I put them" is a directory that already exists next to the world
 * saves instead of a path in a README.
 */
public final class Imports {

    /** Files larger than this are region captures, not builds. */
    private static final long MAX_BYTES = 16L * 1024 * 1024;
    private static final List<String> SCHEMATICS =
            List.of(".litematic", ".schem", ".schematic", ".nbt");
    private static final List<String> MODELS = List.of(".obj", ".stl");

    private Imports() {}

    public static Path folder() {
        return FabricLoader.getInstance().getGameDir().resolve("schematics");
    }

    /** Every importable file, newest first, so a fresh download is at the top. */
    public static List<Path> list() {
        Path folder = folder();
        try {
            Files.createDirectories(folder);
            try (var entries = Files.list(folder)) {
                List<Path> found = new ArrayList<>();
                for (Path path : entries.toList()) {
                    if (!Files.isRegularFile(path)) continue;
                    String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
                    if (!importable(name)) continue;
                    if (Files.size(path) > MAX_BYTES) continue;
                    found.add(path);
                }
                found.sort(Comparator.comparing((Path path) -> {
                    try {
                        return Files.getLastModifiedTime(path);
                    } catch (IOException error) {
                        return java.nio.file.attribute.FileTime.fromMillis(0);
                    }
                }).reversed());
                return found;
            }
        } catch (IOException error) {
            return List.of();
        }
    }

    public static boolean importable(String lowerName) {
        return SCHEMATICS.stream().anyMatch(lowerName::endsWith)
                || MODELS.stream().anyMatch(lowerName::endsWith);
    }

    /** Whether this one needs a size and a fill choice, or comes with its own. */
    public static boolean isModel(Path path) {
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return MODELS.stream().anyMatch(name::endsWith);
    }

    public static Schematic.Result load(Path path) throws IOException {
        return Schematic.read(path.getFileName().toString(), Files.readAllBytes(path));
    }

    /**
     * A mesh has no size of its own, so one has to be chosen. Everything else
     * about it — where it sits, which way up, what it is made of — falls out of
     * that and the material picked in the menu.
     */
    public static Schematic.Result loadModel(Path path, int height, boolean solid, String plain)
            throws IOException {
        return Schematic.readModel(path.getFileName().toString(), Files.readAllBytes(path),
                height, solid, plain);
    }
}

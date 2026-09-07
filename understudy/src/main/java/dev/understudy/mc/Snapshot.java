package dev.understudy.mc;

import dev.understudy.core.adapt.Measured;
import dev.understudy.core.adapt.Timings;
import dev.understudy.core.build.Catalog;
import dev.understudy.core.craft.Planner;
import dev.understudy.core.memory.Atlas;
import dev.understudy.core.mind.Project;
import dev.understudy.core.remote.Json;
import dev.understudy.core.survive.Armoury;
import dev.understudy.core.survive.Combat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Everything the panel shows, as one string.
 *
 * Built on the client thread and published as a finished document, which is the
 * whole of the threading story: the socket threads never read the game, they
 * hand out the last thing the game said about itself. A panel showing a state
 * from eighty milliseconds ago is a panel; a panel that reads a player object
 * from another thread is a crash with a stack trace nobody can explain.
 *
 * The lists that never change — the designs, the projects, everything the
 * planner can obtain — are in here too. They cost a fraction of a millisecond
 * and they mean the page needs no second request and no build step: it opens
 * knowing what it can offer.
 */
public final class Snapshot {
    private Snapshot() {}

    /** Kept short: the panel shows the tail, and a long list is a long document. */
    private static final int LOG_LINES = 60;
    /** Enough to be useful, few enough to read. */
    private static final int MOST_COSTS = 12;

    public static String of(Minecraft client, LocalPlayer player, Atlas atlas, Measured measured,
                     Timings timings, List<String> log, boolean paused, String doing,
                     String why, String fight, List<String> steps, boolean busy) {
        Map<String, Integer> carried = Carried.contents(player);
        String weapon = Combat.bestWeapon(carried);

        List<String> timing = new ArrayList<>();
        for (Timings.Phase phase : Timings.Phase.values()) {
            if (timings.ticksIn(phase) <= 0) continue;
            timing.add(new Json()
                    .put("phase", phase.name().toLowerCase())
                    .put("seconds", timings.secondsIn(phase))
                    .put("share", timings.shareOf(phase))
                    .done());
        }

        List<String> costs = new ArrayList<>();
        measured.all().stream()
                .sorted((a, b) -> Integer.compare(b.samples(), a.samples()))
                .limit(MOST_COSTS)
                .forEach(seen -> costs.add(new Json()
                        .put("item", seen.item())
                        .put("seconds", seen.secondsPerUnit())
                        .put("samples", seen.samples())
                        .done()));

        List<String> designs = new ArrayList<>();
        for (Catalog.Entry entry : Catalog.entries()) {
            designs.add(new Json()
                    .put("id", entry.id())
                    .put("name", entry.name())
                    .put("summary", entry.summary())
                    .put("size", entry.defaultSize())
                    .done());
        }

        List<String> projects = new ArrayList<>();
        for (Project.Plan plan : Project.all()) {
            projects.add(new Json()
                    .put("id", plan.id())
                    .put("name", plan.name())
                    .put("summary", plan.summary())
                    .done());
        }

        return new Json()
                .put("health", player.getHealth())
                .put("maxHealth", player.getMaxHealth())
                .put("food", player.getFoodData().getFoodLevel())
                .put("armour", Armoury.pointsOf(Fight.wornBy(player)))
                .put("x", player.getBlockX())
                .put("y", player.getBlockY())
                .put("z", player.getBlockZ())
                .put("light", client.level == null ? 15
                        : client.level.getMaxLocalRawBrightness(player.blockPosition()))
                .put("dimension", Worlds.key(client))
                // Only when the panel is open to the house. It is the one
                // address somebody genuinely has to read off a screen and type,
                // and a monitor is a far better thing to read it from than a
                // chat log that has already scrolled.
                .put("phoneLink", Remote.openToTheNetwork() ? Remote.networkAddress() : "")
                .put("weapon", weapon == null ? "" : weapon.replace('_', ' '))
                .put("paused", paused)
                .put("busy", busy)
                .put("doing", doing)
                .put("why", why)
                .put("fight", fight)
                .strings("steps", steps)
                .counts("carried", carried)
                .counts("atlas", atlas.summary())
                .strings("log", log)
                .raw("timing", Json.array(timing))
                .raw("costs", Json.array(costs))
                .raw("designs", Json.array(designs))
                .raw("projects", Json.array(projects))
                .strings("obtainable", Planner.obtainable())
                .done();
    }
}

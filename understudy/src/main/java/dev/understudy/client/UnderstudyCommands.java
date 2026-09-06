package dev.understudy.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Designs;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.ChatFix;
import dev.understudy.mc.Hud;
import dev.understudy.mc.SelfTest;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;
import net.minecraft.client.Minecraft;

import java.util.List;
import java.util.Map;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.network.chat.Component;
import net.minecraft.core.BlockPos;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

/**
 * The commands you type.
 *
 * Registered on the client dispatcher, so they complete in the client and the
 * server never receives them.
 */
public final class UnderstudyCommands {
    private UnderstudyCommands() {}

    public static void register() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) -> {
            dispatcher.register(literal("travel")
                    .then(argument("x", IntegerArgumentType.integer())
                            .then(argument("y", IntegerArgumentType.integer())
                                    .then(argument("z", IntegerArgumentType.integer())
                                            .executes(context -> guarded(context.getSource(), "travel",
                                                    () -> travel(
                                                            context.getSource(),
                                                            IntegerArgumentType.getInteger(context, "x"),
                                                            IntegerArgumentType.getInteger(context, "y"),
                                                            IntegerArgumentType.getInteger(context, "z")))))))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("build")
                    .then(argument("what", StringArgumentType.word())
                            .executes(context -> build(context.getSource(),
                                    StringArgumentType.getString(context, "what"), 7, false))
                            .then(argument("size", IntegerArgumentType.integer(3, 32))
                                    .executes(context -> build(context.getSource(),
                                            StringArgumentType.getString(context, "what"),
                                            IntegerArgumentType.getInteger(context, "size"), false))))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("plan")
                    .then(argument("what", StringArgumentType.word())
                            .executes(context -> build(context.getSource(),
                                    StringArgumentType.getString(context, "what"), 7, true))
                            .then(argument("size", IntegerArgumentType.integer(3, 32))
                                    .executes(context -> build(context.getSource(),
                                            StringArgumentType.getString(context, "what"),
                                            IntegerArgumentType.getInteger(context, "size"), true)))));

            dispatcher.register(literal("sort")
                    .executes(context -> sort(context.getSource(), true))
                    .then(literal("all").executes(context -> sort(context.getSource(), false)))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("understudy")
                    .then(literal("stop").executes(context -> stop(context.getSource())))
                    .then(literal("status").executes(context -> status(context.getSource())))
                    .then(literal("profile").executes(context -> profile(context.getSource())))
                    .then(literal("help").executes(context -> help(context.getSource())))
                    .then(literal("chatfix").executes(context ->
                            guarded(context.getSource(), "understudy chatfix",
                                    () -> chatFix(context.getSource()))))
                    .then(literal("test").executes(context ->
                            guarded(context.getSource(), "understudy test",
                                    () -> selfTest(context.getSource()))))
                    .then(literal("hud").executes(context -> toggleHud(context.getSource())))
                    // Bare /understudy lists the commands rather than the
                    // status: someone typing it is usually asking what exists.
                    .executes(context -> help(context.getSource())));
        });
    }

    private static int travel(FabricClientCommandSource source, int x, int y, int z) {
        TravelTask task = UnderstudyClient.travel();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        task.start(new BlockPos(x, y, z));
        say(source, "heading for " + x + ", " + y + ", " + z);
        return 1;
    }

    /**
     * Design a structure and either report what it needs or go and build it.
     *
     * The same code path for both, because "tell me what this costs" and "build
     * this" should never disagree about what the thing is.
     */
    private static int build(FabricClientCommandSource source, String what, int size, boolean planOnly) {
        BuildTask task = UnderstudyClient.build();
        PlayerProfile profile = UnderstudyClient.profile();
        if (task == null || profile == null) {
            say(source, "not in a world yet");
            return 0;
        }

        Map<Blueprint.Role, String> palette = Designs.paletteFrom(
                profile.buildingBlocks(6), Designs.defaultPalette());

        Blueprint blueprint = switch (what.toLowerCase()) {
            case "house" -> Designs.house(size, size, 4, palette);
            case "hut", "shelter" -> Designs.hut(Math.min(size, 9), palette);
            case "tower" -> Designs.tower(Math.max(size, 6), 5, palette);
            case "storage", "chests" -> Designs.storage(size, palette);
            default -> null;
        };
        if (blueprint == null) {
            say(source, "I can build: house, hut, tower, storage");
            return 0;
        }

        Map<String, Integer> shortfall = task.shortfall(blueprint);
        say(source, blueprint.name() + ": " + blueprint.blockCount() + " blocks");
        for (Map.Entry<String, Integer> entry : blueprint.essentialMaterials().entrySet()) {
            say(source, "  " + entry.getValue() + "x " + entry.getKey());
        }

        if (!shortfall.isEmpty()) {
            StringBuilder message = new StringBuilder("short of: ");
            shortfall.forEach((item, count) -> message.append(count).append("x ").append(item).append(" "));
            say(source, message.toString().trim());
            if (!planOnly) {
                say(source, "get those and run it again, or /build " + what + " anyway to start with what you have");
                return 0;
            }
        }

        if (planOnly) return 1;

        if (UnderstudyClient.travel() != null && UnderstudyClient.travel().running()) {
            say(source, "busy travelling — /understudy stop first");
            return 0;
        }
        // Build in front of where you are standing, not on top of you.
        task.start(blueprint, source.getPlayer().blockPosition().offset(2, 0, 2));
        return 1;
    }

    private static int sort(FabricClientCommandSource source, boolean keepKit) {
        SortTask task = UnderstudyClient.sort();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        task.start(keepKit);
        return 1;
    }

    private static int stop(FabricClientCommandSource source) {
        UnderstudyClient.stopAll();
        say(source, "stopped");
        return 1;
    }

    private static int status(FabricClientCommandSource source) {
        TravelTask travel = UnderstudyClient.travel();
        BuildTask build = UnderstudyClient.build();
        SortTask sort = UnderstudyClient.sort();
        if (travel == null) {
            say(source, "idle");
            return 1;
        }
        if (travel.running()) say(source, travel.status());
        else if (build != null && build.running()) say(source, build.status());
        else if (sort != null && sort.running()) say(source, sort.status());
        else say(source, "idle");
        return 1;
    }

    /**
     * Put the chat settings right.
     *
     * Reports what it changed rather than what it tried, because the whole
     * point is that you cannot currently trust what you are being shown.
     */
    private static int chatFix(FabricClientCommandSource source) {
        Minecraft client = Minecraft.getInstance();
        ChatFix.Result result = ChatFix.repair(client);
        if (!result.changedAnything()) {
            say(source, "chat settings were already fine:");
            for (String line : ChatFix.describe(client)) say(source, "  " + line);
            say(source, "so if you cannot see other players, it is the server, not your client");
            return 1;
        }
        say(source, "fixed:");
        for (String change : result.changed()) say(source, "  " + change);
        say(source, "saved to options.txt — this sticks across restarts");
        return 1;
    }

    /** Check every part the mod needs and report which one is broken. */
    private static int selfTest(FabricClientCommandSource source) {
        List<String> results = SelfTest.run(Minecraft.getInstance());
        Hud.clear();
        for (String line : results) {
            say(source, line);
            if (line.startsWith("FAIL") || line.startsWith("WARN")) Hud.warn(line);
            else Hud.say(line);
        }
        say(source, "this is also in .minecraft/logs/latest.log");
        return 1;
    }

    private static int toggleHud(FabricClientCommandSource source) {
        Hud.setEnabled(!Hud.enabled());
        say(source, "overlay " + (Hud.enabled() ? "on" : "off"));
        return 1;
    }

    private static int help(FabricClientCommandSource source) {
        say(source, "/travel <x> <y> <z> — walk there");
        say(source, "/build house|hut|tower|storage [size] — build it");
        say(source, "/plan house [size] — what it would take, without building");
        say(source, "/sort — put your things in the right chests (/sort all includes your kit)");
        say(source, "/understudy profile — what I have learned about how you play");
        say(source, "/understudy test — check what is working and what is not");
        say(source, "/understudy chatfix — repair chat settings that hide messages");
        say(source, "/understudy hud — toggle the on-screen overlay");
        say(source, "/understudy stop — stop everything");
        return 1;
    }

    /**
     * What the mod thinks it has learned about you.
     *
     * Worth having as a command rather than hiding: a thing that adapts to you
     * silently is impossible to trust or correct.
     */
    private static int profile(FabricClientCommandSource source) {
        PlayerProfile p = UnderstudyClient.profile();
        if (p == null) {
            say(source, "no profile yet");
            return 0;
        }
        say(source, String.format("confidence %.0f%%", p.confidence() * 100));
        String block = p.favouriteBuildingBlock();
        say(source, "builds with: " + (block == null ? "not sure yet" : block));
        Integer depth = p.preferredMiningDepth();
        say(source, "mines around y=" + (depth == null ? "not sure yet" : depth));
        say(source, String.format("tunnels %.0f%%, bridges %.0f%%, swims %.0f%%, sprints %.0f%%",
                p.digTolerance() * 100, p.bridgeTolerance() * 100,
                p.swimTolerance() * 100, p.haste() * 100));
        return 1;
    }

    /**
     * Answer through chat and the overlay both.
     *
     * A reply that only goes to chat is invisible on a client whose chat is
     * switched off — which is precisely the situation several of these
     * commands exist to diagnose.
     */
    /**
     * Run a command body, turning any exception into something readable.
     *
     * Brigadier reports a thrown exception as a generic red "an unexpected
     * error occurred", which says nothing about which part failed. Naming the
     * command and the exception is the difference between a bug report and a
     * shrug.
     */
    private static int guarded(FabricClientCommandSource source, String name,
                               java.util.function.Supplier<Integer> body) {
        try {
            return body.get();
        } catch (Throwable error) {
            UnderstudyClient.LOG.error("/{} failed", name, error);
            Hud.warn("/" + name + " failed: " + error);
            source.sendFeedback(Component.literal("§8[§bunderstudy§8] §c/" + name + " failed: " + error));
            return 0;
        }
    }

    private static void say(FabricClientCommandSource source, String message) {
        UnderstudyClient.LOG.info("[cmd] {}", message);
        Hud.say(message);
        source.sendFeedback(Component.literal("§8[§bunderstudy§8] §r" + message));
    }
}

package dev.understudy.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.mc.TravelTask;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;

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
                                            .executes(context -> travel(
                                                    context.getSource(),
                                                    IntegerArgumentType.getInteger(context, "x"),
                                                    IntegerArgumentType.getInteger(context, "y"),
                                                    IntegerArgumentType.getInteger(context, "z"))))))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("understudy")
                    .then(literal("stop").executes(context -> stop(context.getSource())))
                    .then(literal("status").executes(context -> status(context.getSource())))
                    .then(literal("profile").executes(context -> profile(context.getSource())))
                    .executes(context -> status(context.getSource())));
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

    private static int stop(FabricClientCommandSource source) {
        TravelTask task = UnderstudyClient.travel();
        if (task == null || !task.running()) {
            say(source, "not doing anything");
            return 0;
        }
        task.stop(null);
        say(source, "stopped");
        return 1;
    }

    private static int status(FabricClientCommandSource source) {
        TravelTask task = UnderstudyClient.travel();
        say(source, task == null ? "idle" : task.status());
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

    private static void say(FabricClientCommandSource source, String message) {
        source.sendFeedback(Text.literal("§8[§bunderstudy§8] §r" + message));
    }
}

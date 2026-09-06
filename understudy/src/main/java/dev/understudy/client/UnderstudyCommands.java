package dev.understudy.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.text.Text;

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
                                            .executes(context -> {
                                                int x = IntegerArgumentType.getInteger(context, "x");
                                                int y = IntegerArgumentType.getInteger(context, "y");
                                                int z = IntegerArgumentType.getInteger(context, "z");
                                                return travel(context.getSource(), x, y, z);
                                            })))));

            dispatcher.register(literal("understudy")
                    .then(literal("stop").executes(context -> {
                        say(context.getSource(), "stopping");
                        return 1;
                    }))
                    .executes(context -> {
                        say(context.getSource(), "ready");
                        return 1;
                    }));
        });
    }

    private static int travel(FabricClientCommandSource source, int x, int y, int z) {
        say(source, "heading for " + x + ", " + y + ", " + z);
        return 1;
    }

    private static void say(FabricClientCommandSource source, String message) {
        source.sendFeedback(Text.literal("[understudy] " + message));
    }
}

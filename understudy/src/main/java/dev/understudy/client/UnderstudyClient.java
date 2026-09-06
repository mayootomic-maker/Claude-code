package dev.understudy.client;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Client entry point.
 *
 * Everything in this mod runs on the client and only on the client. The
 * commands are registered through Fabric's client command dispatcher, which
 * means they are handled locally and never sent to the server: nothing about
 * this mod appears in chat, in the server log, or to anyone else playing.
 *
 * That is a property of where the code runs rather than a trick — a client
 * command is intercepted before the chat packet is ever built.
 */
public final class UnderstudyClient implements ClientModInitializer {
    public static final String MOD_ID = "understudy";
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);

    private static PlayerProfile profile;
    private static TravelTask travel;
    private static BuildTask build;
    private static SortTask sort;

    @Override
    public void onInitializeClient() {
        profile = new PlayerProfile();

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || client.world == null) return;
            profile.tick();
            if (travel == null) {
                travel = new TravelTask(client, profile, UnderstudyClient::tell);
                build = new BuildTask(client, travel, UnderstudyClient::tell);
                sort = new SortTask(client, travel, UnderstudyClient::tell);
            }
            travel.tick();
            build.tick();
            sort.tick();
        });

        UnderstudyCommands.register();
        LOG.info("Understudy ready");
    }

    public static PlayerProfile profile() {
        return profile;
    }

    public static TravelTask travel() {
        return travel;
    }

    public static BuildTask build() {
        return build;
    }

    public static SortTask sort() {
        return sort;
    }

    /** Stop whatever is going on. */
    public static void stopAll() {
        if (travel != null) travel.stop(null);
        if (build != null) build.stop(null);
        if (sort != null) sort.stop(null);
    }

    /** Print to the local chat log. Never sent anywhere. */
    public static void tell(String message) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.sendMessage(Text.literal("§8[§bunderstudy§8] §r" + message), false);
        }
    }
}

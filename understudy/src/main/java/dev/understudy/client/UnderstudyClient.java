package dev.understudy.client;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.ChatFix;
import dev.understudy.mc.Hud;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;

import java.util.List;
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
    private static boolean greeted;

    @Override
    public void onInitializeClient() {
        profile = new PlayerProfile();

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || client.world == null) {
                greeted = false;
                return;
            }
            greet();
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

        Hud.register();
        UnderstudyCommands.register();
        LOG.info("Understudy ready");
    }

    /**
     * Say hello once per world, listing what this build can do.
     *
     * Which is the point: the commands a jar has are the only reliable way to
     * tell which build you installed, and installing a stale one is otherwise
     * indistinguishable from a bug — you get "unknown command" for something
     * the source clearly registers.
     */
    private static void greet() {
        if (greeted) return;
        greeted = true;
        tell("ready — /travel  /build  /plan  /sort  /understudy help");

        // If chat is misconfigured, the line above may never be seen. Say it
        // again on the overlay, which no chat setting can suppress, and say
        // what is wrong rather than leaving the client looking broken.
        List<String> problems = ChatFix.problems(MinecraftClient.getInstance());
        if (!problems.isEmpty()) {
            Hud.warn("your chat settings are hiding messages:");
            for (String problem : problems) Hud.warn("  " + problem);
            Hud.warn("run /understudy chatfix to put them right");
        }
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

    /**
     * Say something, through every channel at once.
     *
     * Chat, the on-screen overlay, and the log. Not belt and braces for its own
     * sake: chat can be switched off, dimmed to nothing, or filtered by the
     * secure-chat setting, and when that happens a mod that only speaks through
     * chat is indistinguishable from a mod that does nothing. The overlay
     * always draws, and the log is what can be sent to someone who is not
     * sitting at the machine.
     *
     * Nothing here leaves the client.
     */
    public static void tell(String message) {
        LOG.info("[chat] {}", message);
        Hud.say(message);
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.sendMessage(Text.literal("§8[§bunderstudy§8] §r" + message), false);
        }
    }

    /** For things that went wrong: the same channels, marked as a problem. */
    public static void warn(String message) {
        LOG.warn("[chat] {}", message);
        Hud.warn(message);
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.sendMessage(Text.literal("§8[§bunderstudy§8] §c" + message), false);
        }
    }
}

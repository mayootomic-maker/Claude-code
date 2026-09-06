package dev.understudy.client;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.survive.Guardian;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.ChatFix;
import dev.understudy.core.build.Blueprint;
import dev.understudy.mc.BuildPicker;
import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import dev.understudy.mc.Carried;
import dev.understudy.mc.CraftTask;
import dev.understudy.mc.GatherTask;
import dev.understudy.mc.Hud;
import dev.understudy.mc.Marker;
import dev.understudy.mc.Safety;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;
import dev.understudy.human.Rng;

import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
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
    private static GatherTask gather;
    private static CraftTask craft;
    private static Safety safety;
    private static Marker marker;
    private static boolean pickerWanted;
    private static boolean greeted;
    private static boolean reportedFailure;

    @Override
    public void onInitializeClient() {
        profile = new PlayerProfile();

        // Commands are registered first, and every step is guarded separately.
        // Initialisation used to be a single unguarded sequence, so anything
        // that threw part-way through silently took out everything after it —
        // and a mod that loads but registers no commands is indistinguishable,
        // from inside the game, from a mod that is not installed. Whatever
        // fails now, the rest still comes up, and the log names the piece.
        setUp("commands", UnderstudyCommands::register);
        setUp("tick loop", UnderstudyClient::registerTick);

        LOG.info("Understudy ready (Minecraft {})",
                net.fabricmc.loader.api.FabricLoader.getInstance()
                        .getModContainer("minecraft")
                        .map(c -> c.getMetadata().getVersion().getFriendlyString())
                        .orElse("unknown"));
    }

    private static void setUp(String what, Runnable action) {
        try {
            action.run();
            LOG.info("registered {}", what);
        } catch (Throwable error) {
            LOG.error("could not register {} — the rest of the mod still loads", what, error);
        }
    }

    private static void registerTick() {

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || client.level == null) {
                greeted = false;
                return;
            }
            // An exception thrown here would otherwise be swallowed by the
            // event dispatcher every tick: the mod would go quiet and there
            // would be nothing on screen to say why. Catching it turns a silent
            // death into a visible, actionable error — and stops everything
            // rather than throwing twenty times a second.
            try {
                greet();
                Hud.tick();
                profile.tick();
                if (travel == null) {
                    // Seeded from the account, so the character walks the same way every
                    // session. getStringUUID is on Entity and is stable; the game
                    // profile's accessors are not — GameProfile became a record.
                    Rng rng = new Rng(client.player.getStringUUID());
                    safety = new Safety(UnderstudyClient::warn);
                    travel = new TravelTask(client, profile, rng, UnderstudyClient::tell);
                    build = new BuildTask(client, travel, UnderstudyClient::tell);
                    sort = new SortTask(client, travel, UnderstudyClient::tell);
                    craft = new CraftTask(client, UnderstudyClient::tell);
                    gather = new GatherTask(client, travel, craft, UnderstudyClient::tell);
                    marker = new Marker(client, UnderstudyClient::tell);
                }

                // Opening the menu is deferred to here because a command runs
                // while the chat screen is still open, and chat closes itself
                // afterwards by clearing the screen — which would shut the
                // picker in the same frame it opened.
                if (pickerWanted) {
                    pickerWanted = false;
                    client.setScreenAndShow(new BuildPicker(
                            Carried.contents(client.player), UnderstudyClient::siteFor));
                }
                marker.tick();

                // Safety runs before the tasks and can take the tick. Checking
                // after them would mean acting on a health reading from before
                // this tick's walking, which is the tick that matters when
                // something is doing four hearts a second.
                Guardian.Verdict verdict = safety.check(client);
                if (safety.act(client, verdict)) {
                    if (verdict.action() == Guardian.Action.ABORT
                            || verdict.action() == Guardian.Action.FLEE) {
                        stopEverything();
                    }
                    return;
                }

                travel.tick();
                craft.tick();
                gather.tick();
                build.tick();
                sort.tick();
            } catch (Throwable error) {
                onTickFailure(error);
            }
        });

    }

    /**
     * Say hello once per world, listing what this build can do.
     *
     * Which is the point: the commands a jar has are the only reliable way to
     * tell which build you installed, and installing a stale one is otherwise
     * indistinguishable from a bug — you get "unknown command" for something
     * the source clearly registers.
     */
    public static GatherTask gather() {
        return gather;
    }

    /** Ask for the build menu; it opens on the next tick. */
    public static void askForPicker() {
        pickerWanted = true;
    }

    public static void cancelSite() {
        if (marker != null) marker.cancel();
        if (build != null) build.stop("cancelled");
    }

    /**
     * Chosen in the menu: now go and point at where it should stand.
     *
     * Split in two because picking what to build and picking where to build it
     * are different questions, and the second one can only be answered while
     * looking at the world rather than at a menu.
     */
    private static void siteFor(Blueprint blueprint) {
        marker.start(blueprint, UnderstudyClient::gatherThenBuild);
    }

    /**
     * Go and get whatever is missing, then build it.
     *
     * The two halves are deliberately one flow. Being told "you are short of
     * ninety planks" and then having to go and get them yourself is most of the
     * work; the planner already knows what is needed and the gatherer already
     * knows how to fetch it, so the only thing missing was joining them up.
     *
     * With a full inventory it skips straight to building, which is the common
     * case for anyone who keeps a stocked chest.
     */
    private static void gatherThenBuild(Blueprint blueprint, net.minecraft.core.BlockPos origin) {
        Minecraft client = Minecraft.getInstance();
        if (build == null || gather == null || client.player == null) return;

        Planner.Plan needed = new Planner(Catalogue.solver())
                .plan(blueprint.essentialMaterials(), Carried.contents(client.player));

        if (needed.actions().isEmpty()) {
            build.start(blueprint, origin);
            return;
        }
        if (!needed.possible()) {
            warn("no way to get " + String.join(", ", needed.shortfall().keySet())
                    + " — building what is possible");
            build.start(blueprint, origin);
            return;
        }
        gather.start(needed, () -> build.start(blueprint, origin));
    }

    /**
     * Everything down tools. Used when safety takes over, so no task is left
     * quietly holding a movement key while the player is trying to escape.
     */
    private static void stopEverything() {
        if (marker != null) marker.cancel();
        if (travel != null) travel.stop("safety");
        if (craft != null) craft.stop();
        if (gather != null) gather.stop("safety");
        if (build != null) build.stop("safety");
        if (sort != null) sort.stop("safety");
    }

    private static void greet() {
        if (greeted) return;
        greeted = true;
        tell("ready — /travel  /build  /plan  /sort  /understudy help");

        // If chat is misconfigured, the line above may never be seen. Say it
        // again on the overlay, which no chat setting can suppress, and say
        // what is wrong rather than leaving the client looking broken.
        List<String> problems = ChatFix.problems(Minecraft.getInstance());
        if (!problems.isEmpty()) {
            Hud.warn("your chat settings are hiding messages:");
            for (String problem : problems) Hud.warn("  " + problem);
            Hud.warn("run /understudy chatfix to put them right");
        }
    }

    /**
     * Report a crash in the tick loop, once, and stand down.
     *
     * Repeating the same stack trace every tick fills the log with one message
     * and makes the actual first failure impossible to find.
     */
    private static void onTickFailure(Throwable error) {
        LOG.error("tick failed", error);
        if (!reportedFailure) {
            reportedFailure = true;
            warn("something went wrong: " + error);
            warn("stopped. the full trace is in logs/latest.log");
        }
        stopAll();
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
        Minecraft client = Minecraft.getInstance();
        if (client.player != null) {
            client.player.sendSystemMessage(Component.literal("§8[§bunderstudy§8] §r" + message));
        }
    }

    /** For things that went wrong: the same channels, marked as a problem. */
    public static void warn(String message) {
        LOG.warn("[chat] {}", message);
        Hud.warn(message);
        Minecraft client = Minecraft.getInstance();
        if (client.player != null) {
            client.player.sendSystemMessage(Component.literal("§8[§bunderstudy§8] §c" + message));
        }
    }
}

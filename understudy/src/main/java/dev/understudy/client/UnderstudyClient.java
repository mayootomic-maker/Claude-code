package dev.understudy.client;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.adapt.Measured;
import dev.understudy.core.adapt.Timings;
import dev.understudy.core.memory.Atlas;
import dev.understudy.core.mind.Agenda;
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
import dev.understudy.mc.Aim;
import dev.understudy.mc.Autopilot;
import dev.understudy.mc.EnchantTask;
import dev.understudy.mc.Fight;
import dev.understudy.mc.Ghosts;
import dev.understudy.mc.HuntTask;
import dev.understudy.mc.Remembered;
import dev.understudy.mc.Hud;
import dev.understudy.mc.Keys;
import dev.understudy.mc.Marker;
import dev.understudy.mc.Safety;
import dev.understudy.mc.SmeltTask;
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
    /**
     * What it has seen and what it decides, kept for the session.
     *
     * Both outlive every task on purpose: a memory that is cleared when a job
     * ends is not a memory, and the point of the agenda is that it can be asked
     * why at any moment, not only while something is running.
     */
    private static final Atlas atlas = new Atlas();
    private static final Agenda agenda = new Agenda();
    /**
     * Where the time goes, for the whole session.
     *
     * "Too slow" is unactionable on its own: twenty minutes of mining is the
     * game's own speed and nothing to fix, twenty minutes of walking is
     * entirely fixable, and they look identical from the outside.
     */
    /**
     * What things really cost in this world.
     *
     * Kept beside the atlas and saved with it, because it is the same kind of
     * thing: something learned here that is worth nothing anywhere else and
     * everything on the tenth visit.
     */
    private static final Measured measured = new Measured();
    private static final Timings timings = new Timings();
    /**
     * The same accounting, but for one job rather than the session.
     *
     * "Too slow" is answered by the shape of a single job — nineteen minutes of
     * walking and one of mining is a different complaint from the reverse — and
     * a session total blurs a gather and a build together until neither is
     * legible. This one is cleared when work starts and read out when it stops,
     * so the answer arrives without anyone having to know to ask.
     */
    private static final Timings thisJob = new Timings();
    private static TravelTask travel;
    private static BuildTask build;
    private static SortTask sort;
    private static GatherTask gather;
    private static CraftTask craft;
    private static SmeltTask smelt;
    private static HuntTask hunt;
    private static EnchantTask enchant;
    private static Autopilot autopilot;
    private static Safety safety;
    private static Marker marker;
    private static boolean pickerWanted;
    private static boolean paused;
    private static boolean greeted;
    private static boolean reportedFailure;
    private static boolean wasWorking;

    @Override
    public void onInitializeClient() {
        profile = new PlayerProfile();
        // Registered once at start-up rather than when a build begins: a render
        // event you attach and detach is a render event you eventually forget
        // to detach. It draws nothing until something asks it to.
        Ghosts.register();

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
                if (greeted) {
                    // Left the world. Write the memory out now rather than
                    // hoping the process gets a chance to later.
                    Remembered.flush(atlas, measured, UnderstudyClient::tell);
                    Remembered.left();
                }
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
                // What it has seen, kept across sessions. Loaded on arrival and
                // written out on a timer, because the moment you quit is the one
                // moment you cannot count on getting.
                Remembered.tick(client, atlas, measured, UnderstudyClient::tell);
                if (travel == null) {
                    // Seeded from the account, so the character walks the same way every
                    // session. getStringUUID is on Entity and is stable; the game
                    // profile's accessors are not — GameProfile became a record.
                    Rng rng = new Rng(client.player.getStringUUID());
                    // One head for the whole mod, seeded the same way, so every
                    // turn it makes — walking, mining, placing, opening a chest
                    // — moves like the same person rather than like a machine
                    // between the bits that were done carefully.
                    Aim.begin(rng, client.player);
                    Fight.begin(rng);
                    safety = new Safety(UnderstudyClient::warn);
                    travel = new TravelTask(client, profile, UnderstudyClient::tell);
                    build = new BuildTask(client, travel, atlas, UnderstudyClient::tell);
                    sort = new SortTask(client, travel, UnderstudyClient::tell);
                    craft = new CraftTask(client, UnderstudyClient::tell);
                    smelt = new SmeltTask(client, UnderstudyClient::tell);
                    hunt = new HuntTask(client, travel, UnderstudyClient::tell);
                    enchant = new EnchantTask(client, UnderstudyClient::tell);
                    gather = new GatherTask(client, travel, craft, smelt, hunt, atlas, measured,
                            UnderstudyClient::tell);
                    marker = new Marker(client, UnderstudyClient::tell);
                    autopilot = new Autopilot(client, gather, sort, build, atlas, measured, agenda,
                            UnderstudyClient::damageRecently, UnderstudyClient::tell);
                }

                // Take the controls and it lets go of them. No command, no key
                // to remember, no menu: the gesture you already make when
                // something is going wrong is to grab the keyboard, and every
                // autopilot worth using treats that as the instruction it is.
                // Keys knows which of them it is pressing itself, so a movement
                // key that is down and not one of those is a hand.
                if (working() && handOnTheControls(client)) {
                    stopAll("you took the controls");
                    return;
                }

                // Paused holds the place in every plan and queue and simply
                // stops acting on them. Everything the mod was holding was let
                // go at the moment of pausing, so this is a genuine hands-off
                // and not a very fast loop that does nothing.
                if (paused) {
                    Hud.setStatus("paused — /understudy resume");
                    return;
                }

                // Opening the menu is deferred to here because a command runs
                // while the chat screen is still open, and chat closes itself
                // afterwards by clearing the screen — which would shut the
                // picker in the same frame it opened.
                if (pickerWanted) {
                    pickerWanted = false;
                    client.setScreenAndShow(new BuildPicker(
                            Carried.contents(client.player), measured, UnderstudyClient::siteFor));
                }
                marker.tick();

                // Safety only exists to stop the mod from getting you killed.
                // When the mod is not doing anything there is nothing to stop,
                // and a guardian that grabs the controls anyway is not a safety
                // feature — it is the thing holding your movement keys up while
                // a skeleton shoots you. So it watches only while something is
                // running, and lets go of everything the moment nothing is.
                if (!working()) {
                    safety.reset();
                } else {
                    // Checked before the tasks: acting after them would mean
                    // deciding on a health reading from before this tick's
                    // walking, and that is the tick that matters when something
                    // is doing four hearts a second.
                    Guardian.Verdict verdict = safety.check(client);
                    if (safety.act(client, verdict)) {
                        // Whether this ends the job is no longer readable off
                        // the verdict: a hostile goes to Combat, and Combat
                        // answers either "deal with it" or "this one is not
                        // worth having". Safety knows which happened.
                        if (safety.standingDown()) {
                            // Write the place down before letting go of it. A
                            // fight that had to be broken off is a fact about
                            // somewhere, and the mod used to walk straight back
                            // into the same cave and break off again — a loop
                            // that looks like being stuck and costs health
                            // every lap.
                            atlas.saw(Atlas.TROUBLE,
                                    client.player.getBlockX(), client.player.getBlockY(),
                                    client.player.getBlockZ(), client.level.getGameTime());
                            stopEverything();
                        }
                        // Counted, not lost. Time spent fighting used to fall
                        // out of the accounting entirely, because the tick
                        // returns here — so a job that was half combat looked
                        // like a job that was inexplicably slow.
                        if (verdict.action() == Guardian.Action.FIGHT) {
                            timings.spent(Timings.Phase.FIGHTING);
                            thisJob.spent(Timings.Phase.FIGHTING);
                        }
                        // The head still has to turn, or a fight is fought with
                        // the view frozen wherever the last task left it.
                        Aim.tick(client.player);
                        return;
                    }
                }

                travel.tick();
                craft.tick();
                smelt.tick();
                hunt.tick();
                enchant.tick();
                gather.tick();
                build.tick();
                sort.tick();

                // One tick, one bucket. Recorded after the tasks have run so it
                // describes what they actually did rather than what they were
                // about to do, and only while something is running — an idle
                // mod has no time to account for.
                boolean busy = working();
                if (busy) {
                    if (!wasWorking) thisJob.clear();
                    Timings.Phase phase = phaseNow();
                    timings.spent(phase);
                    thisJob.spent(phase);
                } else if (wasWorking) {
                    reportJobTime();
                }
                wasWorking = busy;

                // Thinking for itself goes after the tasks and before the
                // head turns: it only ever acts when nothing else is, so it
                // must see the state the tasks have left behind.
                autopilot.tick(client.player);

                // Every task has now said where it would like to look. Turn the
                // head once, here, so there is one movement per tick rather
                // than several writers fighting over the same two floats.
                Aim.tick(client.player);
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

        Planner.Plan needed = new Planner(Catalogue.solver(), UnderstudyClient.measured())
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
    /**
     * Someone pressing a movement key that the mod is not pressing.
     *
     * Sneak is in the list and the mod never uses it, so it is the one that is
     * unambiguous — but any of them will do, because if you are steering, you
     * did not want the mod steering too.
     */
    private static boolean handOnTheControls(Minecraft client) {
        return Keys.pressedByHand(client.options.keyUp)
                || Keys.pressedByHand(client.options.keyDown)
                || Keys.pressedByHand(client.options.keyLeft)
                || Keys.pressedByHand(client.options.keyRight)
                || Keys.pressedByHand(client.options.keyJump)
                || Keys.pressedByHand(client.options.keyShift);
    }

    /**
     * Which of them to believe about this tick.
     *
     * In the order that answers "what is it doing" the way you would: the thing
     * with its hands on something beats the thing walking to it.
     */
    /**
     * Say where the time went, once, when a job of any length finishes.
     *
     * Not on demand, because nobody thinks to ask afterwards, and the moment a
     * job ends is exactly when the shape of it is interesting. Short jobs say
     * nothing: a twenty-second errand has no shape worth a line of chat.
     */
    private static void reportJobTime() {
        if (thisJob.totalTicks() < 20 * 60) return;
        Timings.Phase worst = null;
        for (Timings.Phase phase : Timings.Phase.values()) {
            if (worst == null || thisJob.ticksIn(phase) > thisJob.ticksIn(worst)) worst = phase;
        }
        tell(String.format("that took %.0f minutes, mostly %s (%.0f%%) — /understudy timing",
                thisJob.totalTicks() / 1200.0, worst.name().toLowerCase(),
                100 * thisJob.shareOf(worst)));
    }

    private static Timings.Phase phaseNow() {
        if (gather != null && gather.running()) return gather.phase();
        if (build != null && build.running()) return build.phase();
        if (sort != null && sort.running()) return sort.phase();
        if (craft != null && craft.running()) return Timings.Phase.HANDLING;
        if (smelt != null && smelt.running()) return Timings.Phase.HANDLING;
        if (travel != null && travel.running()) return Timings.Phase.TRAVELLING;
        return Timings.Phase.WAITING;
    }

    /** Whether the mod is driving anything at all right now. */
    private static boolean working() {
        return (hunt != null && hunt.running())
                || (enchant != null && enchant.running())
                || (travel != null && travel.running())
                || (build != null && build.running())
                || (sort != null && sort.running())
                || (gather != null && gather.running())
                || (craft != null && craft.running())
                || (smelt != null && smelt.running());
    }

    private static void stopEverything() {
        stopAll("safety");
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

    /** Health lost recently, or zero before anything is watching. */
    public static double damageRecently() {
        return safety == null ? 0 : safety.damageRecently();
    }

    public static Autopilot autopilot() {
        return autopilot;
    }

    public static Timings timings() {
        return timings;
    }

    /** How the job that just ran, or is running now, spent its time. */
    public static Timings jobTimings() {
        return thisJob;
    }

    /**
     * What the mod is doing, as the agenda understands it.
     *
     * Assembled from whichever task is running rather than described in one
     * place, because only the task itself knows what it still needs — and the
     * EQUIP and FETCH branches of the agenda were dead until something told it.
     */
    public static Agenda.Job currentJob() {
        if (gather != null && gather.running()) return gather.job();
        if (build != null && build.running()) return build.job();
        if (travel != null && travel.running()) return Agenda.Job.of("travelling");
        if (autopilot != null && autopilot.on()) return autopilot.standingJob();
        return null;
    }

    public static Atlas atlas() {
        return atlas;
    }

    public static Measured measured() {
        return measured;
    }

    public static Agenda agenda() {
        return agenda;
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

    public static HuntTask hunt() {
        return hunt;
    }

    public static EnchantTask enchant() {
        return enchant;
    }

    /** Stop whatever is going on. */
    /**
     * Stop. All of it, at once, and let go of the world.
     *
     * This used to stop travel, building and sorting, which sounds like
     * everything and is not: the gatherer was left running, and the first thing
     * a running gatherer does is start travelling again. From the outside that
     * is a mod that ignores you. So the list is now every task there is, the
     * gatherer first because it is the one that starts the others, and it ends
     * by putting down whatever the mod was physically holding — the keys, and
     * the block it was halfway through breaking.
     */
    public static void stopAll() {
        stopAll("stopped");
    }

    public static void stopAll(String why) {
        paused = false;
        pickerWanted = false;
        if (marker != null) marker.cancel();
        if (autopilot != null) autopilot.stop();
        if (gather != null) gather.stop(why);
        if (hunt != null) hunt.stop(null);
        if (enchant != null) enchant.stop(null);
        if (build != null) build.stop(why);
        if (sort != null) sort.stop(why);
        if (craft != null) craft.stop();
        if (smelt != null) smelt.stop();
        if (travel != null) travel.stop(null);
        letGo();
    }

    /**
     * Hands off: no key held down, no block half-broken, no status left up.
     *
     * Stopping a task clears what it intends to do next. This clears what it is
     * doing right now, which is a different thing and the one you feel.
     */
    private static void letGo() {
        Keys.releaseAll();
        Aim.release(Minecraft.getInstance().player);
        Minecraft client = Minecraft.getInstance();
        if (client.gameMode != null) client.gameMode.stopDestroyBlock();
        if (safety != null) safety.reset();
        Hud.setStatus("");
    }

    public static boolean paused() {
        return paused;
    }

    /**
     * Hold everything where it is, without forgetting it.
     *
     * The difference from stopping: the plan, the queue and the place in them
     * all survive, so resuming carries on rather than starting again. What does
     * not survive is anything being held — a pause that leaves your movement
     * keys down is not a pause.
     */
    public static void pause() {
        if (paused) return;
        paused = true;
        letGo();
    }

    public static void resume() {
        paused = false;
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

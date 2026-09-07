package dev.understudy.mc;

import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import dev.understudy.core.mind.Agenda;
import dev.understudy.core.sort.Category;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Doing something without being told to.
 *
 * Everything else waits for a command. This is the piece that closes the gap
 * between a mod that executes well and one you would call clever: the Agenda
 * could already say what ought to be happening, but nothing acted on it unless
 * a task was already running, so it could veto and never choose.
 *
 * The one design decision worth stating. It has a short list of things it will
 * do unbidden — keep a pickaxe, keep torches, keep food, put things away, and
 * work toward whatever standing goal it was given — and it will not invent
 * anything outside that list. An autopilot that decides on its own to
 * redecorate your base is not a smarter autopilot, it is a worse one, and the
 * gap between "handles itself" and "does things you did not ask for" is the
 * whole difference between leaving it running and never leaving it running.
 *
 * It also never overrides you. Any task already going is left alone, a pause
 * stops it, and the moment you touch a movement key everything including this
 * lets go.
 */
public final class Autopilot {

    /** How often to think. Sixty ticks is three seconds and plenty. */
    private static final int INTERVAL = 60;
    /** Keep this many of the things that make a session possible. */
    private static final int WANT_TORCHES = 16;
    /** The tool everything else needs before it needs anything else. */
    private static final String BASIC_TOOL = "stone_pickaxe";

    private final Minecraft client;
    private final GatherTask gather;
    private final SortTask sort;
    private final Agenda agenda;
    /**
     * How much health has just been lost.
     *
     * Passed in rather than read here, because the guardian is what keeps that
     * window and two of them would disagree. Without it the autopilot cannot
     * tell "on four hearts" from "on four hearts and still being hit", and the
     * second one is the situation where deciding to go mining kills you.
     */
    private final java.util.function.DoubleSupplier damageRecently;
    private final Consumer<String> report;

    private boolean on;
    private String goalItem;
    private int goalCount;
    private int cooldown;
    private String lastSaid = "";

    public Autopilot(Minecraft client, GatherTask gather, SortTask sort, Agenda agenda,
                     java.util.function.DoubleSupplier damageRecently, Consumer<String> report) {
        this.client = client;
        this.gather = gather;
        this.sort = sort;
        this.agenda = agenda;
        this.damageRecently = damageRecently;
        this.report = report;
    }

    public boolean on() {
        return on;
    }

    public String goal() {
        return goalItem == null ? "looking after itself" : goalCount + " " + goalItem;
    }

    public void start(String item, int count) {
        this.on = true;
        this.goalItem = item;
        this.goalCount = count;
        this.cooldown = 0;
        report.accept("auto: " + goal() + " — /understudy auto off to stop, or just move");
    }

    public void stop() {
        if (!on) return;
        on = false;
        goalItem = null;
        report.accept("auto off");
    }

    /**
     * Think, occasionally, and only when there is nothing already happening.
     *
     * Deliberately not every tick: deciding is cheap but starting a task is
     * not, and an autopilot that re-decides sixty times a second spends its
     * life cancelling itself.
     */
    public void tick(LocalPlayer player) {
        if (!on || player == null || client.level == null) return;
        if (busy()) return;
        if (cooldown-- > 0) return;
        cooldown = INTERVAL;

        Agenda.Situation now = Senses.read(client, player, standingJob(), damageRecently.getAsDouble());
        Agenda.Decision decision = agenda.next(now);

        switch (decision.act()) {
            case RETREAT -> say(decision.because());
            case EAT -> { /* the guardian eats; this stays out of its way */ }
            case LIGHT -> Torchlight.keepLit(client, player);
            case UNLOAD -> {
                say("putting things away — " + decision.because());
                sort.start(true);
            }
            case EQUIP, FETCH, WORK, IDLE -> fetchWhateverIsMissing(player);
        }
    }

    /**
     * Get the next thing that is missing, in the order a person would.
     *
     * A tool before the things it digs; light and food before a long job,
     * because running out of either halfway is what turns an hour of work into
     * a walk home. The standing goal comes last, which looks backwards and is
     * not: a goal pursued without a pickaxe is a goal you fail slowly.
     */
    private void fetchWhateverIsMissing(LocalPlayer player) {
        Map<String, Integer> carried = Carried.contents(player);

        Map<String, Integer> wanted = new LinkedHashMap<>();
        if (carried.getOrDefault(BASIC_TOOL, 0) == 0
                && carried.getOrDefault("iron_pickaxe", 0) == 0
                && carried.getOrDefault("diamond_pickaxe", 0) == 0) {
            wanted.put(BASIC_TOOL, 1);
        } else if (carried.getOrDefault("torch", 0) < WANT_TORCHES) {
            wanted.put("torch", WANT_TORCHES);
        } else if (!hasFood(carried)) {
            // Nothing here farms or hunts, so this is the honest limit of
            // looking after itself. Say so once rather than trying and failing.
            say("no food and no way to get any on its own — that one is yours");
            return;
        } else if (goalItem != null && carried.getOrDefault(goalItem, 0) < goalCount) {
            wanted.put(goalItem, goalCount);
        }

        if (wanted.isEmpty()) {
            say(goalItem == null ? "nothing needs doing" : "got " + goal());
            return;
        }

        Planner.Plan plan = new Planner(Catalogue.solver()).plan(wanted, carried);
        if (!plan.possible()) {
            say("cannot work out how to get " + String.join(", ", plan.shortfall().keySet()));
            return;
        }
        if (plan.actions().isEmpty()) return;

        say("getting " + String.join(", ", wanted.keySet()));
        gather.start(plan, null);
    }

    private static boolean hasFood(Map<String, Integer> carried) {
        return carried.keySet().stream().anyMatch(item -> Category.of(item) == Category.FOOD);
    }

    private Agenda.Job standingJob() {
        return goalItem == null ? null : Agenda.Job.of(goalCount + " " + goalItem);
    }

    private boolean busy() {
        return gather.running() || sort.running();
    }

    /** Say it once. An autopilot that narrates every three seconds is noise. */
    private void say(String line) {
        if (line.equals(lastSaid)) return;
        lastSaid = line;
        report.accept("auto: " + line);
    }
}

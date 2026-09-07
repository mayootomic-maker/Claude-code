package dev.understudy.mc;

import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import dev.understudy.core.mind.Agenda;
import dev.understudy.core.survive.Armoury;
import dev.understudy.core.survive.Combat;
import dev.understudy.core.sort.Category;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
 * do unbidden — keep a pickaxe, keep torches, hunt and cook when the food runs
 * out, sleep through the night, put things away, and work toward whatever
 * standing goal it was given — and it will not invent anything outside that
 * list. An autopilot that decides on its own to
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
    /**
     * Meals in the bag before setting off.
     *
     * Eight cooked anything is most of a hunger bar twice over, which is about
     * as long as a job runs. Fewer means hunting again halfway through; more
     * means hunting instead of working.
     */
    private static final int WANT_MEALS = 8;
    /** What it hunts and cooks when the bag is empty, in preference order. */
    private static final List<String> MEALS =
            List.of("cooked_beef", "cooked_porkchop", "cooked_mutton", "bread");
    /** The tool everything else needs before it needs anything else. */
    private static final String BASIC_TOOL = "stone_pickaxe";
    /** Pickaxes that count as having one, best last. */
    private static final List<String> PICKAXES =
            List.of("stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe");
    /** Swords it will make for itself, in the order it can reach them. */
    private static final List<String> SWORDS =
            List.of("iron_sword", "stone_sword", "wooden_sword");
    /**
     * Armour worth stopping to make, and the order to try.
     *
     * Iron first because it is more than twice the protection and the mod is
     * already mining iron for everything else; leather is the first-day answer
     * and needs a cow rather than a mine. Chest and legs before head and feet:
     * that is where two thirds of the points are.
     */
    private static final List<String> ARMOUR = List.of(
            "iron_chestplate", "iron_leggings", "iron_helmet", "iron_boots",
            "leather_chestplate", "leather_leggings", "leather_helmet", "leather_boots");

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
        Bedtime.reset();
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
            case DEFEND -> say(decision.because());
            case EAT -> { /* the guardian eats; this stays out of its way */ }
            case LIGHT -> Torchlight.keepLit(client, player);
            case UNLOAD -> {
                say("putting things away — " + decision.because());
                sort.start(true);
            }
            case EQUIP, FETCH, WORK, IDLE -> {
                // Put on whatever is already in the bag before anything else,
                // every time it thinks. It costs one right-click, it is the
                // largest single thing that changes how a fight goes, and the
                // mod used to carry a full set of iron while trading hits with
                // a zombie in a shirt.
                if (Fight.wearTheBest(client, player)) return;
                // The night before the errand. Sleeping through it is eight
                // seconds and removes every hostile in it, which no amount of
                // fighting well does — and phantoms, which nothing here can
                // reach, arrive on the third night awake.
                if (!Bedtime.tick(client, player, this::say)) fetchWhateverIsMissing(player);
            }
        }
    }

    /**
     * Get the next thing that is missing, in the order a person would.
     *
     * A tool before the things it digs; something to fight with and something
     * to be hit in before a night; light and food before a long job, because
     * running out of either halfway is what turns an hour of work into a walk
     * home. The standing goal comes last, which looks backwards and is not: a
     * goal pursued without a pickaxe is a goal you fail slowly.
     *
     * The sword and the armour are new and they are not decoration. Everything
     * above them in this list is about getting work done; those two are the
     * difference between the work surviving the night and the character not.
     */
    private void fetchWhateverIsMissing(LocalPlayer player) {
        Map<String, Integer> carried = Carried.contents(player);

        String armour = missingArmour(player, carried);
        Map<String, Integer> wanted = new LinkedHashMap<>();
        if (!hasAny(carried, PICKAXES)) {
            wanted.put(BASIC_TOOL, 1);
        } else if (Combat.bestWeapon(carried) == null
                || !Combat.isWeapon(Combat.bestWeapon(carried))) {
            String sword = firstReachable(SWORDS, carried);
            if (sword == null) {
                say("nothing to fight with and no way to make one yet");
                return;
            }
            wanted.put(sword, 1);
        } else if (armour != null) {
            wanted.put(armour, 1);
        } else if (carried.getOrDefault("torch", 0) < WANT_TORCHES) {
            wanted.put("torch", WANT_TORCHES);
        } else if (countFood(carried) < WANT_MEALS) {
            // It can hunt now, so this is no longer the limit it used to be:
            // the planner treats meat as a source like any other and works out
            // the walk, the kill and the furnace by itself. Which meal depends
            // on what is actually reachable — beef needs cows, bread needs a
            // wheat field, and neither is guaranteed to be where you are.
            String meal = reachableMeal(carried);
            if (meal == null) {
                say("no way to get food where it is standing — that one is yours");
                return;
            }
            wanted.put(meal, WANT_MEALS);
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

    private static boolean hasAny(Map<String, Integer> carried, List<String> any) {
        for (String item : any) if (carried.getOrDefault(item, 0) > 0) return true;
        return false;
    }

    /**
     * The next piece of armour worth going and making.
     *
     * One at a time, best-first, and only if the slot is empty or has something
     * worse in it — so a session that starts in leather upgrades to iron a piece
     * at a time rather than deciding it is dressed and stopping.
     */
    private String missingArmour(LocalPlayer player, Map<String, Integer> carried) {
        Map<Armoury.Slot, String> worn = Fight.wornBy(player);
        Map<Armoury.Slot, String> best = Armoury.bestSet(carried);
        for (String want : ARMOUR) {
            Armoury.Piece piece = Armoury.of(want);
            Armoury.Piece have = Armoury.of(best.getOrDefault(piece.slot(),
                    worn.get(piece.slot())));
            if (have != null && have.points() >= piece.points()) continue;
            if (new Planner(Catalogue.solver()).plan(Map.of(want, 1), carried).possible()) {
                return want;
            }
        }
        return null;
    }

    /** The first of these the planner can actually see a route to. */
    private String firstReachable(List<String> options, Map<String, Integer> carried) {
        for (String option : options) {
            if (new Planner(Catalogue.solver()).plan(Map.of(option, 1), carried).possible()) {
                return option;
            }
        }
        return null;
    }

    /**
     * The first meal on the list the planner can actually see a route to.
     *
     * In preference order rather than by cost: cooked meat is the best food in
     * the early game by a distance, and bread is the fallback for somewhere
     * with nothing to hunt.
     */
    private String reachableMeal(Map<String, Integer> carried) {
        for (String meal : MEALS) {
            if (new Planner(Catalogue.solver()).plan(Map.of(meal, WANT_MEALS), carried).possible()) {
                return meal;
            }
        }
        return null;
    }

    /** How many meals are in the bag, of whatever kind. */
    private static int countFood(Map<String, Integer> carried) {
        int total = 0;
        for (Map.Entry<String, Integer> held : carried.entrySet()) {
            if (Category.of(held.getKey()) == Category.FOOD) total += held.getValue();
        }
        return total;
    }

    /**
     * The standing goal, with what it will take to reach it.
     *
     * The needs are what makes the agenda's EQUIP and FETCH branches mean
     * anything: with an empty list they could never fire, so the mod had a
     * decision layer that could veto and never ask for a tool. The planner
     * already works out the tools on the way to the goal, so this is reading
     * them off a plan it was going to build anyway.
     */
    public Agenda.Job standingJob() {
        if (goalItem == null) return null;
        String what = goalCount + " " + goalItem;
        LocalPlayer player = client.player;
        if (player == null) return Agenda.Job.of(what);

        Planner.Plan plan = new Planner(Catalogue.solver())
                .plan(Map.of(goalItem, goalCount), Carried.contents(player));
        List<String> tools = new ArrayList<>();
        for (Planner.Action action : plan.actions()) {
            if (action instanceof Planner.Collect collect
                    && collect.tool() != null && !tools.contains(collect.tool())) {
                tools.add(collect.tool());
            }
        }
        return new Agenda.Job(what, tools, List.of(goalItem));
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

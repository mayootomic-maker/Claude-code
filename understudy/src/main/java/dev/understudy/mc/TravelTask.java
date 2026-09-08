package dev.understudy.mc;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.path.PathFinder;
import dev.understudy.core.path.Step;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

import java.util.List;
import java.util.function.Consumer;

/**
 * Getting somewhere: search a bit, walk what was found, search again.
 *
 * Travelling two thousand blocks is not one search. The client only has the
 * terrain around you loaded, and proving a route that far would freeze the game
 * for seconds even if it did. So the task searches within a budget, walks the
 * prefix it got, and searches again from wherever it ended up — which also
 * means it copes with the world changing underneath it and with terrain that
 * only loads as you approach.
 *
 * How willing it is to tunnel, bridge or swim comes from the player profile
 * rather than from settings, so a route looks like one you would have taken.
 */
public final class TravelTask {

    /** Re-plan once the remaining path is this short, so walking never stalls. */
    private static final int REPLAN_AT = 6;
    /** Give up after this many failed searches in a row. */
    private static final int MAX_FAILURES = 4;

    private final Minecraft client;
    private final PlayerProfile profile;
    private final Walker walker;
    private final Consumer<String> report;

    private BlockPos goal;
    private boolean running;
    private int failures;
    private int ticks;
    private double startedDistance;
    private BlockPos plannedFrom;
    private int plannedTick;
    private boolean mustDig;

    public TravelTask(Minecraft client, PlayerProfile profile, Consumer<String> report) {
        this.client = client;
        this.profile = profile;
        this.walker = new Walker(client);
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    public BlockPos goal() {
        return goal;
    }

    /**
     * How near counts as arrived.
     *
     * Named because it is not only this class's business. Anything that walks
     * somewhere in order to be able to *do* something there has to know that it
     * will be put down up to this far from where it asked for — and a caller
     * that assumes it lands on the exact block will ask again, arrive again
     * instantly, and stand there doing that forever.
     */
    public static final double ARRIVAL_SLACK = 1.8;

    public void start(BlockPos target) {
        start(target, false);
    }

    /**
     * Go there, digging whether or not that is your style.
     *
     * Used when the destination is underground and there is no walking to it:
     * a mine shaft is not a route preference, it is the only route.
     */
    public void start(BlockPos target, boolean digging) {
        this.mustDig = digging;
        this.goal = target;
        this.running = true;
        this.failures = 0;
        this.ticks = 0;
        this.plannedFrom = null;
        this.plannedTick = 0;
        LocalPlayer player = client.player;
        this.startedDistance = player == null ? 0 : Math.sqrt(player.blockPosition().distSqr(target));
        replan();
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        walker.stop();
        if (why != null) report.accept(why);
    }

    /** Called every client tick while a journey is in progress. */
    public void tick() {
        if (!running) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop("lost the world");
            return;
        }

        ticks++;
        BlockPos here = player.blockPosition();

        if (here.closerThan(goal, ARRIVAL_SLACK)) {
            running = false;
            walker.stop();
            report.accept("arrived (" + (ticks / 20) + "s)");
            return;
        }

        // The walk has run out of path, or snagged on something the search did
        // not know about. Either way the answer is a fresh search from here.
        if (walker.done() || walker.stuck()) {
            replan();
            return;
        }

        walker.tick(profile.haste() > 0.25);
        observeTravel(player);
    }

    private void replan() {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop("lost the world");
            return;
        }

        BlockPos from = player.blockPosition();
        // Did the last plan get us anywhere? Not "did the search succeed" —
        // the search can hand back a perfect route to a door the walker cannot
        // open, and then it is asked again from the same three blocks, and
        // succeeds again, forever. Ground covered is the only honest measure.
        // A plan made moments ago is exempt: a short prefix is meant to be
        // walked out quickly.
        boolean movedOn = plannedFrom == null
                || from.distSqr(plannedFrom) > 9
                || ticks - plannedTick < 40;
        plannedFrom = from;
        plannedTick = ticks;

        ClientBlockView view = new ClientBlockView(client.level);

        PathFinder.Options options = new PathFinder.Options();
        // Take the shortcuts you take. Digging is wired to the walker, so a route
        // may go through a hill rather than all the way round it — which is what
        // a person does, and what makes a long journey a journey rather than a
        // tour. How willing it is comes from the profile: someone who tunnels
        // gets a route that tunnels. Unless the last search came back with
        // nothing, at which point even someone who never tunnels picks up a
        // shovel rather than standing there, because one wall is all it usually is.
        options.allowDig = mustDig || profile.digTolerance() > 0.2 || failures > 0;
        // Bridging is on, but only when there is something ordinary to bridge
        // with. Planning a route across a ravine you have no blocks for is a
        // route that ends at the ravine, and the search is better off not
        // knowing about the shortcut at all.
        options.allowBridge = Walker.spare(player) != null;
        options.allowSwim = profile.swimTolerance() > 0.15;
        // A bigger budget is worth it here. The old one gave up on anything that
        // needed real thought and handed back a partial path, which is how a
        // walk ends up going the scenic way round a mountain one replan at a time.
        options.budget = 24_000;
        options.range = 1;

        PathFinder.Result result =
                new PathFinder(view, options).find(from.getX(), from.getY(), from.getZ(),
                        goal.getX(), goal.getY(), goal.getZ());

        // Three ways to be getting nowhere: no route at all, a route that ends
        // no closer than it began, or a route we have already been given and
        // failed to walk. Any of them once is nothing — terrain loads, a mob
        // gets in the way. Four in a row is the walk pacing, and saying so is
        // better than doing it until the world ends.
        if (result.empty() || !result.progress() || !movedOn) {
            failures++;
            if (failures >= MAX_FAILURES) {
                stop(result.empty() ? "can't find a way there from here"
                        : "stuck: nothing from here is getting any closer");
                return;
            }
            if (result.empty()) return;
        } else {
            failures = 0;
        }

        List<Step> steps = result.steps();
        // Walking the whole prefix before re-planning wastes the chance to use
        // terrain that loads on the way, so stop a little short of the end.
        if (!result.complete() && steps.size() > REPLAN_AT * 2) {
            steps = steps.subList(0, steps.size() - REPLAN_AT);
        }
        // The walker is told whether this route was allowed to tunnel, because
        // that is also the answer to "may I break the thing I am stuck on".
        walker.follow(steps, view, options.allowDig);
    }

    /** Feed the player's own movement back into the profile. */
    private void observeTravel(LocalPlayer player) {
        Step step = walker.current();
        if (step == null) return;
        profile.travelled(0.05,
                client.options.keySprint.isDown(),
                step.kind() == Step.Kind.DIG,
                step.kind() == Step.Kind.BRIDGE,
                player.isInWater());
    }

    public String status() {
        if (!running) return "idle";
        LocalPlayer player = client.player;
        if (player == null) return "no player";
        double left = Math.sqrt(player.blockPosition().distSqr(goal));
        return String.format("travelling: %.0f blocks to go of %.0f", left, startedDistance);
    }
}

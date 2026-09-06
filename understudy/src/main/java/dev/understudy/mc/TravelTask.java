package dev.understudy.mc;

import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.path.PathFinder;
import dev.understudy.core.path.Step;
import dev.understudy.human.Rng;
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

    public TravelTask(Minecraft client, PlayerProfile profile, Rng rng, Consumer<String> report) {
        this.client = client;
        this.profile = profile;
        this.walker = new Walker(client, rng);
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    public BlockPos goal() {
        return goal;
    }

    public void start(BlockPos target) {
        this.goal = target;
        this.running = true;
        this.failures = 0;
        this.ticks = 0;
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

        if (here.closerThan(goal, 1.8)) {
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
        ClientBlockView view = new ClientBlockView(client.level);

        PathFinder.Options options = new PathFinder.Options();
        // Take the shortcuts you take. Someone who tunnels through hills gets a
        // route that tunnels; someone who walks round gets one that walks round.
        // Digging is wired to the walker now, so a route may go through a hill
        // rather than all the way round it — which is what a person does, and
        // what makes a long journey a journey rather than a tour. How willing it
        // is comes from the profile: someone who tunnels gets a route that
        // tunnels.
        options.allowDig = profile.digTolerance() > 0.2;
        // Bridging still is not: placing a block underfoot mid-stride needs the
        // block in hand and a free moment, and half of that is not built.
        options.allowBridge = false;
        options.allowSwim = profile.swimTolerance() > 0.15;
        // A bigger budget is worth it here. The old one gave up on anything that
        // needed real thought and handed back a partial path, which is how a
        // walk ends up going the scenic way round a mountain one replan at a time.
        options.budget = 24_000;
        options.range = 1;

        PathFinder.Result result =
                new PathFinder(view, options).find(from.getX(), from.getY(), from.getZ(),
                        goal.getX(), goal.getY(), goal.getZ());

        if (result.empty()) {
            failures++;
            if (failures >= MAX_FAILURES) {
                stop("can't find a way there from here");
            }
            return;
        }

        failures = 0;
        List<Step> steps = result.steps();
        // Walking the whole prefix before re-planning wastes the chance to use
        // terrain that loads on the way, so stop a little short of the end.
        if (!result.complete() && steps.size() > REPLAN_AT * 2) {
            steps = steps.subList(0, steps.size() - REPLAN_AT);
        }
        walker.follow(steps, view);
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

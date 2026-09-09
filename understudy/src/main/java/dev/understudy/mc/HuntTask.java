package dev.understudy.mc;

import dev.understudy.core.adapt.Timings;
import dev.understudy.core.craft.Planner;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;

import java.util.List;
import java.util.function.Consumer;

/**
 * Getting food the way food is actually got.
 *
 * The honest limit of the old autopilot was one line: "no food and no way to get
 * any on its own — that one is yours". It was true. Nothing here could fight, so
 * nothing here could hunt, so an unattended session ended when the bread did and
 * there was nothing to be done about it.
 *
 * With a combat layer that limit is gone, and hunting turns out to be the
 * simplest thing that layer enables: find the animal, walk to it, hit it until
 * it stops, walk over what it dropped. The planner already treats meat as a
 * source like any other, so this is a plan step rather than a special mode —
 * which is why "get eight cooked beef" works, and works by hunting twice and
 * lighting a furnace, without anything above here knowing that is what happened.
 *
 * What it does not do is farm. Wheat is a gather because a wild patch is a thing
 * you find; a field is a thing you tend, over days, and pretending otherwise
 * would be a worse answer than saying so.
 */
public final class HuntTask {

    /** Beyond this, an animal on the entity list is not worth walking to. */
    private static final double IN_RANGE = 96.0;
    /** Close enough to swing rather than walk. */
    private static final double CLOSE = 12.0;
    /** How long to stand on the drop before accepting it is not coming. */
    private static final int PICKUP_TICKS = 30;
    /** How far each look-elsewhere leg goes. */
    private static final int LEG = 40;
    /** Give up after this many empty legs rather than walking to the horizon. */
    private static final int MAX_LEGS = 6;

    private final Minecraft client;
    private final TravelTask travel;
    private final Consumer<String> report;

    private boolean running;
    private List<String> animals = List.of();
    private String item = "";
    private int wanted;
    private Entity quarry;
    private BlockPos drop;
    private int pickup;
    private int legs;
    private int heading;
    /**
     * What it has already searched for and not found.
     *
     * Without this the plan step and the hunt deadlock politely forever: the
     * hunt gives up because there are no cows, the step sees the count has not
     * moved and starts it again, and the pair of them do that twenty times a
     * second. Refusing the same quarry twice is what turns that into "moving
     * on", which is what the gatherer does with everything else it cannot get.
     */
    private String gaveUpOn;

    public HuntTask(Minecraft client, TravelTask travel, Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.report = report;
    }

    public boolean running() {
        return running;
    }

    public String status() {
        return running ? "hunting for " + item : "idle";
    }

    public Timings.Phase phase() {
        if (travel.running()) return Timings.Phase.TRAVELLING;
        if (quarry != null) return Timings.Phase.FIGHTING;
        return Timings.Phase.SEARCHING;
    }

    /**
     * Take on a plan step. Returns false when the step is not a hunt or names
     * nothing that can be hunted, so the caller can move on rather than stall.
     */
    public boolean start(Planner.Collect step) {
        List<String> from = Planner.sourcesOf(step.item());
        if (!step.hunted() || from.isEmpty()) return false;
        if (step.item().equals(gaveUpOn)) return false;
        this.animals = from;
        this.item = step.item();
        this.wanted = step.count();
        this.quarry = null;
        this.drop = null;
        this.pickup = 0;
        this.legs = 0;
        this.running = true;
        report.accept("hunting: " + String.join(" or ", from) + " for " + item);
        return true;
    }

    public void stop(String why) {
        if (!running) return;
        running = false;
        quarry = null;
        drop = null;
        letGo();
        if (why != null) report.accept(why);
    }

    public void tick() {
        if (!running) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) return;

        if (Hotbar.count(player, item) >= wanted) {
            gaveUpOn = null;
            stop(null);
            return;
        }
        if (travel.running()) return;

        // Standing on what the last one dropped. Items are picked up by being
        // walked over, so the only thing to do is be there and wait a moment —
        // a drop can land a block away or bounce into water, and giving it a
        // second and a half is cheaper than losing the whole kill.
        if (drop != null) {
            if (pickup-- > 0) return;
            drop = null;
            return;
        }

        if (quarry != null && quarry.isAlive()) {
            if (!Fight.strike(client, player, quarry)) quarry = null;
            return;
        }
        if (quarry != null) {
            // It went down. Go and stand where it was.
            drop = quarry.blockPosition();
            pickup = PICKUP_TICKS;
            quarry = null;
            letGo();
            travel.start(drop);
            return;
        }

        Entity found = nearest(player);
        if (found == null) {
            lookElsewhere(player);
            return;
        }
        legs = 0;
        double distance = Math.sqrt(player.distanceToSqr(found));
        if (distance > CLOSE) {
            travel.start(found.blockPosition());
            return;
        }
        quarry = found;
        Fight.arm(client, player);
    }

    /**
     * Walk somewhere else and look again.
     *
     * Animals are not where you are standing, and a hunt that gives up because
     * the first look found nothing is not a hunt. The direction turns each leg,
     * so it sweeps rather than wandering back over the same field.
     */
    private void lookElsewhere(LocalPlayer player) {
        if (legs++ >= MAX_LEGS) {
            gaveUpOn = item;
            stop("no animals anywhere near — hunting for " + item + " gave up");
            return;
        }
        double angle = Math.toRadians(heading);
        heading = (heading + 137) % 360; // an awkward angle, so legs do not retrace
        BlockPos from = player.blockPosition();
        travel.start(from.offset((int) Math.round(Math.cos(angle) * LEG), 0,
                (int) Math.round(Math.sin(angle) * LEG)));
    }

    /** The closest thing on the list that is still alive. */
    private Entity nearest(LocalPlayer player) {
        Entity best = null;
        double nearest = IN_RANGE * IN_RANGE;
        for (Entity entity : client.level.entitiesForRendering()) {
            if (!entity.isAlive() || entity == player) continue;
            if (!animals.contains(Fight.kindOf(entity))) continue;
            double distance = player.distanceToSqr(entity);
            if (distance < nearest) {
                nearest = distance;
                best = entity;
            }
        }
        return best;
    }

    private void letGo() {
        Keys.set(client.options.keyUp, false);
        Keys.set(client.options.keyDown, false);
        Keys.set(client.options.keyJump, false);
    }
}

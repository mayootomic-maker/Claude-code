package dev.understudy.mc;

import dev.understudy.core.sort.Category;
import dev.understudy.core.survive.Guardian;
import dev.understudy.core.survive.Vitals;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.item.ItemStack;

import java.util.function.Consumer;

/**
 * Reads the player's condition, asks the Guardian what to do, and does it.
 *
 * The split matters: every judgement about when to stop lives in the Guardian,
 * where it is tested against situations that would be miserable to stage in a
 * real game, and this file only knows how to read a health bar and press a key.
 *
 * On hostiles. This used to stop the task and hand back the controls, full
 * stop, on the reasoning that a retreat picked by a mod that cannot see what hit
 * it is as likely to run off a ledge as away from anything. That reasoning was
 * sound about *retreating* and wrong about the situation: the third option is to
 * kill the thing, which is what a player does, and which does not require
 * knowing the terrain at all. So a hostile now goes to Combat, which fights when
 * fighting is the better answer and still says "stop" when it is not — including
 * the case the old code got backwards, where the mob is faster than you and
 * standing still with your hands off the controls is the losing move.
 *
 * "Gives you back the controls" is meant literally, and getting it wrong is
 * worse than not having a guardian at all. Two rules make it true. It runs only
 * while the mod is driving something — an idle mod has nothing to stop, so it
 * watches nothing and touches nothing. And letting go means letting go of the
 * mod's own keys, through Keys, never blanking the movement keys outright:
 * doing that to someone holding W leaves them standing still, mid-fight,
 * wondering why.
 */
public final class Safety {

    /** Hunger below which eating is worth interrupting for. */
    private static final int EAT_UNTIL = 18;
    /** Far enough to see one coming, near enough that it is about you. */
    private static final double WATCH_RADIUS = 16.0;

    private final Guardian guardian = new Guardian();
    private final Consumer<String> report;
    private int eatingTicks;
    private String lastReported = "";
    /**
     * Whether the last verdict ended with the mod standing down.
     *
     * The caller needs to know this and cannot read it off the verdict any
     * more: a FIGHT can end either way, and which way it ended is Combat's
     * answer rather than the Guardian's.
     */
    private boolean standingDown;

    public Safety(Consumer<String> report) {
        this.report = report;
    }

    /** Whether the mod is currently eating and should not be doing anything else. */
    public boolean busy() {
        return eatingTicks > 0;
    }

    /**
     * Forget everything and let go.
     *
     * Called whenever the mod goes idle, which matters more than it looks: a
     * half-finished mouthful leaves the use key held down, and a use key held
     * down by nobody is a player who cannot stop eating.
     */
    public void reset() {
        guardian.reset();
        eatingTicks = 0;
        lastReported = "";
        standingDown = false;
        Fight.reset();
        Keys.releaseAll();
    }

    /** Whether the task should be stopped outright after this tick. */
    public boolean standingDown() {
        return standingDown;
    }

    /**
     * Health lost in the last couple of seconds.
     *
     * The Guardian already keeps this window because a sudden four hearts and a
     * steady fourteen are the same instantaneous reading and call for opposite
     * responses. The agenda wants the same number for the same reason.
     */
    public double damageRecently() {
        return guardian.damageInWindow();
    }

    public Vitals read(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) return Vitals.healthy();
        Threats threats = scan(client);
        return new Vitals(
                player.getHealth(),
                player.getMaxHealth(),
                player.getFoodData().getFoodLevel(),
                hasFood(player),
                player.getAirSupply(),
                player.getMaxAirSupply(),
                player.isOnFire(),
                player.isInLava(),
                player.isInWater(),
                player.fallDistance,
                threats.count(),
                threats.nearest());
    }

    private record Threats(int count, double nearest) {}

    /**
     * How many hostiles are close, and how close the closest is.
     *
     * entitiesForRendering is already limited to what the client has loaded
     * around you, which is exactly the right scope: something four hundred
     * blocks away is not a reason to stop building, and the client cannot see it
     * anyway.
     *
     * Monster covers what actually attacks — zombies, skeletons, creepers,
     * spiders — and leaves out cows, villagers and your own pets, which is the
     * distinction that matters when deciding whether to stop.
     */
    private static Threats scan(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) return new Threats(0, Double.MAX_VALUE);
        int count = 0;
        double nearest = Double.MAX_VALUE;
        for (Entity entity : client.level.entitiesForRendering()) {
            if (!(entity instanceof Monster) || !entity.isAlive()) continue;
            double distance = Math.sqrt(player.distanceToSqr(entity));
            if (distance > WATCH_RADIUS) continue;
            count++;
            nearest = Math.min(nearest, distance);
        }
        return new Threats(count, nearest);
    }

    public Guardian.Verdict check(Minecraft client) {
        return guardian.check(read(client));
    }

    /**
     * Carry out a verdict. Returns true when the caller should stand down for
     * this tick and let safety have the controls.
     */
    public boolean act(Minecraft client, Guardian.Verdict verdict) {
        LocalPlayer player = client.player;
        if (player == null) return true;

        if (eatingTicks > 0) {
            eatingTicks--;
            boolean full = player.getFoodData().getFoodLevel() >= EAT_UNTIL;
            if (eatingTicks == 0 || full) {
                Keys.set(client.options.keyUse, false);
                eatingTicks = 0;
            }
            return true;
        }

        standingDown = false;
        switch (verdict.action()) {
            case CONTINUE -> {
                lastReported = "";
                Fight.reset();
                return false;
            }
            case FIGHT -> {
                Fight.Outcome outcome = Fight.defend(client, player, guardian.damageInWindow());
                switch (outcome) {
                    case CLEAR -> {
                        lastReported = "";
                        return false;
                    }
                    case DISENGAGE -> {
                        standingDown = true;
                        releaseMovement();
                        announce(Fight.describe(), "stopping");
                        return true;
                    }
                    default -> {
                        String what = Fight.describe();
                        announce(what.isEmpty() ? verdict.reason() : what, "dealing with it");
                        return true;
                    }
                }
            }
            case EAT -> {
                if (startEating(client, player)) {
                    announce(verdict.reason(), "eating");
                    return true;
                }
                return false; // nothing edible after all; do not stall the task
            }
            case SURFACE -> {
                announce(verdict.reason(), "surfacing");
                releaseMovement();
                // Look up and swim: holding jump is what rises in water.
                // Look up to swim up, through the same head as everything else.
                Aim.at(player.getYRot(), -70);
                Keys.set(client.options.keyJump, true);
                Keys.set(client.options.keyUp, true);
                return true;
            }
            case HOLD -> {
                releaseMovement();
                return true;
            }
            case FLEE, ABORT -> {
                standingDown = true;
                releaseMovement();
                announce(verdict.reason(), "stopping");
                return true;
            }
        }
        return false;
    }

    private void announce(String reason, String doing) {
        String line = reason + " — " + doing;
        if (line.equals(lastReported)) return; // once per situation, not per tick
        lastReported = line;
        report.accept(line);
    }

    private boolean startEating(Minecraft client, LocalPlayer player) {
        String food = bestFood(player);
        if (food == null || !Hotbar.hold(client, food)) return false;
        Keys.set(client.options.keyUse, true);
        // Long enough for the slowest food, and cut short the moment the hunger
        // bar says it worked.
        eatingTicks = 40;
        return true;
    }

    /**
     * Let go. Of the mod's own keys only — the player may well be holding the
     * same ones, and taking those off them is how "it stopped me moving while I
     * was being hit" happens.
     */
    private static void releaseMovement() {
        Keys.releaseAll();
    }

    private static boolean hasFood(LocalPlayer player) {
        return bestFood(player) != null;
    }

    /**
     * The most plentiful thing worth eating, so a stack of bread goes before the
     * single golden apple you were saving.
     */
    private static String bestFood(LocalPlayer player) {
        String best = null;
        int mostHeld = 0;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            String name = Hotbar.nameOf(stack);
            if (name == null) continue;
            if (Category.of(name) != Category.FOOD) continue;
            if (stack.getCount() > mostHeld) {
                mostHeld = stack.getCount();
                best = name;
            }
        }
        return best;
    }
}

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
 * On fleeing. When something is actively hurting you, this stops the task and
 * gives you back the controls rather than running somewhere of its own choosing.
 * That is deliberate. A retreat picked by a mod that cannot see what hit it is
 * as likely to run off a ledge or into the next cave as away from anything, and
 * "it killed me while escaping" is a worse failure than "it stopped and told
 * you". Stopping is the safe move, and it is the one that is honestly available.
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
        Keys.releaseAll();
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

        switch (verdict.action()) {
            case CONTINUE -> {
                lastReported = "";
                return false;
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
                player.setXRot(-70f);
                Keys.set(client.options.keyJump, true);
                Keys.set(client.options.keyUp, true);
                return true;
            }
            case HOLD -> {
                releaseMovement();
                return true;
            }
            case FLEE, ABORT -> {
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

package dev.understudy.mc;

import dev.understudy.core.sort.Category;
import dev.understudy.core.survive.Guardian;
import dev.understudy.core.survive.Vitals;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
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
 */
public final class Safety {

    /** Hunger below which eating is worth interrupting for. */
    private static final int EAT_UNTIL = 18;

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

    public void reset() {
        guardian.reset();
        eatingTicks = 0;
        lastReported = "";
    }

    public Vitals read(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) return Vitals.healthy();
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
                // Nothing scans for mobs yet, so this reports no hostiles rather
                // than guessing at some. The Guardian still catches an attack
                // through the damage it does, which needs no entity list.
                0,
                Double.MAX_VALUE);
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
                client.options.keyUse.setDown(false);
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
                releaseMovement(client);
                // Look up and swim: holding jump is what rises in water.
                player.setXRot(-70f);
                client.options.keyJump.setDown(true);
                client.options.keyUp.setDown(true);
                return true;
            }
            case HOLD -> {
                releaseMovement(client);
                return true;
            }
            case FLEE, ABORT -> {
                releaseMovement(client);
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
        client.options.keyUse.setDown(true);
        // Long enough for the slowest food, and cut short the moment the hunger
        // bar says it worked.
        eatingTicks = 40;
        return true;
    }

    private static void releaseMovement(Minecraft client) {
        client.options.keyUp.setDown(false);
        client.options.keyDown.setDown(false);
        client.options.keyLeft.setDown(false);
        client.options.keyRight.setDown(false);
        client.options.keySprint.setDown(false);
        client.options.keyJump.setDown(false);
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

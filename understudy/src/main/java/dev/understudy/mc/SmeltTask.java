package dev.understudy.mc;

import dev.understudy.core.craft.Planner;
import dev.understudy.core.craft.Recipe;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.AbstractFurnaceMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.ItemStack;

import java.util.List;
import java.util.function.Consumer;

/**
 * Smelting: the half of the plan a crafting grid cannot do.
 *
 * Glass for the windows is sand that has been in a fire, and so are the ingots,
 * the bricks and the smooth stone. Without this a plan that needs any of them
 * stops halfway and asks the player to go and do it, which is exactly the thing
 * the mod is for.
 *
 * The whole interaction is three shift-clicks and a wait. A furnace menu sorts
 * an incoming stack itself — anything smeltable goes to the top slot, anything
 * that burns goes to the bottom one — so this never has to know that sand is
 * smeltable or that coal is not. It only has to know which stack to throw at
 * it, which the plan already said.
 *
 * Fuel is coal, charcoal or a block of it, and deliberately nothing else. A
 * furnace will happily burn the planks you were about to build a floor out of,
 * and there is no version of that the player asked for.
 */
public final class SmeltTask {

    /**
     * Input on top, fuel below it, the result on the right — named by the menu
     * itself rather than written out here, and the slots after them are the
     * player's own inventory drawn underneath.
     */
    private static final int INPUT = AbstractFurnaceMenu.INGREDIENT_SLOT;
    private static final int FUEL = AbstractFurnaceMenu.FUEL_SLOT;
    private static final int RESULT = AbstractFurnaceMenu.RESULT_SLOT;
    private static final int FIRST_CARRIED = AbstractFurnaceMenu.SLOT_COUNT;

    private static final int OPEN_TIMEOUT = 40;
    /** One item takes ten seconds. Longer than that with nothing moving is a stall. */
    private static final int STALL_TICKS = 300;
    /** Don't fire a slot click every tick; the server has to answer each one. */
    private static final int CLICK_INTERVAL = 5;

    private static final List<String> FUELS = List.of("coal", "charcoal", "coal_block");

    private enum Stage { IDLE, NEED_FURNACE, OPENING, RUNNING }

    private final Minecraft client;
    private final Consumer<String> report;

    private Stage stage = Stage.IDLE;
    private Planner.Make job;
    private String input;
    private int madeAtStart;
    private BlockPos furnace;
    private int waited;
    private int idle;
    private int sinceClick;
    private String seen = "";

    public SmeltTask(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean running() {
        return stage != Stage.IDLE;
    }

    /** Returns false when this is not a smelting step at all. */
    public boolean start(Planner.Make make) {
        LocalPlayer player = client.player;
        if (player == null) return false;
        if (make.recipe().station() != Recipe.Station.FURNACE) return false;

        // The recipe lists the fuel as an ingredient, because the planner has to
        // go and get it. What goes in the top slot is the other one.
        input = make.recipe().inputs().keySet().stream()
                .filter(item -> !FUELS.contains(item))
                .findFirst()
                .orElse(null);
        if (input == null) return false;

        job = make;
        madeAtStart = Hotbar.count(player, make.item());
        stage = Stage.NEED_FURNACE;
        waited = 0;
        idle = 0;
        sinceClick = 0;
        seen = "";
        return true;
    }

    public void stop() {
        stage = Stage.IDLE;
        job = null;
        furnace = null;
    }

    public String status() {
        return stage == Stage.IDLE || job == null ? "idle" : "smelting " + job.item();
    }

    public void tick() {
        LocalPlayer player = client.player;
        if (stage == Stage.IDLE || player == null || client.gameMode == null) return;

        switch (stage) {
            case NEED_FURNACE -> findOrPlaceFurnace(player);
            case OPENING -> open(player);
            case RUNNING -> run(player);
            default -> { }
        }
    }

    private void findOrPlaceFurnace(LocalPlayer player) {
        BlockPos found = Placement.nearest(client, player.blockPosition(), "furnace");
        if (found != null) {
            furnace = found;
            stage = Stage.OPENING;
            waited = 0;
            return;
        }
        if (Hotbar.count(player, "furnace") > 0 && Hotbar.hold(client, "furnace")) {
            BlockPos spot = Placement.spotBeside(client, player);
            if (spot != null && Placement.put(client, player, spot, "furnace")) {
                furnace = spot;
                stage = Stage.OPENING;
                waited = 0;
                return;
            }
        }
        fail("no furnace nearby and none to put down");
    }

    private void open(LocalPlayer player) {
        if (menu(player) != null) {
            stage = Stage.RUNNING;
            waited = 0;
            idle = 0;
            report.accept("smelting " + job.count() + " " + job.item()
                    + " — about " + Math.max(1, Math.round(job.seconds() / 60)) + " min");
            return;
        }
        if (waited++ > OPEN_TIMEOUT) {
            fail("could not open the furnace");
            return;
        }
        if (waited > 1) return; // one attempt, then wait for the window to arrive
        if (furnace != null) Placement.use(client, player, furnace);
    }

    /**
     * Keep it loaded, keep taking the output, and notice when it has stopped.
     *
     * Written as "look at the three slots and fix whichever is wrong" rather
     * than as a sequence, because a furnace is not a sequence: the player is
     * stood in front of it for minutes, the fuel runs out partway, and a stack
     * of sixty-four sand is eight separate loads of the input slot.
     */
    private void run(LocalPlayer player) {
        AbstractFurnaceMenu open = menu(player);
        if (open == null) {
            finish(player, "the furnace window closed");
            return;
        }

        // Anything at all changing means it is still working. Comparing the
        // three slots is cheaper and more honest than trusting a timer: a cook
        // in progress moves nothing for ten seconds at a stretch.
        String now = describe(open, INPUT) + "|" + describe(open, FUEL) + "|" + describe(open, RESULT);
        if (now.equals(seen)) idle++;
        else {
            idle = 0;
            seen = now;
        }

        if (sinceClick-- > 0) return;
        sinceClick = CLICK_INTERVAL;

        // Enough of them made. Empty the furnace before walking away from it:
        // a stack of sand left in a furnace you put down in a field is a stack
        // of sand you have thrown away.
        if (Hotbar.count(player, job.item()) >= madeAtStart + job.count()) {
            if (emptied(player, open, RESULT) || emptied(player, open, INPUT)
                    || emptied(player, open, FUEL)) {
                return;
            }
            player.clientSideCloseContainer();
            finish(player, null);
            return;
        }

        if (emptied(player, open, RESULT)) return;

        if (open.getSlot(INPUT).getItem().isEmpty()) {
            int slot = carrying(open, input);
            if (slot >= 0) {
                shiftClick(player, open, slot);
                return;
            }
            // Nothing carried, nothing cooking, nothing in the output: this is
            // as far as it goes, and it may be short of what was asked for.
            if (idle > CLICK_INTERVAL * 2) {
                if (emptied(player, open, FUEL)) return;
                player.clientSideCloseContainer();
                finish(player, "ran out of " + input);
            }
            return;
        }

        // Keep the fuel slot filled rather than waiting for the fire to go out.
        // A coal sat in the slot is not consumed until it is needed, so this
        // costs nothing and saves a stall between every load.
        if (open.getSlot(FUEL).getItem().isEmpty()) {
            int slot = carriedFuel(open);
            if (slot >= 0) {
                shiftClick(player, open, slot);
                return;
            }
            // Nothing in the slot and nothing burning is the end of it — the
            // menu knows whether it is lit, so this does not have to be guessed
            // from a stopwatch. Still lit means it is working through the last
            // one, and there is a chance the job finishes on it.
            if (!open.isLit()) {
                if (emptied(player, open, INPUT)) return;
                player.clientSideCloseContainer();
                finish(player, "out of fuel — it needs coal or charcoal");
            }
            return;
        }

        if (idle > STALL_TICKS * 2) {
            player.clientSideCloseContainer();
            finish(player, "the furnace stopped");
        }
    }

    /** Shift a slot's contents back into the inventory. True if there were any. */
    private boolean emptied(LocalPlayer player, AbstractContainerMenu open, int slot) {
        if (open.getSlot(slot).getItem().isEmpty()) return false;
        shiftClick(player, open, slot);
        return true;
    }

    private void shiftClick(LocalPlayer player, AbstractContainerMenu open, int slot) {
        client.gameMode.handleContainerInput(open.containerId, slot, 0,
                ContainerInput.QUICK_MOVE, player);
    }

    /** Where in the furnace window the player is carrying this item, or -1. */
    private static int carrying(AbstractContainerMenu open, String item) {
        for (int slot = FIRST_CARRIED; slot < open.slots.size(); slot++) {
            if (item.equals(Hotbar.nameOf(open.getSlot(slot).getItem()))) return slot;
        }
        return -1;
    }

    private static int carriedFuel(AbstractContainerMenu open) {
        for (String fuel : FUELS) {
            int slot = carrying(open, fuel);
            if (slot >= 0) return slot;
        }
        return -1;
    }

    private static String describe(AbstractContainerMenu open, int slot) {
        ItemStack stack = open.getSlot(slot).getItem();
        return stack.isEmpty() ? "-" : Hotbar.nameOf(stack) + "x" + stack.getCount();
    }

    private static AbstractFurnaceMenu menu(LocalPlayer player) {
        return player.containerMenu instanceof AbstractFurnaceMenu furnace ? furnace : null;
    }

    private void finish(LocalPlayer player, String why) {
        int made = Hotbar.count(player, job.item()) - madeAtStart;
        String what = made > 0 ? "smelted " + made + " " + job.item()
                : "smelted no " + job.item();
        report.accept(why == null ? what : what + " — " + why);
        stop();
    }

    private void fail(String why) {
        report.accept("smelting " + (job == null ? "" : job.item()) + ": " + why);
        stop();
    }
}

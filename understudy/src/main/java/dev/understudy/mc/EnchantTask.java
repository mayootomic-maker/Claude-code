package dev.understudy.mc;

import dev.understudy.core.craft.Enchanting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.EnchantmentMenu;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Standing at the table and taking the right line.
 *
 * Enchanting decides; this does. What is left here is finding a table, counting
 * the shelves round it, putting two things in two slots and clicking one of
 * three buttons.
 *
 * It is deliberately a command rather than something the autopilot does. An
 * item can be enchanted at a table exactly once, so the cost of getting this
 * wrong is permanent in a way that nothing else in this mod is — and "it
 * enchanted my pickaxe while I was away, badly" is not a sentence anyone should
 * have to say. It says what it is about to do, and it refuses far more often
 * than it acts.
 */
public final class EnchantTask {

    private enum Stage { IDLE, FIND, OPENING, DECIDE, TAKING }

    /**
     * How far a bookshelf can be and still count.
     *
     * The game's own rule is a ring two blocks out with air between, which is
     * fiddly and which players get wrong constantly. Counting everything within
     * three blocks over-counts a badly built room, so the answer it gives is
     * checked against the table's own offers before anything is spent: if the
     * shelves are not really working the top line will not reach thirty, and
     * the level rule refuses.
     */
    private static final int SHELF_RANGE = 3;
    private static final int OPEN_TIMEOUT = 60;
    /** Ticks between clicks, so the server sees a person rather than a script. */
    private static final int CLICK_INTERVAL = 6;
    /** The table's two slots: the thing, and the lapis. */
    private static final int ITEM_SLOT = 0;
    private static final int LAPIS_SLOT = 1;

    private final Minecraft client;
    private final Consumer<String> report;

    private Stage stage = Stage.IDLE;
    private String wanted = "";
    private BlockPos table;
    private int waited;
    private int cooldown;

    public EnchantTask(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean running() {
        return stage != Stage.IDLE;
    }

    public String status() {
        return running() ? "enchanting " + wanted : "idle";
    }

    /** Returns whether it took the job. */
    public boolean start(String item) {
        LocalPlayer player = client.player;
        if (player == null) return false;
        if (!Enchanting.worthEnchanting(item)) {
            report.accept("a table has nothing to offer a " + item);
            return false;
        }
        if (Hotbar.count(player, item) <= 0) {
            report.accept("no " + item + " to enchant");
            return false;
        }
        this.wanted = item;
        this.table = null;
        this.waited = 0;
        this.cooldown = 0;
        this.stage = Stage.FIND;
        return true;
    }

    public void stop(String why) {
        if (stage == Stage.IDLE) return;
        stage = Stage.IDLE;
        if (client.player != null) client.player.clientSideCloseContainer();
        if (why != null) report.accept(why);
    }

    public void tick() {
        LocalPlayer player = client.player;
        if (stage == Stage.IDLE || player == null || client.gameMode == null) return;
        if (cooldown-- > 0) return;
        cooldown = CLICK_INTERVAL;

        switch (stage) {
            case FIND -> find(player);
            case OPENING -> open(player);
            case DECIDE -> decide(player);
            case TAKING -> take(player);
            default -> { }
        }
    }

    private void find(LocalPlayer player) {
        table = Placement.nearest(client, player.blockPosition(), "enchanting_table");
        if (table == null) {
            stop("no enchanting table within reach — stand at one");
            return;
        }
        stage = Stage.OPENING;
        waited = 0;
    }

    private void open(LocalPlayer player) {
        if (menu(player) != null) {
            stage = Stage.DECIDE;
            return;
        }
        if (waited++ > OPEN_TIMEOUT) {
            stop("could not open the table");
            return;
        }
        if (waited > 1) return; // one attempt, then wait for the window
        Placement.use(client, player, table);
    }

    /**
     * Read the three lines, ask whether any of them is worth it, and act.
     *
     * The item and the lapis go in first, because the table offers nothing at
     * all until there is something to enchant — so the first pass through here
     * loads the slots and the second one reads the offers.
     */
    private void decide(LocalPlayer player) {
        EnchantmentMenu open = menu(player);
        if (open == null) {
            stop("the table window closed");
            return;
        }
        if (open.getSlot(ITEM_SLOT).getItem().isEmpty()) {
            if (!move(player, open, wanted, ITEM_SLOT)) stop("could not put the " + wanted + " in");
            return;
        }
        if (open.getSlot(LAPIS_SLOT).getItem().isEmpty()) {
            if (!move(player, open, "lapis_lazuli", LAPIS_SLOT)) {
                stop("no lapis lazuli — three is the price of admission");
            }
            return;
        }

        List<Enchanting.Offer> offers = new ArrayList<>();
        for (int slot = 0; slot < open.costs.length; slot++) {
            offers.add(new Enchanting.Offer(slot, open.costs[slot], ""));
        }
        Enchanting.Choice choice = Enchanting.decide(player.experienceLevel,
                Hotbar.count(player, "lapis_lazuli"), shelvesAround(), offers);

        report.accept(choice.because());
        if (choice.act() != Enchanting.Act.ENCHANT) {
            stage = Stage.TAKING; // give the item and the lapis back first
            return;
        }
        client.gameMode.handleInventoryButtonClick(open.containerId, choice.slot());
        stage = Stage.TAKING;
    }

    /** Empty both slots back into the bag, whether it enchanted or thought better of it. */
    private void take(LocalPlayer player) {
        EnchantmentMenu open = menu(player);
        if (open == null) {
            stage = Stage.IDLE;
            return;
        }
        for (int slot : new int[]{ITEM_SLOT, LAPIS_SLOT}) {
            if (open.getSlot(slot).getItem().isEmpty()) continue;
            client.gameMode.handleContainerInput(open.containerId, slot, 0,
                    ContainerInput.QUICK_MOVE, player);
            return;
        }
        player.clientSideCloseContainer();
        stage = Stage.IDLE;
    }

    /** Send one of these from the bag into a table slot. */
    private boolean move(LocalPlayer player, EnchantmentMenu open, String item, int into) {
        int from = slotOf(open, item);
        if (from < 0) return false;
        client.gameMode.handleContainerInput(open.containerId, from, 0,
                ContainerInput.QUICK_MOVE, player);
        return true;
    }

    /** Where this item is sitting in the table's view of the player's bag. */
    private int slotOf(EnchantmentMenu open, String item) {
        for (int slot = 0; slot < open.slots.size(); slot++) {
            if (slot == ITEM_SLOT || slot == LAPIS_SLOT) continue;
            if (item.equals(Hotbar.nameOf(open.getSlot(slot).getItem()))) return slot;
        }
        return -1;
    }

    /**
     * Bookshelves near enough to be doing something.
     *
     * Generous on purpose, and safe to be: over-counting a badly built room
     * only means the table's own offers are consulted next, and a room whose
     * shelves are not really working cannot offer thirty — at which point the
     * level rule refuses and nothing is spent.
     */
    private int shelvesAround() {
        if (table == null || client.level == null) return 0;
        int found = 0;
        for (int dx = -SHELF_RANGE; dx <= SHELF_RANGE; dx++) {
            for (int dy = 0; dy <= 1; dy++) {
                for (int dz = -SHELF_RANGE; dz <= SHELF_RANGE; dz++) {
                    if (Placement.is(client, table.offset(dx, dy, dz), "bookshelf")) found++;
                }
            }
        }
        return found;
    }

    private EnchantmentMenu menu(LocalPlayer player) {
        return player.containerMenu instanceof EnchantmentMenu table ? table : null;
    }
}

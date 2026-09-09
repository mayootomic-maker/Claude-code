package dev.understudy.mc;

import dev.understudy.core.gear.Kit;
import dev.understudy.core.memory.Atlas;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Puts down a chest with a spare set of everything in it.
 *
 * The thing you want after dying is not your things — those are on the floor
 * where you died, on a timer. It is a second set, somewhere you can walk to
 * naked: armour, a sword, four tools, food, torches and a stack of stone. That
 * is a five-minute job by hand and nobody does it, which is why the first death
 * a long way from home costs an evening.
 *
 * How it works is deliberately ordinary. It places the chest the way you would,
 * by holding one and right-clicking the ground beside you, and it fills it the
 * way you would, by opening it and shift-clicking stacks across. Nothing here
 * is a command and nothing here needs permission, so it works the same in your
 * own world and on a friend's server, opped or not.
 *
 * What it will not do is take the kit you are wearing. Every line of `Kit` says
 * how many must stay with you and only the surplus is ever moved — see
 * `core.gear.Kit`, where that arithmetic lives and is tested.
 *
 * Where the chest went is written into the atlas, so `/stash where` can say,
 * and so it survives the session. A cache you cannot find again is a cache you
 * did not make.
 */
public final class StashTask {

    /** What the atlas files these under. */
    public static final String STASH = "stash";

    private enum Phase { IDLE, PLACE, STOCK, OPEN, FILL, CLOSE, DONE }

    /** One stack a couple of ticks, as everywhere else that touches a container. */
    private static final int MOVE_INTERVAL = 2;
    private static final int PLACE_TIMEOUT = 60;
    private static final int OPEN_TIMEOUT = 60;
    /** Where the hotbar sits in the player's own screen handler. */
    private static final int HOTBAR_IN_MENU = 36;

    private final Minecraft client;
    private final Atlas atlas;
    private final Consumer<String> report;

    private Phase phase = Phase.IDLE;
    private BlockPos where;
    private boolean creative;
    /** What is still to go in, and the most of each that may go. */
    private final Map<String, Integer> outstanding = new LinkedHashMap<>();
    /**
     * The lines this pass of the chest is trying to move.
     *
     * In creative the kit is conjured into the inventory before the chest is
     * opened rather than while it is open. Writing to a creative slot while a
     * container is up means two menus disagreeing about the same inventory,
     * and the way that fails is a silent resync that puts the stack back — a
     * chest that is empty for no visible reason. So each pass conjures what
     * will fit in the free slots, opens, empties them across, and comes back
     * for the rest if there was not room for all of it at once.
     */
    private final java.util.List<String> wave = new ArrayList<>();
    /** What actually went in, for the report at the end. */
    private final Map<String, Integer> stocked = new LinkedHashMap<>();
    private List<String> shortOf = List.of();
    /** What this chest is, as a phrase the reports can drop straight into. */
    private String label = "recovery chest";
    private int waited;
    private int cooldown;

    public StashTask(Minecraft client, Atlas atlas, Consumer<String> report) {
        this.client = client;
        this.atlas = atlas;
        this.report = report;
    }

    public boolean running() {
        return phase != Phase.IDLE && phase != Phase.DONE;
    }

    public String status() {
        return running()
                ? "stashing a " + label + ": " + outstanding.size() + " lines left"
                : "idle";
    }

    /**
     * Decide the kit, find a spot, and start.
     *
     * Everything that can be known before touching the world is checked here,
     * because a refusal you get immediately is worth ten times one you get
     * after the chest is already on the ground. A misspelled item is the case
     * that matters most: the chest would otherwise go down, open, fill with
     * nothing and close again, which looks exactly like a broken feature
     * rather than like a typo.
     */
    public void start(List<Kit.Line> wanted, String what, boolean kit) {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            report.accept("not in a world yet");
            return;
        }
        if (wanted.isEmpty()) {
            report.accept("nothing named to stash");
            return;
        }

        List<Kit.Line> lines = new ArrayList<>();
        List<String> nonsense = new ArrayList<>();
        for (Kit.Line line : wanted) {
            String real = inTheGame(line.item());
            if (real == null) nonsense.add(line.item());
            else lines.add(new Kit.Line(real, line.want(), line.keepBack()));
        }
        if (!nonsense.isEmpty()) {
            report.accept("no item called " + String.join(", ", nonsense));
            if (lines.isEmpty()) return;
            report.accept("stashing the rest anyway");
        }

        label = what;
        creative = Hotbar.creative(player);
        Map<String, Integer> carried = Carried.contents(player);

        if (!creative && !carried.containsKey(Kit.CONTAINER)) {
            report.accept("no chest to put it in — carry one, or /get chest");
            return;
        }

        Kit.Stocked plan = Kit.from(lines, carried, creative);
        if (plan.isEmpty()) {
            report.accept("nothing to spare for a " + label + " — no spare "
                    + String.join(", ", plan.shortOf()));
            if (kit) {
                report.accept("a kit is a second set, not the one you are wearing — "
                        + "/stash needs says what to carry for a full one");
            }
            return;
        }

        BlockPos spot = Placement.spotBeside(client, player);
        if (spot == null) {
            report.accept("no clear ground beside you to put a chest on");
            return;
        }

        outstanding.clear();
        stocked.clear();
        for (Kit.Give give : plan.giving()) outstanding.put(give.item(), give.count());
        shortOf = plan.shortOf();
        where = spot;
        waited = 0;
        cooldown = 0;
        phase = Phase.PLACE;
        report.accept("stashing a " + label + " at " + where.getX() + " " + where.getY()
                + " " + where.getZ() + " — " + Kit.describe(plan));
    }

    /**
     * The registry name behind a word somebody typed, or null.
     *
     * The candidates come from core — the alias and the plural rules are facts
     * about English rather than about this version of the game — and the
     * registry is the only thing that can say which of them is real.
     */
    private String inTheGame(String typed) {
        for (String candidate : Kit.candidates(typed)) {
            if (itemNamed(candidate) != null) return candidate;
        }
        return null;
    }

    public void stop(String why) {
        if (!running()) return;
        closeScreen();
        phase = Phase.IDLE;
        if (why != null) report.accept(why);
    }

    public void tick() {
        if (!running()) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop(null);
            return;
        }
        if (cooldown-- > 0) return;

        switch (phase) {
            case PLACE -> place(player);
            case STOCK -> stock(player);
            case OPEN -> open(player);
            case FILL -> fill(player);
            case CLOSE -> close();
            default -> { }
        }
    }

    /**
     * Put the chest down.
     *
     * `Placement.put` asks and then looks, and on a server the looking is a
     * tick or two early — the block appears when the server says so, not when
     * the click is sent. So the answer is retried rather than believed, once a
     * second, and the timeout is the honest end of it.
     */
    private void place(LocalPlayer player) {
        if (Placement.is(client, where, Kit.CONTAINER)) {
            atlas.saw(STASH, where.getX(), where.getY(), where.getZ(),
                    client.level.getGameTime());
            waited = 0;
            phase = Phase.STOCK;
            return;
        }
        if (waited++ > PLACE_TIMEOUT) {
            stop("could not put a chest down there — something is in the way, "
                    + "or the server would not let it be placed");
            return;
        }
        if (waited % 10 != 1) return;
        if (!Hotbar.holdOrConjure(client, Kit.CONTAINER)) {
            stop("ran out of chests");
            return;
        }
        Placement.put(client, player, where, Kit.CONTAINER);
    }

    private void open(LocalPlayer player) {
        if (player.containerMenu instanceof ChestMenu) {
            phase = Phase.FILL;
            return;
        }
        if (waited++ > OPEN_TIMEOUT) {
            stop("the chest is there but would not open");
            return;
        }
        if (waited % 20 != 1) return;
        Vec3 hit = Vec3.atCenterOf(where);
        Aim.at(player, hit);
        if (client.gameMode != null) {
            client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(hit, Direction.UP, where, false));
        }
    }

    /**
     * Get this pass's lines into the inventory, ready to be shifted across.
     *
     * Survival has nothing to do here — the whole point is that it moves what
     * you already carry. Creative conjures each line at exactly the size the
     * kit asked for, into a slot that was empty, so nothing you were holding is
     * overwritten and what lands in the chest is exact.
     */
    private void stock(LocalPlayer player) {
        wave.clear();
        if (!creative) {
            wave.addAll(outstanding.keySet());
            waited = 0;
            phase = Phase.OPEN;
            return;
        }
        List<String> unknown = new ArrayList<>();
        for (Map.Entry<String, Integer> line : outstanding.entrySet()) {
            int slot = freeSlot(player);
            if (slot < 0) break;
            // A name this version does not have is dropped rather than
            // retried: the pass after it would conjure nothing either, and
            // this loop comes back round for as long as anything is left.
            if (!conjure(player, slot, line.getKey(), line.getValue())) {
                unknown.add(line.getKey());
                continue;
            }
            wave.add(line.getKey());
        }
        for (String item : unknown) outstanding.remove(item);
        if (wave.isEmpty()) {
            // Nowhere to put anything: another pass would find the inventory
            // just as full, so this is the end rather than a retry.
            finish();
            return;
        }
        waited = 0;
        phase = Phase.OPEN;
    }

    /** An inventory slot with nothing in it, or -1. */
    private int freeSlot(LocalPlayer player) {
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            if (player.getInventory().getItem(slot).isEmpty()) return slot;
        }
        return -1;
    }

    /**
     * Move one line across, then come back next tick for the next.
     *
     * In creative the stack was conjured to exactly the size the kit asked for,
     * so what lands is exact. In survival there is no click that moves part of
     * a stack — the sequences that do exist take a second each and there are
     * sixteen lines — so whole stacks are moved while they fit under the
     * ceiling, and a stack that does not fit is left where it is. The chest
     * ends up under-filled rather than your pockets emptied, and the report
     * says which lines that happened to.
     */
    private void fill(LocalPlayer player) {
        AbstractContainerMenu menu = player.containerMenu;
        if (!(menu instanceof ChestMenu chest)) {
            // The screen went away under us — someone hit escape, or the chest
            // was broken. Not a failure worth a stack trace, but not a success.
            phase = Phase.CLOSE;
            return;
        }
        if (wave.isEmpty()) {
            phase = Phase.CLOSE;
            return;
        }

        String item = wave.getFirst();
        int ceiling = outstanding.getOrDefault(item, 0);
        int first = chest.getRowCount() * 9;
        Integer slot = ceiling <= 0 ? null : slotHolding(menu, first, item, ceiling);
        if (slot == null) {
            wave.removeFirst();
            outstanding.remove(item);
            return;
        }

        int moving = menu.slots.get(slot).getItem().getCount();
        if (client.gameMode != null) {
            client.gameMode.handleContainerInput(menu.containerId, slot, 0,
                    ContainerInput.QUICK_MOVE, player);
        }
        stocked.merge(item, moving, Integer::sum);
        int left = ceiling - moving;
        if (left > 0) {
            outstanding.put(item, left);
        } else {
            wave.removeFirst();
            outstanding.remove(item);
        }
        cooldown = MOVE_INTERVAL;
    }

    /**
     * A slot of the player's own inventory holding this, small enough to move.
     *
     * Smallest first, so a spare partial stack goes before a full one and the
     * ceiling is used up as closely as whole stacks allow.
     */
    private Integer slotHolding(AbstractContainerMenu menu, int first, String item, int ceiling) {
        Integer best = null;
        int smallest = Integer.MAX_VALUE;
        for (int slot = first; slot < menu.slots.size(); slot++) {
            Slot candidate = menu.slots.get(slot);
            ItemStack stack = candidate.getItem();
            if (!item.equals(Hotbar.nameOf(stack))) continue;
            int count = stack.getCount();
            if (count > ceiling || count >= smallest) continue;
            smallest = count;
            best = slot;
        }
        return best;
    }

    /**
     * In creative, put exactly the wanted number into an empty slot.
     *
     * The stack has to exist on the server as well as here or the shift-click
     * moves nothing, which is why this goes through handleCreativeModeItemAdd
     * rather than only writing to the local inventory. The slot number the
     * server wants is the one in the player's own screen handler, where the
     * hotbar sits after the main inventory rather than before it.
     */
    private boolean conjure(LocalPlayer player, int slot, String item, int count) {
        Item kind = itemNamed(item);
        if (kind == null || client.gameMode == null) return false;
        ItemStack stack = new ItemStack(kind, Math.min(count, kind.getDefaultMaxStackSize()));
        player.getInventory().setItem(slot, stack);
        client.gameMode.handleCreativeModeItemAdd(stack, inMenu(slot));
        return true;
    }

    /** An inventory index as the player's own screen handler numbers it. */
    private static int inMenu(int slot) {
        return slot < 9 ? HOTBAR_IN_MENU + slot : slot;
    }

    private static Item itemNamed(String name) {
        if (BY_NAME.isEmpty()) {
            for (Item item : BuiltInRegistries.ITEM) {
                BY_NAME.put(BuiltInRegistries.ITEM.getKey(item).getPath(), item);
            }
        }
        return BY_NAME.get(name);
    }

    private static final Map<String, Item> BY_NAME = new java.util.HashMap<>();

    /**
     * Another pass if there is more kit than there was room to carry at once,
     * and otherwise the report.
     */
    private void close() {
        closeScreen();
        if (creative && !outstanding.isEmpty()) {
            phase = Phase.STOCK;
            return;
        }
        finish();
    }

    private void finish() {
        closeScreen();
        phase = Phase.IDLE;
        if (stocked.isEmpty()) {
            report.accept("the chest is down but nothing would go in it");
            return;
        }
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, Integer> line : stocked.entrySet()) {
            parts.add(line.getValue() + " " + line.getKey());
        }
        report.accept("stashed: " + String.join(", ", parts));
        if (!shortOf.isEmpty()) {
            report.accept("none spare: " + String.join(", ", shortOf));
        }
        if (!outstanding.isEmpty()) {
            // A different problem from having none, and worth saying so: the
            // thing is in your inventory, in a stack too big to give away
            // without dipping under what has to stay with you. Nothing can be
            // done about it from here except tell you.
            report.accept("could not split a stack for: "
                    + String.join(", ", outstanding.keySet()));
        }
        report.accept("it is at " + where.getX() + " " + where.getY() + " " + where.getZ()
                + "; /stash where lists them");
    }

    private void closeScreen() {
        if (client.player != null && client.player.containerMenu instanceof ChestMenu) {
            client.player.closeContainer();
        }
    }

    /** Every stash it has put down in this world, nearest first. */
    public List<String> where() {
        LocalPlayer player = client.player;
        if (player == null) return List.of();
        List<Atlas.Sighting> known = new ArrayList<>(atlas.known(STASH));
        known.sort(java.util.Comparator.comparingDouble(
                s -> s.distanceTo(player.getBlockX(), player.getBlockY(), player.getBlockZ())));
        List<String> lines = new ArrayList<>();
        for (Atlas.Sighting sighting : known) {
            int away = (int) Math.round(sighting.distanceTo(
                    player.getBlockX(), player.getBlockY(), player.getBlockZ()));
            lines.add(sighting.x() + " " + sighting.y() + " " + sighting.z()
                    + "  —  " + away + " blocks away");
        }
        return lines;
    }
}

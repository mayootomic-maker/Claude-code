package dev.understudy.mc;

import dev.understudy.core.adapt.Timings;
import dev.understudy.core.sort.Category;
import dev.understudy.core.sort.Sorter;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Puts your things away.
 *
 * Opening a container is a round trip — you click it, and the screen arrives
 * some ticks later — so this is a state machine over ticks rather than a
 * function. Each chest is opened once: read what is in it, work out what
 * belongs there, shift the matching stacks across, close it, move on.
 *
 * Which category goes in which chest is decided in `core.sort`, away from all
 * of this, and it is sticky: a chest that already holds mostly ore stays the
 * ore chest, so running the command twice does not rearrange your base.
 */
public final class SortTask {

    private enum Phase { IDLE, SURVEY, WALK, OPEN, MOVE, CLOSE, DONE }

    private static final int SEARCH_RADIUS = 12;
    private static final double REACH = 3.5;
    private static final int OPEN_TIMEOUT = 60;
    private static final int MOVE_INTERVAL = 2;

    private final Minecraft client;
    private final TravelTask travel;
    private final Consumer<String> report;

    private Phase phase = Phase.IDLE;
    private final List<BlockPos> chests = new ArrayList<>();
    private final Map<Integer, List<Category>> assignment = new LinkedHashMap<>();
    private java.util.Set<String> keeping = java.util.Set.of();
    private int chestIndex;
    private int waited;
    private int cooldown;
    private int moved;
    private boolean keepKit = true;
    private final List<String> unplaced = new ArrayList<>();

    public SortTask(Minecraft client, TravelTask travel, Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.report = report;
    }

    public boolean running() {
        return phase != Phase.IDLE && phase != Phase.DONE;
    }

    public void start(boolean keepKit) {
        this.keepKit = keepKit;
        this.chests.clear();
        this.assignment.clear();
        this.unplaced.clear();
        this.chestIndex = 0;
        this.moved = 0;
        this.phase = Phase.SURVEY;
    }

    public void stop(String why) {
        if (!running()) return;
        closeScreen();
        phase = Phase.IDLE;
        if (why != null) report.accept(why);
    }

    public Timings.Phase phase() {
        return phase == Phase.WALK ? Timings.Phase.TRAVELLING : Timings.Phase.HANDLING;
    }

    public void tick() {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop(null);
            return;
        }
        if (cooldown-- > 0) return;

        switch (phase) {
            case SURVEY -> survey(player);
            case WALK -> walk(player);
            case OPEN -> open(player);
            case MOVE -> move(player);
            case CLOSE -> close();
            default -> { }
        }
    }

    /** Find the chests, read them, and decide what belongs where. */
    private void survey(LocalPlayer player) {
        BlockPos here = player.blockPosition();
        for (BlockPos pos : BlockPos.withinManhattan(here, SEARCH_RADIUS, SEARCH_RADIUS / 2, SEARCH_RADIUS)) {
            BlockState state = client.level.getBlockState(pos);
            String name = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
            if (!name.endsWith("chest") && !name.endsWith("barrel")) continue;
            // The two halves of a double chest are two blocks and one container.
            // Counting both gave them different categories, each of which then
            // filled the same box with the other's things.
            if (halfOfOneAlreadyFound(pos)) continue;
            chests.add(pos.immutable());
        }
        if (chests.isEmpty()) {
            phase = Phase.IDLE;
            report.accept("no chests nearby");
            return;
        }

        // Read what is already in each chest, so the assignment can be sticky.
        List<Sorter.ChestView> views = new ArrayList<>();
        for (int i = 0; i < chests.size(); i++) {
            views.add(new Sorter.ChestView(i, peek(chests.get(i)), 27));
        }
        Map<String, Integer> carried = carrying(player);
        Sorter.Plan plan = Sorter.plan(carried, views, keepKit);
        assignment.putAll(plan.assignment());
        unplaced.addAll(plan.unplaced());
        // Worked out once, from the whole inventory, so the best pickaxe stays
        // and the three worse ones go. Deciding it per stack cannot see that.
        keeping = keepKit ? Sorter.keepBack(carried) : java.util.Set.of();

        if (plan.isEmpty()) {
            phase = Phase.IDLE;
            report.accept("nothing to put away");
            return;
        }
        report.accept("sorting " + plan.itemsMoved() + " items into "
                + assignment.size() + (assignment.size() == 1 ? " chest" : " chests"));
        phase = Phase.WALK;
    }

    /**
     * Read a chest without opening it.
     *
     * The client keeps a block entity for every loaded container, and for
     * chests the server sends the contents. Where it does not, this comes back
     * empty and the chest is simply treated as unclassified — which is the
     * right answer, not a failure.
     */
    private Map<String, Integer> peek(BlockPos pos) {
        Map<String, Integer> out = new LinkedHashMap<>();
        BlockEntity entity = client.level.getBlockEntity(pos);
        if (entity instanceof net.minecraft.world.Container inventory) {
            for (int i = 0; i < inventory.getContainerSize(); i++) {
                ItemStack stack = inventory.getItem(i);
                String name = Hotbar.nameOf(stack);
                if (name != null) out.merge(name, stack.getCount(), Integer::sum);
            }
        }
        return out;
    }

    /**
     * Whether the other half of this chest is already on the list.
     *
     * Only chests pair up, and only along one axis, so the two blocks either
     * side are the whole question.
     */
    private boolean halfOfOneAlreadyFound(BlockPos pos) {
        for (Direction direction : Direction.Plane.HORIZONTAL) {
            if (chests.contains(pos.relative(direction))) {
                String neighbour = BuiltInRegistries.BLOCK
                        .getKey(client.level.getBlockState(pos.relative(direction)).getBlock())
                        .getPath();
                if (neighbour.endsWith("chest")) return true;
            }
        }
        return false;
    }

    private Map<String, Integer> carrying(LocalPlayer player) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            String name = Hotbar.nameOf(stack);
            if (name != null) out.merge(name, stack.getCount(), Integer::sum);
        }
        return out;
    }

    private void walk(LocalPlayer player) {
        if (chestIndex >= chests.size()) {
            finish();
            return;
        }
        if (!assignment.containsKey(chestIndex)) {
            chestIndex++;
            return;
        }
        BlockPos chest = chests.get(chestIndex);
        if (Math.sqrt(player.blockPosition().distSqr(chest)) > REACH) {
            if (!travel.running()) travel.start(chest.above());
            return;
        }
        waited = 0;
        phase = Phase.OPEN;
    }

    private void open(LocalPlayer player) {
        BlockPos chest = chests.get(chestIndex);
        if (player.containerMenu instanceof ChestMenu) {
            phase = Phase.MOVE;
            return;
        }
        if (waited++ > OPEN_TIMEOUT) {
            report.accept("could not open the chest at " + chest.toShortString());
            chestIndex++;
            phase = Phase.WALK;
            return;
        }
        if (waited % 20 != 1) return; // one attempt a second, not one a tick

        Vec3 hit = Vec3.atCenterOf(chest);
        double dx = hit.x - player.getX();
        double dz = hit.z - player.getZ();
        Aim.at(player, Vec3.atCenterOf(chests.get(chestIndex)));
        if (client.gameMode != null) {
            client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(hit, Direction.UP, chest, false));
        }
    }

    /**
     * Shift-click everything that belongs in this chest.
     *
     * One stack per couple of ticks. Emptying a whole inventory in a single
     * tick is both a very loud tell and a good way to desynchronise from the
     * server's view of the container.
     */
    private void move(LocalPlayer player) {
        AbstractContainerMenu handler = player.containerMenu;
        if (!(handler instanceof ChestMenu container)) {
            phase = Phase.WALK;
            return;
        }
        List<Category> wanted = assignment.get(chestIndex);
        if (wanted == null || wanted.isEmpty()) {
            phase = Phase.CLOSE;
            return;
        }

        int containerSlots = container.getRowCount() * 9;
        for (int slot = containerSlots; slot < handler.slots.size(); slot++) {
            Slot s = handler.slots.get(slot);
            String name = Hotbar.nameOf(s.getItem());
            if (name == null) continue;
            if (!wanted.contains(Category.of(name))) continue;
            if (keeping.contains(name)) continue;

            if (client.gameMode != null) {
                client.gameMode.handleContainerInput(handler.containerId, slot, 0,
                        ContainerInput.QUICK_MOVE, player);
                moved++;
                cooldown = MOVE_INTERVAL;
            }
            return; // one stack per tick window
        }
        phase = Phase.CLOSE;
    }

    private void close() {
        closeScreen();
        chestIndex++;
        phase = Phase.WALK;
    }

    private void closeScreen() {
        if (client.player != null && client.player.containerMenu instanceof ChestMenu) {
            client.player.closeContainer();
        }
    }

    private void finish() {
        closeScreen();
        phase = Phase.IDLE;
        StringBuilder message = new StringBuilder("put away " + moved + " stacks");
        if (!unplaced.isEmpty()) {
            message.append(" — no chest for ").append(String.join(", ", unplaced));
        }
        report.accept(message.toString());
    }

    public String status() {
        return running() ? "sorting: chest " + (chestIndex + 1) + " of " + chests.size() : "idle";
    }
}

package dev.understudy.mc;

import dev.understudy.core.sort.Category;
import dev.understudy.core.sort.Sorter;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

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

    private final MinecraftClient client;
    private final TravelTask travel;
    private final Consumer<String> report;

    private Phase phase = Phase.IDLE;
    private final List<BlockPos> chests = new ArrayList<>();
    private final Map<Integer, Category> assignment = new LinkedHashMap<>();
    private int chestIndex;
    private int waited;
    private int cooldown;
    private int moved;
    private boolean keepKit = true;
    private final List<String> unplaced = new ArrayList<>();

    public SortTask(MinecraftClient client, TravelTask travel, Consumer<String> report) {
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

    public void tick() {
        ClientPlayerEntity player = client.player;
        if (player == null || client.world == null) {
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
    private void survey(ClientPlayerEntity player) {
        BlockPos here = player.getBlockPos();
        for (BlockPos pos : BlockPos.iterateOutwards(here, SEARCH_RADIUS, SEARCH_RADIUS / 2, SEARCH_RADIUS)) {
            BlockState state = client.world.getBlockState(pos);
            String name = state.getBlock().getTranslationKey();
            if (name.endsWith("chest") || name.endsWith("barrel")) {
                chests.add(pos.toImmutable());
            }
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
        Sorter.Plan plan = Sorter.plan(carrying(player), views, keepKit);
        assignment.putAll(plan.assignment());
        unplaced.addAll(plan.unplaced());

        if (plan.isEmpty()) {
            phase = Phase.IDLE;
            report.accept("nothing to put away");
            return;
        }
        report.accept("sorting into " + assignment.size() + " chests");
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
        BlockEntity entity = client.world.getBlockEntity(pos);
        if (entity instanceof net.minecraft.inventory.Inventory inventory) {
            for (int i = 0; i < inventory.size(); i++) {
                ItemStack stack = inventory.getStack(i);
                String name = Hotbar.nameOf(stack);
                if (name != null) out.merge(name, stack.getCount(), Integer::sum);
            }
        }
        return out;
    }

    private Map<String, Integer> carrying(ClientPlayerEntity player) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (int i = 0; i < player.getInventory().size(); i++) {
            ItemStack stack = player.getInventory().getStack(i);
            String name = Hotbar.nameOf(stack);
            if (name != null) out.merge(name, stack.getCount(), Integer::sum);
        }
        return out;
    }

    private void walk(ClientPlayerEntity player) {
        if (chestIndex >= chests.size()) {
            finish();
            return;
        }
        if (!assignment.containsKey(chestIndex)) {
            chestIndex++;
            return;
        }
        BlockPos chest = chests.get(chestIndex);
        if (Math.sqrt(player.getBlockPos().getSquaredDistance(chest)) > REACH) {
            if (!travel.running()) travel.start(chest.up());
            return;
        }
        waited = 0;
        phase = Phase.OPEN;
    }

    private void open(ClientPlayerEntity player) {
        BlockPos chest = chests.get(chestIndex);
        if (player.currentScreenHandler instanceof GenericContainerScreenHandler) {
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

        Vec3d hit = Vec3d.ofCenter(chest);
        double dx = hit.x - player.getX();
        double dz = hit.z - player.getZ();
        player.setYaw((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setPitch(20f);
        if (client.interactionManager != null) {
            client.interactionManager.interactBlock(player, Hand.MAIN_HAND,
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
    private void move(ClientPlayerEntity player) {
        ScreenHandler handler = player.currentScreenHandler;
        if (!(handler instanceof GenericContainerScreenHandler container)) {
            phase = Phase.WALK;
            return;
        }
        Category wanted = assignment.get(chestIndex);
        if (wanted == null) {
            phase = Phase.CLOSE;
            return;
        }

        int containerSlots = container.getRows() * 9;
        for (int slot = containerSlots; slot < handler.slots.size(); slot++) {
            Slot s = handler.slots.get(slot);
            String name = Hotbar.nameOf(s.getStack());
            if (name == null) continue;
            Category category = Category.of(name);
            if (category != wanted) continue;
            if (keepKit && Sorter.keep(name, category)) continue;

            if (client.interactionManager != null) {
                client.interactionManager.clickSlot(handler.syncId, slot, 0,
                        SlotActionType.QUICK_MOVE, player);
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
        if (client.player != null && client.player.currentScreenHandler instanceof GenericContainerScreenHandler) {
            client.player.closeHandledScreen();
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

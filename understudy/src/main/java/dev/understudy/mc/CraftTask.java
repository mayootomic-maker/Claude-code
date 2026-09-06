package dev.understudy.mc;

import dev.understudy.core.craft.Planner;
import dev.understudy.core.craft.Recipe;
import net.minecraft.client.ClientRecipeBook;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.recipebook.RecipeCollection;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.display.RecipeDisplayEntry;
import net.minecraft.world.item.crafting.display.RecipeDisplayId;
import net.minecraft.world.item.crafting.display.SlotDisplayContext;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.function.Consumer;

/**
 * Crafting, through the recipe book rather than by arranging a grid.
 *
 * handlePlaceRecipe is the whole reason this is tractable. Given a recipe id it
 * lays the ingredients out in the crafting grid itself, which means none of the
 * knowledge about which shape goes in which of the nine slots has to exist here
 * — and that knowledge is both large and exactly the sort of thing that changes
 * between versions. What is left is: open the right window, name the recipe,
 * take the result.
 *
 * Two windows, and the plan already knows which: a recipe the catalogue marks as
 * HAND fits the two-by-two in your own inventory, and anything else needs a
 * table, which means finding one nearby or putting one down.
 *
 * The result is taken with a shift-click rather than picked up and carried,
 * because a stack held by the cursor is dropped on the floor the moment
 * something closes the screen.
 */
public final class CraftTask {

    private static final double REACH = 4.0;
    /** How long to wait for the server to agree that the grid is full. */
    private static final int PLACE_TIMEOUT = 40;
    private static final int OPEN_TIMEOUT = 40;

    private enum Stage { IDLE, NEED_TABLE, OPENING, PLACING, TAKING }

    private final Minecraft client;
    private final Consumer<String> report;

    private Stage stage = Stage.IDLE;
    private Planner.Make job;
    private int waited;
    private int madeAtStart;
    private BlockPos table;

    public CraftTask(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean running() {
        return stage != Stage.IDLE;
    }

    /** Returns false when this is not something crafting can do at all. */
    public boolean start(Planner.Make make) {
        LocalPlayer player = client.player;
        if (player == null) return false;
        if (make.recipe().station() == Recipe.Station.FURNACE) return false; // smelting, not crafting

        job = make;
        madeAtStart = Hotbar.count(player, make.item());
        waited = 0;
        stage = make.recipe().station() == Recipe.Station.HAND ? Stage.OPENING : Stage.NEED_TABLE;
        return true;
    }

    public void stop() {
        stage = Stage.IDLE;
        job = null;
        table = null;
    }

    public void tick() {
        LocalPlayer player = client.player;
        if (stage == Stage.IDLE || player == null || client.gameMode == null) return;

        switch (stage) {
            case NEED_TABLE -> findOrPlaceTable(player);
            case OPENING -> open(player);
            case PLACING -> place(player);
            case TAKING -> take(player);
            default -> { }
        }
    }

    // --- finding somewhere to craft ------------------------------------------

    private void findOrPlaceTable(LocalPlayer player) {
        BlockPos found = nearestTable(player);
        if (found != null) {
            table = found;
            stage = Stage.OPENING;
            waited = 0;
            return;
        }
        if (Hotbar.count(player, "crafting_table") > 0 && Hotbar.hold(client, "crafting_table")) {
            BlockPos spot = spotBeside(player);
            if (spot != null && placeAt(player, spot)) {
                table = spot;
                stage = Stage.OPENING;
                waited = 0;
                return;
            }
        }
        fail("no crafting table nearby and none to put down");
    }

    private BlockPos nearestTable(LocalPlayer player) {
        BlockPos from = player.blockPosition();
        BlockPos best = null;
        double nearest = REACH * REACH;
        for (int dx = -4; dx <= 4; dx++) {
            for (int dy = -3; dy <= 3; dy++) {
                for (int dz = -4; dz <= 4; dz++) {
                    BlockPos at = from.offset(dx, dy, dz);
                    if (!isTable(at)) continue;
                    double distance = at.distSqr(from);
                    if (distance < nearest) {
                        nearest = distance;
                        best = at;
                    }
                }
            }
        }
        return best;
    }

    private boolean isTable(BlockPos at) {
        if (client.level == null) return false;
        BlockState state = client.level.getBlockState(at);
        return !state.isAir()
                && BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath().equals("crafting_table");
    }

    /** Somewhere within arm's reach with air above it and ground under it. */
    private BlockPos spotBeside(LocalPlayer player) {
        BlockPos feet = player.blockPosition();
        for (Direction direction : Direction.Plane.HORIZONTAL) {
            BlockPos at = feet.relative(direction);
            if (client.level == null) return null;
            if (client.level.getBlockState(at).isAir()
                    && client.level.getBlockState(at.above()).isAir()
                    && !client.level.getBlockState(at.below()).isAir()) {
                return at;
            }
        }
        return null;
    }

    private boolean placeAt(LocalPlayer player, BlockPos at) {
        BlockPos under = at.below();
        Vec3 hit = Vec3.atCenterOf(under).add(0, 0.5, 0);
        lookAt(player, hit);
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                new BlockHitResult(hit, Direction.UP, under, false));
        player.swing(InteractionHand.MAIN_HAND);
        return isTable(at);
    }

    // --- the crafting itself -------------------------------------------------

    private void open(LocalPlayer player) {
        if (craftingMenu(player) != null) {
            stage = Stage.PLACING;
            waited = 0;
            return;
        }
        if (waited++ > OPEN_TIMEOUT) {
            fail("could not open anywhere to craft");
            return;
        }
        if (waited > 1) return; // one attempt, then wait for the screen to arrive

        if (table != null) {
            Vec3 hit = Vec3.atCenterOf(table);
            lookAt(player, hit);
            client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(hit, Direction.UP, table, false));
        }
    }

    private void place(LocalPlayer player) {
        AbstractContainerMenu menu = craftingMenu(player);
        if (menu == null) {
            fail("the crafting window closed");
            return;
        }
        if (waited++ == 0) {
            RecipeDisplayId recipe = findRecipe(player, job.item());
            if (recipe == null) {
                fail("no recipe for " + job.item() + " that you have learned yet");
                return;
            }
            // makeAll fills the grid as many times as the ingredients allow,
            // which is one round trip instead of one per item.
            client.gameMode.handlePlaceRecipe(menu.containerId, recipe, true);
            return;
        }
        if (!resultOf(menu).isEmpty()) {
            stage = Stage.TAKING;
            waited = 0;
            return;
        }
        if (waited > PLACE_TIMEOUT) fail("the grid never filled — probably short of an ingredient");
    }

    private void take(LocalPlayer player) {
        AbstractContainerMenu menu = craftingMenu(player);
        if (menu == null) {
            finish(player);
            return;
        }
        if (resultOf(menu).isEmpty()) {
            // Nothing left to take. Either it is done or there was only one batch.
            client.player.clientSideCloseContainer();
            finish(player);
            return;
        }
        // Shift-click: taking the stack onto the cursor instead would drop it on
        // the floor the moment anything closed the screen.
        client.gameMode.handleContainerInput(menu.containerId, resultSlot(menu), 0,
                ContainerInput.QUICK_MOVE, player);
        if (++waited > PLACE_TIMEOUT) {
            client.player.clientSideCloseContainer();
            finish(player);
        }
    }

    private void finish(LocalPlayer player) {
        int made = Hotbar.count(player, job.item()) - madeAtStart;
        report.accept(made > 0
                ? "crafted " + made + " " + job.item()
                : "could not craft " + job.item());
        stop();
    }

    private void fail(String why) {
        report.accept("crafting " + (job == null ? "" : job.item()) + ": " + why);
        stop();
    }

    // --- the bits that poke at Minecraft -------------------------------------

    /**
     * The window a recipe can be placed into, or null if it is not open yet.
     *
     * No screen has to be showing for the two-by-two. The player's own
     * inventory menu is always active, and what the server acts on is the
     * packet naming its container, not whether anybody is looking at it — so
     * a hand recipe does not interrupt what you were doing to open a menu at
     * you. Asking the game which screen is up would also mean depending on a
     * field whose name changed in this version, and this does not need to know.
     */
    private AbstractContainerMenu craftingMenu(LocalPlayer player) {
        AbstractContainerMenu menu = player.containerMenu;
        if (menu instanceof CraftingMenu) return menu;
        if (job != null && job.recipe().station() == Recipe.Station.HAND
                && menu == player.inventoryMenu) {
            return menu;
        }
        return null;
    }

    /** Where the finished item appears. Slot zero in the inventory's own grid. */
    private static int resultSlot(AbstractContainerMenu menu) {
        return menu instanceof CraftingMenu crafting ? crafting.getResultSlot().index : 0;
    }

    private static ItemStack resultOf(AbstractContainerMenu menu) {
        return menu.getSlot(resultSlot(menu)).getItem();
    }

    /**
     * The id of a learned recipe that makes this item.
     *
     * The recipe book is the client's own list of what it knows how to make, so
     * anything it does not contain is something the server has not taught the
     * player yet — which is a real answer and not a failure to look properly.
     */
    private RecipeDisplayId findRecipe(LocalPlayer player, String item) {
        ClientRecipeBook book = player.getRecipeBook();
        var context = SlotDisplayContext.fromLevel(client.level);
        for (RecipeCollection collection : book.getCollections()) {
            for (RecipeDisplayEntry entry : collection.getRecipes()) {
                for (ItemStack result : entry.display().result().resolveForStacks(context)) {
                    if (item.equals(Hotbar.nameOf(result))) return entry.id();
                }
            }
        }
        return null;
    }

    private void lookAt(LocalPlayer player, Vec3 at) {
        double dx = at.x - player.getX();
        double dy = at.y - (player.getY() + player.getEyeHeight());
        double dz = at.z - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYRot((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setXRot((float) -Math.toDegrees(Math.atan2(dy, horizontal)));
    }
}

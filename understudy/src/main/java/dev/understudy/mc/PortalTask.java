package dev.understudy.mc;

import dev.understudy.core.memory.Atlas;
import dev.understudy.core.nether.Portal;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.function.Consumer;

/**
 * Going to the Nether and coming back.
 *
 * Deliberately left undone for a long time, for a reason that was real: the
 * pathfinder treated only *source* lava as dangerous, and the Nether is sheets
 * of flowing lava over solid ground. The search called that a floor. Fixing
 * that in ClientBlockView is what made the rest of this safe to write, and it
 * is the part that matters most — everything below is only the ceremony.
 *
 * The ceremony has four steps and the mod already knew three of them:
 *
 *  - **Find one.** A portal already lit nearby, or one written down from last
 *    time. Cheapest by far, and after the first trip it is always this.
 *  - **Build one.** Ten obsidian in a frame, which is a blueprint, which means
 *    the site picker, the gatherer and the builder all work on it unchanged.
 *  - **Light it.** Flint and steel against the bottom of the opening. The one
 *    genuinely new action, and it is a right-click.
 *  - **Walk in.** The one thing that could not be done the usual way. A lit
 *    portal is a hazard as far as the router is concerned — quite rightly, or
 *    every path across a base would go through the front door of one — so
 *    stepping through has to be deliberate: stand in front of it, hold forward,
 *    wait for the world to change underneath you.
 *
 * Both ends are written into the atlas as they are used, which is what makes
 * the second trip a walk to a known door rather than this whole dance again.
 */
public final class PortalTask {

    /** What the atlas calls a portal, so both dimensions can look one up. */
    public static final String PORTAL = "portal";

    /** How far to look for one already standing. Beyond this, build. */
    private static final int LOOK = 48;
    /** Ticks of walking into it before admitting it is not taking. */
    private static final int PATIENCE = 200;
    /** Long enough for the builder to place ten blocks, including fetching them. */
    private static final int FRAME_PATIENCE = 20 * 60 * 10;

    private enum Step { OFF, RAISING, WALKING, LIGHTING, ENTERING }

    private final Minecraft client;
    private final TravelTask travel;
    private final Atlas atlas;
    private final Consumer<String> report;

    private Step step = Step.OFF;
    private BlockPos portal;
    private int waited;
    private String cameFrom = "";

    public PortalTask(Minecraft client, TravelTask travel, Atlas atlas, Consumer<String> report) {
        this.client = client;
        this.travel = travel;
        this.atlas = atlas;
        this.report = report;
    }

    public boolean running() {
        return step != Step.OFF;
    }

    public void stop(String why) {
        if (step == Step.OFF) return;
        step = Step.OFF;
        Keys.releaseAll();
        if (why != null) report.accept(why);
    }

    /**
     * Go through the nearest portal, building one if there is none.
     *
     * The same command both ways, because it is the same act: a portal in the
     * Nether leads to the overworld and one in the overworld leads to the
     * Nether, and which you get is decided by where you are standing rather
     * than by what you typed.
     */
    public void start() {
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            report.accept("not in a world yet");
            return;
        }
        cameFrom = client.level.dimension().identifier().getPath();

        BlockPos found = nearestPortal(player);
        if (found == null) {
            report.accept("no portal alight near here");
            return;
        }
        goTo(found);
    }

    /** Whether there is one to walk into, so the caller knows to offer to build. */
    public boolean oneNearby() {
        return client.player != null && nearestPortal(client.player) != null;
    }

    /** What a frame would cost, said before any of it is dug. */
    public String shoppingList(LocalPlayer player) {
        int have = Hotbar.count(player, "obsidian");
        boolean lighter = Hotbar.count(player, "flint_and_steel") > 0;
        if (have >= Portal.OBSIDIAN && lighter) return null;

        // As a list rather than one at a time: finding out about the flint and
        // steel after mining ten obsidian is worse than hearing both now.
        StringBuilder missing = new StringBuilder();
        if (have < Portal.OBSIDIAN) {
            missing.append(Portal.OBSIDIAN - have).append(" more obsidian");
        }
        if (!lighter) {
            if (missing.length() > 0) missing.append(" and ");
            missing.append("flint and steel");
        }
        return missing.toString();
    }

    /**
     * The frame is going up here; light it when it is finished and step through.
     *
     * Given the blueprint as the site picker turned it rather than as it was
     * designed, because the opening moves when the frame does and the fire has
     * to go in the opening.
     */
    public void lightWhenBuilt(dev.understudy.core.build.Blueprint frame, BlockPos origin) {
        if (client.level == null) return;
        cameFrom = client.level.dimension().identifier().getPath();
        portal = origin.offset(frame.entranceX(), frame.entranceY(), frame.entranceZ());
        step = Step.RAISING;
        waited = 0;
        report.accept("building the frame — I will light it and step through when it is up");
    }

    private void goTo(BlockPos found) {
        portal = found;
        step = Step.WALKING;
        report.accept("portal at " + found.toShortString() + " — going through");
        travel.start(inFrontOf(found));
    }

    /**
     * Where a portal comes out on the other side, before going anywhere.
     *
     * Worth knowing first rather than after: the two worlds are the same map at
     * different scales, so a portal built here lands somewhere specific over
     * there, and "somewhere specific" is occasionally inside a lava lake.
     */
    public String otherSide(LocalPlayer player) {
        boolean down = !Worlds.inTheNether(client.level);
        int[] there = Portal.across(player.getBlockX(), player.getBlockZ(), down);
        return (down ? "the nether" : "the overworld") + " around "
                + there[0] + ", " + there[1];
    }

    public void tick() {
        if (step == Step.OFF) return;
        LocalPlayer player = client.player;
        if (player == null || client.level == null) {
            stop("lost the world");
            return;
        }

        // The world changed underneath us, which is the whole point.
        if (!client.level.dimension().identifier().getPath().equals(cameFrom)) {
            arrived(player);
            return;
        }

        switch (step) {
            case RAISING -> {
                if (++waited > FRAME_PATIENCE) {
                    stop("the frame never went up");
                    return;
                }
                // The obsidian under the opening is the last thing to check
                // because it is the thing the fire is struck against.
                if (!isObsidian(portal.below())) return;
                waited = 0;
                step = Step.WALKING;
                travel.start(inFrontOf(portal));
            }
            case WALKING -> {
                if (travel.running()) return;
                step = lit(portal) ? Step.ENTERING : Step.LIGHTING;
                waited = 0;
            }
            case LIGHTING -> {
                if (lit(portal)) {
                    step = Step.ENTERING;
                    waited = 0;
                    return;
                }
                if (++waited > PATIENCE) {
                    stop("could not light it — is the frame complete?");
                    return;
                }
                light(player);
            }
            case ENTERING -> {
                if (++waited > PATIENCE) {
                    stop("stood in the portal and nothing happened");
                    return;
                }
                walkIn(player);
            }
            default -> { }
        }
    }

    /** Through. Write both doors down and let go of everything. */
    private void arrived(LocalPlayer player) {
        Keys.releaseAll();
        step = Step.OFF;
        if (atlas != null) {
            atlas.saw(PORTAL, player.getBlockX(), player.getBlockY(), player.getBlockZ(),
                    client.level.getGameTime());
        }
        report.accept("through — " + client.level.dimension().identifier().getPath()
                + " at " + player.getBlockX() + ", " + player.getBlockZ());
        if (Worlds.inTheNether(client.level)) {
            report.accept("every block here is eight up there — /travel is cheap now, "
                    + "and I will not sleep or path through lava");
        }
    }

    /** A lit portal block near the player, or null. */
    private BlockPos nearestPortal(LocalPlayer player) {
        BlockPos from = player.blockPosition();
        BlockPos best = null;
        double nearest = Double.MAX_VALUE;
        for (int dx = -LOOK; dx <= LOOK; dx++) {
            for (int dz = -LOOK; dz <= LOOK; dz++) {
                for (int dy = -16; dy <= 16; dy++) {
                    BlockPos at = from.offset(dx, dy, dz);
                    if (!lit(at)) continue;
                    double gap = from.distSqr(at);
                    if (gap < nearest) {
                        nearest = gap;
                        best = at;
                    }
                }
            }
        }
        return best;
    }

    private boolean isObsidian(BlockPos at) {
        if (client.level == null) return false;
        BlockState state = client.level.getBlockState(at);
        return !state.isAir()
                && BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath().equals("obsidian");
    }

    private boolean lit(BlockPos at) {
        if (at == null || client.level == null) return false;
        BlockState state = client.level.getBlockState(at);
        return !state.isAir()
                && BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath().equals("nether_portal");
    }

    /**
     * A block to stand on beside the portal.
     *
     * Beside rather than in, because the router will not path into one and
     * should not: a portal in the middle of a base would otherwise swallow
     * every journey that passed it.
     */
    private BlockPos inFrontOf(BlockPos at) {
        for (Direction side : Direction.Plane.HORIZONTAL) {
            BlockPos spot = at.relative(side);
            if (lit(spot)) continue;
            ClientBlockView view = new ClientBlockView(client.level);
            if (view.passable(spot.getX(), spot.getY(), spot.getZ())
                    && view.passable(spot.getX(), spot.getY() + 1, spot.getZ())
                    && view.solid(spot.getX(), spot.getY() - 1, spot.getZ())) {
                return spot;
            }
        }
        return at.relative(Direction.NORTH);
    }

    /** Flint and steel against the bottom of the opening. */
    private void light(LocalPlayer player) {
        if (client.gameMode == null) return;
        if (!Hotbar.hold(client, "flint_and_steel")) {
            stop("no flint and steel to light it with");
            return;
        }
        // The fire goes on top of the obsidian under the opening, so the block
        // to click is that one and the face is its top.
        BlockPos floor = portal.below();
        Vec3 hit = Vec3.atCenterOf(floor).add(0, 0.5, 0);
        Aim.at(player, hit);
        if (!Aim.onTarget()) return;
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                new BlockHitResult(hit, Direction.UP, floor, false));
        player.swing(InteractionHand.MAIN_HAND);
    }

    /**
     * Lean into it until the world changes.
     *
     * Four seconds of standing in a portal in survival, which is why this is a
     * held key and a wait rather than a step and a check.
     */
    private void walkIn(LocalPlayer player) {
        Aim.at(player, Vec3.atCenterOf(portal));
        Keys.set(client.options.keyUp, true);
    }
}

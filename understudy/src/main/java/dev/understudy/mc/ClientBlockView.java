package dev.understudy.mc;

import dev.understudy.core.path.BlockView;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.BlockPos;

import java.util.Set;

/**
 * Answers the pathfinder's four questions from the client's own copy of the
 * world.
 *
 * Deliberately the only file that knows both about Minecraft and about the
 * search. Everything interesting lives in `core.path`, which is testable
 * against a hand-built voxel world; this is the dull adapter that makes the
 * real world look like that one.
 */
public final class ClientBlockView implements BlockView {

    /** Blocks that hurt to stand in, or that ruin a route in other ways. */
    private static final Set<String> HAZARDS = Set.of(
            "lava", "fire", "soul_fire", "magma_block", "cactus", "sweet_berry_bush",
            "powder_snow", "campfire", "soul_campfire", "wither_rose", "pointed_dripstone",
            "end_portal", "nether_portal");

    private final ClientLevel world;
    private final BlockPos.Mutable cursor = new BlockPos.Mutable();

    public ClientBlockView(ClientLevel world) {
        this.world = world;
    }

    private BlockState stateAt(int x, int y, int z) {
        return world.getBlockState(cursor.set(x, y, z));
    }

    @Override
    public boolean passable(int x, int y, int z) {
        BlockState state = stateAt(x, y, z);
        if (state.isAir()) return true;
        if (!state.getFluidState().isEmpty()) return true;
        // Collision shape rather than a block list: it is the same question the
        // game asks when it decides whether you walk into something, so tall
        // grass, torches, signs and open doors all come out right for free.
        return state.getCollisionShape(world, cursor.set(x, y, z)).isEmpty();
    }

    @Override
    public boolean solid(int x, int y, int z) {
        BlockState state = stateAt(x, y, z);
        if (state.isAir()) return false;
        if (!state.getFluidState().isEmpty()) return false;
        return !state.getCollisionShape(world, cursor.set(x, y, z)).isEmpty();
    }

    @Override
    public boolean hazard(int x, int y, int z) {
        BlockState state = stateAt(x, y, z);
        if (!state.getFluidState().isEmpty() && state.getFluidState().isSource()) {
            String fluid = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath();
            if (fluid.contains("lava")) return true;
        }
        return HAZARDS.contains(BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath());
    }

    @Override
    public boolean liquid(int x, int y, int z) {
        return !stateAt(x, y, z).getFluidState().isEmpty();
    }

    @Override
    public double breakSeconds(int x, int y, int z) {
        BlockState state = stateAt(x, y, z);
        if (state.isAir()) return -1;
        float hardness = state.getDestroySpeed(world, cursor.set(x, y, z));
        // Negative hardness is bedrock and friends: not breakable at any speed.
        if (hardness < 0) return -1;
        // A rough seconds-per-block. The exact figure depends on the held tool,
        // and getting it wrong only makes a route slightly mis-priced, so an
        // approximation from hardness is enough for choosing between routes.
        return Math.max(0.05, hardness * 1.5);
    }

    @Override
    public boolean known(int x, int y, int z) {
        // Never path into terrain the client has not received: the blocks would
        // read as air and the route would walk confidently into a hillside.
        // getTopY() takes a heightmap and coordinates in this version; the
        // world's own vertical extent is the bottom plus its height.
        return world.hasChunk(x >> 4, z >> 4)
                && y >= world.getMinY()
                && y < world.getMinY() + world.getHeight();
    }
}

package dev.understudy.mc;

import dev.understudy.core.path.PathFinder;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

import java.util.ArrayList;
import java.util.List;

/**
 * Checks each thing the mod needs, and says which one is broken.
 *
 * "It does not work" is not something anyone can act on, and from here I cannot
 * watch it fail. So the mod checks itself: is there a world, can the pathfinder
 * see the ground underfoot, does a short search return a route, do the movement
 * keys actually register as pressed. Each answer is a different bug.
 *
 * The results go to the overlay and the log rather than to chat, because chat
 * being unreadable is one of the things this is diagnosing.
 */
public final class SelfTest {
    private SelfTest() {}

    public static List<String> run(Minecraft client) {
        List<String> out = new ArrayList<>();
        LocalPlayer player = client.player;

        if (player == null || client.world == null) {
            out.add("FAIL no world or player — join a world first");
            return out;
        }
        out.add("OK   in a world at " + player.getBlockPos().toShortString());

        // Can the pathfinder read the world at all?
        ClientBlockView view = new ClientBlockView(client.world);
        BlockPos feet = player.getBlockPos();
        boolean groundBelow = view.solid(feet.getX(), feet.getY() - 1, feet.getZ());
        boolean spaceAtFeet = view.passable(feet.getX(), feet.getY(), feet.getZ());
        boolean chunkKnown = view.known(feet.getX(), feet.getY(), feet.getZ());
        out.add((chunkKnown ? "OK  " : "FAIL") + " chunk under you is loaded");
        out.add((groundBelow ? "OK  " : "WARN") + " solid ground below you");
        out.add((spaceAtFeet ? "OK  " : "WARN") + " space where you are standing");

        // Does a short search return anything?
        PathFinder.Options options = new PathFinder.Options();
        options.allowDig = false;
        options.allowBridge = false;
        options.budget = 4_000;
        BlockPos near = feet.add(8, 0, 8);
        PathFinder.Result result = new PathFinder(view, options)
                .find(feet.getX(), feet.getY(), feet.getZ(), near.getX(), near.getY(), near.getZ());
        out.add((result.empty() ? "FAIL" : "OK  ") + " pathfinder: " + result.steps().size()
                + " steps, " + result.expanded() + " nodes"
                + (result.complete() ? ", complete" : ", partial"));

        // Do the movement keys take a write? This is the one that decides
        // whether walking can work at all.
        boolean before = client.options.keyUp.isDown();
        client.options.keyUp.setDown(true);
        boolean took = client.options.keyUp.isDown();
        client.options.keyUp.setDown(before);
        out.add((took ? "OK  " : "FAIL") + " movement keys accept input");

        // And the settings that decide whether you can see anything.
        List<String> chat = ChatFix.problems(client);
        if (chat.isEmpty()) {
            out.add("OK   chat settings look fine");
        } else {
            for (String problem : chat) out.add("WARN " + problem);
        }
        return out;
    }
}

package dev.understudy.mc;

import net.minecraft.client.KeyMapping;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/**
 * The movement keys, but only the ones the mod is actually holding.
 *
 * A key mapping is one shared switch between the mod and the human at the
 * keyboard, and it has no memory of who last flipped it. That is fine while the
 * mod is walking somewhere and nobody is touching the keys. It is not fine the
 * moment the mod decides to let go: `setDown(false)` on a key you are holding
 * down puts it up, and it stays up, because the game only notices a key again
 * when it is pressed afresh. You end up leaning on W with the character
 * standing still, which is exactly as bad as it sounds if something is hitting
 * you at the time.
 *
 * So every press the mod makes is recorded here, and a release only touches
 * keys that are in that set. Anything the player is holding is left alone,
 * because as far as this is concerned the mod never pressed it.
 */
public final class Keys {
    private Keys() {}

    /** Identity, not equality: two mappings are the same key or they are not. */
    private static final Set<KeyMapping> ours =
            Collections.newSetFromMap(new IdentityHashMap<>());

    public static void set(KeyMapping key, boolean down) {
        if (down) {
            key.setDown(true);
            ours.add(key);
        } else if (ours.remove(key)) {
            key.setDown(false);
        }
    }

    /** Let go of everything the mod is holding, and nothing else. */
    public static void releaseAll() {
        for (KeyMapping key : ours) key.setDown(false);
        ours.clear();
    }

    /** Whether the mod is currently holding anything down. */
    public static boolean holding() {
        return !ours.isEmpty();
    }
}

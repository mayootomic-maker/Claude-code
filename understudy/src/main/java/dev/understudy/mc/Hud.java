package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Says what the mod is doing somewhere chat settings cannot hide it.
 *
 * This exists because chat turned out to be an unreliable place to talk. If a
 * player's chat is set to commands-only, or opacity is at zero, or the client
 * is dropping unsigned messages, then a mod that reports through chat is
 * indistinguishable from a mod that does nothing — which is exactly the
 * failure this project hit. The overlay line above the hotbar obeys none of
 * those settings.
 *
 * It draws through the game's own overlay message rather than painting to the
 * screen directly. Minecraft 26 moved rendering to an extract-and-submit model
 * with no stable drawing surface for a mod to scribble on, and the overlay is
 * both the supported route and the one that looks native. It also costs no
 * screen space when there is nothing to say.
 *
 * The overlay fades after a few seconds, so a long-running status is re-sent
 * from the tick loop; a one-off message wins until it has had its time.
 */
public final class Hud {

    private static final int MAX_LINES = 6;
    /** Lines older than this stop being repeated. */
    private static final long LINE_LIFETIME_MS = 6_000;
    /** Well inside the vanilla fade, so a status never visibly blinks out. */
    private static final int REFRESH_TICKS = 40;

    private record Line(String text, long at, boolean warning) {}

    private static final Deque<Line> lines = new ArrayDeque<>();
    private static String status = "";
    private static boolean enabled = true;
    private static int sinceRefresh = 0;

    private Hud() {}

    public static void setStatus(String text) {
        status = text == null ? "" : text;
        sinceRefresh = REFRESH_TICKS; // show it now rather than up to two seconds late
    }

    public static void say(String text) {
        add(text, false);
    }

    public static void warn(String text) {
        add(text, true);
    }

    private static synchronized void add(String text, boolean warning) {
        lines.addLast(new Line(text, System.currentTimeMillis(), warning));
        while (lines.size() > MAX_LINES) lines.removeFirst();
        sinceRefresh = REFRESH_TICKS;
    }

    public static synchronized void clear() {
        lines.clear();
        status = "";
    }

    public static void setEnabled(boolean value) {
        enabled = value;
    }

    public static boolean enabled() {
        return enabled;
    }

    /** Called every client tick. Cheap: it sends nothing on most of them. */
    public static synchronized void tick() {
        if (!enabled) return;
        Minecraft client = Minecraft.getInstance();
        if (client.player == null) return;

        long now = System.currentTimeMillis();
        lines.removeIf(line -> now - line.at() > LINE_LIFETIME_MS);

        if (++sinceRefresh < REFRESH_TICKS) return;
        sinceRefresh = 0;

        // The newest message outranks the status: a warning that scrolled past
        // in chat is the thing most worth putting in front of someone.
        Line latest = lines.peekLast();
        String text;
        if (latest != null) {
            text = (latest.warning() ? "§c" : "§f") + latest.text();
        } else if (!status.isEmpty()) {
            text = "§b" + status;
        } else {
            return;
        }
        client.player.sendOverlayMessage(Component.literal("§8[§bunderstudy§8] §r" + text));
    }
}

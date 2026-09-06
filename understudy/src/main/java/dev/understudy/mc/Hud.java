package dev.understudy.mc;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Draws what the mod is doing straight onto the screen.
 *
 * This exists because chat turned out to be an unreliable place to talk. If a
 * player's chat is set to commands-only, or opacity is at zero, or the client
 * is dropping unsigned messages, then a mod that reports through chat is
 * indistinguishable from a mod that does nothing — which is exactly the
 * failure this project hit. The overlay does not care about any of those
 * settings.
 *
 * It draws nothing at all when there is nothing to say, so it costs no screen
 * space in normal play.
 */
public final class Hud {

    private static final int MAX_LINES = 6;
    /** Lines older than this stop being drawn. */
    private static final long LINE_LIFETIME_MS = 20_000;

    private record Line(String text, long at, boolean warning) {}

    private static final Deque<Line> lines = new ArrayDeque<>();
    private static String status = "";
    private static boolean enabled = true;

    private Hud() {}

    public static void register() {
        HudRenderCallback.EVENT.register(Hud::render);
    }

    public static void setStatus(String text) {
        status = text == null ? "" : text;
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

    private static synchronized void render(DrawContext context, Object tickCounter) {
        if (!enabled) return;
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.options.hudHidden) return;

        long now = System.currentTimeMillis();
        lines.removeIf(line -> now - line.at() > LINE_LIFETIME_MS);
        if (lines.isEmpty() && status.isEmpty()) return;

        int x = 4;
        int y = 4;
        context.drawTextWithShadow(client.textRenderer, "understudy", x, y, 0x55FFFF);
        y += 11;

        if (!status.isEmpty()) {
            context.drawTextWithShadow(client.textRenderer, status, x, y, 0xFFFFFF);
            y += 10;
        }
        for (Line line : lines) {
            context.drawTextWithShadow(client.textRenderer, line.text(), x, y,
                    line.warning() ? 0xFF5555 : 0xAAAAAA);
            y += 10;
        }
    }
}

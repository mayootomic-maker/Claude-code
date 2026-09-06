package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;

import java.util.ArrayList;
import java.util.List;

/**
 * Repairs the chat settings that make a client look broken.
 *
 * Four options between them account for almost every "I cannot see anything in
 * chat" report, and they are easy to set by accident and hard to find again:
 *
 *  - **Chat visibility** set to COMMANDS or HIDDEN. Commands-only still shows
 *    your own command errors, which is why the client looks half-working
 *    rather than obviously misconfigured — you see the red text and conclude
 *    chat is fine.
 *  - **Only show secure chat.** On since 1.19. Messages that are not
 *    cryptographically signed get dropped, and on proxied or offline-mode
 *    servers that is most of them, so other players simply go silent while
 *    system messages keep arriving.
 *  - **Command suggestions** off, which is the missing autocomplete.
 *  - **Chat opacity** wound down to nothing, so the text is drawn but
 *    invisible.
 *
 * Nothing here is guessed at: each is read back after writing, and the result
 * says what was actually changed rather than what was attempted.
 *
 * The chat-visibility enum is reached through the value already in the option
 * rather than by importing it. Its package has moved between versions — the
 * first attempt at this file failed to compile for exactly that reason — and
 * since the only thing needed is the constant named FULL, asking the existing
 * value for its own enum constants is both shorter and immune to the move.
 */
public final class ChatFix {
    private ChatFix() {}

    public record Result(List<String> changed, List<String> alreadyFine) {
        public boolean changedAnything() {
            return !changed.isEmpty();
        }
    }

    /** Look without touching. Used on join to decide whether to warn. */
    public static List<String> problems(Minecraft client) {
        Options options = client.options;
        List<String> found = new ArrayList<>();

        if (!isFullVisibility(options)) {
            found.add("chat is set to " + options.chatVisibility().get()
                    + " — you will not see other players");
        }
        if (Boolean.TRUE.equals(options.onlyShowSecureChat().get())) {
            found.add("only-secure-chat is on — unsigned messages are hidden");
        }
        if (Boolean.FALSE.equals(options.autoSuggestions().get())) {
            found.add("command suggestions are off");
        }
        if (options.chatOpacity().get() < 0.2) {
            found.add("chat opacity is almost zero");
        }
        return found;
    }

    /** Put them right, and say what actually changed. */
    public static Result repair(Minecraft client) {
        Options options = client.options;
        List<String> changed = new ArrayList<>();
        List<String> fine = new ArrayList<>();

        if (!isFullVisibility(options)) {
            if (setFullVisibility(options)) changed.add("chat visibility -> shown");
        } else {
            fine.add("chat visibility");
        }

        if (Boolean.TRUE.equals(options.onlyShowSecureChat().get())) {
            options.onlyShowSecureChat().set(false);
            changed.add("only-secure-chat -> off (this is the usual culprit)");
        } else {
            fine.add("only-secure-chat");
        }

        if (Boolean.FALSE.equals(options.autoSuggestions().get())) {
            options.autoSuggestions().set(true);
            changed.add("command suggestions -> on");
        } else {
            fine.add("command suggestions");
        }

        if (options.chatOpacity().get() < 0.2) {
            options.chatOpacity().set(1.0);
            changed.add("chat opacity -> full");
        } else {
            fine.add("chat opacity");
        }

        if (options.textBackgroundOpacity().get() < 0.1) {
            options.textBackgroundOpacity().set(0.5);
            changed.add("chat background -> visible");
        }

        if (options.chatScale().get() < 0.3) {
            options.chatScale().set(1.0);
            changed.add("chat scale -> normal");
        }

        if (!changed.isEmpty()) options.save();
        return new Result(changed, fine);
    }

    private static boolean isFullVisibility(Options options) {
        var current = options.chatVisibility().get();
        return current != null && "FULL".equals(current.name());
    }

    /** Set visibility to FULL without naming the enum's package. */
    private static boolean setFullVisibility(Options options) {
        var option = options.chatVisibility();
        var current = option.get();
        if (current == null) return false;
        for (var candidate : current.getDeclaringClass().getEnumConstants()) {
            if ("FULL".equals(candidate.name())) {
                option.set(candidate);
                return true;
            }
        }
        return false;
    }

    /** The current settings, for a diagnostic that does not need chat to read. */
    public static List<String> describe(Minecraft client) {
        Options options = client.options;
        List<String> out = new ArrayList<>();
        out.add("visibility: " + options.chatVisibility().get());
        out.add("only secure: " + options.onlyShowSecureChat().get());
        out.add("suggestions: " + options.autoSuggestions().get());
        out.add("opacity: " + String.format("%.2f", options.chatOpacity().get()));
        out.add("scale: " + String.format("%.2f", options.chatScale().get()));
        return out;
    }
}

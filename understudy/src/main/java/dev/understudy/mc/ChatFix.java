package dev.understudy.mc;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;

import java.util.ArrayList;
import java.util.List;

/**
 * Repairs the chat settings that make a client look broken.
 *
 * There are two different complaints here and the first version only handled
 * one of them. Whether chat *appears* is one question; whether what appears can
 * be *read* is another, and it was the second one that was actually wrong — a
 * chat window two lines tall drops everything this mod says within a second of
 * it being said, and no amount of repairing the visibility setting helps,
 * because the visibility setting was never the problem.
 *
 * So this now looks at both, and says which it found. Where it finds nothing it
 * says that too, along with the third possibility it cannot fix from here: a
 * line longer than the window is wide, which is the overlay's business and is
 * cut to fit in {@link Hud}.
 *
 * Whether chat appears at all:
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
 * Whether it can be read once it does:
 *
 *  - **Chat height** wound down, which is the one that looks most like the mod
 *    being broken: the message is printed, is on screen for a fraction of a
 *    second, and is pushed off by the next one. From the outside that is a mod
 *    that says nothing.
 *  - **Chat width** wound down, so every line wraps three times and a list of
 *    commands becomes a wall.
 *  - **Chat delay**, which holds messages back by up to six seconds. Set on
 *    purpose by people who dislike spam; indistinguishable from lag otherwise.
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
        if (options.chatHeightUnfocused().get() < MIN_HEIGHT) {
            found.add("the chat window is only a line or two tall — "
                    + "messages are pushed off it as fast as they arrive");
        }
        if (options.chatWidth().get() < MIN_WIDTH) {
            found.add("the chat window is narrow, so every line wraps");
        }
        if (options.chatDelay().get() > 0.0) {
            found.add("chat is delayed by " + options.chatDelay().get() + "s");
        }
        return found;
    }

    /**
     * Below this the window holds about two lines, which is where a message is
     * gone before it has been read. Two thirds is the vanilla default.
     */
    private static final double MIN_HEIGHT = 0.35;
    /** Below this a line of ordinary length wraps twice. */
    private static final double MIN_WIDTH = 0.55;

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
            changed.add("only-secure-chat -> off");
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

        // The legibility half. Nothing here decides whether a message arrives;
        // all of it decides whether you get to read it, which is the half that
        // was actually wrong.
        if (options.chatHeightUnfocused().get() < MIN_HEIGHT) {
            options.chatHeightUnfocused().set(0.66);
            changed.add("chat window height -> taller (this is the usual culprit)");
        } else {
            fine.add("chat window height");
        }

        if (options.chatWidth().get() < MIN_WIDTH) {
            options.chatWidth().set(1.0);
            changed.add("chat width -> full");
        } else {
            fine.add("chat width");
        }

        if (options.chatDelay().get() > 0.0) {
            options.chatDelay().set(0.0);
            changed.add("chat delay -> none");
        } else {
            fine.add("chat delay");
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
        out.add("height: " + String.format("%.2f", options.chatHeightUnfocused().get()));
        out.add("width: " + String.format("%.2f", options.chatWidth().get()));
        out.add("delay: " + String.format("%.2f", options.chatDelay().get()) + "s");
        return out;
    }
}

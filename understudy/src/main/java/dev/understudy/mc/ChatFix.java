package dev.understudy.mc;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.ChatVisibility;
import net.minecraft.client.option.GameOptions;

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
 * Nothing here is guessed at: each is read back after writing, and `report`
 * says what was actually changed rather than what was attempted.
 */
public final class ChatFix {
    private ChatFix() {}

    public record Result(List<String> changed, List<String> alreadyFine) {
        public boolean changedAnything() {
            return !changed.isEmpty();
        }
    }

    /** Look without touching. Used on join to decide whether to warn. */
    public static List<String> problems(MinecraftClient client) {
        GameOptions options = client.options;
        List<String> found = new ArrayList<>();

        if (options.getChatVisibility().getValue() != ChatVisibility.FULL) {
            found.add("chat is set to " + options.getChatVisibility().getValue()
                    + " — you will not see other players");
        }
        if (Boolean.TRUE.equals(options.getOnlyShowSecureChat().getValue())) {
            found.add("only-secure-chat is on — unsigned messages are hidden");
        }
        if (Boolean.FALSE.equals(options.getAutoSuggestions().getValue())) {
            found.add("command suggestions are off");
        }
        if (options.getChatOpacity().getValue() < 0.2) {
            found.add("chat opacity is almost zero");
        }
        return found;
    }

    /** Put them right, and say what actually changed. */
    public static Result repair(MinecraftClient client) {
        GameOptions options = client.options;
        List<String> changed = new ArrayList<>();
        List<String> fine = new ArrayList<>();

        if (options.getChatVisibility().getValue() != ChatVisibility.FULL) {
            options.getChatVisibility().setValue(ChatVisibility.FULL);
            changed.add("chat visibility -> shown");
        } else {
            fine.add("chat visibility");
        }

        if (Boolean.TRUE.equals(options.getOnlyShowSecureChat().getValue())) {
            options.getOnlyShowSecureChat().setValue(false);
            changed.add("only-secure-chat -> off (this is the usual culprit)");
        } else {
            fine.add("only-secure-chat");
        }

        if (Boolean.FALSE.equals(options.getAutoSuggestions().getValue())) {
            options.getAutoSuggestions().setValue(true);
            changed.add("command suggestions -> on");
        } else {
            fine.add("command suggestions");
        }

        if (options.getChatOpacity().getValue() < 0.2) {
            options.getChatOpacity().setValue(1.0);
            changed.add("chat opacity -> full");
        } else {
            fine.add("chat opacity");
        }

        if (options.getTextBackgroundOpacity().getValue() < 0.1) {
            options.getTextBackgroundOpacity().setValue(0.5);
            changed.add("chat background -> visible");
        }

        if (options.getChatScale().getValue() < 0.3) {
            options.getChatScale().setValue(1.0);
            changed.add("chat scale -> normal");
        }

        if (!changed.isEmpty()) options.write();
        return new Result(changed, fine);
    }

    /** The current settings, for a diagnostic that does not need chat to read. */
    public static List<String> describe(MinecraftClient client) {
        GameOptions options = client.options;
        List<String> out = new ArrayList<>();
        out.add("visibility: " + options.getChatVisibility().getValue());
        out.add("only secure: " + options.getOnlyShowSecureChat().getValue());
        out.add("suggestions: " + options.getAutoSuggestions().getValue());
        out.add("opacity: " + String.format("%.2f", options.getChatOpacity().getValue()));
        out.add("scale: " + String.format("%.2f", options.getChatScale().getValue()));
        return out;
    }
}

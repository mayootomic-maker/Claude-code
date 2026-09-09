package dev.understudy.core.build;

import java.util.List;

/**
 * What a server will let an ordinary player paste, and how often.
 *
 * This exists because of the thing that was worried about out loud: give
 * everyone operator so they can build, and one bad afternoon is unrecoverable.
 * The server half of this mod exists precisely so nobody has to hold operator
 * — but a server that accepts "place these six thousand blocks" from any
 * client has handed out something very like it anyway, unless the acceptance
 * is bounded. This is the bound.
 *
 * Three limits, and each one is a different failure:
 *
 *  - **What.** Only blocks, ever. That is `Ticket`'s whitelist, reused rather
 *    than rewritten, and it is what stops a paste from being a way to run a
 *    command.
 *  - **How much.** A cap on the box and on the number of commands. A mistake
 *    with the drag handles is a real thing that happens, and the difference
 *    between a wrong building and a flattened region is this number.
 *  - **How often.** A cooldown. Without it, the cap is per-paste rather than
 *    per-minute, and per-paste is not a limit.
 *
 * All of it decided here, away from the game, so the rules can be tested and
 * so the server half is small enough to read in one sitting.
 */
public final class Quota {

    private Quota() {}

    /** The only two things a paste request may ever ask for. */
    private static final List<String> ALLOWED = List.of("setblock ", "fill ");

    /**
     * Whether one line is a block placement and nothing else.
     *
     * A whitelist rather than a parser, because this is the rule that keeps
     * "anyone may paste" from meaning "anyone may run commands", and a parser
     * is a thing that can be surprised. Letters, digits and underscore for
     * names; a colon for a namespace; square brackets, equals and comma for
     * block states; minus and digits for coordinates. Deliberately absent:
     * tilde and caret, so a request cannot be relative to wherever the server
     * happens to evaluate it; braces, so it cannot carry NBT and spawn a chest
     * full of anything; quotes, slashes, semicolons and at-signs, so it cannot
     * become a second command or a selector.
     */
    public static boolean placesABlock(String command) {
        if (command == null) return false;
        String clean = command.startsWith("/") ? command.substring(1) : command;
        for (int i = 0; i < clean.length(); i++) {
            char c = clean.charAt(i);
            boolean fine = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9')
                    || c == '_' || c == ':' || c == '[' || c == ']' || c == '='
                    || c == ',' || c == '-' || c == ' ' || c == '.';
            if (!fine) return false;
        }
        for (String start : ALLOWED) {
            if (clean.startsWith(start)) return true;
        }
        return false;
    }

    /**
     * The default cap on a single paste, in blocks of bounding box.
     *
     * A 64-cube. Comfortably more than any design in the catalogue and more
     * than most imported schematics, and small enough that the worst a mistake
     * does is ruin a clearing rather than a landscape.
     */
    public static final int MOST_BLOCKS = 64 * 64 * 64;

    /**
     * The cap on commands, which is not the same question.
     *
     * A box of one material is a handful of fills; the same box of noise is one
     * setblock per block. The second is what costs the server its tick, so it
     * gets its own ceiling.
     */
    public static final int MOST_COMMANDS = 20_000;

    /** Twenty seconds between pastes from one player, in ticks. */
    public static final int COOLDOWN_TICKS = 20 * 20;

    /** @param why null when it is allowed, and a sentence for the player when not */
    public record Verdict(boolean allowed, String why) {
        public static final Verdict FINE = new Verdict(true, null);

        public static Verdict no(String why) {
            return new Verdict(false, why);
        }
    }

    /**
     * @param wide       the box the paste occupies
     * @param commands   what it is actually asking to run
     * @param sinceLast  ticks since this player's last paste, or a large number
     */
    public static Verdict check(int wide, int tall, int deep,
                                List<String> commands, long sinceLast) {
        if (commands == null || commands.isEmpty()) {
            return Verdict.no("that paste is empty");
        }
        if (wide <= 0 || tall <= 0 || deep <= 0) {
            return Verdict.no("that paste has no size");
        }
        // Multiplied as longs: three ints inside the int range can multiply out
        // of it, and an overflow here reads as a small paste, which is the one
        // wrong answer this must never give.
        long blocks = (long) wide * tall * deep;
        if (blocks > MOST_BLOCKS) {
            return Verdict.no("that is " + blocks + " blocks and the limit here is "
                    + MOST_BLOCKS + " — build it in pieces");
        }
        if (commands.size() > MOST_COMMANDS) {
            return Verdict.no("that needs " + commands.size() + " commands and the limit "
                    + "here is " + MOST_COMMANDS);
        }
        for (int i = 0; i < commands.size(); i++) {
            if (!placesABlock(commands.get(i))) {
                return Verdict.no("a paste may only place blocks, and line " + (i + 1)
                        + " does not");
            }
        }
        if (sinceLast < COOLDOWN_TICKS) {
            long left = (COOLDOWN_TICKS - sinceLast + 19) / 20;
            return Verdict.no("another " + left + " seconds before the next paste");
        }
        return Verdict.FINE;
    }
}

package dev.understudy.core.help;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Every command this mod has, in one place, with what each one does.
 *
 * It is data rather than a method full of print statements because the same
 * list has to come out in three places — the in-game help, the control panel,
 * and the file in the repository — and three hand-maintained copies of a
 * command list is three copies that disagree within a week. A command that is
 * only in one of them is, from the outside, a command that does not exist.
 *
 * There is nothing Minecraft in here, which is what lets the tests check it.
 * What they check is the thing that actually goes wrong with help text: a
 * summary long enough to run off the edge of the chat window, which is exactly
 * the complaint that prompted this file.
 */
public final class Manual {
    private Manual() {}

    /**
     * @param usage what you type, arguments in the shape the game expects
     * @param what  one line, short enough to read on one line
     */
    public record Entry(String usage, String what) {}

    public record Section(String id, String title, List<Entry> entries) {}

    /**
     * The widest a summary may be.
     *
     * Chat wraps rather than clipping, so this is not about overflowing — it is
     * about a list where every other item takes two lines being much harder to
     * scan than one where none of them do. Sixty-four characters plus the usage
     * fits a default chat window at normal width.
     */
    public static final int SUMMARY_LIMIT = 64;

    private static final List<Section> SECTIONS = List.of(
            new Section("build", "Building", List.of(
                    new Entry("/build",
                            "open the menu: pick a design, size and materials"),
                    new Entry("/build <name> [size]",
                            "hut, house, tower, storage, study or manor"),
                    new Entry("/paste",
                            "same menu; it appears, or is built instantly without op"),
                    new Entry("/paste undo", "take the last paste back out again"),
                    new Entry("/paste stop", "stop a paste part way through"),
                    new Entry("/build cancel", "drop the site you are placing"),
                    new Entry("/build stop", "stop a build that is under way"),
                    new Entry("/build imports", "where to drop schematics and models"),
                    new Entry("/plan <name> [size]",
                            "what it would cost, without building anything"))),

            new Section("site", "Placing a build", List.of(
                    new Entry("tap crouch", "put one corner of the plot where you look"),
                    new Entry("look around", "drag the far corner; the design resizes to fit"),
                    new Entry("R", "turn it a quarter"),
                    new Entry("Page Up / Page Down", "raise or lower it off the ground"),
                    new Entry("Enter", "confirm the square, then again to build"))),

            new Section("get", "Fetching and making", List.of(
                    new Entry("/get <item> [n]", "go and get it, however that has to happen"),
                    new Entry("/get iron_ingot+coal 8", "several at once, planned as one trip"),
                    new Entry("/sort", "put your things in the chests they belong in"),
                    new Entry("/sort all", "the same, including the kit you carry"),
                    new Entry("/stash", "a chest of spares here, for after you die"),
                    new Entry("/stash flight", "rockets and a spare elytra instead"),
                    new Entry("/stash <item> [n]", "a chest of anything: /stash rockets 64"),
                    new Entry("/stash a+b 32", "several things at once, that many of each"),
                    new Entry("/stash where", "the stashes it has put down in this world"),
                    new Entry("/stash needs [kit]", "what to carry so a kit fills up properly"),
                    new Entry("/enchant [item]", "at a table with its fifteen shelves"),
                    new Entry("/travel <x> <y> <z>", "walk there"),
                    new Entry("/travel stop", "stop walking"),
                    new Entry("/nether",
                            "through a portal, building and lighting one if needed"))),

            new Section("run", "Running it", List.of(
                    new Entry("/understudy", "this list"),
                    new Entry("/understudy help [topic]", "one section of it: " + topicList()),
                    new Entry("/understudy stop", "stop everything, now"),
                    new Entry("/understudy pause", "hold it there, keeping the plan"),
                    new Entry("/understudy resume", "carry on from where it was"),
                    new Entry("/understudy status", "what it is doing this second"),
                    new Entry("/understudy why", "what it thinks is going on, and why"),
                    new Entry("/understudy auto [item] [n]", "decide for itself what to do next"),
                    new Entry("/understudy auto off", "stop deciding for itself"),
                    new Entry("/understudy speed [how]",
                            "steady, brisk, flat out, or instant"),
                    new Entry("/project [which]", "an objective: kit, camp, base, enchanter"))),

            new Section("look", "Looking at it", List.of(
                    new Entry("/panel", "a control panel in your browser"),
                    new Entry("/panel network", "the same, reachable from your phone"),
                    new Entry("/panel open", "open the browser at it again"),
                    new Entry("/panel off", "shut the panel down"),
                    new Entry("/understudy hud", "turn the line above the hotbar on or off"),
                    new Entry("/understudy atlas", "everywhere it has seen anything"),
                    new Entry("/understudy timing", "where the time actually went"),
                    new Entry("/understudy profile", "what it has learned about how you play"))),

            new Section("fix", "When something is wrong", List.of(
                    new Entry("/understudy test", "check every part and say what is broken"),
                    new Entry("/understudy chatfix", "repair settings that hide or squash chat"))));

    /**
     * Taking the controls, which is not a command and is the thing people most
     * need told. Kept out of the sections so it reads as a note rather than as
     * something to type.
     */
    public static final List<String> NOTES = List.of(
            "Move, look around or open a chest and it lets go at once, keeping the plan.",
            "It picks the work back up after ten seconds of you doing nothing at all.");

    public static List<Section> sections() {
        return SECTIONS;
    }

    public static List<String> topics() {
        List<String> out = new ArrayList<>();
        for (Section section : SECTIONS) out.add(section.id());
        return out;
    }

    private static String topicList() {
        return String.join(", ", "build", "site", "get", "run", "look", "fix");
    }

    public static Section section(String id) {
        if (id == null) return null;
        String wanted = id.toLowerCase(Locale.ROOT);
        for (Section section : SECTIONS) if (section.id().equals(wanted)) return section;
        return null;
    }

    /** Every entry of one section, formatted for chat. */
    public static List<String> lines(Section section) {
        List<String> out = new ArrayList<>();
        for (Entry entry : section.entries()) {
            out.add(entry.usage() + " §7— " + entry.what());
        }
        return out;
    }

    /** The whole manual, for the panel and for the file in the repository. */
    public static String markdown() {
        StringBuilder out = new StringBuilder("# Understudy commands\n");
        for (Section section : SECTIONS) {
            out.append("\n## ").append(section.title()).append("\n\n");
            out.append("| | |\n|---|---|\n");
            for (Entry entry : section.entries()) {
                out.append("| `").append(entry.usage()).append("` | ")
                        .append(entry.what()).append(" |\n");
            }
        }
        out.append("\n## Taking the controls\n\n");
        for (String note : NOTES) out.append("- ").append(note).append('\n');
        return out.toString();
    }
}

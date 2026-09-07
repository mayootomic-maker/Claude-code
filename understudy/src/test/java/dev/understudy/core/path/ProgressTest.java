package dev.understudy.core.path;

import dev.understudy.core.path.Progress.Move;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProgressTest {

    /** About what a walking player covers in a tick. */
    private static final double WALK = 0.215;

    /** Walk in a straight line toward a goal that starts this far off. */
    private static List<Move> walking(Progress progress, int ticks, double from) {
        List<Move> moves = new ArrayList<>();
        double travelled = 0;
        for (int tick = 0; tick < ticks; tick++) {
            travelled += WALK;
            moves.add(progress.next(travelled, 64, 0, from - travelled));
        }
        return moves;
    }

    /** Stand perfectly still, the goal never getting closer. */
    private static List<Move> wedged(Progress progress, int ticks) {
        List<Move> moves = new ArrayList<>();
        for (int tick = 0; tick < ticks; tick++) {
            moves.add(progress.next(10, 64, 10, 40));
        }
        return moves;
    }

    @Test
    @DisplayName("an ordinary walk is never mistaken for being stuck")
    void walkingIsFine() {
        List<Move> moves = walking(new Progress(), 400, 200);
        assertTrue(moves.stream().allMatch(m -> m == Move.WALK),
                "interfered with a walk that was working: " + moves.stream()
                        .filter(m -> m != Move.WALK).findFirst().orElse(null));
    }

    @Test
    @DisplayName("scraping along a wall is not progress")
    void catchesTheSlowScrape() {
        // The failure the old check could not see at all. It compared this
        // tick's distance with last tick's, so a fifth of walking speed in
        // roughly the right direction counted as progress forever.
        Progress progress = new Progress();
        Move last = Move.WALK;
        for (int tick = 0; tick < 60; tick++) {
            double crept = tick * 0.02; // a fortieth of walking speed
            last = progress.next(crept, 64, 0, 40 - crept);
        }
        assertNotEquals(Move.WALK, last, "a character sliding on a wall was left to it");
    }

    @Test
    @DisplayName("tries things in the order a person tries them")
    void escalatesInOrder() {
        Progress progress = new Progress();
        List<Move> moves = wedged(progress, 120);

        int jump = moves.indexOf(Move.JUMP);
        int open = moves.indexOf(Move.OPEN);
        int lean = Math.min(indexOfAny(moves, Move.LEAN_LEFT), indexOfAny(moves, Move.LEAN_RIGHT));
        int dig = moves.indexOf(Move.DIG);
        int over = moves.indexOf(Move.GIVE_UP);

        assertTrue(jump > 0, "never tried jumping");
        assertTrue(open > jump, "went for the door before trying to step over it");
        assertTrue(lean > open, "leaned out before trying the handle");
        assertTrue(dig > lean, "started mining before trying to walk round");
        assertTrue(over > dig, "gave up before trying to dig through");
    }

    @Test
    @DisplayName("leans one way, holds it, then tries the other")
    void alternatesButDoesNotVibrate() {
        // A side chosen afresh every tick is a character shaking on the spot,
        // which is both useless and the most obviously non-human thing it could
        // do. Whichever side the obstruction is, one of the two gets past it.
        List<Move> leans = new ArrayList<>();
        for (Move move : wedged(new Progress(), 60)) {
            if (move == Move.LEAN_LEFT || move == Move.LEAN_RIGHT) leans.add(move);
        }
        assertTrue(leans.size() > 12, "barely leaned at all");
        assertTrue(leans.contains(Move.LEAN_LEFT) && leans.contains(Move.LEAN_RIGHT),
                "only ever tried one side");

        int changes = 0;
        for (int i = 1; i < leans.size(); i++) {
            if (leans.get(i) != leans.get(i - 1)) changes++;
        }
        assertTrue(changes <= 3, "swapped sides " + changes + " times: that is vibrating");
    }

    @Test
    @DisplayName("moving well and getting nowhere asks for a different route")
    void repathsRatherThanShoving() {
        // A route that loops is not a thing rudeness fixes. The character is
        // walking perfectly; the path is the problem.
        Progress progress = new Progress();
        Move last = Move.WALK;
        for (int tick = 0; tick < 300; tick++) {
            // Round and round a twenty-block circle, always forty from the goal.
            double angle = tick * 0.1;
            last = progress.next(Math.cos(angle) * 20, 64, Math.sin(angle) * 20, 40);
        }
        assertEquals(Move.REPATH, last);
    }

    @Test
    @DisplayName("a fresh route forgets how the last one was going")
    void restartClearsIt() {
        Progress progress = new Progress();
        wedged(progress, 120);
        assertTrue(progress.hopeless());

        progress.restart();
        assertEquals(0, progress.wedgedTicks());
        assertFalse(progress.hopeless());
        assertTrue(walking(progress, 100, 60).stream().allMatch(m -> m == Move.WALK));
    }

    @Test
    @DisplayName("does not accuse it of being stuck before it has had a chance to move")
    void givesItASecond() {
        // The first tick of a journey has no history behind it, and a walk that
        // is called stuck on tick one never starts.
        assertTrue(wedged(new Progress(), 10).stream().allMatch(m -> m == Move.WALK));
    }

    private static int indexOfAny(List<Move> moves, Move wanted) {
        int at = moves.indexOf(wanted);
        return at < 0 ? Integer.MAX_VALUE : at;
    }
}

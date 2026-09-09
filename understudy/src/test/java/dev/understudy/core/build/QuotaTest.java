package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The server half of this mod lets anybody paste, so this is what stops that
 * from being operator by another name.
 *
 * Every test here is a thing somebody could do to a server they were trusted
 * with. That is the right frame: the point of the server half is that nobody
 * has to hold operator, and it only earns that if a client cannot ask it for
 * anything an operator could do.
 */
class QuotaTest {

    private static List<String> place(int howMany) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < howMany; i++) out.add("setblock " + i + " 64 0 stone");
        return out;
    }

    private static final long LONG_AGO = 1_000_000;

    @Test
    void anOrdinaryPasteGoesThrough() {
        assertTrue(Quota.check(9, 7, 11, place(200), LONG_AGO).allowed());
    }

    @Test
    void aPasteMayOnlyEverPlaceBlocks() {
        for (String nasty : List.of(
                "op TrustMe",
                "gamemode creative TrustMe",
                "execute as @a run setblock 0 0 0 stone",
                "setblock 0 0 0 stone; op TrustMe",
                "kill @e")) {
            List<String> commands = new ArrayList<>(place(3));
            commands.add(nasty);
            Quota.Verdict verdict = Quota.check(9, 7, 11, commands, LONG_AGO);
            assertFalse(verdict.allowed(), nasty);
            assertTrue(verdict.why().contains("only place blocks"), verdict.why());
        }
    }

    @Test
    void nothingCanBeSmuggledOntoAPlacementLine() {
        for (String smuggled : List.of(
                "setblock 1 2 3 stone; op TrustMe",
                "setblock 1 2 3 stone/op TrustMe",
                "setblock 1 2 3 stone \"quoted\"",
                "setblock 1 2 3 chest{Items:[{id:tnt}]}",
                "setblock 1 2 3 stone @e",
                "setblock ~ ~ ~ stone",
                "setblock ^ ^ ^1 stone")) {
            assertFalse(Quota.placesABlock(smuggled), smuggled);
        }
    }

    @Test
    void anOrdinaryPlacementWithABlockStateIsFine() {
        assertTrue(Quota.placesABlock("setblock 1 2 3 minecraft:oak_stairs[facing=east]"));
        assertTrue(Quota.placesABlock("fill -10 64 -10 10 70 10 air"));
        assertTrue(Quota.placesABlock("/setblock 1 2 3 stone"));
    }

    @Test
    void theRefusalSaysWhichLineSoAGenuineMistakeIsFixable() {
        List<String> commands = new ArrayList<>(place(4));
        commands.add("summon creeper");
        assertTrue(Quota.check(9, 7, 11, commands, LONG_AGO).why().contains("line 5"));
    }

    @Test
    void aRegionTooBigToWantBackIsRefused() {
        Quota.Verdict verdict = Quota.check(300, 300, 300, place(10), LONG_AGO);
        assertFalse(verdict.allowed());
        assertTrue(verdict.why().contains("in pieces"), verdict.why());
    }

    @Test
    void aBoxThatOverflowsAnIntIsNotASmallBox() {
        // 2000^3 is 8 billion, which wraps negative in int arithmetic and would
        // read as comfortably under the limit. The one wrong answer this must
        // never give.
        assertFalse(Quota.check(2000, 2000, 2000, place(10), LONG_AGO).allowed());
        assertFalse(Quota.check(46341, 46341, 1, place(10), LONG_AGO).allowed());
    }

    @Test
    void aSmallBoxMadeOfEnoughCommandsToStallTheServerIsStillRefused() {
        // Under the block cap and over the command cap: a 64-cube of noise is
        // one setblock per block, and it is the commands that cost the tick.
        Quota.Verdict verdict = Quota.check(
                64, 64, 64, place(Quota.MOST_COMMANDS + 1), LONG_AGO);
        assertFalse(verdict.allowed());
        assertTrue(verdict.why().contains("commands"), verdict.why());
    }

    @Test
    void oneAfterAnotherIsRefusedUntilTheCooldownIsUp() {
        assertFalse(Quota.check(9, 7, 11, place(10), 0).allowed());
        assertFalse(Quota.check(9, 7, 11, place(10), Quota.COOLDOWN_TICKS - 1).allowed());
        assertTrue(Quota.check(9, 7, 11, place(10), Quota.COOLDOWN_TICKS).allowed());
    }

    @Test
    void theCooldownSaysHowLongInSecondsRatherThanInTicks() {
        String why = Quota.check(9, 7, 11, place(10), 0).why();
        assertTrue(why.contains("20 seconds"), why);
    }

    @Test
    void nothingAtAllIsNotAPaste() {
        assertFalse(Quota.check(9, 7, 11, List.of(), LONG_AGO).allowed());
        assertFalse(Quota.check(9, 7, 11, null, LONG_AGO).allowed());
        assertFalse(Quota.check(0, 7, 11, place(10), LONG_AGO).allowed());
        assertFalse(Quota.check(9, -7, 11, place(10), LONG_AGO).allowed());
    }

    @Test
    void everyRefusalIsSayableToTheePersonWhoTriedIt() {
        List<Quota.Verdict> refusals = List.of(
                Quota.check(300, 300, 300, place(10), LONG_AGO),
                Quota.check(9, 7, 11, place(10), 0),
                Quota.check(9, 7, 11, List.of(), LONG_AGO));
        for (Quota.Verdict verdict : refusals) {
            assertFalse(verdict.allowed());
            assertTrue(verdict.why() != null && !verdict.why().isBlank(),
                    "a refusal with nothing to show the player is a silent failure");
        }
    }

    @Test
    void theBiggestAllowedPasteIsActuallyAllowed() {
        assertTrue(Quota.check(64, 64, 64, place(10), LONG_AGO).allowed());
        assertFalse(Quota.check(65, 64, 64, place(10), LONG_AGO).allowed());
    }

    @Test
    void aLeadingSlashDoesNotSneakPastTheWhitelist() {
        List<String> commands = new ArrayList<>(place(2));
        Collections.addAll(commands, "/op TrustMe");
        assertFalse(Quota.check(9, 7, 11, commands, LONG_AGO).allowed());
    }
}

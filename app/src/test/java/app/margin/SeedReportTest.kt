package app.margin

import app.margin.core.format.Money
import app.margin.data.seed.SeedData
import app.margin.domain.engine.DecisionMemory
import app.margin.domain.engine.HeuristicValuationEngine
import app.margin.domain.engine.Ranking
import app.margin.domain.engine.SeededMarketData
import app.margin.domain.engine.ValuationRequest
import app.margin.domain.model.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Evaluates the whole seeded corpus and prints it as a table.
 *
 * This is how the demo's arithmetic gets checked: the numbers a user will see are produced
 * here, in the build, rather than being eyeballed on a device.
 */
class SeedReportTest {

    private val market = SeededMarketData()
    private val engine = HeuristicValuationEngine(market)
    private val now = 1_787_000_000_000L // fixed instant so the report is reproducible

    @Test
    fun `seed corpus evaluates into a legible spread of verdicts`() {
        val corpus = SeedData.build(now)
        val allListings = (corpus.feedListings + corpus.historyListings).associateBy { it.id }
        val memory = DecisionMemory.from(corpus.decisions, allListings)
        val activeGoals = corpus.goals.filter { it.active }

        assertEquals(
            "every seeded decision must reference a seeded listing, or memory silently drops it",
            corpus.decisions.size, memory.totalDecisions,
        )

        println()
        println("MEMORY: rejectedByBrand=${memory.rejectedByBrand} boughtByBrand=${memory.boughtByBrand}")
        println("        avgRejectedAsk=" + memory.avgRejectedAskByCategory.mapValues { Money.format(it.value) })
        println()
        println(
            "%-34s %8s %8s %5s %5s %10s %-12s %s".format(
                "LISTING", "ASK", "FAIR", "SCR", "MEM", "NET", "VERDICT", "GOAL",
            )
        )
        println("-".repeat(110))

        val verdicts = mutableMapOf<Verdict, Int>()
        corpus.feedListings.forEach { listing ->
            val goal = Ranking.bestGoal(listing, activeGoals)
            val e = engine.compute(
                ValuationRequest(listing, goal, memory, now, "t-${listing.id}")
            )
            verdicts[e.verdict] = (verdicts[e.verdict] ?: 0) + 1

            println(
                "%-34s %8s %8s %5d %5d %10s %-12s %s".format(
                    listing.title.take(34),
                    Money.format(listing.askingPriceMinor, showCurrency = false),
                    Money.format(e.fairValueMinor, showCurrency = false),
                    e.dealScore,
                    e.memoryDelta,
                    Money.format(e.netProfitMinor, showCurrency = false, alwaysSigned = true),
                    e.verdict.label,
                    goal?.title?.take(28) ?: "-",
                )
            )

            // Invariant: the displayed range must contain the value it is a range for.
            assertTrue(
                "range inverted for ${listing.title}: ${e.fairLowMinor}..${e.fairHighMinor} around ${e.fairValueMinor}",
                e.fairLowMinor <= e.fairValueMinor && e.fairValueMinor <= e.fairHighMinor,
            )
            assertTrue("score out of range for ${listing.title}", e.dealScore in 0..100)
        }
        println()
        println("VERDICT SPREAD: $verdicts")
        println()

        // The feed has to discriminate. A demo where everything says the same thing teaches
        // the user nothing about what the product is for.
        assertTrue(
            "the feed must produce at least three distinct verdicts, got $verdicts",
            verdicts.keys.size >= 3,
        )
        assertTrue(
            "at least one seeded listing must be a clear buy, got $verdicts",
            (verdicts[Verdict.STRONG_BUY] ?: 0) + (verdicts[Verdict.BUY] ?: 0) >= 2,
        )
    }

    @Test
    fun `the pc flip goal produces three different answers`() {
        val corpus = SeedData.build(now)
        val all = (corpus.feedListings + corpus.historyListings).associateBy { it.id }
        val memory = DecisionMemory.from(corpus.decisions, all)
        val goal = corpus.goals.first { it.id == "goal-pcflip" }

        val triplet = listOf("l-ryzen", "l-elitedesk", "l-optiplex-dear")
            .map { id -> corpus.feedListings.first { it.id == id } }

        println()
        println("PC FLIP GOAL — target ${Money.format(goal.targetProfitMinMinor)}")
        val results = triplet.map { listing ->
            val e = engine.compute(ValuationRequest(listing, goal, memory, now, "t-${listing.id}"))
            println(
                "  %-38s ask %8s  fair %8s  net %9s  maxBid %8s  %s".format(
                    listing.title.take(38),
                    Money.format(listing.askingPriceMinor, showCurrency = false),
                    Money.format(e.fairValueMinor, showCurrency = false),
                    Money.format(e.netProfitMinor, showCurrency = false, alwaysSigned = true),
                    Money.format(e.maxBidMinor, showCurrency = false),
                    e.verdict.label,
                )
            )
            e
        }
        println()

        assertTrue(
            "the Ryzen build must clear the CHF 150 profit target",
            results[0].netProfitMinor >= goal.targetProfitMinMinor,
        )
        assertTrue(
            "the Ryzen build must read as a buy",
            results[0].verdict.isPositive,
        )
        assertTrue(
            "the dear OptiPlex must not read as a buy",
            !results[2].verdict.isPositive,
        )
    }

    @Test
    fun `the e-gravel goal has affordable matches under the stated budget`() {
        val corpus = SeedData.build(now)
        val all = (corpus.feedListings + corpus.historyListings).associateBy { it.id }
        val memory = DecisionMemory.from(corpus.decisions, all)
        val goal = corpus.goals.first { it.id == "goal-egravel" }

        val inBudget = corpus.feedListings
            .filter { it.category == goal.category && it.askingPriceMinor <= goal.budgetMaxMinor }

        println()
        println("E-GRAVEL GOAL — budget ${Money.format(goal.budgetMaxMinor)}")
        val positive = inBudget.count { listing ->
            val e = engine.compute(ValuationRequest(listing, goal, memory, now, "t-${listing.id}"))
            println(
                "  %-34s ask %8s  fair %8s  score %3d  %s".format(
                    listing.title.take(34),
                    Money.format(listing.askingPriceMinor, showCurrency = false),
                    Money.format(e.fairValueMinor, showCurrency = false),
                    e.dealScore, e.verdict.label,
                )
            )
            e.verdict.isPositive
        }
        println()

        assertTrue("no e-gravel bikes are inside the stated budget at all", inBudget.size >= 3)
        assertTrue(
            "the headline goal must yield at least two positive verdicts, got $positive",
            positive >= 2,
        )
    }

    @Test
    fun `decision memory visibly penalises a brand the user keeps rejecting`() {
        val corpus = SeedData.build(now)
        val all = (corpus.feedListings + corpus.historyListings).associateBy { it.id }
        val memory = DecisionMemory.from(corpus.decisions, all)
        val canyon = corpus.feedListings.first { it.id == "l-canyon-over" }
        val goal = corpus.goals.first { it.id == "goal-egravel" }

        val withMemory = engine.compute(ValuationRequest(canyon, goal, memory, now, "t-mem"))
        val without = engine.compute(ValuationRequest(canyon, goal, DecisionMemory.EMPTY, now, "t-nomem"))

        println()
        println("MEMORY EFFECT on ${canyon.title}:")
        println("  base ${withMemory.baseScore}  memory ${withMemory.memoryDelta}  final ${withMemory.dealScore}")
        println("  without any history: ${without.dealScore}")
        println("  note: ${withMemory.personalNote}")
        println()

        assertTrue("memory must lower the score for a repeatedly rejected brand", withMemory.memoryDelta < 0)
        assertTrue("memory must explain itself", !withMemory.personalNote.isNullOrBlank())
        assertEquals(withMemory.baseScore + withMemory.memoryDelta, withMemory.dealScore)
    }
}

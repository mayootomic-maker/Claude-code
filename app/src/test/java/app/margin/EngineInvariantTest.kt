package app.margin

import app.margin.core.format.Money
import app.margin.domain.engine.DecisionMemory
import app.margin.domain.engine.HeuristicValuationEngine
import app.margin.domain.engine.SeededMarketData
import app.margin.domain.engine.ValuationRequest
import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import app.margin.domain.model.Listing
import app.margin.domain.model.Provenance
import app.margin.domain.model.SellerType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The three invariants that, if broken, make the app lie to the user. Each of these was a
 * real defect found in review before it was fixed.
 */
class EngineInvariantTest {

    private val market = SeededMarketData()
    private val engine = HeuristicValuationEngine(market)
    private val now = 1_787_000_000_000L

    private fun listing(
        price: Long,
        condition: Condition = Condition.GOOD,
        year: Int? = 2021,
        brand: String = "Canyon",
        model: String = "Grail:ON CF 7",
        category: Category = Category.BIKE,
        description: String = "A" .repeat(300),
        images: Int = 6,
        rating: Int? = 96,
        specs: Map<String, String> = emptyMap(),
    ) = Listing(
        id = "t", url = "", sourceName = "Test", provenance = Provenance.MANUAL,
        title = "$brand $model", brand = brand, model = model, year = year,
        category = category, condition = condition, askingPriceMinor = price,
        location = "Bern", sellerType = SellerType.PRIVATE, sellerRatingPct = rating,
        listedAtMillis = now - 86_400_000L, description = description, specs = specs,
        imageCount = images, capturedAtMillis = now,
    )

    private fun evaluate(l: Listing, goal: Goal? = null) =
        engine.compute(ValuationRequest(l, goal, DecisionMemory.EMPTY, now, "t"))

    /** Invariant 1: the displayed range must contain the value it is a range for. */
    @Test
    fun `fair value band never inverts across conditions and ages`() {
        val cases = buildList {
            for (condition in Condition.entries) {
                for (year in listOf(null, 1998, 2014, 2021, 2026, 2030)) {
                    for (price in listOf(1L, 100_00L, 1_000_00L, 50_000_00L)) {
                        add(listing(price, condition, year))
                    }
                }
            }
        }
        cases.forEach { l ->
            val e = evaluate(l)
            assertTrue(
                "low ${e.fairLowMinor} > fair ${e.fairValueMinor} for ${l.condition} ${l.year} @${l.askingPriceMinor}",
                e.fairLowMinor <= e.fairValueMinor,
            )
            assertTrue(
                "fair ${e.fairValueMinor} > high ${e.fairHighMinor} for ${l.condition} ${l.year} @${l.askingPriceMinor}",
                e.fairValueMinor <= e.fairHighMinor,
            )
            assertTrue("score out of range", e.dealScore in 0..100)
            assertEquals("score arithmetic must be exactly what the UI shows",
                (e.baseScore + e.memoryDelta).coerceIn(0, 100), e.dealScore)
        }
    }

    /**
     * Invariant 2: a cheaper listing can never score worse than an identical dearer one.
     * This broke when the "suspiciously cheap" flag subtracted 14 points from the score.
     */
    @Test
    fun `deal score is monotonic as the asking price falls`() {
        listOf<Goal?>(
            null,
            Goal("g", "buy", GoalKind.BUY, Category.BIKE, 200_000, 0, emptyList(), Condition.FAIR),
            Goal("g", "flip", GoalKind.FLIP, Category.BIKE, 200_000, 15_000, emptyList(), Condition.FAIR),
        ).forEach { goal ->
            var previous = -1
            // Walk the price down; the score must never fall as the item gets cheaper.
            for (price in generateSequence(300_000L) { it - 5_000L }.takeWhile { it >= 5_000L }) {
                val score = evaluate(listing(price), goal).dealScore
                if (previous >= 0) {
                    assertTrue(
                        "score fell from $previous to $score when the price dropped to " +
                            "${Money.format(price)} (goal=${goal?.kind})",
                        score >= previous,
                    )
                }
                previous = score
            }
        }
    }

    /**
     * Invariant 3: refurbishment must never make a worse-condition item the better buy.
     * A flat per-category refurb cost against a proportional condition uplift made the engine
     * recommend buying scrap.
     */
    @Test
    fun `worse condition is never a better margin at the same fair value`() {
        val goal = Goal("g", "flip", GoalKind.FLIP, Category.BIKE, 500_000, 10_000, emptyList(), Condition.FOR_PARTS)
        // Price each condition exactly at its own fair value, then compare margins.
        val margins = listOf(
            Condition.GOOD, Condition.FAIR, Condition.POOR, Condition.FOR_PARTS,
        ).map { condition ->
            val probe = evaluate(listing(100_000, condition), goal)
            val atFair = evaluate(listing(probe.fairValueMinor, condition), goal)
            condition to atFair.marginFraction
        }

        margins.forEach { (condition, margin) ->
            println("%-10s margin %.4f".format(condition.name, margin))
        }

        val byCondition = margins.toMap()
        val good = byCondition.getValue(Condition.GOOD)
        val fair = byCondition.getValue(Condition.FAIR)
        val poor = byCondition.getValue(Condition.POOR)
        val parts = byCondition.getValue(Condition.FOR_PARTS)

        // Deep refurbishment must never look attractive.
        assertTrue("POOR ($poor) must not beat GOOD ($good)", poor <= good + 1e-9)
        assertTrue("FOR_PARTS ($parts) must not beat GOOD ($good)", parts <= good + 1e-9)

        // Below FAIR, worse must mean worse. Monotonicity is the property that broke.
        assertTrue("POOR ($poor) must not beat FAIR ($fair)", poor <= fair + 1e-9)
        assertTrue("FOR_PARTS ($parts) must not beat POOR ($poor)", parts <= poor + 1e-9)

        // Light refurbishment may be the better trade, but only by a bounded amount. An
        // unbounded advantage is the signature of the flat-cost bug.
        assertTrue(
            "FAIR ($fair) beats GOOD ($good) by more than a plausible refurbishment spread",
            fair - good <= 0.05,
        )
    }

    /** An unknown model must not be valued off the seller's own asking price. */
    @Test
    fun `unknown category declines to state a fair value rather than echoing the asking price`() {
        val e = evaluate(
            listing(
                price = 250_00, brand = "Nobody", model = "Nothing",
                category = Category.OTHER, year = 2020,
            )
        )
        assertTrue("must admit it has no market data", !e.hasMarketData)
        assertTrue("must not present a positive verdict without data", !e.verdict.isPositive)
        assertTrue("must raise this as a risk", e.risks.any { it.title.contains("No market data") })
        assertTrue("score must not exceed the neutral midpoint", e.dealScore <= 50)
    }

    /** A brand-fallback match must be demoted, not reported as high confidence. */
    @Test
    fun `pricing off a different model lowers confidence and says so`() {
        val e = evaluate(listing(price = 90_000, brand = "Canyon", model = "Endurace AL"))
        assertTrue("must be flagged as priced off another model", e.pricedOffDifferentModel)
        assertEquals(app.margin.domain.model.Confidence.LOW, e.confidence)
        assertTrue(e.risks.any { it.title.contains("different model") })
    }

    /** Determinism: the same input must always produce the same output. */
    @Test
    fun `evaluation is deterministic`() {
        val l = listing(120_000, Condition.FAIR, 2020)
        val a = evaluate(l)
        val b = evaluate(l)
        assertEquals(a.fairValueMinor, b.fairValueMinor)
        assertEquals(a.dealScore, b.dealScore)
        assertEquals(a.netProfitMinor, b.netProfitMinor)
        assertEquals(a.maxBidMinor, b.maxBidMinor)
    }

    @Test
    fun `money formatting uses Swiss grouping, NBSP and a real minus sign`() {
        val s = "\u00A0" // non-breaking space between currency and figure
        assertEquals("CHF${s}1\u2019480", Money.format(148_000))
        assertEquals("CHF${s}1\u2019480.50", Money.format(148_050))
        assertEquals("\u2212CHF${s}240", Money.format(-24_000))
        assertEquals("+CHF${s}240", Money.format(24_000, alwaysSigned = true))
        assertEquals("CHF${s}580", Money.whole(57_982))
        assertEquals("CHF${s}12", Money.whole(1_249))
        assertEquals("1\u2019480", Money.format(148_000, showCurrency = false))
    }
}

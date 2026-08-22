package app.margin

import androidx.test.core.app.ApplicationProvider
import app.margin.di.AppContainer
import app.margin.domain.engine.ResolveResult
import app.margin.domain.model.Category
import app.margin.domain.model.DecisionType
import app.margin.domain.model.OwnedStatus
import app.margin.domain.model.Provenance
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * End-to-end exercise of the primary flows against a real database and real engine.
 * These are the paths a screenshot cannot prove: capture, decide, remember, own, sell.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CoreFlowTest {

    private lateinit var container: AppContainer

    @Before
    fun setUp() {
        container = AppContainer(ApplicationProvider.getApplicationContext())
        runBlocking { container.seeder.reseed() }
    }

    @Test
    fun `seeding produces an evaluation for every listing`() = runBlocking {
        val listings = container.listings.all()
        assertTrue("expected a seeded corpus", listings.size >= 15)
        listings.forEach { listing ->
            assertNotNull(
                "no evaluation for ${listing.title}",
                container.evaluations.latestFor(listing.id),
            )
        }
    }

    @Test
    fun `a known marketplace link resolves against the local catalogue`() = runBlocking {
        val known = container.listings.all().first { it.url.isNotBlank() }
        val result = container.listingSource.resolve(known.url, container.now())
        assertTrue("expected a catalogue hit, got $result", result is ResolveResult.Known)
        assertEquals(known.id, (result as ResolveResult.Known).listing.id)
    }

    @Test
    fun `an unknown link is parsed locally and says what it guessed`() = runBlocking {
        val result = container.listingSource.resolve(
            "https://www.ricardo.ch/de/a/specialized-allez-sprint-gravel-chf-1290-1299887711/",
            container.now(),
        )
        assertTrue("expected a locally inferred listing, got $result", result is ResolveResult.Inferred)
        result as ResolveResult.Inferred
        assertEquals(Provenance.PARSED_URL, result.listing.provenance)
        assertEquals("Ricardo", result.listing.sourceName)
        assertEquals(Category.BIKE, result.listing.category)
        assertEquals("price should be read from the slug", 129_000L, result.listing.askingPriceMinor)
        assertTrue("must declare what it inferred", result.inferredFields.isNotEmpty())
    }

    @Test
    fun `nonsense input is rejected rather than invented`() = runBlocking {
        val result = container.listingSource.resolve("hello", container.now())
        assertTrue(result is ResolveResult.Unusable)
    }

    @Test
    fun `capture then evaluate then buy lands the item in inventory`() = runBlocking {
        val result = container.listingSource.resolve(
            "https://www.tutti.ch/de/vi/bern/velo/cube-nuroad-hybrid-chf-1390/4499001",
            container.now(),
        ) as ResolveResult.Inferred

        container.listings.upsert(result.listing, inFeed = true)
        val evaluation = container.coordinator.evaluate(result.listing)
        assertNotNull(container.evaluations.latestFor(result.listing.id))
        assertTrue("range must contain the value",
            evaluation.fairLowMinor <= evaluation.fairValueMinor &&
                evaluation.fairValueMinor <= evaluation.fairHighMinor)

        container.decisions.record(
            app.margin.domain.repository.DecisionRecord(
                decision = app.margin.domain.model.Decision(
                    id = "d-new", listingId = result.listing.id,
                    type = DecisionType.BOUGHT, reason = "test",
                    createdAtMillis = container.now(),
                ),
                scoreAtDecision = evaluation.dealScore,
                verdictAtDecision = evaluation.verdict,
            )
        )
        assertEquals(DecisionType.BOUGHT, container.decisions.latestFor(result.listing.id)?.type)
    }

    /** The behaviour the product claims: decisions change later recommendations. */
    @Test
    fun `rejecting a brand lowers the score of the next listing from that brand`() = runBlocking {
        val canyon = container.listings.all().first { it.id == "l-canyon-over" }
        val before = container.coordinator.evaluate(canyon, persist = false)

        // Wipe the seeded history and confirm the penalty disappears with it.
        container.listings.all().forEach { container.decisions.clearFor(it.id) }
        val without = container.coordinator.evaluate(canyon, persist = false)

        assertTrue(
            "seeded rejections must penalise this brand (was ${before.dealScore}, " +
                "clean ${without.dealScore})",
            before.dealScore < without.dealScore,
        )
        assertEquals(0, without.memoryDelta)
        assertTrue("the penalty must be explained", !before.personalNote.isNullOrBlank())
    }

    @Test
    fun `owned items are revalued by the engine rather than read from a stored constant`() = runBlocking {
        val item = container.owned.all().first { it.id == "o-cube" }
        val now = container.now()
        val atPurchase = app.margin.domain.engine.AttentionEngine
            .currentValueOf(item, container.marketData, item.purchasedAtMillis)
        val today = app.margin.domain.engine.AttentionEngine
            .currentValueOf(item, container.marketData, now)
        assertTrue("value must depreciate over time ($atPurchase -> $today)", today < atPurchase)
        assertTrue("still ahead of what was paid", today > item.purchasePriceMinor)
    }

    @Test
    fun `the sell flow produces copy and a channel recommendation`() = runBlocking {
        val item = container.owned.all().first { it.id == "o-macbook" }
        val draft = container.saleDrafts.forOwnedItem(item.id)
        assertNotNull("the seeded listed item should carry a draft", draft)
        assertTrue("draft must have a title", draft!!.title.isNotBlank())
        assertTrue("draft must have a body", draft.body.length > 120)
        assertTrue("photo checklist must exist", draft.photoTasks.isNotEmpty())

        val copy = container.copywriter.draft(
            app.margin.domain.engine.CopyRequest(
                item = item,
                channel = draft.channel,
                askPriceMinor = draft.askPriceMinor,
                condition = item.condition,
                highlights = listOf("Battery health 91%"),
                flaws = listOf("Two scuffs on the underside"),
                location = "Bern",
            )
        )
        assertTrue(copy.title.isNotBlank())
        assertTrue("copy must state the flaw rather than hide it",
            copy.body.contains("scuffs", ignoreCase = true))
        assertTrue("copy must state the price", copy.body.contains("Asking"))
    }

    @Test
    fun `marking an owned item sold records the outcome against the forecast`() = runBlocking {
        val sold = container.owned.all().first { it.status == OwnedStatus.SOLD }
        assertNotNull("sold item must record what it fetched", sold.soldPriceMinor)
        assertNotNull("sold item must record what was forecast", sold.predictedNetMinor)
        assertNotNull("prediction error must be computable", sold.predictionErrorMinor)
    }

    @Test
    fun `today surfaces attention items from the seeded state`() = runBlocking {
        val records = container.decisions.allRecords()
        val listings = container.listings.all().associateBy { it.id }
        val evaluations = container.evaluations.all()
            .groupBy { it.listingId }
            .mapValues { (_, v) -> v.maxBy { it.createdAtMillis } }

        val watched = records
            .filter { it.decision.type == DecisionType.WATCH }
            .mapNotNull { r ->
                val l = listings[r.decision.listingId] ?: return@mapNotNull null
                val e = evaluations[l.id] ?: return@mapNotNull null
                app.margin.domain.engine.WatchedItem(
                    l, e, r.decision.createdAtMillis, r.scoreAtDecision, r.verdictAtDecision,
                )
            }

        val attention = app.margin.domain.engine.AttentionEngine.compute(
            watched = watched,
            owned = container.owned.all(),
            drafts = container.saleDrafts.all(),
            nowMillis = container.now(),
        )
        assertTrue("Today must have something to show on first run", attention.size >= 3)
        assertEquals(
            "each listing may appear at most once",
            attention.mapNotNull { it.listingId }.size,
            attention.mapNotNull { it.listingId }.distinct().size,
        )
        attention.forEach {
            assertTrue("attention headline must not be blank", it.headline.isNotBlank())
            assertTrue("attention detail must not be blank", it.detail.isNotBlank())
        }
    }
}

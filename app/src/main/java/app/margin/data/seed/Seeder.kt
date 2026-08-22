package app.margin.data.seed

import app.margin.data.service.EvaluationCoordinator
import app.margin.domain.model.Decision
import app.margin.domain.model.Verdict
import app.margin.domain.repository.DecisionRecord
import app.margin.domain.repository.DecisionRepository
import app.margin.domain.repository.GoalRepository
import app.margin.domain.repository.ListingRepository
import app.margin.domain.repository.OwnedRepository
import app.margin.domain.repository.SaleDraftRepository

/**
 * Populates the demo corpus and evaluates it.
 *
 * Order matters: listings and goals first, then decisions, then a full evaluation pass. The
 * decisions have to be on record before anything is evaluated, otherwise the seeded history
 * would have no effect on the seeded scores and memory would look inert on first run.
 */
class Seeder(
    private val goals: GoalRepository,
    private val listings: ListingRepository,
    private val decisions: DecisionRepository,
    private val owned: OwnedRepository,
    private val saleDrafts: SaleDraftRepository,
    private val coordinator: EvaluationCoordinator,
    private val now: () -> Long,
) {

    suspend fun isSeeded(): Boolean = goals.all().isNotEmpty()

    suspend fun ensureSeeded() {
        if (isSeeded()) return
        seed()
    }

    suspend fun reseed() = seed()

    private suspend fun seed() {
        val corpus = SeedData.build(now())

        corpus.goals.forEach { goals.upsert(it) }
        corpus.feedListings.forEach { listings.upsert(it, inFeed = true) }
        // Historical listings back the decision record but do not appear in the feed.
        corpus.historyListings.forEach { listings.upsert(it, inFeed = false) }

        corpus.decisions.forEach { decision ->
            decisions.record(
                DecisionRecord(
                    decision = decision,
                    scoreAtDecision = scoreAtDecisionFor(decision),
                    verdictAtDecision = verdictAtDecisionFor(decision),
                )
            )
        }

        corpus.ownedItems.forEach { owned.upsert(it) }
        corpus.saleDrafts.forEach { saleDrafts.upsert(it) }

        coordinator.refreshAll()
    }

    /**
     * Scores recorded at the time each seeded decision was taken. These are what Today's
     * attention queue diffs against, so a watched item whose price has since dropped shows a
     * real, non-zero change rather than a fabricated one.
     */
    private fun scoreAtDecisionFor(decision: Decision): Int = when (decision.listingId) {
        "l-flyer" -> 64      // has since dropped CHF 100
        "l-macbook" -> 71    // has since dropped CHF 40
        "l-canyon-over" -> 58
        "l-elitedesk" -> 55
        "l-fuji" -> 41
        else -> 50
    }

    private fun verdictAtDecisionFor(decision: Decision): Verdict = when (decision.listingId) {
        "l-flyer" -> Verdict.WATCH
        "l-macbook" -> Verdict.BUY
        "l-canyon-over" -> Verdict.WATCH
        "l-elitedesk" -> Verdict.WATCH
        "l-fuji" -> Verdict.PASS
        else -> Verdict.WATCH
    }
}

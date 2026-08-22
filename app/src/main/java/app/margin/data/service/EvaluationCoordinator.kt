package app.margin.data.service

import app.margin.domain.engine.DecisionMemory
import app.margin.domain.engine.Ranking
import app.margin.domain.engine.ValuationRequest
import app.margin.domain.engine.ValuationService
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import app.margin.domain.repository.DecisionRepository
import app.margin.domain.repository.EvaluationRepository
import app.margin.domain.repository.GoalRepository
import app.margin.domain.repository.ListingRepository

/**
 * Runs the valuation engine and persists the result.
 *
 * Every evaluation is recomputed against the current decision history, so a rejection made a
 * minute ago changes the next evaluation. That is what makes decision memory observable
 * rather than asserted.
 */
class EvaluationCoordinator(
    private val listings: ListingRepository,
    private val goals: GoalRepository,
    private val decisions: DecisionRepository,
    private val evaluations: EvaluationRepository,
    private val valuation: ValuationService,
    private val now: () -> Long,
) {

    suspend fun memory(): DecisionMemory =
        DecisionMemory.from(decisions.all(), listings.all().associateBy { it.id })

    suspend fun evaluate(listing: Listing, goal: Goal? = null, persist: Boolean = true): Evaluation {
        val activeGoals = goals.all().filter { it.active }
        val chosen = goal ?: Ranking.bestGoal(listing, activeGoals)
        val nowMillis = now()
        val evaluation = valuation.evaluate(
            ValuationRequest(
                listing = listing,
                goal = chosen,
                memory = memory(),
                nowMillis = nowMillis,
                evaluationId = "eval-${listing.id}-$nowMillis",
            )
        )
        if (persist) evaluations.upsert(evaluation)
        return evaluation
    }

    /** Re-evaluates everything. Called after seeding and after any decision changes. */
    suspend fun refreshAll() {
        val activeGoals = goals.all().filter { it.active }
        val mem = memory()
        val nowMillis = now()
        listings.all().forEach { listing ->
            val evaluation = valuation.evaluate(
                ValuationRequest(
                    listing = listing,
                    goal = Ranking.bestGoal(listing, activeGoals),
                    memory = mem,
                    nowMillis = nowMillis,
                    evaluationId = "eval-${listing.id}-$nowMillis",
                )
            )
            evaluations.upsert(evaluation)
        }
    }
}

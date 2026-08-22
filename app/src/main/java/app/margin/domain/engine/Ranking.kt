package app.margin.domain.engine

import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import app.margin.domain.model.Listing

/**
 * How the Opportunities feed is ordered.
 *
 * Relevance to an active goal dominates, value is the tie-breaker, and freshness only nudges.
 * The resulting score is exposed in the UI as the reason a row is where it is, so the ranking
 * is never a black box.
 */
object Ranking {

    data class Ranked(
        val listing: Listing,
        val evaluation: Evaluation,
        val goal: Goal?,
        val relevance: Double,
        val rankScore: Double,
    )

    /** 1.0 = squarely inside a goal, 0.5 = unrelated to anything the user asked for. */
    fun relevance(listing: Listing, goal: Goal?): Double {
        if (goal == null) return 0.5
        var score = 0.0
        if (listing.category == goal.category) score += 0.40

        val haystack = "${listing.title} ${listing.brand} ${listing.model} ${listing.description}".lowercase()
        val hits = goal.keywords.count { kw -> kw.isNotBlank() && haystack.contains(kw.lowercase()) }
        if (goal.keywords.isNotEmpty()) {
            score += 0.35 * (hits.toDouble() / goal.keywords.size)
        } else {
            score += 0.18
        }

        when (goal.kind) {
            GoalKind.BUY ->
                if (listing.askingPriceMinor <= goal.budgetMaxMinor) score += 0.25
                else if (listing.askingPriceMinor <= goal.budgetMaxMinor * 12 / 10) score += 0.10
            GoalKind.FLIP ->
                if (listing.askingPriceMinor <= goal.budgetMaxMinor) score += 0.25
        }

        return score.coerceIn(0.0, 1.0)
    }

    fun rank(
        items: List<Triple<Listing, Evaluation, Goal?>>,
        nowMillis: Long,
    ): List<Ranked> = items.map { (listing, evaluation, goal) ->
        val relevance = relevance(listing, goal)
        val value = evaluation.dealScore.toDouble()

        // Freshness is worth a few points at most: a great deal from last week still beats a
        // mediocre one from this morning.
        val ageDays = ((nowMillis - listing.listedAtMillis) / 86_400_000L).coerceAtLeast(0L)
        val freshness = when {
            ageDays <= 1 -> 6.0
            ageDays <= 3 -> 4.0
            ageDays <= 7 -> 2.0
            ageDays <= 21 -> 0.0
            else -> -3.0
        }

        // Profit on a flip goal is the point, so it gets an explicit lift.
        val profitBoost = if (goal?.kind == GoalKind.FLIP && evaluation.netProfitMinor >= goal.targetProfitMinMinor) 8.0 else 0.0

        Ranked(
            listing = listing,
            evaluation = evaluation,
            goal = goal,
            relevance = relevance,
            rankScore = value * (0.55 + 0.45 * relevance) + freshness + profitBoost,
        )
    }.sortedByDescending { it.rankScore }

    /** Picks the goal a listing best belongs to, or null if none is a reasonable fit. */
    fun bestGoal(listing: Listing, goals: List<Goal>): Goal? =
        goals.filter { it.active }
            .map { it to relevance(listing, it) }
            .filter { it.second >= 0.50 }
            .maxByOrNull { it.second }
            ?.first
}

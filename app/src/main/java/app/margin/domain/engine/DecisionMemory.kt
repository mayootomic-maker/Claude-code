package app.margin.domain.engine

import app.margin.core.format.Money
import app.margin.domain.model.Decision
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Listing
import app.margin.domain.model.MarketKey

/**
 * What Margin has learned from the user's own decisions.
 *
 * This is the mechanism behind "recommendations stay consistent": every Watch, Reject and
 * Bought is folded into brand and category affinities, which then shift the deal score and,
 * crucially, are said out loud in the verdict. The user can always see why an item scored
 * differently than an identical one would have last week.
 *
 * Deliberately simple and inspectable. It is a real feedback loop, not a decorative one.
 */
data class DecisionMemory(
    val rejectedByBrand: Map<String, Int>,
    val boughtByBrand: Map<String, Int>,
    val rejectedByCategory: Map<String, Int>,
    /** Mean asking price of the listings the user rejected, per category. */
    val avgRejectedAskByCategory: Map<String, Long>,
    val totalDecisions: Int,
) {

    data class Assessment(val scoreDelta: Int, val note: String?)

    fun assess(listing: Listing): Assessment {
        if (totalDecisions == 0) return Assessment(0, null)

        val brand = MarketKey.norm(listing.brand)
        val category = listing.category.slug
        var delta = 0
        val notes = mutableListOf<String>()

        val rejectedSameBrand = rejectedByBrand[brand] ?: 0
        val boughtSameBrand = boughtByBrand[brand] ?: 0

        if (rejectedSameBrand >= 2 && boughtSameBrand == 0) {
            delta -= 6
            notes += "You have passed on $rejectedSameBrand ${listing.brand} listings before."
        } else if (rejectedSameBrand == 1 && boughtSameBrand == 0) {
            delta -= 2
        }

        if (boughtSameBrand >= 1) {
            delta += 4
            notes += "You bought ${listing.brand} before, so this is a known quantity."
        }

        val rejectedSameCategory = rejectedByCategory[category] ?: 0
        if (rejectedSameCategory >= 3 && boughtSameBrand == 0) {
            delta -= 3
        }

        // The most useful thing memory can say: how this compares to what they already turned down.
        avgRejectedAskByCategory[category]?.let { avg ->
            if (avg > 0 && rejectedSameCategory >= 2) {
                val cheaperBy = avg - listing.askingPriceMinor
                if (cheaperBy > avg / 8) {
                    delta += 4
                    notes += "Cheaper than the ${listing.category.label.lowercase()} you rejected " +
                        "(average ${Money.format(avg, listing.currency)})."
                } else if (cheaperBy < -avg / 8) {
                    delta -= 3
                    notes += "Dearer than the ${listing.category.label.lowercase()} you already rejected " +
                        "(average ${Money.format(avg, listing.currency)})."
                }
            }
        }

        return Assessment(
            scoreDelta = delta.coerceIn(-12, 10),
            note = notes.takeIf { it.isNotEmpty() }?.joinToString(" "),
        )
    }

    companion object {
        val EMPTY = DecisionMemory(emptyMap(), emptyMap(), emptyMap(), emptyMap(), 0)

        fun from(decisions: List<Decision>, listingsById: Map<String, Listing>): DecisionMemory {
            if (decisions.isEmpty()) return EMPTY
            val rejectedBrand = mutableMapOf<String, Int>()
            val boughtBrand = mutableMapOf<String, Int>()
            val rejectedCategory = mutableMapOf<String, Int>()
            val rejectedTotals = mutableMapOf<String, Long>()
            val rejectedCounts = mutableMapOf<String, Int>()

            decisions.forEach { d ->
                val listing = listingsById[d.listingId] ?: return@forEach
                val brand = MarketKey.norm(listing.brand)
                val category = listing.category.slug
                when (d.type) {
                    DecisionType.REJECT -> {
                        rejectedBrand[brand] = (rejectedBrand[brand] ?: 0) + 1
                        rejectedCategory[category] = (rejectedCategory[category] ?: 0) + 1
                        rejectedTotals[category] = (rejectedTotals[category] ?: 0L) + listing.askingPriceMinor
                        rejectedCounts[category] = (rejectedCounts[category] ?: 0) + 1
                    }
                    DecisionType.BOUGHT -> boughtBrand[brand] = (boughtBrand[brand] ?: 0) + 1
                    DecisionType.WATCH -> Unit
                }
            }

            val averages = rejectedTotals.mapValues { (cat, total) ->
                val n = rejectedCounts[cat] ?: 1
                total / n
            }

            return DecisionMemory(
                rejectedByBrand = rejectedBrand,
                boughtByBrand = boughtBrand,
                rejectedByCategory = rejectedCategory,
                avgRejectedAskByCategory = averages,
                totalDecisions = decisions.size,
            )
        }
    }
}

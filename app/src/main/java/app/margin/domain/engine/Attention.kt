package app.margin.domain.engine

import app.margin.core.format.Money
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.SaleDraftStatus
import app.margin.domain.model.Verdict
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * What Today is made of.
 *
 * Today is not a summary of the other tabs. It is a queue of things that changed or are
 * rotting, computed from state, and it is allowed to be empty. If nothing here fires, Today
 * says so in one line rather than backfilling with content the user can already see elsewhere.
 */
enum class AttentionKind(val basePriority: Int) {
    PRICE_DROP(90),
    VERDICT_IMPROVED(85),
    SELL_NOW(80),
    PRICE_RISE(55),
    VERDICT_WORSENED(60),
    DRAFT_OPEN(50),
    STALE_WATCH(40),
}

data class AttentionItem(
    val id: String,
    val kind: AttentionKind,
    val priority: Int,
    val headline: String,
    val detail: String,
    val amountMinor: Long? = null,
    val listingId: String? = null,
    val ownedItemId: String? = null,
    val saleDraftId: String? = null,
)

data class WatchedItem(
    val listing: Listing,
    val evaluation: Evaluation,
    val watchedAtMillis: Long,
    /** The score recorded when the user pressed Watch, so drift is measurable. */
    val scoreAtWatch: Int,
    val verdictAtWatch: Verdict,
)

object AttentionEngine {

    private const val DAY = 86_400_000L

    /** A watched item with no decision after this long is asked about. */
    const val StaleWatchDays = 12

    fun compute(
        watched: List<WatchedItem>,
        owned: List<OwnedItem>,
        drafts: List<SaleDraft>,
        nowMillis: Long,
        currency: String = "CHF",
    ): List<AttentionItem> {
        val items = mutableListOf<AttentionItem>()

        watched.forEach { w ->
            val listing = w.listing
            val drop = listing.priceDropMinor
            val lastMove = listing.priceHistory.lastOrNull()

            if (drop > 0 && listing.priceHistory.size >= 2) {
                items += AttentionItem(
                    id = "drop-${listing.id}",
                    kind = AttentionKind.PRICE_DROP,
                    priority = AttentionKind.PRICE_DROP.basePriority +
                        (listing.priceDropFraction * 40).roundToLong().toInt(),
                    headline = "${listing.title} dropped ${Money.format(drop, currency)}",
                    detail = "Now ${Money.format(listing.askingPriceMinor, currency)}, " +
                        "${Money.percent(listing.priceDropFraction)} below where it started. " +
                        walkAway(w.evaluation, currency),
                    amountMinor = drop,
                    listingId = listing.id,
                )
            } else if (drop < 0 && lastMove != null) {
                items += AttentionItem(
                    id = "rise-${listing.id}",
                    kind = AttentionKind.PRICE_RISE,
                    priority = AttentionKind.PRICE_RISE.basePriority,
                    headline = "${listing.title} went up ${Money.format(-drop, currency)}",
                    detail = "Now ${Money.format(listing.askingPriceMinor, currency)}. " +
                        "Sellers who raise prices rarely negotiate.",
                    amountMinor = drop,
                    listingId = listing.id,
                )
            }

            val scoreDelta = w.evaluation.dealScore - w.scoreAtWatch
            if (w.evaluation.verdict != w.verdictAtWatch || abs(scoreDelta) >= 8) {
                val improved = w.evaluation.dealScore > w.scoreAtWatch
                items += AttentionItem(
                    id = "verdict-${listing.id}",
                    kind = if (improved) AttentionKind.VERDICT_IMPROVED else AttentionKind.VERDICT_WORSENED,
                    priority = (if (improved) AttentionKind.VERDICT_IMPROVED else AttentionKind.VERDICT_WORSENED)
                        .basePriority + abs(scoreDelta),
                    headline = "${listing.title} is now ${w.evaluation.verdict.label.lowercase()}",
                    detail = "Deal score moved ${if (scoreDelta > 0) "+" else ""}$scoreDelta to " +
                        "${w.evaluation.dealScore}, from ${w.verdictAtWatch.label.lowercase()}. " +
                        w.evaluation.headline,
                    listingId = listing.id,
                )
            }

            val watchedDays = ((nowMillis - w.watchedAtMillis) / DAY).toInt()
            if (watchedDays >= StaleWatchDays && items.none { it.listingId == listing.id }) {
                items += AttentionItem(
                    id = "stale-${listing.id}",
                    kind = AttentionKind.STALE_WATCH,
                    priority = AttentionKind.STALE_WATCH.basePriority + watchedDays.coerceAtMost(30),
                    headline = "Still watching ${listing.title}",
                    detail = "$watchedDays days without a decision and the price has not moved. " +
                        "Make an offer or drop it.",
                    listingId = listing.id,
                )
            }
        }

        owned.filter { it.status == OwnedStatus.OWNED }.forEach { item ->
            val signal = sellSignal(item, nowMillis) ?: return@forEach
            items += signal
        }

        drafts.filter { it.status == SaleDraftStatus.DRAFT }.forEach { draft ->
            items += AttentionItem(
                id = "draft-${draft.id}",
                kind = AttentionKind.DRAFT_OPEN,
                priority = AttentionKind.DRAFT_OPEN.basePriority +
                    ((nowMillis - draft.createdAtMillis) / DAY).toInt().coerceAtMost(20),
                headline = "Unfinished listing: ${draft.title}",
                detail = "Priced at ${Money.format(draft.askPriceMinor, currency)} and not posted yet. " +
                    "${draft.photosDone} of ${draft.photosTotal} preparation steps done.",
                amountMinor = draft.askPriceMinor,
                saleDraftId = draft.id,
                ownedItemId = draft.ownedItemId,
            )
        }

        return items.sortedByDescending { it.priority }
    }

    private fun walkAway(evaluation: Evaluation, currency: String): String =
        if (evaluation.negotiationGapMinor <= 0) {
            "That is under your walk-away price of ${Money.format(evaluation.maxBidMinor, currency)}."
        } else {
            "Still ${Money.format(evaluation.negotiationGapMinor, currency)} above your walk-away " +
                "price of ${Money.format(evaluation.maxBidMinor, currency)}."
        }

    /**
     * Owned goods lose value continuously. This fires when holding is measurably costing
     * money, or when the item is far enough ahead that taking the profit is the right call.
     */
    fun sellSignal(item: OwnedItem, nowMillis: Long, currency: String = "CHF"): AttentionItem? {
        val profile = CategoryProfiles.of(item.category)
        val heldDays = ((nowMillis - item.purchasedAtMillis) / DAY).toInt()
        val monthlyDecayFraction = 1.0 - (1.0 - profile.annualDepreciation).pow(1.0 / 12.0)
        val monthlyLoss = (item.currentValueMinor * monthlyDecayFraction).roundToLong()

        val gain = item.unrealisedMinor
        val gainFraction = if (item.purchasePriceMinor > 0) {
            gain.toDouble() / item.purchasePriceMinor.toDouble()
        } else 0.0

        return when {
            gainFraction >= 0.18 && heldDays >= 14 -> AttentionItem(
                id = "sell-${item.id}",
                kind = AttentionKind.SELL_NOW,
                priority = AttentionKind.SELL_NOW.basePriority + (gainFraction * 30).roundToLong().toInt(),
                headline = "${item.title} is up ${Money.percent(gainFraction)}",
                detail = "Worth ${Money.format(item.currentValueMinor, currency)} against " +
                    "${Money.format(item.purchasePriceMinor, currency)} paid. It sheds about " +
                    "${Money.format(monthlyLoss, currency)} a month from here.",
                amountMinor = gain,
                ownedItemId = item.id,
            )
            heldDays >= 75 && monthlyLoss >= 1_500 -> AttentionItem(
                id = "sell-${item.id}",
                kind = AttentionKind.SELL_NOW,
                priority = AttentionKind.SELL_NOW.basePriority - 10 + (heldDays / 30),
                headline = "${item.title} is costing you to hold",
                detail = "Held $heldDays days and losing about ${Money.format(monthlyLoss, currency)} " +
                    "a month. Current value ${Money.format(item.currentValueMinor, currency)}.",
                amountMinor = -monthlyLoss,
                ownedItemId = item.id,
            )
            else -> null
        }
    }

    /**
     * Re-values an owned item using the same engine that valued it at purchase, so Owned is
     * computed rather than a stored constant that silently goes stale.
     */
    fun currentValueOf(
        item: OwnedItem,
        market: MarketDataSource,
        nowMillis: Long,
    ): Long {
        val profile = market.categoryDefaults(item.category)
        val model = market.lookup(item.category, item.brand, "")
        val dep = model?.annualDepreciation ?: profile.annualDepreciation
        val floorFraction = model?.floorFraction ?: profile.floorFraction

        val anchor = item.fairValueAtPurchaseMinor ?: item.purchasePriceMinor
        val heldYears = ((nowMillis - item.purchasedAtMillis).coerceAtLeast(0L)).toDouble() /
            (365.0 * DAY)
        val decayed = anchor * (1.0 - dep).pow(heldYears)
        val floor = (model?.newPriceMinor?.times(floorFraction)) ?: (anchor * floorFraction)
        return maxOf(decayed, floor).roundToLong()
    }
}

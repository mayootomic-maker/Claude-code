package app.margin.domain.model

import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------

enum class GoalKind { BUY, FLIP }

/**
 * A closed set. Free-text categories made goal matching depend on two strings agreeing,
 * which they eventually do not ("Cycling" vs "Bicycles"), silently orphaning listings from
 * the goal they belong to.
 */
enum class Category(val slug: String, val label: String) {
    BIKE("bike", "Bikes"),
    PC("pc", "Desktop PCs"),
    LAPTOP("laptop", "Laptops"),
    CAMERA("camera", "Cameras"),
    PHONE("phone", "Phones"),
    AUDIO("audio", "Audio"),
    WATCH("watch", "Watches"),
    TOOL("tool", "Tools"),
    FURNITURE("furniture", "Furniture"),
    DRONE("drone", "Drones"),
    INSTRUMENT("instrument", "Instruments"),
    OTHER("general", "Other");

    companion object {
        fun fromSlug(raw: String?): Category =
            entries.firstOrNull { it.slug == raw?.lowercase()?.trim() } ?: OTHER
    }
}

/**
 * Condition multipliers are expressed relative to GOOD, because GOOD is what the vast
 * majority of second-hand comparables actually are.
 */
enum class Condition(val label: String, val multiplier: Double, val rank: Int) {
    NEW("New", 1.30, 5),
    LIKE_NEW("Like new", 1.14, 4),
    GOOD("Good", 1.00, 3),
    FAIR("Fair", 0.84, 2),
    POOR("Poor", 0.66, 1),
    FOR_PARTS("For parts", 0.38, 0);

    companion object {
        fun from(raw: String?): Condition = when (raw?.lowercase()?.trim()) {
            "new", "sealed", "brand new" -> NEW
            "like new", "as new", "mint", "excellent" -> LIKE_NEW
            "good", "very good", "used" -> GOOD
            "fair", "worn", "acceptable" -> FAIR
            "poor", "damaged", "faulty" -> POOR
            "for parts", "parts", "spares", "broken" -> FOR_PARTS
            else -> GOOD
        }
    }
}

enum class Verdict(val label: String, val short: String) {
    STRONG_BUY("Strong buy", "Buy"),
    BUY("Buy", "Buy"),
    WATCH("Worth watching", "Watch"),
    PASS("Pass", "Pass"),
    AVOID("Avoid", "Avoid");

    val isPositive get() = this == STRONG_BUY || this == BUY
}

enum class Confidence(val label: String) { LOW("Low"), MEDIUM("Medium"), HIGH("High") }

enum class DecisionType { WATCH, REJECT, BOUGHT }

/** Where a listing's data actually came from. Always surfaced in the UI. */
enum class Provenance(val label: String) {
    SEEDED("Demo catalogue"),
    PARSED_URL("Parsed from link"),
    MANUAL("Entered by hand"),
}

enum class OwnedStatus(val label: String) { OWNED("Owned"), LISTED("Listed"), SOLD("Sold") }

enum class RiskSeverity(val weight: Int) { INFO(1), CAUTION(6), SERIOUS(14) }

enum class SellerType(val label: String) {
    PRIVATE("Private seller"), DEALER("Dealer"), UNKNOWN("Unknown seller"),
}

/**
 * Sale channels differ in what fraction of fair value they realise and what they charge.
 * These numbers drive the resale estimate and the Sell flow's channel recommendation.
 */
enum class SaleChannel(
    val label: String,
    val realisation: Double,
    val feeFraction: Double,
    val typicalDays: Int,
    val note: String,
) {
    LOCAL_MARKETPLACE("Local marketplace", 0.94, 0.00, 18, "No fees, slower, meet in person"),
    SPECIALIST("Specialist platform", 1.04, 0.13, 26, "Best price, takes a cut, buyers know the product"),
    AUCTION("Auction", 0.86, 0.11, 9, "Fastest clean exit, you accept the room's price"),
    TRADE_IN("Trade-in", 0.62, 0.00, 2, "Immediate, worst price, zero effort");

    /** What lands in your pocket for a given fair value. */
    fun netFor(fairValueMinor: Long): Long =
        ((fairValueMinor * realisation) * (1.0 - feeFraction)).toLong()
}

enum class SaleDraftStatus(val label: String) {
    DRAFT("Draft"), LISTED("Listed"), SOLD("Sold"),
}

// ---------------------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------------------

data class Goal(
    val id: String,
    val title: String,
    val kind: GoalKind,
    val category: Category,
    val budgetMaxMinor: Long,
    val targetProfitMinMinor: Long,
    val keywords: List<String>,
    val conditionFloor: Condition,
    val currency: String = "CHF",
    val active: Boolean = true,
    val note: String = "",
    val createdAtMillis: Long = 0L,
)

data class Listing(
    val id: String,
    val url: String,
    val sourceName: String,
    val provenance: Provenance,
    val title: String,
    val brand: String,
    val model: String,
    val year: Int?,
    val category: Category,
    val condition: Condition,
    val askingPriceMinor: Long,
    val currency: String = "CHF",
    val location: String,
    val sellerType: SellerType,
    val sellerRatingPct: Int?,
    val listedAtMillis: Long,
    val description: String,
    val specs: Map<String, String> = emptyMap(),
    val imageCount: Int = 0,
    val capturedAtMillis: Long = 0L,
    /** Oldest first. The current asking price is always [askingPriceMinor]. */
    val priceHistory: List<PricePoint> = emptyList(),
) {
    val marketKey: String get() = MarketKey.of(category.slug, brand, model)

    /** Positive when the price has come down since the listing first appeared. */
    val priceDropMinor: Long
        get() = priceHistory.firstOrNull()?.let { it.priceMinor - askingPriceMinor } ?: 0L

    val priceDropFraction: Double
        get() = priceHistory.firstOrNull()
            ?.takeIf { it.priceMinor > 0 }
            ?.let { priceDropMinor.toDouble() / it.priceMinor.toDouble() } ?: 0.0

    fun daysListed(nowMillis: Long): Int =
        (((nowMillis - listedAtMillis) / 86_400_000L).coerceAtLeast(0L)).toInt()
}

object MarketKey {
    fun of(category: String, brand: String, model: String): String =
        "${norm(category)}:${norm(brand)}:${norm(model)}"

    fun norm(s: String): String = s.lowercase().trim().replace(Regex("[^a-z0-9]+"), "-").trim('-')
}

/** One observed asking price for a listing, at a point in time. */
@Serializable
data class PricePoint(val priceMinor: Long, val atMillis: Long)

@Serializable
data class Comp(
    val label: String,
    val priceMinor: Long,
    val conditionName: String,
    val ageMonths: Int,
    val soldDaysAgo: Int,
    val source: String,
) {
    val condition: Condition get() = runCatching { Condition.valueOf(conditionName) }.getOrDefault(Condition.GOOD)
}

@Serializable
data class Risk(
    val severityName: String,
    val title: String,
    val detail: String,
    /**
     * False for flags that must be surfaced without moving the score — chiefly
     * "priced suspiciously low", which otherwise makes a cheaper listing score worse.
     */
    val affectsScore: Boolean = true,
) {
    val severity: RiskSeverity
        get() = runCatching { RiskSeverity.valueOf(severityName) }.getOrDefault(RiskSeverity.INFO)
}

data class Evaluation(
    val id: String,
    val listingId: String,
    val goalId: String?,
    val fairValueMinor: Long,
    val fairLowMinor: Long,
    val fairHighMinor: Long,
    val dealScore: Int,
    /** Score before decision memory is applied; [dealScore] = baseScore + memoryDelta. */
    val baseScore: Int,
    val memoryDelta: Int,
    val resaleValueMinor: Long,
    val refurbCostMinor: Long,
    val feeCostMinor: Long,
    val logisticsCostMinor: Long,
    /** Cost of capital while the item sits unsold on the chosen channel. */
    val holdingCostMinor: Long,
    val netProfitMinor: Long,
    val recommendedChannel: SaleChannel,
    /** Do not pay more than this and still hit the goal's profit requirement. */
    val maxBidMinor: Long,
    val confidence: Confidence,
    val verdict: Verdict,
    val headline: String,
    val rationale: List<String>,
    val risks: List<Risk>,
    val comparables: List<Comp>,
    val personalNote: String?,
    /** True when no comparable sales exist for this model and the value is a category anchor. */
    val pricedOffDifferentModel: Boolean,
    /** False when the engine has no basis at all and declines to state a value. */
    val hasMarketData: Boolean,
    val engineId: String,
    val askingPriceMinor: Long,
    val createdAtMillis: Long,
) {
    /** Positive when the asking price is below fair value. */
    val discountMinor: Long get() = fairValueMinor - askingPriceMinor

    /** Fraction below (positive) or above (negative) fair value. */
    val discountFraction: Double
        get() = if (fairValueMinor <= 0L) 0.0 else discountMinor.toDouble() / fairValueMinor.toDouble()

    val marginFraction: Double
        get() = if (askingPriceMinor <= 0L) 0.0 else netProfitMinor.toDouble() / askingPriceMinor.toDouble()

    val seriousRisks: List<Risk> get() = risks.filter { it.severity == RiskSeverity.SERIOUS }

    /** How far the seller has to come down before this clears the bar. Negative = already there. */
    val negotiationGapMinor: Long get() = askingPriceMinor - maxBidMinor

    val totalCostMinor: Long
        get() = askingPriceMinor + refurbCostMinor + logisticsCostMinor
}

data class Decision(
    val id: String,
    val listingId: String,
    val type: DecisionType,
    val reason: String,
    val note: String = "",
    val createdAtMillis: Long,
)

data class OwnedItem(
    val id: String,
    val listingId: String?,
    val title: String,
    val brand: String,
    val category: Category,
    val condition: Condition,
    val purchasePriceMinor: Long,
    val purchasedAtMillis: Long,
    val currentValueMinor: Long,
    val status: OwnedStatus,
    val soldPriceMinor: Long? = null,
    val soldAtMillis: Long? = null,
    val currency: String = "CHF",
    val note: String = "",
    val year: Int? = null,
    /** What the engine said this would clear when it was bought. Enables an honest scorecard. */
    val predictedNetMinor: Long? = null,
    val fairValueAtPurchaseMinor: Long? = null,
) {
    val unrealisedMinor: Long get() = currentValueMinor - purchasePriceMinor
    val realisedMinor: Long? get() = soldPriceMinor?.let { it - purchasePriceMinor }

    /** Positive when the sale beat what Margin predicted at purchase. */
    val predictionErrorMinor: Long?
        get() = if (soldPriceMinor != null && predictedNetMinor != null) {
            (soldPriceMinor - purchasePriceMinor) - predictedNetMinor
        } else null
}

@Serializable
data class PhotoTask(
    val id: String,
    val label: String,
    val hint: String,
    val done: Boolean = false,
    val required: Boolean = true,
)

data class SaleDraft(
    val id: String,
    val ownedItemId: String,
    val channel: SaleChannel,
    val askPriceMinor: Long,
    val floorPriceMinor: Long,
    val quickSalePriceMinor: Long,
    val title: String,
    val body: String,
    val photoTasks: List<PhotoTask>,
    val status: SaleDraftStatus,
    val createdAtMillis: Long,
) {
    val photosDone: Int get() = photoTasks.count { it.done }
    val photosTotal: Int get() = photoTasks.size
}

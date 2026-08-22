package app.margin.domain.engine

import app.margin.core.format.Money
import app.margin.domain.model.Category
import app.margin.domain.model.Comp
import app.margin.domain.model.Condition
import app.margin.domain.model.Confidence
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import app.margin.domain.model.Listing
import app.margin.domain.model.Risk
import app.margin.domain.model.RiskSeverity
import app.margin.domain.model.SaleChannel
import app.margin.domain.model.SellerType
import app.margin.domain.model.Verdict
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

data class ValuationRequest(
    val listing: Listing,
    val goal: Goal? = null,
    val memory: DecisionMemory = DecisionMemory.EMPTY,
    val nowMillis: Long,
    val evaluationId: String,
)

/** The seam an external pricing or LLM service would implement. */
interface ValuationService {
    val engineId: String
    suspend fun evaluate(request: ValuationRequest): Evaluation
}

/**
 * Margin's shipped valuation engine: deterministic, local, and pure enough to unit test.
 *
 * Pipeline: comparable sales -> normalise to this item's age and condition -> fair value,
 * band and confidence -> refurbishment -> resale channel -> net profit -> risk rules ->
 * deal score -> verdict -> copy.
 *
 * Three invariants are enforced and covered by tests, because breaking any of them makes the
 * app lie to the user:
 *  1. low <= fair <= high, always.
 *  2. The score never falls when the asking price falls, everything else held constant.
 *  3. Refurbishment never makes a worse-condition item the more profitable buy.
 */
class HeuristicValuationEngine(
    private val market: MarketDataSource,
) : ValuationService {

    override val engineId: String = "local-heuristic-v2"

    override suspend fun evaluate(request: ValuationRequest): Evaluation = compute(request)

    /** Cost of capital per day, as a fraction of the item's value. ~1.2% a month. */
    private val dailyCapitalCost = 0.0004

    fun compute(request: ValuationRequest): Evaluation {
        val listing = request.listing
        val profile = market.categoryDefaults(listing.category)
        val exact = market.lookup(listing.category, listing.brand, listing.model)
        val exactKey = app.margin.domain.model.MarketKey.of(
            listing.category.slug, listing.brand, listing.model,
        )
        val isExactMatch = exact != null && exact.key == exactKey
        val model = exact

        val ageMonths = ageMonths(listing, model, request.nowMillis)
        val basis = fairValueBasis(listing, model, profile, ageMonths, isExactMatch)

        val fairGood = basis.goodValueMinor
        val fair = (fairGood * listing.condition.multiplier).roundToLong()
        // Enforced here rather than trusted: an inverted range is visible nonsense in the UI.
        val low = (basis.lowGoodMinor * listing.condition.multiplier).roundToLong().coerceAtMost(fair)
        val high = (basis.highGoodMinor * listing.condition.multiplier).roundToLong().coerceAtLeast(fair)

        val refurb = refurbPlan(listing, fairGood, profile)
        val resaleBase = (fairGood * refurb.resultingCondition.multiplier).roundToLong()

        val liquidity = model?.liquidity ?: profile.liquidity
        val channel = bestChannel(resaleBase, liquidity, request.goal)

        val resale = (resaleBase * realisationFor(channel, liquidity)).roundToLong()
        val fees = (resale * channel.feeFraction).roundToLong()
        val logistics = profile.logisticsMinor
        val holding = (resaleBase * dailyCapitalCost * channel.typicalDays).roundToLong()
        val net = resale - fees - listing.askingPriceMinor - refurb.costMinor - logistics - holding

        // The walk-away price: pay more than this and the goal stops being met.
        val requiredProfit = when (request.goal?.kind) {
            GoalKind.FLIP -> request.goal.targetProfitMinMinor
            else -> 0L
        }
        val maxBid = (resale - fees - refurb.costMinor - logistics - holding - requiredProfit)
            .coerceAtLeast(0L)

        val risks = risks(listing, request, fair, low, refurb, basis, ageMonths)
        val personal = request.memory.assess(listing)

        val confidence = basis.confidence
        val baseScore = dealScore(
            listing = listing,
            goal = request.goal,
            fair = fair,
            net = net,
            liquidity = liquidity,
            risks = risks,
            confidence = confidence,
            hasMarketData = basis.hasMarketData,
        )
        // Memory is evidence about the user, not about the market, so it is applied after the
        // market-confidence damping - but it is damped itself when the market read is weak,
        // and it is always shown as explicit arithmetic in the UI.
        val memoryDelta = if (confidence == Confidence.LOW) {
            (personal.scoreDelta * 0.6).roundToLong().toInt()
        } else {
            personal.scoreDelta
        }.coerceIn(-8, 8)
        val score = (baseScore + memoryDelta).coerceIn(0, 100)

        val verdict = verdict(score, listing, request.goal, net, risks, confidence, basis.hasMarketData)

        return Evaluation(
            id = request.evaluationId,
            listingId = listing.id,
            goalId = request.goal?.id,
            fairValueMinor = fair,
            fairLowMinor = low,
            fairHighMinor = high,
            dealScore = score,
            baseScore = baseScore,
            memoryDelta = memoryDelta,
            resaleValueMinor = resale,
            refurbCostMinor = refurb.costMinor,
            feeCostMinor = fees,
            logisticsCostMinor = logistics,
            holdingCostMinor = holding,
            netProfitMinor = net,
            maxBidMinor = maxBid,
            recommendedChannel = channel,
            confidence = confidence,
            verdict = verdict,
            headline = headline(verdict, listing, fair, net, request.goal, basis.hasMarketData),
            rationale = rationale(
                listing, request.goal, fair, low, high, resale, refurb, fees, logistics,
                holding, net, maxBid, channel, basis, liquidity,
            ),
            risks = risks,
            comparables = basis.usedComps,
            personalNote = personal.note,
            pricedOffDifferentModel = basis.pricedOffDifferentModel,
            hasMarketData = basis.hasMarketData,
            engineId = engineId,
            askingPriceMinor = listing.askingPriceMinor,
            createdAtMillis = request.nowMillis,
        )
    }

    // -- Fair value ------------------------------------------------------------------------

    private data class Basis(
        val goodValueMinor: Long,
        val lowGoodMinor: Long,
        val highGoodMinor: Long,
        val confidence: Confidence,
        val usedComps: List<Comp>,
        val method: String,
        val hasMarketData: Boolean,
        val pricedOffDifferentModel: Boolean,
        val ageUncertain: Boolean,
    )

    private fun fairValueBasis(
        listing: Listing,
        model: MarketModel?,
        profile: CategoryProfile,
        ageMonths: Int,
        isExactMatch: Boolean,
    ): Basis {
        val dep = model?.annualDepreciation ?: profile.annualDepreciation
        val comps = model?.comps.orEmpty()
        val ageUncertain = listing.year == null && model == null

        if (comps.size >= 3) {
            // Normalise each comparable to "this item's age, in GOOD condition", then weight
            // by recency: a sale from last week says more than one from two months ago.
            val weighted = comps.map { c ->
                val conditionAdjusted = c.priceMinor / c.condition.multiplier
                val yearsApart = (ageMonths - c.ageMonths) / 12.0
                val value = conditionAdjusted * (1.0 - dep).pow(yearsApart)
                val weight = 1.0 / (1.0 + c.soldDaysAgo / 45.0)
                value to weight
            }
            val values = weighted.map { it.first }.sorted()

            val median = weightedPercentile(weighted, 0.50)
            val p25 = percentile(values, 0.25)
            val p75 = percentile(values, 0.75)
            val spread = if (median > 0) (p75 - p25) / median else 1.0

            val confidence = when {
                !isExactMatch -> Confidence.LOW
                comps.size >= 5 && spread < 0.22 -> Confidence.HIGH
                comps.size >= 3 && spread < 0.42 -> Confidence.MEDIUM
                else -> Confidence.LOW
            }

            val floor = model?.let { it.newPriceMinor * it.floorFraction } ?: 0.0
            // A used item in GOOD condition cannot be worth more than a new one.
            val ceiling = model?.newPriceMinor?.times(0.95) ?: Double.MAX_VALUE

            val good = median.coerceIn(floor, ceiling)
            return Basis(
                goodValueMinor = good.roundToLong(),
                lowGoodMinor = minOf(p25, good * 0.94).coerceIn(floor * 0.85, good).roundToLong(),
                highGoodMinor = maxOf(p75, good * 1.06).coerceIn(good, ceiling * 1.05).roundToLong(),
                confidence = confidence,
                usedComps = comps.sortedBy { it.soldDaysAgo },
                method = if (isExactMatch) "${comps.size} comparable sales"
                else "${comps.size} comparable sales for a different model by the same maker",
                hasMarketData = true,
                pricedOffDifferentModel = !isExactMatch,
                ageUncertain = ageUncertain,
            )
        }

        if (model != null) {
            val years = ageMonths / 12.0
            val decayed = model.newPriceMinor * (1.0 - model.annualDepreciation).pow(years)
            val good = decayed.coerceIn(
                model.newPriceMinor * model.floorFraction,
                model.newPriceMinor * 0.95,
            )
            return Basis(
                goodValueMinor = good.roundToLong(),
                lowGoodMinor = (good * 0.84).roundToLong(),
                highGoodMinor = (good * 1.16).roundToLong(),
                confidence = Confidence.LOW,
                usedComps = comps,
                method = "depreciation curve, too few comparable sales",
                hasMarketData = true,
                pricedOffDifferentModel = !isExactMatch,
                ageUncertain = ageUncertain,
            )
        }

        val anchor = market.categoryAnchor(listing.category)
        if (anchor == null) {
            // No basis at all. The engine declines to invent one: deriving "fair value" from
            // the seller's own asking price would make every listing look correctly priced.
            return Basis(
                goodValueMinor = listing.askingPriceMinor,
                lowGoodMinor = listing.askingPriceMinor,
                highGoodMinor = listing.askingPriceMinor,
                confidence = Confidence.LOW,
                usedComps = emptyList(),
                method = "no market data for this category",
                hasMarketData = false,
                pricedOffDifferentModel = false,
                ageUncertain = ageUncertain,
            )
        }

        val years = ageMonths / 12.0
        val decayed = anchor * (1.0 - profile.annualDepreciation).pow(years)
        val good = decayed.coerceIn(anchor * profile.floorFraction, anchor * 0.95)
        return Basis(
            goodValueMinor = good.roundToLong(),
            lowGoodMinor = (good * 0.72).roundToLong(),
            highGoodMinor = (good * 1.28).roundToLong(),
            confidence = Confidence.LOW,
            usedComps = emptyList(),
            method = "category average, this model is not in the local market table",
            hasMarketData = true,
            pricedOffDifferentModel = true,
            ageUncertain = ageUncertain,
        )
    }

    private fun percentile(sorted: List<Double>, q: Double): Double {
        if (sorted.isEmpty()) return 0.0
        if (sorted.size == 1) return sorted[0]
        val pos = q * (sorted.size - 1)
        val lo = pos.toInt()
        val hi = (lo + 1).coerceAtMost(sorted.lastIndex)
        return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo)
    }

    private fun weightedPercentile(pairs: List<Pair<Double, Double>>, q: Double): Double {
        if (pairs.isEmpty()) return 0.0
        val sorted = pairs.sortedBy { it.first }
        val total = sorted.sumOf { it.second }
        if (total <= 0.0) return percentile(sorted.map { it.first }, q)
        var acc = 0.0
        for ((value, weight) in sorted) {
            acc += weight
            if (acc >= q * total) return value
        }
        return sorted.last().first
    }

    /**
     * Uses a fixed UTC calendar: [Calendar.getInstance] follows the JVM default timezone,
     * which would make results machine-dependent and break the determinism this engine claims.
     */
    private fun ageMonths(listing: Listing, model: MarketModel?, nowMillis: Long): Int {
        val cal = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { timeInMillis = nowMillis }
        val nowYear = cal.get(Calendar.YEAR)
        val nowMonth = cal.get(Calendar.MONTH) + 1

        model?.let { m ->
            if (listing.year == null) return m.ageMonthsAt(nowYear, nowMonth)
            // Prefer the model's release month when the listing year matches it.
            if (listing.year == m.releasedYear) return m.ageMonthsAt(nowYear, nowMonth)
        }

        val year = listing.year ?: return 36
        // A listing that states only a year is treated as January of that year.
        return (((nowYear - year) * 12) + (nowMonth - 1)).coerceIn(0, 480)
    }

    // -- Refurbishment ------------------------------------------------------------------------

    private data class RefurbPlan(
        val costMinor: Long,
        val resultingCondition: Condition,
        val attempted: Boolean,
        val overrunFraction: Double,
    )

    /**
     * Refurbishment cost scales with the item's value, and only one condition rank can be
     * bought back. A flat per-category cost against a proportional uplift made worse condition
     * monotonically more profitable — the engine recommended buying scrap.
     *
     * Cost also carries an overrun allowance that grows as condition worsens, because that is
     * how refurbishment actually goes, and it is what stops a wreck from out-scoring a good one.
     */
    private fun refurbPlan(listing: Listing, fairGood: Long, profile: CategoryProfile): RefurbPlan {
        val nextRank = when (listing.condition) {
            Condition.NEW, Condition.LIKE_NEW, Condition.GOOD ->
                return RefurbPlan(0L, listing.condition, attempted = false, overrunFraction = 0.0)
            Condition.FAIR -> Condition.GOOD
            Condition.POOR -> Condition.FAIR
            Condition.FOR_PARTS -> Condition.POOR
        }

        val baseFraction = when (listing.condition) {
            Condition.FAIR -> 0.11
            Condition.POOR -> 0.16
            else -> 0.22
        }
        val overrun = when (listing.condition) {
            Condition.FAIR -> 0.15
            Condition.POOR -> 0.30
            else -> 0.50
        }

        var cost = maxOf(fairGood * baseFraction, profile.refurbToGoodMinor * 0.35)
        cost += specificWork(listing, profile, fairGood)
        cost *= (1.0 + overrun)

        val uplift = fairGood * (nextRank.multiplier - listing.condition.multiplier)

        // Work that costs more than the value it restores is work nobody does.
        return if (cost >= uplift) {
            RefurbPlan(0L, listing.condition, attempted = false, overrunFraction = overrun)
        } else {
            RefurbPlan(cost.roundToLong(), nextRank, attempted = true, overrunFraction = overrun)
        }
    }

    /** Named defects that carry a real, category-appropriate cost. */
    private fun specificWork(listing: Listing, profile: CategoryProfile, fairGood: Long): Double {
        var extra = 0.0
        listing.specs["battery_health_pct"]?.toIntOrNull()?.let { health ->
            // Proportional to the item, not a hardcoded e-bike battery price charged to phones.
            val packCost = when (listing.category) {
                Category.BIKE -> minOf(62_000.0, fairGood * 0.34)
                Category.LAPTOP, Category.PHONE -> minOf(14_000.0, fairGood * 0.20)
                else -> fairGood * 0.15
            }
            if (health < 72) extra += packCost else if (health < 85) extra += packCost * 0.20
        }
        if (listing.specs["service_history"]?.lowercase() == "none") {
            extra += profile.refurbToGoodMinor * 0.35
        }
        if (listing.specs["missing"]?.isNotBlank() == true) {
            extra += profile.refurbToGoodMinor * 0.5
        }
        return extra
    }

    // -- Channel ------------------------------------------------------------------------------

    /**
     * The liquidity effect is expressed as a realisation adjustment so it flows into the resale
     * figure the UI actually shows. Previously it only perturbed the choice, and the app could
     * recommend a channel while displaying a net lower than the one it silently rejected.
     */
    private fun realisationFor(channel: SaleChannel, liquidity: Double): Double {
        var r = channel.realisation
        if (liquidity < 0.60 && channel == SaleChannel.SPECIALIST) r *= 1.06
        if (liquidity > 0.82 && channel == SaleChannel.LOCAL_MARKETPLACE) r *= 1.04
        return r
    }

    private fun bestChannel(resaleBase: Long, liquidity: Double, goal: Goal?): SaleChannel {
        val candidates = SaleChannel.entries.filter { it != SaleChannel.TRADE_IN }
        return candidates.maxBy { channel ->
            netVia(resaleBase, channel, liquidity, goal)
        }
    }

    /** Exactly the expression reported downstream, so selection and display cannot disagree. */
    private fun netVia(resaleBase: Long, channel: SaleChannel, liquidity: Double, goal: Goal?): Double {
        val resale = resaleBase * realisationFor(channel, liquidity)
        val fees = resale * channel.feeFraction
        val holding = resaleBase * dailyCapitalCost * channel.typicalDays
        // A flip's capital is idle until it sells, so slow channels cost proportionally more.
        val flipDrag = if (goal?.kind == GoalKind.FLIP) {
            resaleBase * dailyCapitalCost * channel.typicalDays * 1.5
        } else 0.0
        return resale - fees - holding - flipDrag
    }

    /** Every channel's outcome, for the Sell flow's comparison table. Includes trade-in. */
    fun channelOptions(resaleBaseMinor: Long, liquidity: Double): List<Pair<SaleChannel, Long>> =
        SaleChannel.entries.map { channel ->
            val resale = resaleBaseMinor * realisationFor(channel, liquidity)
            val net = resale - resale * channel.feeFraction -
                resaleBaseMinor * dailyCapitalCost * channel.typicalDays
            channel to net.roundToLong()
        }.sortedByDescending { it.second }

    // -- Risks ---------------------------------------------------------------------------------

    private fun risks(
        listing: Listing,
        request: ValuationRequest,
        fair: Long,
        low: Long,
        refurb: RefurbPlan,
        basis: Basis,
        ageMonths: Int,
    ): List<Risk> {
        val risks = mutableListOf<Risk>()
        val ask = listing.askingPriceMinor
        val cur = listing.currency

        if (!basis.hasMarketData) {
            risks += Risk(
                RiskSeverity.SERIOUS.name,
                "No market data for this item",
                "Margin has no comparable sales and no category anchor for this, so it will not " +
                    "state a fair value. Treat every figure below as unverified.",
            )
        }

        if (basis.hasMarketData && fair > 0 && ask < low * 0.70) {
            risks += Risk(
                RiskSeverity.SERIOUS.name,
                "Priced far below every comparable sale",
                "Asking ${Money.format(ask, cur)} against a low comparable of " +
                    "${Money.format(low, cur)}. That gap usually means undisclosed damage, a " +
                    "missing part, or a listing that will not survive contact. Verify before paying.",
                // A verification flag, not a score penalty: a cheaper listing must never score
                // worse than an identical dearer one.
                affectsScore = false,
            )
        }

        if (basis.pricedOffDifferentModel && basis.hasMarketData) {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Priced off a different model",
                "No comparable sales exist for this exact model, so the value is derived from " +
                    "${basis.method}. The range is wide on purpose.",
            )
        }

        if (basis.ageUncertain) {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Age not stated",
                "No year in the listing and no release date on record, so depreciation is " +
                    "assumed over three years. Ask the seller how old it is.",
            )
        }

        listing.specs["battery_health_pct"]?.toIntOrNull()?.let { health ->
            when {
                health < 72 -> risks += Risk(
                    RiskSeverity.SERIOUS.name,
                    "Battery is near replacement",
                    "Stated health $health%. A replacement is already priced into the " +
                        "refurbishment estimate of ${Money.format(refurb.costMinor, cur)}.",
                )
                health < 85 -> risks += Risk(
                    RiskSeverity.CAUTION.name,
                    "Battery has measurable wear",
                    "Stated health $health%. Expect noticeably less range than new.",
                )
            }
        }

        if (refurb.attempted) {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Depends on refurbishment going to plan",
                "The estimate of ${Money.format(refurb.costMinor, cur)} already carries a " +
                    "${Money.percent(refurb.overrunFraction)} overrun allowance. Work on " +
                    "${listing.condition.label.lowercase()} items regularly exceeds it anyway.",
            )
        }

        if (listing.specs["service_history"]?.lowercase() == "none") {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "No service history",
                "Nothing documented. Treat wear parts as unknown.",
            )
        }

        listing.specs["missing"]?.takeIf { it.isNotBlank() }?.let {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Incomplete: $it",
                "Buyers discount harder for missing parts than the replacement actually costs.",
            )
        }

        if (listing.sellerRatingPct != null && listing.sellerRatingPct < 90) {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Seller rating ${listing.sellerRatingPct}%",
                "Below the level where a marketplace rating reassures. Inspect before paying.",
            )
        }

        if (listing.sellerType == SellerType.UNKNOWN) {
            risks += Risk(
                RiskSeverity.INFO.name,
                "Seller type not stated",
                "Private and dealer sales differ on returns and warranty.",
            )
        }

        if (listing.description.length < 140) {
            risks += Risk(
                RiskSeverity.INFO.name,
                "Thin description",
                "${listing.description.length} characters. Ask for specifics before travelling.",
            )
        }

        if (listing.imageCount in 1..2) {
            risks += Risk(
                RiskSeverity.CAUTION.name,
                "Only ${listing.imageCount} photo${if (listing.imageCount == 1) "" else "s"}",
                "Not enough to judge condition. Request photos of the wear points.",
            )
        }

        val daysListed = listing.daysListed(request.nowMillis)
        if (daysListed >= 40) {
            risks += Risk(
                RiskSeverity.INFO.name,
                "Listed $daysListed days ago",
                "It has not sold at this price, which is leverage in a negotiation.",
                affectsScore = false,
            )
        }

        request.goal?.let { goal ->
            if (goal.kind == GoalKind.BUY && ask > goal.budgetMaxMinor) {
                val over = ask - goal.budgetMaxMinor
                risks += Risk(
                    if (over > goal.budgetMaxMinor / 5) RiskSeverity.SERIOUS.name else RiskSeverity.CAUTION.name,
                    "Over budget by ${Money.format(over, cur)}",
                    "\"${goal.title}\" caps spending at ${Money.format(goal.budgetMaxMinor, cur)}.",
                )
            }
            if (goal.conditionFloor.rank > listing.condition.rank) {
                risks += Risk(
                    RiskSeverity.CAUTION.name,
                    "Below your condition floor",
                    "You asked for ${goal.conditionFloor.label} or better; this is " +
                        "${listing.condition.label.lowercase()}.",
                )
            }
        }

        return risks.sortedByDescending { it.severity.weight }
    }

    // -- Score and verdict ----------------------------------------------------------------------

    private fun dealScore(
        listing: Listing,
        goal: Goal?,
        fair: Long,
        net: Long,
        liquidity: Double,
        risks: List<Risk>,
        confidence: Confidence,
        hasMarketData: Boolean,
    ): Int {
        val ask = listing.askingPriceMinor.coerceAtLeast(1)

        val discount = if (fair > 0 && hasMarketData) (fair - ask).toDouble() / fair.toDouble() else 0.0
        val priceComponent = (50 + discount * 145).coerceIn(0.0, 100.0)

        val margin = net.toDouble() / ask.toDouble()
        val marginComponent = (50 + margin * 115).coerceIn(0.0, 100.0)

        val liquidityComponent = (liquidity * 100).coerceIn(0.0, 100.0)

        val weights = when (goal?.kind) {
            GoalKind.FLIP -> Triple(0.28, 0.52, 0.20)
            GoalKind.BUY -> Triple(0.58, 0.12, 0.30)
            null -> Triple(0.45, 0.25, 0.30)
        }

        var score = priceComponent * weights.first +
            marginComponent * weights.second +
            liquidityComponent * weights.third

        // Damp only the upside on a weak market read. Damping both directions would rescue bad
        // deals and soften risk penalties, making less information look like better news.
        if (score > 50) {
            val factor = when (confidence) {
                Confidence.HIGH -> 1.0
                Confidence.MEDIUM -> 0.95
                Confidence.LOW -> 0.82
            }
            score = 50 + (score - 50) * factor
        }
        if (!hasMarketData) score = minOf(score, 50.0)

        val penalty = risks.filter { it.affectsScore }.sumOf { it.severity.weight }.coerceAtMost(32)
        score -= penalty

        return score.roundToLong().toInt().coerceIn(0, 100)
    }

    private fun verdict(
        score: Int,
        listing: Listing,
        goal: Goal?,
        net: Long,
        risks: List<Risk>,
        confidence: Confidence,
        hasMarketData: Boolean,
    ): Verdict {
        val serious = risks.count { it.severity == RiskSeverity.SERIOUS }
        val profitOk = goal?.kind != GoalKind.FLIP || net >= goal.targetProfitMinMinor
        val budgetOk = goal?.kind != GoalKind.BUY || listing.askingPriceMinor <= goal.budgetMaxMinor

        var verdict = when {
            score >= 78 -> Verdict.STRONG_BUY
            score >= 63 -> Verdict.BUY
            score >= 47 -> Verdict.WATCH
            score >= 30 -> Verdict.PASS
            else -> Verdict.AVOID
        }

        if (!hasMarketData && verdict.isPositive) verdict = Verdict.WATCH
        if (!profitOk && verdict.isPositive) verdict = Verdict.WATCH
        if (!budgetOk && verdict.isPositive) verdict = Verdict.WATCH
        if (serious >= 2 && verdict.isPositive) verdict = Verdict.WATCH
        if (serious >= 1 && verdict == Verdict.STRONG_BUY) verdict = Verdict.BUY
        if (confidence == Confidence.LOW && verdict == Verdict.STRONG_BUY) verdict = Verdict.BUY

        return verdict
    }

    // -- Copy -------------------------------------------------------------------------------------

    private fun headline(
        verdict: Verdict, listing: Listing, fair: Long, net: Long, goal: Goal?, hasMarketData: Boolean,
    ): String {
        if (!hasMarketData) return "Not enough market data to value this."
        val cur = listing.currency
        val delta = fair - listing.askingPriceMinor
        return when (verdict) {
            Verdict.STRONG_BUY -> if (goal?.kind == GoalKind.FLIP) {
                "Buy it. ${Money.format(net, cur)} clear after every cost."
            } else {
                "Buy it. ${Money.format(abs(delta), cur)} under fair value."
            }
            Verdict.BUY -> if (delta > 0) {
                "Good buy at ${Money.format(abs(delta), cur)} below fair value."
            } else {
                "Fair price for what it is."
            }
            Verdict.WATCH -> if (delta > 0) {
                "Under fair value, but something needs checking first."
            } else {
                "Not there yet. Worth watching for a cut."
            }
            Verdict.PASS -> "Overpriced for the condition. Leave it."
            Verdict.AVOID -> "Walk away."
        }
    }

    private fun rationale(
        listing: Listing, goal: Goal?,
        fair: Long, low: Long, high: Long,
        resale: Long, refurb: RefurbPlan, fees: Long, logistics: Long, holding: Long,
        net: Long, maxBid: Long,
        channel: SaleChannel, basis: Basis, liquidity: Double,
    ): List<String> {
        val cur = listing.currency
        val out = mutableListOf<String>()

        if (!basis.hasMarketData) {
            out += "Margin has no comparable sales for this and will not guess a fair value."
            out += "Everything below is based on the asking price alone."
            return out
        }

        out += "Fair value ${Money.format(fair, cur)} (range ${Money.format(low, cur)}–" +
            "${Money.format(high, cur)}), from ${basis.method}, adjusted for " +
            "${listing.condition.label.lowercase()} condition."

        val delta = fair - listing.askingPriceMinor
        out += when {
            delta > 0 -> "Asking ${Money.format(listing.askingPriceMinor, cur)} is " +
                "${Money.format(delta, cur)} below that, ${Money.percent(delta.toDouble() / fair)} under."
            delta < 0 -> "Asking ${Money.format(listing.askingPriceMinor, cur)} is " +
                "${Money.format(-delta, cur)} above it, ${Money.percent(-delta.toDouble() / fair)} over."
            else -> "Asking price sits exactly on fair value."
        }

        if (refurb.attempted) {
            out += "Bringing it from ${listing.condition.label.lowercase()} to " +
                "${refurb.resultingCondition.label.lowercase()} costs about " +
                "${Money.format(refurb.costMinor, cur)}, overrun allowance included."
        } else if (listing.condition.rank < Condition.GOOD.rank) {
            out += "Refurbishing it would cost more than the value it restores, so this is " +
                "priced as it stands."
        }

        out += "Through ${channel.label.lowercase()} it returns about ${Money.format(resale, cur)}" +
            (if (fees > 0) " before ${Money.format(fees, cur)} of fees" else " with no platform fee") +
            ", typically in ${channel.typicalDays} days."

        out += if (net >= 0) {
            "After purchase, refurbishment, fees, ${Money.format(logistics, cur)} collection and " +
                "${Money.format(holding, cur)} of tied-up capital, you clear ${Money.format(net, cur)}."
        } else {
            "After every cost you are ${Money.format(-net, cur)} down. This does not work as a flip."
        }

        out += "Walk away above ${Money.format(maxBid, cur)}."

        out += when {
            liquidity >= 0.82 -> "This model sells quickly; you are unlikely to sit on it."
            liquidity >= 0.60 -> "Sells at a normal pace for the category."
            else -> "Slow mover. Price it right the first time or it will sit."
        }

        goal?.let {
            out += when (it.kind) {
                GoalKind.FLIP -> if (net >= it.targetProfitMinMinor) {
                    "Clears the ${Money.format(it.targetProfitMinMinor, cur)} target on \"${it.title}\" " +
                        "by ${Money.format(net - it.targetProfitMinMinor, cur)}."
                } else {
                    "Falls ${Money.format(it.targetProfitMinMinor - net, cur)} short of the target on \"${it.title}\"."
                }
                GoalKind.BUY -> if (listing.askingPriceMinor <= it.budgetMaxMinor) {
                    "Inside the ${Money.format(it.budgetMaxMinor, cur)} budget on \"${it.title}\"."
                } else {
                    "Above the ${Money.format(it.budgetMaxMinor, cur)} budget on \"${it.title}\"."
                }
            }
        }

        return out
    }
}

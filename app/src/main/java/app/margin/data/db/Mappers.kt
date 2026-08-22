package app.margin.data.db

import app.margin.domain.model.Category
import app.margin.domain.model.Comp
import app.margin.domain.model.Condition
import app.margin.domain.model.Confidence
import app.margin.domain.model.Decision
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import app.margin.domain.model.PhotoTask
import app.margin.domain.model.PricePoint
import app.margin.domain.model.Provenance
import app.margin.domain.model.Risk
import app.margin.domain.model.SaleChannel
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.SaleDraftStatus
import app.margin.domain.model.SellerType
import app.margin.domain.model.Verdict
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Entity <-> domain conversion. Lists and maps are stored as JSON columns; enums are stored
 * by name and decoded defensively so a future rename cannot crash a user's install.
 */
object Mappers {

    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val stringListSerializer = ListSerializer(String.serializer())
    private val stringMapSerializer = MapSerializer(String.serializer(), String.serializer())
    private val compListSerializer = ListSerializer(Comp.serializer())
    private val riskListSerializer = ListSerializer(Risk.serializer())
    private val photoListSerializer = ListSerializer(PhotoTask.serializer())
    private val pricePointListSerializer = ListSerializer(PricePoint.serializer())

    private inline fun <reified T : Enum<T>> decode(name: String, fallback: T): T =
        runCatching { enumValueOf<T>(name) }.getOrDefault(fallback)

    // --- Goal ---------------------------------------------------------------------------

    fun GoalEntity.toDomain() = Goal(
        id = id,
        title = title,
        kind = decode(kind, GoalKind.BUY),
        category = Category.fromSlug(category),
        budgetMaxMinor = budgetMaxMinor,
        targetProfitMinMinor = targetProfitMinMinor,
        keywords = runCatching { json.decodeFromString(stringListSerializer, keywordsJson) }
            .getOrDefault(emptyList()),
        conditionFloor = decode(conditionFloor, Condition.FAIR),
        currency = currency,
        active = active,
        note = note,
        createdAtMillis = createdAtMillis,
    )

    fun Goal.toEntity() = GoalEntity(
        id = id,
        title = title,
        kind = kind.name,
        category = category.slug,
        budgetMaxMinor = budgetMaxMinor,
        targetProfitMinMinor = targetProfitMinMinor,
        keywordsJson = json.encodeToString(stringListSerializer, keywords),
        conditionFloor = conditionFloor.name,
        currency = currency,
        active = active,
        note = note,
        createdAtMillis = createdAtMillis,
    )

    // --- Listing ------------------------------------------------------------------------

    fun ListingEntity.toDomain() = Listing(
        id = id,
        url = url,
        sourceName = sourceName,
        provenance = decode(provenance, Provenance.SEEDED),
        title = title,
        brand = brand,
        model = model,
        year = year,
        category = Category.fromSlug(category),
        condition = decode(condition, Condition.GOOD),
        askingPriceMinor = askingPriceMinor,
        currency = currency,
        location = location,
        sellerType = decode(sellerType, SellerType.UNKNOWN),
        sellerRatingPct = sellerRatingPct,
        listedAtMillis = listedAtMillis,
        description = description,
        specs = runCatching { json.decodeFromString(stringMapSerializer, specsJson) }
            .getOrDefault(emptyMap()),
        imageCount = imageCount,
        capturedAtMillis = capturedAtMillis,
        priceHistory = runCatching { json.decodeFromString(pricePointListSerializer, priceHistoryJson) }
            .getOrDefault(emptyList()),
    )

    fun Listing.toEntity(inFeed: Boolean) = ListingEntity(
        id = id,
        url = url,
        sourceName = sourceName,
        provenance = provenance.name,
        title = title,
        brand = brand,
        model = model,
        year = year,
        category = category.slug,
        condition = condition.name,
        askingPriceMinor = askingPriceMinor,
        currency = currency,
        location = location,
        sellerType = sellerType.name,
        sellerRatingPct = sellerRatingPct,
        listedAtMillis = listedAtMillis,
        description = description,
        specsJson = json.encodeToString(stringMapSerializer, specs),
        imageCount = imageCount,
        capturedAtMillis = capturedAtMillis,
        priceHistoryJson = json.encodeToString(pricePointListSerializer, priceHistory),
        inFeed = inFeed,
    )

    // --- Evaluation ---------------------------------------------------------------------

    fun EvaluationEntity.toDomain() = Evaluation(
        id = id,
        listingId = listingId,
        goalId = goalId,
        fairValueMinor = fairValueMinor,
        fairLowMinor = fairLowMinor,
        fairHighMinor = fairHighMinor,
        dealScore = dealScore,
        baseScore = baseScore,
        memoryDelta = memoryDelta,
        resaleValueMinor = resaleValueMinor,
        refurbCostMinor = refurbCostMinor,
        feeCostMinor = feeCostMinor,
        logisticsCostMinor = logisticsCostMinor,
        holdingCostMinor = holdingCostMinor,
        netProfitMinor = netProfitMinor,
        maxBidMinor = maxBidMinor,
        recommendedChannel = decode(recommendedChannel, SaleChannel.LOCAL_MARKETPLACE),
        confidence = decode(confidence, Confidence.LOW),
        verdict = decode(verdict, Verdict.WATCH),
        headline = headline,
        rationale = runCatching { json.decodeFromString(stringListSerializer, rationaleJson) }
            .getOrDefault(emptyList()),
        risks = runCatching { json.decodeFromString(riskListSerializer, risksJson) }
            .getOrDefault(emptyList()),
        comparables = runCatching { json.decodeFromString(compListSerializer, comparablesJson) }
            .getOrDefault(emptyList()),
        personalNote = personalNote,
        pricedOffDifferentModel = pricedOffDifferentModel,
        hasMarketData = hasMarketData,
        engineId = engineId,
        askingPriceMinor = askingPriceMinor,
        createdAtMillis = createdAtMillis,
    )

    fun Evaluation.toEntity() = EvaluationEntity(
        id = id,
        listingId = listingId,
        goalId = goalId,
        fairValueMinor = fairValueMinor,
        fairLowMinor = fairLowMinor,
        fairHighMinor = fairHighMinor,
        dealScore = dealScore,
        baseScore = baseScore,
        memoryDelta = memoryDelta,
        resaleValueMinor = resaleValueMinor,
        refurbCostMinor = refurbCostMinor,
        feeCostMinor = feeCostMinor,
        logisticsCostMinor = logisticsCostMinor,
        holdingCostMinor = holdingCostMinor,
        netProfitMinor = netProfitMinor,
        maxBidMinor = maxBidMinor,
        recommendedChannel = recommendedChannel.name,
        confidence = confidence.name,
        verdict = verdict.name,
        headline = headline,
        rationaleJson = json.encodeToString(stringListSerializer, rationale),
        risksJson = json.encodeToString(riskListSerializer, risks),
        comparablesJson = json.encodeToString(compListSerializer, comparables),
        personalNote = personalNote,
        pricedOffDifferentModel = pricedOffDifferentModel,
        hasMarketData = hasMarketData,
        engineId = engineId,
        askingPriceMinor = askingPriceMinor,
        createdAtMillis = createdAtMillis,
    )

    // --- Decision -----------------------------------------------------------------------

    fun DecisionEntity.toDomain() = Decision(
        id = id,
        listingId = listingId,
        type = decode(type, DecisionType.WATCH),
        reason = reason,
        note = note,
        createdAtMillis = createdAtMillis,
    )

    fun Decision.toEntity(scoreAtDecision: Int, verdictAtDecision: Verdict) = DecisionEntity(
        id = id,
        listingId = listingId,
        type = type.name,
        reason = reason,
        note = note,
        createdAtMillis = createdAtMillis,
        scoreAtDecision = scoreAtDecision,
        verdictAtDecision = verdictAtDecision.name,
    )

    // --- Owned --------------------------------------------------------------------------

    fun OwnedItemEntity.toDomain() = OwnedItem(
        id = id,
        listingId = listingId,
        title = title,
        brand = brand,
        category = Category.fromSlug(category),
        condition = decode(condition, Condition.GOOD),
        purchasePriceMinor = purchasePriceMinor,
        purchasedAtMillis = purchasedAtMillis,
        currentValueMinor = currentValueMinor,
        status = decode(status, OwnedStatus.OWNED),
        soldPriceMinor = soldPriceMinor,
        soldAtMillis = soldAtMillis,
        currency = currency,
        note = note,
        year = year,
        predictedNetMinor = predictedNetMinor,
        fairValueAtPurchaseMinor = fairValueAtPurchaseMinor,
    )

    fun OwnedItem.toEntity() = OwnedItemEntity(
        id = id,
        listingId = listingId,
        title = title,
        brand = brand,
        category = category.slug,
        condition = condition.name,
        purchasePriceMinor = purchasePriceMinor,
        purchasedAtMillis = purchasedAtMillis,
        currentValueMinor = currentValueMinor,
        status = status.name,
        soldPriceMinor = soldPriceMinor,
        soldAtMillis = soldAtMillis,
        currency = currency,
        note = note,
        year = year,
        predictedNetMinor = predictedNetMinor,
        fairValueAtPurchaseMinor = fairValueAtPurchaseMinor,
    )

    // --- Sale draft ---------------------------------------------------------------------

    fun SaleDraftEntity.toDomain() = SaleDraft(
        id = id,
        ownedItemId = ownedItemId,
        channel = decode(channel, SaleChannel.LOCAL_MARKETPLACE),
        askPriceMinor = askPriceMinor,
        floorPriceMinor = floorPriceMinor,
        quickSalePriceMinor = quickSalePriceMinor,
        title = title,
        body = body,
        photoTasks = runCatching { json.decodeFromString(photoListSerializer, photoTasksJson) }
            .getOrDefault(emptyList()),
        status = decode(status, SaleDraftStatus.DRAFT),
        createdAtMillis = createdAtMillis,
    )

    fun SaleDraft.toEntity() = SaleDraftEntity(
        id = id,
        ownedItemId = ownedItemId,
        channel = channel.name,
        askPriceMinor = askPriceMinor,
        floorPriceMinor = floorPriceMinor,
        quickSalePriceMinor = quickSalePriceMinor,
        title = title,
        body = body,
        photoTasksJson = json.encodeToString(photoListSerializer, photoTasks),
        status = status.name,
        createdAtMillis = createdAtMillis,
    )
}

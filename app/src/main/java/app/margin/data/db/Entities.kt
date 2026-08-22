package app.margin.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "goals")
data class GoalEntity(
    @PrimaryKey val id: String,
    val title: String,
    val kind: String,
    val category: String,
    val budgetMaxMinor: Long,
    val targetProfitMinMinor: Long,
    val keywordsJson: String,
    val conditionFloor: String,
    val currency: String,
    val active: Boolean,
    val note: String,
    val createdAtMillis: Long,
)

@Entity(tableName = "listings", indices = [Index("url"), Index("category")])
data class ListingEntity(
    @PrimaryKey val id: String,
    val url: String,
    val sourceName: String,
    val provenance: String,
    val title: String,
    val brand: String,
    val model: String,
    val year: Int?,
    val category: String,
    val condition: String,
    val askingPriceMinor: Long,
    val currency: String,
    val location: String,
    val sellerType: String,
    val sellerRatingPct: Int?,
    val listedAtMillis: Long,
    val description: String,
    val specsJson: String,
    val imageCount: Int,
    val capturedAtMillis: Long,
    val priceHistoryJson: String,
    /** False for listings captured by the user; true for the demo feed. */
    val inFeed: Boolean,
)

@Entity(tableName = "evaluations", indices = [Index("listingId")])
data class EvaluationEntity(
    @PrimaryKey val id: String,
    val listingId: String,
    val goalId: String?,
    val fairValueMinor: Long,
    val fairLowMinor: Long,
    val fairHighMinor: Long,
    val dealScore: Int,
    val baseScore: Int,
    val memoryDelta: Int,
    val resaleValueMinor: Long,
    val refurbCostMinor: Long,
    val feeCostMinor: Long,
    val logisticsCostMinor: Long,
    val holdingCostMinor: Long,
    val netProfitMinor: Long,
    val maxBidMinor: Long,
    val recommendedChannel: String,
    val confidence: String,
    val verdict: String,
    val headline: String,
    val rationaleJson: String,
    val risksJson: String,
    val comparablesJson: String,
    val personalNote: String?,
    val pricedOffDifferentModel: Boolean,
    val hasMarketData: Boolean,
    val engineId: String,
    val askingPriceMinor: Long,
    val createdAtMillis: Long,
)

@Entity(tableName = "decisions", indices = [Index("listingId")])
data class DecisionEntity(
    @PrimaryKey val id: String,
    val listingId: String,
    val type: String,
    val reason: String,
    val note: String,
    val createdAtMillis: Long,
    /** Deal score at the moment of the decision, so later drift is measurable. */
    val scoreAtDecision: Int,
    val verdictAtDecision: String,
)

@Entity(tableName = "owned_items")
data class OwnedItemEntity(
    @PrimaryKey val id: String,
    val listingId: String?,
    val title: String,
    val brand: String,
    val category: String,
    val condition: String,
    val purchasePriceMinor: Long,
    val purchasedAtMillis: Long,
    val currentValueMinor: Long,
    val status: String,
    val soldPriceMinor: Long?,
    val soldAtMillis: Long?,
    val currency: String,
    val note: String,
    val year: Int?,
    val predictedNetMinor: Long?,
    val fairValueAtPurchaseMinor: Long?,
)

@Entity(tableName = "sale_drafts", indices = [Index("ownedItemId")])
data class SaleDraftEntity(
    @PrimaryKey val id: String,
    val ownedItemId: String,
    val channel: String,
    val askPriceMinor: Long,
    val floorPriceMinor: Long,
    val quickSalePriceMinor: Long,
    val title: String,
    val body: String,
    val photoTasksJson: String,
    val status: String,
    val createdAtMillis: Long,
)

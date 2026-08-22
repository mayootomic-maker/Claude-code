package app.margin.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface GoalDao {
    @Query("SELECT * FROM goals ORDER BY active DESC, createdAtMillis DESC")
    fun observeAll(): Flow<List<GoalEntity>>

    @Query("SELECT * FROM goals WHERE id = :id")
    suspend fun byId(id: String): GoalEntity?

    @Query("SELECT * FROM goals")
    suspend fun all(): List<GoalEntity>

    @Upsert suspend fun upsert(goal: GoalEntity)

    @Query("DELETE FROM goals WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM goals")
    suspend fun count(): Int
}

@Dao
interface ListingDao {
    @Query("SELECT * FROM listings ORDER BY listedAtMillis DESC")
    fun observeAll(): Flow<List<ListingEntity>>

    @Query("SELECT * FROM listings WHERE inFeed = 1 ORDER BY listedAtMillis DESC")
    fun observeFeed(): Flow<List<ListingEntity>>

    @Query("SELECT * FROM listings")
    suspend fun all(): List<ListingEntity>

    @Query("SELECT * FROM listings WHERE id = :id")
    suspend fun byId(id: String): ListingEntity?

    @Query("SELECT * FROM listings WHERE id = :id")
    fun observeById(id: String): Flow<ListingEntity?>

    @Upsert suspend fun upsert(listing: ListingEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(listings: List<ListingEntity>)
}

@Dao
interface EvaluationDao {
    @Query("SELECT * FROM evaluations ORDER BY createdAtMillis DESC")
    fun observeAll(): Flow<List<EvaluationEntity>>

    @Query("SELECT * FROM evaluations WHERE listingId = :listingId ORDER BY createdAtMillis DESC LIMIT 1")
    suspend fun latestFor(listingId: String): EvaluationEntity?

    @Query("SELECT * FROM evaluations WHERE listingId = :listingId ORDER BY createdAtMillis DESC LIMIT 1")
    fun observeLatestFor(listingId: String): Flow<EvaluationEntity?>

    @Query("SELECT * FROM evaluations")
    suspend fun all(): List<EvaluationEntity>

    @Upsert suspend fun upsert(evaluation: EvaluationEntity)

    @Query("DELETE FROM evaluations WHERE listingId = :listingId")
    suspend fun deleteFor(listingId: String)
}

@Dao
interface DecisionDao {
    @Query("SELECT * FROM decisions ORDER BY createdAtMillis DESC")
    fun observeAll(): Flow<List<DecisionEntity>>

    @Query("SELECT * FROM decisions ORDER BY createdAtMillis DESC")
    suspend fun all(): List<DecisionEntity>

    @Query("SELECT * FROM decisions WHERE listingId = :listingId ORDER BY createdAtMillis DESC LIMIT 1")
    suspend fun latestFor(listingId: String): DecisionEntity?

    @Upsert suspend fun upsert(decision: DecisionEntity)

    @Query("DELETE FROM decisions WHERE listingId = :listingId")
    suspend fun clearFor(listingId: String)
}

@Dao
interface OwnedItemDao {
    @Query("SELECT * FROM owned_items ORDER BY purchasedAtMillis DESC")
    fun observeAll(): Flow<List<OwnedItemEntity>>

    @Query("SELECT * FROM owned_items")
    suspend fun all(): List<OwnedItemEntity>

    @Query("SELECT * FROM owned_items WHERE id = :id")
    suspend fun byId(id: String): OwnedItemEntity?

    @Query("SELECT * FROM owned_items WHERE id = :id")
    fun observeById(id: String): Flow<OwnedItemEntity?>

    @Upsert suspend fun upsert(item: OwnedItemEntity)
}

@Dao
interface SaleDraftDao {
    @Query("SELECT * FROM sale_drafts ORDER BY createdAtMillis DESC")
    fun observeAll(): Flow<List<SaleDraftEntity>>

    @Query("SELECT * FROM sale_drafts")
    suspend fun all(): List<SaleDraftEntity>

    @Query("SELECT * FROM sale_drafts WHERE ownedItemId = :ownedItemId ORDER BY createdAtMillis DESC LIMIT 1")
    suspend fun forOwnedItem(ownedItemId: String): SaleDraftEntity?

    @Query("SELECT * FROM sale_drafts WHERE ownedItemId = :ownedItemId ORDER BY createdAtMillis DESC LIMIT 1")
    fun observeForOwnedItem(ownedItemId: String): Flow<SaleDraftEntity?>

    @Query("SELECT * FROM sale_drafts WHERE id = :id")
    fun observeById(id: String): Flow<SaleDraftEntity?>

    @Upsert suspend fun upsert(draft: SaleDraftEntity)
}

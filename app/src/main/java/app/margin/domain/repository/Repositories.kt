package app.margin.domain.repository

import app.margin.domain.model.Decision
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.Verdict
import kotlinx.coroutines.flow.Flow

interface GoalRepository {
    fun observeAll(): Flow<List<Goal>>
    suspend fun all(): List<Goal>
    suspend fun byId(id: String): Goal?
    suspend fun upsert(goal: Goal)
    suspend fun delete(id: String)
}

interface ListingRepository {
    fun observeFeed(): Flow<List<Listing>>
    fun observeAll(): Flow<List<Listing>>
    fun observeById(id: String): Flow<Listing?>
    suspend fun all(): List<Listing>
    suspend fun byId(id: String): Listing?
    suspend fun upsert(listing: Listing, inFeed: Boolean)
}

interface EvaluationRepository {
    fun observeAll(): Flow<List<Evaluation>>
    fun observeLatestFor(listingId: String): Flow<Evaluation?>
    suspend fun latestFor(listingId: String): Evaluation?
    suspend fun all(): List<Evaluation>
    suspend fun upsert(evaluation: Evaluation)
}

/** Decisions carry the score at the time, so later drift is measurable rather than guessed. */
data class DecisionRecord(val decision: Decision, val scoreAtDecision: Int, val verdictAtDecision: Verdict)

interface DecisionRepository {
    fun observeAll(): Flow<List<Decision>>
    suspend fun all(): List<Decision>
    suspend fun allRecords(): List<DecisionRecord>
    suspend fun latestFor(listingId: String): Decision?
    suspend fun record(record: DecisionRecord)
    suspend fun clearFor(listingId: String)
}

interface OwnedRepository {
    fun observeAll(): Flow<List<OwnedItem>>
    fun observeById(id: String): Flow<OwnedItem?>
    suspend fun all(): List<OwnedItem>
    suspend fun byId(id: String): OwnedItem?
    suspend fun upsert(item: OwnedItem)
}

interface SaleDraftRepository {
    fun observeAll(): Flow<List<SaleDraft>>
    fun observeForOwnedItem(ownedItemId: String): Flow<SaleDraft?>
    suspend fun forOwnedItem(ownedItemId: String): SaleDraft?
    suspend fun all(): List<SaleDraft>
    suspend fun upsert(draft: SaleDraft)
}

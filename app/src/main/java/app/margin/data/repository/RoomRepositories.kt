package app.margin.data.repository

import app.margin.data.db.DecisionDao
import app.margin.data.db.EvaluationDao
import app.margin.data.db.GoalDao
import app.margin.data.db.ListingDao
import app.margin.data.db.Mappers.toDomain
import app.margin.data.db.Mappers.toEntity
import app.margin.data.db.OwnedItemDao
import app.margin.data.db.SaleDraftDao
import app.margin.domain.model.Decision
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.Verdict
import app.margin.domain.repository.DecisionRecord
import app.margin.domain.repository.DecisionRepository
import app.margin.domain.repository.EvaluationRepository
import app.margin.domain.repository.GoalRepository
import app.margin.domain.repository.ListingRepository
import app.margin.domain.repository.OwnedRepository
import app.margin.domain.repository.SaleDraftRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class RoomGoalRepository(private val dao: GoalDao) : GoalRepository {
    override fun observeAll(): Flow<List<Goal>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override suspend fun all(): List<Goal> = dao.all().map { it.toDomain() }
    override suspend fun byId(id: String): Goal? = dao.byId(id)?.toDomain()
    override suspend fun upsert(goal: Goal) = dao.upsert(goal.toEntity())
    override suspend fun delete(id: String) = dao.delete(id)
}

class RoomListingRepository(private val dao: ListingDao) : ListingRepository {
    override fun observeFeed(): Flow<List<Listing>> = dao.observeFeed().map { list -> list.map { it.toDomain() } }
    override fun observeAll(): Flow<List<Listing>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeById(id: String): Flow<Listing?> = dao.observeById(id).map { it?.toDomain() }
    override suspend fun all(): List<Listing> = dao.all().map { it.toDomain() }
    override suspend fun byId(id: String): Listing? = dao.byId(id)?.toDomain()
    override suspend fun upsert(listing: Listing, inFeed: Boolean) = dao.upsert(listing.toEntity(inFeed))
}

class RoomEvaluationRepository(private val dao: EvaluationDao) : EvaluationRepository {
    override fun observeAll(): Flow<List<Evaluation>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeLatestFor(listingId: String): Flow<Evaluation?> =
        dao.observeLatestFor(listingId).map { it?.toDomain() }
    override suspend fun latestFor(listingId: String): Evaluation? = dao.latestFor(listingId)?.toDomain()
    override suspend fun all(): List<Evaluation> = dao.all().map { it.toDomain() }
    override suspend fun upsert(evaluation: Evaluation) = dao.upsert(evaluation.toEntity())
}

class RoomDecisionRepository(private val dao: DecisionDao) : DecisionRepository {
    override fun observeAll(): Flow<List<Decision>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override suspend fun all(): List<Decision> = dao.all().map { it.toDomain() }
    override suspend fun allRecords(): List<DecisionRecord> = dao.all().map {
        DecisionRecord(
            decision = it.toDomain(),
            scoreAtDecision = it.scoreAtDecision,
            verdictAtDecision = runCatching { Verdict.valueOf(it.verdictAtDecision) }
                .getOrDefault(Verdict.WATCH),
        )
    }
    override suspend fun latestFor(listingId: String): Decision? = dao.latestFor(listingId)?.toDomain()
    override suspend fun record(record: DecisionRecord) =
        dao.upsert(record.decision.toEntity(record.scoreAtDecision, record.verdictAtDecision))
    override suspend fun clearFor(listingId: String) = dao.clearFor(listingId)
}

class RoomOwnedRepository(private val dao: OwnedItemDao) : OwnedRepository {
    override fun observeAll(): Flow<List<OwnedItem>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeById(id: String): Flow<OwnedItem?> = dao.observeById(id).map { it?.toDomain() }
    override suspend fun all(): List<OwnedItem> = dao.all().map { it.toDomain() }
    override suspend fun byId(id: String): OwnedItem? = dao.byId(id)?.toDomain()
    override suspend fun upsert(item: OwnedItem) = dao.upsert(item.toEntity())
}

class RoomSaleDraftRepository(private val dao: SaleDraftDao) : SaleDraftRepository {
    override fun observeAll(): Flow<List<SaleDraft>> = dao.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeForOwnedItem(ownedItemId: String): Flow<SaleDraft?> =
        dao.observeForOwnedItem(ownedItemId).map { it?.toDomain() }
    override suspend fun forOwnedItem(ownedItemId: String): SaleDraft? =
        dao.forOwnedItem(ownedItemId)?.toDomain()
    override suspend fun all(): List<SaleDraft> = dao.all().map { it.toDomain() }
    override suspend fun upsert(draft: SaleDraft) = dao.upsert(draft.toEntity())
}

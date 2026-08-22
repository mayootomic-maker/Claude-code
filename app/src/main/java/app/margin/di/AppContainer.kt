package app.margin.di

import android.content.Context
import app.margin.data.db.MarginDatabase
import app.margin.data.prefs.PreferencesStore
import app.margin.data.repository.RoomDecisionRepository
import app.margin.data.repository.RoomEvaluationRepository
import app.margin.data.repository.RoomGoalRepository
import app.margin.data.repository.RoomListingRepository
import app.margin.data.repository.RoomOwnedRepository
import app.margin.data.repository.RoomSaleDraftRepository
import app.margin.data.seed.Seeder
import app.margin.data.service.EvaluationCoordinator
import app.margin.domain.engine.HeuristicValuationEngine
import app.margin.domain.engine.ListingSource
import app.margin.domain.engine.ListingCopywriter
import app.margin.domain.engine.LocalListingResolver
import app.margin.domain.engine.MarketDataSource
import app.margin.domain.engine.SeededMarketData
import app.margin.domain.engine.TemplateCopywriter
import app.margin.domain.engine.ValuationService
import app.margin.domain.repository.DecisionRepository
import app.margin.domain.repository.EvaluationRepository
import app.margin.domain.repository.GoalRepository
import app.margin.domain.repository.ListingRepository
import app.margin.domain.repository.OwnedRepository
import app.margin.domain.repository.SaleDraftRepository

/**
 * Manual dependency wiring.
 *
 * The three replaceable seams — [ValuationService], [ListingSource] and [ListingCopywriter] —
 * are constructed here and nowhere else. Swapping any of them for a network-backed
 * implementation is a change to this file alone; no screen or view model knows which
 * implementation answered.
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext
    private val database = MarginDatabase.build(appContext)

    val now: () -> Long = { System.currentTimeMillis() }

    val goals: GoalRepository = RoomGoalRepository(database.goals())
    val listings: ListingRepository = RoomListingRepository(database.listings())
    val evaluations: EvaluationRepository = RoomEvaluationRepository(database.evaluations())
    val decisions: DecisionRepository = RoomDecisionRepository(database.decisions())
    val owned: OwnedRepository = RoomOwnedRepository(database.ownedItems())
    val saleDrafts: SaleDraftRepository = RoomSaleDraftRepository(database.saleDrafts())

    val marketData: MarketDataSource = SeededMarketData()
    val valuation: ValuationService = HeuristicValuationEngine(marketData)
    val copywriter: ListingCopywriter = TemplateCopywriter()
    val listingSource: ListingSource = LocalListingResolver(
        catalogue = { listings.all() },
        market = marketData as SeededMarketData,
    )

    val coordinator = EvaluationCoordinator(
        listings = listings,
        goals = goals,
        decisions = decisions,
        evaluations = evaluations,
        valuation = valuation,
        now = now,
    )

    val seeder = Seeder(
        goals = goals,
        listings = listings,
        decisions = decisions,
        owned = owned,
        saleDrafts = saleDrafts,
        coordinator = coordinator,
        now = now,
    )

    val preferences = PreferencesStore(appContext)
}

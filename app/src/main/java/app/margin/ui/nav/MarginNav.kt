package app.margin.ui.nav

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FlagCircle
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.lifecycle.viewmodel.compose.viewModel
import app.margin.core.design.Hairline
import app.margin.core.design.MarginTheme
import app.margin.core.design.Motion
import app.margin.core.design.Space
import app.margin.core.design.pressable
import app.margin.di.AppContainer
import app.margin.ui.capture.CaptureScreen
import app.margin.ui.capture.CaptureViewModel
import app.margin.ui.common.viewModelFactory
import app.margin.ui.evaluate.EvaluateScreen
import app.margin.ui.evaluate.EvaluateViewModel
import app.margin.ui.goals.GoalEditorScreen
import app.margin.ui.goals.GoalEditorViewModel
import app.margin.ui.goals.GoalsScreen
import app.margin.ui.goals.GoalsViewModel
import app.margin.ui.opportunities.OpportunitiesScreen
import app.margin.ui.opportunities.OpportunitiesViewModel
import app.margin.ui.owned.OwnedDetailScreen
import app.margin.ui.owned.OwnedDetailViewModel
import app.margin.ui.owned.OwnedScreen
import app.margin.ui.owned.OwnedViewModel
import app.margin.ui.sell.SellScreen
import app.margin.ui.sell.SellViewModel
import app.margin.ui.settings.SettingsScreen
import app.margin.ui.settings.SettingsViewModel
import app.margin.ui.today.TodayScreen
import app.margin.ui.today.TodayViewModel

object Routes {
    const val TODAY = "today"
    const val OPPORTUNITIES = "opportunities"
    const val OWNED = "owned"
    const val GOALS = "goals"
    const val SETTINGS = "settings"
    const val CAPTURE = "capture"
    fun evaluate(id: String) = "evaluate/$id"
    fun ownedDetail(id: String) = "ownedDetail/$id"
    fun sell(id: String) = "sell/$id"
    fun goalEditor(id: String?) = if (id == null) "goalEditor" else "goalEditor?goalId=$id"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab(Routes.TODAY, "Today", Icons.Outlined.Today),
    Tab(Routes.OPPORTUNITIES, "Deals", Icons.Outlined.TrendingUp),
    Tab(Routes.OWNED, "Owned", Icons.Outlined.Inventory2),
    Tab(Routes.GOALS, "Goals", Icons.Outlined.FlagCircle),
)

// Lateral pushes travel on the X axis; modals rise. Both spring rather than tween, so an
// interrupted gesture resolves instead of finishing an animation nobody asked for.
private const val SLIDE = 1
private fun pushEnter(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(Motion.standardIntOffset) { it / SLIDE } + fadeIn(tween(120))
}
private fun pushExit(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(Motion.standardIntOffset) { -it / 6 } + fadeOut(tween(120))
}
private fun popEnter(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(Motion.standardIntOffset) { -it / 6 } + fadeIn(tween(120))
}
private fun popExit(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(Motion.standardIntOffset) { it / SLIDE } + fadeOut(tween(120))
}
private fun riseEnter(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInVertically(Motion.gentleIntOffset) { it / 5 } + fadeIn(tween(140))
}
private fun riseExit(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutVertically(Motion.gentleIntOffset) { it / 5 } + fadeOut(tween(140))
}

@Composable
fun MarginNavHost(
    container: AppContainer,
    sharedText: String?,
    onSharedTextConsumed: () -> Unit,
    navController: NavHostController = rememberNavController(),
) {
    val c = MarginTheme.colors
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = currentRoute in TABS.map { it.route }

    // A shared URL jumps straight into capture, which resolves it on arrival.
    androidx.compose.runtime.LaunchedEffect(sharedText) {
        if (!sharedText.isNullOrBlank()) {
            navController.navigate(Routes.CAPTURE)
            onSharedTextConsumed()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .statusBarsPadding()
    ) {
        NavHost(
            navController = navController,
            startDestination = Routes.TODAY,
            modifier = Modifier.weight(1f),
            enterTransition = pushEnter(),
            exitTransition = pushExit(),
            popEnterTransition = popEnter(),
            popExitTransition = popExit(),
        ) {
            composable(Routes.TODAY) {
                val vm: TodayViewModel = viewModel(factory = viewModelFactory { TodayViewModel(container) })
                TodayScreen(
                    viewModel = vm,
                    onOpenListing = { navController.navigate(Routes.evaluate(it)) },
                    onOpenOwned = { navController.navigate(Routes.ownedDetail(it)) },
                    onOpenSell = { navController.navigate(Routes.sell(it)) },
                    onCapture = { navController.navigate(Routes.CAPTURE) },
                )
            }

            composable(Routes.OPPORTUNITIES) {
                val vm: OpportunitiesViewModel =
                    viewModel(factory = viewModelFactory { OpportunitiesViewModel(container) })
                OpportunitiesScreen(
                    viewModel = vm,
                    onOpenListing = { navController.navigate(Routes.evaluate(it)) },
                    onCapture = { navController.navigate(Routes.CAPTURE) },
                    onCreateGoal = { navController.navigate(Routes.goalEditor(null)) },
                )
            }

            composable(Routes.OWNED) {
                val vm: OwnedViewModel = viewModel(factory = viewModelFactory { OwnedViewModel(container) })
                OwnedScreen(vm, onOpenItem = { navController.navigate(Routes.ownedDetail(it)) })
            }

            composable(Routes.GOALS) {
                val vm: GoalsViewModel = viewModel(factory = viewModelFactory { GoalsViewModel(container) })
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) {
                        GoalsScreen(vm, onEditGoal = { navController.navigate(Routes.goalEditor(it)) })
                    }
                    Hairline(inset = 0.dp)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .pressable({ navController.navigate(Routes.SETTINGS) })
                            .padding(horizontal = Space.screenH, vertical = Space.md),
                    ) {
                        Text("Settings", style = MarginTheme.type.bodyStrong, color = c.inkMuted)
                    }
                }
            }

            composable(Routes.SETTINGS) {
                val vm: SettingsViewModel = viewModel(factory = viewModelFactory { SettingsViewModel(container) })
                SettingsScreen(vm)
            }

            composable(
                Routes.CAPTURE,
                enterTransition = riseEnter(),
                exitTransition = riseExit(),
                popEnterTransition = popEnter(),
                popExitTransition = riseExit(),
            ) {
                val vm: CaptureViewModel =
                    viewModel(factory = viewModelFactory { CaptureViewModel(container, sharedText) })
                CaptureScreen(
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onEvaluated = { id ->
                        navController.popBackStack()
                        navController.navigate(Routes.evaluate(id))
                    },
                )
            }

            composable(
                "evaluate/{listingId}",
                arguments = listOf(navArgument("listingId") { type = NavType.StringType }),
            ) { entry ->
                val id = entry.arguments?.getString("listingId").orEmpty()
                val vm: EvaluateViewModel =
                    viewModel(factory = viewModelFactory { EvaluateViewModel(container, id) })
                EvaluateScreen(
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onOpenOwned = { ownedId ->
                        navController.navigate(Routes.ownedDetail(ownedId))
                    },
                )
            }

            composable(
                "ownedDetail/{itemId}",
                arguments = listOf(navArgument("itemId") { type = NavType.StringType }),
            ) { entry ->
                val id = entry.arguments?.getString("itemId").orEmpty()
                val vm: OwnedDetailViewModel =
                    viewModel(factory = viewModelFactory { OwnedDetailViewModel(container, id) })
                OwnedDetailScreen(
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onSell = { navController.navigate(Routes.sell(it)) },
                )
            }

            composable(
                "sell/{itemId}",
                arguments = listOf(navArgument("itemId") { type = NavType.StringType }),
                enterTransition = riseEnter(),
                popExitTransition = riseExit(),
            ) { entry ->
                val id = entry.arguments?.getString("itemId").orEmpty()
                val vm: SellViewModel = viewModel(factory = viewModelFactory { SellViewModel(container, id) })
                SellScreen(
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onFinished = { navController.popBackStack() },
                )
            }

            composable(
                "goalEditor?goalId={goalId}",
                arguments = listOf(
                    navArgument("goalId") {
                        type = NavType.StringType; nullable = true; defaultValue = null
                    }
                ),
                enterTransition = riseEnter(),
                popExitTransition = riseExit(),
            ) { entry ->
                val id = entry.arguments?.getString("goalId")
                val vm: GoalEditorViewModel =
                    viewModel(factory = viewModelFactory { GoalEditorViewModel(container, id) })
                GoalEditorScreen(vm, onDone = { navController.popBackStack() })
            }
            composable(
                "goalEditor",
                enterTransition = riseEnter(),
                popExitTransition = riseExit(),
            ) {
                val vm: GoalEditorViewModel =
                    viewModel(factory = viewModelFactory { GoalEditorViewModel(container, null) })
                GoalEditorScreen(vm, onDone = { navController.popBackStack() })
            }
        }

        if (showBottomBar) {
            BottomBar(
                currentRoute = currentRoute,
                onSelect = { route ->
                    navController.navigate(route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
            )
        }
    }
}

@Composable
private fun BottomBar(currentRoute: String?, onSelect: (String) -> Unit) {
    val c = MarginTheme.colors
    Column(Modifier.background(c.canvas)) {
        Hairline(inset = 0.dp)
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .height(Space.bottomBarHeight),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TABS.forEach { tab ->
                val selected = currentRoute == tab.route
                Column(
                    Modifier
                        .weight(1f)
                        .pressable({ onSelect(tab.route) }, haptic = false),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        tab.icon,
                        contentDescription = tab.label,
                        tint = if (selected) c.inkStrong else c.inkFaint,
                        modifier = Modifier.size(21.dp),
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        tab.label,
                        style = MarginTheme.type.label,
                        color = if (selected) c.inkStrong else c.inkFaint,
                    )
                }
            }
        }
    }
}

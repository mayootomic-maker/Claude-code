package app.margin.core.design

import androidx.compose.ui.unit.dp

/** 4pt grid. Named by role, not by size, so spacing decisions stay consistent. */
object Space {
    val hair = 1.dp
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 20.dp
    val xxl = 24.dp
    val section = 32.dp
    val screenH = 20.dp
    val rowV = 14.dp
    val bottomBarHeight = 60.dp
    val touchTarget = 48.dp
}

/** Restrained radii. Pills are reserved for genuine toggles, never for labels. */
object Radius {
    val xs = 6.dp
    val sm = 10.dp
    val md = 14.dp
    val lg = 18.dp
    val sheet = 24.dp
}

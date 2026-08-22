package app.margin

import android.app.Application
import app.margin.di.AppContainer

class MarginApp : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}

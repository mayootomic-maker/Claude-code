package com.tomicstudios.apexdrift

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {

    private lateinit var container: FrameLayout
    private var webView: WebView? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    /**
     * Written on the UI thread, read on the JavaBridge thread: WebView.getUrl()
     * may only be called on the UI thread, so the bridge cannot ask directly.
     */
    @Volatile
    private var currentUrl: String? = null

    /** Set when the renderer died while we were in the background. */
    private var reloadOnResume = false

    private var cutoutCssPx = SafeArea(0f, 0f, 0f, 0f)

    private val audioManager by lazy { getSystemService(AudioManager::class.java) }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        // Ducking is left to the system: with USAGE_GAME it lowers our volume
        // itself, and pausing a race for a notification chime would be hostile.
        if (change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
        ) {
            dispatch(EVENT_PAUSE)
        }
    }

    private val focusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setOnAudioFocusChangeListener(focusListener)
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        // Only takes effect while this window is visible, so it lapses on its
        // own when the player leaves the app.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        container = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.apex_bg))
        }
        setContentView(container)
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val density = resources.displayMetrics.density
            cutoutCssPx = SafeArea(
                cutout.left / density,
                cutout.top / density,
                cutout.right / density,
                cutout.bottom / density,
            )
            publishSafeArea()
            insets
        }

        attachNewWebView().loadUrl(START_URL)
        hideSystemBars()

        onBackPressedDispatcher.addCallback(this) {
            val view = webView
            if (view == null) {
                finish()
                return@addCallback
            }
            view.evaluateJavascript(
                "window.__apexBack ? window.__apexBack() : false",
            ) { result ->
                if (result != "true") finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        webView?.onResume()
        if (reloadOnResume) {
            reloadOnResume = false
            webView?.loadUrl(START_URL)
            Toast.makeText(this, R.string.renderer_restarted, Toast.LENGTH_SHORT).show()
        }
        dispatch(EVENT_RESUME)
        // Requested after resume so that, during a phone call, the pause it
        // triggers is the last word and the game stays paused.
        if (audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_FAILED) {
            dispatch(EVENT_PAUSE)
        }
    }

    override fun onPause() {
        dispatch(EVENT_PAUSE)
        webView?.onPause()
        audioManager.abandonAudioFocusRequest(focusRequest)
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Dialogs, the IME and the notification shade can all bring the bars
        // back; re-hiding on focus is what makes immersive mode stick.
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        webView?.let { destroyWebView(it) }
        webView = null
        super.onDestroy()
    }

    /** Called from [ApexBridge]; must stay cheap and thread-safe. */
    internal fun isTrustedPage(): Boolean = isAppOrigin(currentUrl?.let(Uri::parse))

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun attachNewWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val view = WebView(this).apply {
            // Shown until WebGL draws its first frame; the default is white.
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.apex_bg))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                // window.open and target=_blank then become ordinary
                // navigations, which shouldOverrideUrlLoading can vet.
                setSupportMultipleWindows(false)
                javaScriptCanOpenWindowsAutomatically = false
            }
            webViewClient = GameClient()
            addJavascriptInterface(ApexBridge(this@MainActivity), BRIDGE_NAME)
        }
        container.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        webView = view
        return view
    }

    private fun destroyWebView(view: WebView) {
        container.removeView(view)
        view.destroy()
    }

    private fun dispatch(event: String) {
        webView?.evaluateJavascript("window.dispatchEvent(new Event('$event'))", null)
    }

    /**
     * Mirrors the display cutout into CSS variables. env(safe-area-inset-*)
     * reports zero on many WebView versions still in the field, and with
     * shortEdges the cutout sits over the game's HUD in landscape.
     */
    private fun publishSafeArea() {
        val c = cutoutCssPx
        webView?.evaluateJavascript(
            "(function(s){" +
                "s.setProperty('--apex-safe-left','${c.left}px');" +
                "s.setProperty('--apex-safe-top','${c.top}px');" +
                "s.setProperty('--apex-safe-right','${c.right}px');" +
                "s.setProperty('--apex-safe-bottom','${c.bottom}px');" +
                "})(document.documentElement.style)",
            null,
        )
    }

    private fun openExternally(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show()
        }
    }

    private inner class GameClient : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isAppOrigin(uri)) return false
            if (uri.scheme == "http" || uri.scheme == "https") openExternally(uri)
            // Everything else (intent:, file:, javascript:, market: ...) is
            // refused outright rather than handed to some other app.
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            currentUrl = url
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            currentUrl = url
        }

        override fun onPageFinished(view: WebView, url: String?) {
            publishSafeArea()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Returning true is what keeps the app alive; the dead WebView
            // must not be touched again beyond destroy().
            if (view === webView) {
                webView = null
                currentUrl = null
            }
            destroyWebView(view)
            if (isFinishing || isDestroyed) return true

            val fresh = attachNewWebView()
            // Usually the renderer is killed for memory while we are in the
            // background; loading then would start the game's audio unseen.
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                fresh.loadUrl(START_URL)
                Toast.makeText(this@MainActivity, R.string.renderer_restarted, Toast.LENGTH_SHORT).show()
            } else {
                fresh.onPause()
                reloadOnResume = true
            }
            return true
        }
    }

    private data class SafeArea(val left: Float, val top: Float, val right: Float, val bottom: Float)

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"

        /** The 2.0 origin. Players' localStorage saves are keyed to it. */
        const val START_URL = "https://$APP_HOST/assets/www/index.html"

        const val BRIDGE_NAME = "ApexNative"
        const val EVENT_PAUSE = "apex:pause"
        const val EVENT_RESUME = "apex:resume"

        fun isAppOrigin(uri: Uri?): Boolean =
            uri != null &&
                uri.scheme == "https" &&
                uri.host == APP_HOST &&
                (uri.port == -1 || uri.port == 443)
    }
}

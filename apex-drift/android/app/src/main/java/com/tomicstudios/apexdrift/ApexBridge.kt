package com.tomicstudios.apexdrift

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Exposed to the page as `window.ApexNative`.
 *
 * Methods run on the WebView's JavaBridge thread, not the UI thread. Each one
 * first checks the page is our own origin: addJavascriptInterface injects into
 * whatever is loaded, and navigation filtering alone is not a guarantee.
 */
class ApexBridge(private val activity: MainActivity) {

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            activity.getSystemService(Vibrator::class.java)
        }
    }

    @JavascriptInterface
    fun vibrate(ms: Int) {
        if (!activity.isTrustedPage()) return
        val v = vibrator?.takeIf { it.hasVibrator() } ?: return
        if (ms <= 0) {
            v.cancel()
            return
        }
        // Capped so a bad value from game code cannot buzz for minutes.
        v.vibrate(VibrationEffect.createOneShot(ms.coerceAtMost(MAX_VIBRATE_MS).toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @JavascriptInterface
    fun exitApp() {
        if (!activity.isTrustedPage()) return
        activity.runOnUiThread { activity.finish() }
    }

    @JavascriptInterface
    fun version(): String {
        if (!activity.isTrustedPage()) return ""
        return BuildConfig.VERSION_NAME
    }

    /**
     * Writes a PNG to Pictures/Apex Drift. Synchronous: the caller's JS is
     * blocked until the file is written, which is fine for a single screenshot.
     * Returns false below API 29, where MediaStore cannot write to a shared
     * folder without the storage permission this app deliberately does not hold.
     */
    @JavascriptInterface
    fun saveImage(base64Png: String, name: String): Boolean {
        if (!activity.isTrustedPage()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false

        val bytes = try {
            Base64.decode(base64Png.substringAfter("base64,"), Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "saveImage: payload is not valid base64", e)
            return false
        }
        if (!bytes.startsWith(PNG_SIGNATURE)) {
            Log.w(TAG, "saveImage: payload is not a PNG")
            return false
        }

        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName(name))
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Apex Drift")
            // Hidden from the gallery until fully written, so a crash mid-write
            // never leaves a truncated image behind.
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        return try {
            val out = resolver.openOutputStream(uri) ?: throw java.io.IOException("no output stream")
            out.use { it.write(bytes) }
            resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            true
        } catch (e: Exception) {
            Log.w(TAG, "saveImage: write failed", e)
            resolver.delete(uri, null, null)
            false
        }
    }

    private fun fileName(requested: String): String {
        val base = requested
            .removeSuffix(".png")
            .replace(UNSAFE_FILENAME_CHARS, "_")
            .trim('_', ' ', '.')
            .take(MAX_NAME_LENGTH)
            .ifEmpty { "apex-drift-${System.currentTimeMillis()}" }
        return "$base.png"
    }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
        size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private companion object {
        const val TAG = "ApexBridge"
        const val MAX_VIBRATE_MS = 2_000
        const val MAX_NAME_LENGTH = 64
        val UNSAFE_FILENAME_CHARS = Regex("[^A-Za-z0-9 ._-]")
        val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    }
}

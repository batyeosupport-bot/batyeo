package com.batyeo.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Fullscreen kiosk shell for a physical BATYEO station. Loads the station's
 * /kiosk/[publicId] web page (built in the main BATYEO repo) and keeps it on
 * screen, reloading itself if the network drops. This app owns nothing about
 * rentals or payment yet — it is step 1 (display) of the runtime described in
 * docs/RUNBOOK_RUNTIME_INSTALL.md. Stripe Terminal and the slot-board serial
 * bridge are separate, later additions to this same shell.
 */
class MainActivity : AppCompatActivity() {

    private val prefs by lazy { getSharedPreferences("batyeo_runtime", Context.MODE_PRIVATE) }
    private lateinit var webView: WebView
    private val retryHandler = Handler(Looper.getMainLooper())
    private var retryDelayMs = 3_000L
    private val openConfigDialog = Runnable { showConfigDialog() }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersiveMode()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    retryDelayMs = 3_000L
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    if (request?.isForMainFrame != true) return
                    scheduleReload()
                }
            }
            // Long-press anywhere on the kiosk screen (5s) opens the hidden config
            // dialog. No visible button — matches how the borne's own factory
            // launcher hides its settings from customers.
            setOnTouchListener { v, event ->
                when (event.action) {
                    android.view.MotionEvent.ACTION_DOWN -> retryHandler.postDelayed(openConfigDialog, 5_000L)
                    android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL ->
                        retryHandler.removeCallbacks(openConfigDialog)
                }
                v.performClick()
                false
            }
        }
        setContentView(webView)
        loadKioskUrl()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    private fun applyImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    private fun currentUrl(): String =
        prefs.getString(KEY_KIOSK_URL, null) ?: getString(R.string.default_kiosk_url)

    private fun loadKioskUrl() {
        webView.loadUrl(currentUrl())
    }

    private fun scheduleReload() {
        retryHandler.postDelayed({ loadKioskUrl() }, retryDelayMs)
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(30_000L)
    }

    private fun showConfigDialog() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(currentUrl())
        }
        AlertDialog.Builder(this)
            .setTitle("URL de la borne")
            .setView(input)
            .setPositiveButton("Enregistrer") { _, _ ->
                prefs.edit().putString(KEY_KIOSK_URL, input.text.toString().trim()).apply()
                loadKioskUrl()
            }
            .setNegativeButton("Annuler", null)
            .show()
    }

    companion object {
        private const val KEY_KIOSK_URL = "kiosk_url"
    }
}

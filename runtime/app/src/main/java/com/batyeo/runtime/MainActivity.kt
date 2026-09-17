package com.batyeo.runtime

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

/**
 * Kiosk shell for a BATYEO station.
 *
 * Owns the parts that have to work even when the network does not: it comes up
 * on boot, pins itself to the screen, plays the media playlist while idle, and
 * keeps reporting its health to the admin portal. The rental flow itself is the
 * web page loaded in the WebView, so screens and copy can change without
 * reflashing the station.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var settings: KioskSettings
    private lateinit var client: CoreClient
    private lateinit var watchdog: Watchdog
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var carousel: MediaCarouselView
    private lateinit var banner: TextView

    private val handler = Handler(Looper.getMainLooper())
    private val background = Executors.newSingleThreadExecutor()
    private val startedAt = System.currentTimeMillis()
    private var config: KioskConfig? = null
    private var reloadDelayMs = 3_000L
    private val errors = mutableListOf<String>()

    private val openConfigDialog = Runnable { showConfigDialog() }
    private val goIdle = Runnable { showCarousel() }
    private val refreshConfig = object : Runnable {
        override fun run() {
            background.execute {
                val applied = client.fetchConfig(config)
                val network = if (applied != null || settings.lastCoreContactAt() > 0) "ONLINE" else "OFFLINE"
                client.sendHeartbeat(applied ?: config, network, System.currentTimeMillis() - startedAt, errors.toList())
                if (applied != null) handler.post { applyConfig(applied) }
            }
            handler.postDelayed(this, (config?.refreshIntervalMs ?: DEFAULT_REFRESH_MS).coerceAtLeast(MIN_REFRESH_MS))
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = KioskSettings(this)
        client = CoreClient(this, settings)
        watchdog = Watchdog(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersiveMode()

        if (watchdog.isHardStopped()) {
            setContentView(buildHardStopView())
            return
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    reloadDelayMs = 3_000L
                    errors.remove(ERROR_DISPLAY)
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    if (request?.isForMainFrame != true) return
                    if (!errors.contains(ERROR_DISPLAY)) errors.add(ERROR_DISPLAY)
                    handler.postDelayed({ loadKioskUrl() }, reloadDelayMs)
                    reloadDelayMs = (reloadDelayMs * 2).coerceAtMost(30_000L)
                }
            }
        }
        carousel = MediaCarouselView(this)
        banner = TextView(this).apply {
            setBackgroundColor(0xCC9D3F35.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(24, 16, 24, 16)
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
            )
        }

        root = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(carousel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(banner)
            setOnTouchListener { view, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> handler.postDelayed(openConfigDialog, CONFIG_HOLD_MS)
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(openConfigDialog)
                }
                view.performClick()
                false
            }
        }
        setContentView(root)

        config = client.cachedConfig()
        config?.let { applyConfig(it) }
        loadKioskUrl()
        showCarousel()
        handler.post(refreshConfig)
        if (settings.coreUrl().isEmpty() && settings.kioskUrl().isEmpty()) showConfigDialog()
    }

    override fun onStart() {
        super.onStart()
        // Pins the app to the screen. Silently does nothing unless this app is a
        // device-owner/allowlisted task, so an un-provisioned station still runs.
        runCatching { startLockTask() }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        carousel.stop()
        background.shutdownNow()
        super.onDestroy()
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        showContent()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    /** No back door out of the kiosk: hardware back never leaves the station screen. */
    @Suppress("DEPRECATION")
    override fun onBackPressed() = Unit

    private fun applyConfig(incoming: KioskConfig) {
        config = incoming
        carousel.setPlaylist(incoming.playlist)
        banner.text = incoming.maintenanceBanner.orEmpty()
        banner.visibility = if (incoming.maintenanceBanner.isNullOrBlank()) View.GONE else View.VISIBLE
        if (settings.locale().isEmpty()) settings.saveLocale(incoming.defaultLocale)
    }

    private fun showCarousel() {
        if (config?.playlist.isNullOrEmpty()) return
        carousel.visibility = View.VISIBLE
        carousel.start()
    }

    private fun showContent() {
        handler.removeCallbacks(goIdle)
        if (carousel.visibility == View.VISIBLE) {
            carousel.stop()
            carousel.visibility = View.GONE
        }
        handler.postDelayed(goIdle, IDLE_TIMEOUT_MS)
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

    private fun loadKioskUrl() {
        val url = settings.kioskUrl().ifEmpty { getString(R.string.default_kiosk_url) }
        webView.loadUrl(url)
    }

    /**
     * Shown instead of the kiosk when the restart budget is exhausted — three
     * crash-restart cycles inside 30 minutes means retrying automatically is
     * just draining the station, so this is a deliberate stop, not a bug.
     */
    private fun buildHardStopView(): View {
        val message = TextView(this).apply {
            text = "BATYEO Runtime à l'arrêt\n\n${watchdog.hardStopReason()}\n\n" +
                "Identifiant : ${settings.runtimeId().ifEmpty { "non appairé" }}"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 18f
            gravity = Gravity.CENTER
        }
        val retry = Button(this).apply {
            text = "Réinitialiser et relancer"
            setOnClickListener {
                watchdog.reset()
                recreate()
            }
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xFF19382C.toInt())
            setPadding(64, 64, 64, 64)
            addView(message)
            addView(retry, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 48
                gravity = Gravity.CENTER
            })
        }
    }

    private fun showConfigDialog() {
        val coreUrl = EditText(this).apply { hint = "URL du serveur BATYEO"; setText(settings.coreUrl()); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val kioskUrl = EditText(this).apply { hint = "URL d'affichage"; setText(settings.kioskUrl().ifEmpty { getString(R.string.default_kiosk_url) }); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val pairing = EditText(this).apply { hint = "Coller le code d'appairage" }
        val pairingStatus = TextView(this).apply {
            text = if (settings.runtimeToken().isNotEmpty()) "Borne appairée (${settings.runtimeId()})" else "Borne non appairée"
        }
        val pairButton = Button(this).apply {
            text = "Appairer cette borne"
            setOnClickListener {
                val code = pairing.text.toString()
                pairingStatus.text = "Appairage en cours…"
                this@MainActivity.background.execute {
                    val result = client.enroll(code)
                    handler.post {
                        pairingStatus.text = result.fold(
                            onSuccess = { "Borne appairée · station $it" },
                            onFailure = { "Échec : ${it.message}" }
                        )
                        if (result.isSuccess) {
                            coreUrl.setText(settings.coreUrl())
                            handler.post(refreshConfig)
                        }
                    }
                }
            }
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(coreUrl); addView(kioskUrl); addView(pairingStatus); addView(pairing); addView(pairButton)
            config?.availableLocales?.takeIf { it.isNotEmpty() }?.let { locales ->
                addView(TextView(this@MainActivity).apply { text = config?.translate(settings.locale(), "selectLanguage") ?: "Langue" })
                locales.forEach { option ->
                    addView(Button(this@MainActivity).apply {
                        text = option.label
                        setOnClickListener { settings.saveLocale(option.locale); loadKioskUrl() }
                    })
                }
            }
        }
        AlertDialog.Builder(this)
            .setTitle("Configuration de la borne")
            .setView(layout)
            .setPositiveButton("Enregistrer") { _, _ ->
                // Pairing owns the credential; saving here must never clear it.
                settings.save(coreUrl.text.toString(), kioskUrl.text.toString(), settings.runtimeId(), settings.runtimeToken())
                loadKioskUrl()
                handler.post(refreshConfig)
            }
            .setNegativeButton("Annuler", null)
            .show()
    }

    private companion object {
        const val CONFIG_HOLD_MS = 5_000L
        const val IDLE_TIMEOUT_MS = 60_000L
        const val DEFAULT_REFRESH_MS = 15_000L
        const val MIN_REFRESH_MS = 5_000L
        const val ERROR_DISPLAY = "DISPLAY_LOAD_FAILED"
    }
}

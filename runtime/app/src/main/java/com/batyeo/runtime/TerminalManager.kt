package com.batyeo.runtime

import android.app.Application
import android.util.Log
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.TerminalApplicationDelegate
import com.stripe.stripeterminal.external.callable.Callback
import com.stripe.stripeterminal.external.callable.Cancelable
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider
import com.stripe.stripeterminal.external.callable.DiscoveryListener
import com.stripe.stripeterminal.external.callable.MobileReaderListener
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.ConnectionStatus
import com.stripe.stripeterminal.external.models.ConnectionTokenException
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.PaymentStatus
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.TerminalException
import com.stripe.stripeterminal.log.LogLevel
import java.util.concurrent.Executors

/**
 * Owns the BBPOS WisePOS reader session, independently of the manufacturer's
 * own "Charge" app — this is the piece that lets BATYEO take card payments on
 * the station without going through Bajie's payment stack.
 *
 * Deliberately stops at "a reader is connected and ready" (`PaymentStatus.READY`).
 * Actually charging a card (createPaymentIntent → collectPaymentMethod →
 * confirmPaymentIntent) needs a rental amount, a capture-method decision, and a
 * bridge from the WebView rental flow into this native code — product
 * decisions, not plumbing, and out of scope for this pass. This class is the
 * foundation that work builds on.
 *
 * A reader also has to be assigned to a Stripe "Location" in the merchant's
 * dashboard before it can connect; until an operator enters that id (hidden
 * config dialog), this stays inert and nothing here runs.
 */
class TerminalManager(
    private val application: Application,
    private val client: CoreClient,
    private val settings: KioskSettings
) {
    private val io = Executors.newSingleThreadExecutor()
    private val reconnect = ReconnectPolicy()
    private var discovery: Cancelable? = null

    var onStatusChange: ((ConnectionStatus) -> Unit)? = null
    var onReaderReady: ((Reader) -> Unit)? = null
    var onConnectionFailed: ((String) -> Unit)? = null

    val connectionStatus: ConnectionStatus get() = Terminal.getInstance().connectionStatus
    val paymentStatus: PaymentStatus get() = Terminal.getInstance().paymentStatus
    val connectedReader: Reader? get() = Terminal.getInstance().connectedReader

    private val connectionTokenProvider = object : ConnectionTokenProvider {
        override fun fetchConnectionToken(callback: ConnectionTokenCallback) {
            io.execute {
                val token = client.fetchTerminalConnectionToken()
                if (token != null) callback.onSuccess(token)
                else callback.onFailure(ConnectionTokenException("Serveur BATYEO injoignable pour le jeton lecteur."))
            }
        }
    }

    private val terminalListener = object : TerminalListener {
        override fun onConnectionStatusChange(status: ConnectionStatus) {
            onStatusChange?.invoke(status)
        }
    }

    private val readerListener = object : MobileReaderListener {}

    fun initializeIfNeeded() {
        TerminalApplicationDelegate.onCreate(application)
        if (Terminal.isInitialized()) return
        runCatching {
            Terminal.init(application, LogLevel.NONE, connectionTokenProvider, terminalListener, null)
        }.onFailure { Log.e(TAG, "Terminal.init failed", it) }
    }

    /**
     * No-op if no Location is configured yet, or a reader is already connected. The server-owned
     * Location from runtime/config always wins over the locally hand-entered one — BATYEO Core is
     * the source of truth for a station's own configuration — so the manual field in the config
     * dialog only matters until an admin assigns one from the portal (Admin -> Affichage).
     */
    fun connectIfConfigured(serverLocationId: String? = null) {
        val locationId = serverLocationId?.takeIf { it.isNotBlank() } ?: settings.stripeLocationId()
        if (locationId.isEmpty() || !Terminal.isInitialized()) return
        if (connectionStatus != ConnectionStatus.NOT_CONNECTED) return
        reconnect.reset()
        discover(locationId)
    }

    fun disconnect() {
        discovery?.cancel(object : Callback {
            override fun onSuccess() {}
            override fun onFailure(e: TerminalException) {}
        })
        discovery = null
        if (Terminal.isInitialized() && connectionStatus == ConnectionStatus.CONNECTED) {
            Terminal.getInstance().disconnectReader(object : Callback {
                override fun onSuccess() {}
                override fun onFailure(e: TerminalException) {
                    Log.w(TAG, "disconnectReader failed", e)
                }
            })
        }
    }

    private fun discover(locationId: String) {
        val config = DiscoveryConfiguration.BluetoothDiscoveryConfiguration(timeout = 0, isSimulated = false)
        discovery = Terminal.getInstance().discoverReaders(
            config,
            object : DiscoveryListener {
                override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                    val found = readers.firstOrNull() ?: return
                    discovery?.cancel(object : Callback {
                        override fun onSuccess() {
                            connect(found, locationId)
                        }
                        override fun onFailure(e: TerminalException) {
                            connect(found, locationId)
                        }
                    }) ?: connect(found, locationId)
                }
            },
            object : Callback {
                override fun onSuccess() {}
                override fun onFailure(e: TerminalException) {
                    Log.w(TAG, "Reader discovery failed", e)
                    onConnectionFailed?.invoke(e.errorMessage ?: "Découverte du lecteur impossible.")
                }
            }
        )
    }

    private fun connect(reader: Reader, locationId: String) {
        val config = ConnectionConfiguration.BluetoothConnectionConfiguration(
            locationId, true, readerListener
        )
        Terminal.getInstance().connectReader(reader, config, object : ReaderCallback {
            override fun onSuccess(reader: Reader) {
                reconnect.reset()
                onReaderReady?.invoke(reader)
            }
            override fun onFailure(e: TerminalException) {
                Log.w(TAG, "connectReader failed (attempt ${reconnect.attemptCount + 1})", e)
                if (reconnect.recordFailure()) {
                    io.execute {
                        Thread.sleep(reconnect.nextDelayMs)
                        discover(locationId)
                    }
                } else {
                    onConnectionFailed?.invoke(
                        "Lecteur injoignable après ${RestartRule.POS_RECONNECT_BUDGET} tentatives."
                    )
                }
            }
        })
    }

    private companion object {
        const val TAG = "BatyeoTerminal"
    }
}

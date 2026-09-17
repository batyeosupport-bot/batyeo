package com.batyeo.runtime

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to the BATYEO core API as an enrolled station runtime.
 *
 * Every response is written to a last-known-good file only after it parses and
 * proves to be newer than what we already hold, so a truncated payload or a
 * rolled-back server can never leave the station showing worse information than
 * it had before. Offline, the cached config is what keeps the screen alive.
 */
class CoreClient(private val context: Context, private val settings: KioskSettings) {

    private val cacheFile: File get() = File(context.filesDir, "last-known-good-config.json")

    fun cachedConfig(): KioskConfig? = runCatching {
        if (!cacheFile.exists()) return null
        KioskConfig.parse(JSONObject(cacheFile.readText()))
    }.onFailure { Log.w(TAG, "Cached config unreadable, ignoring it", it) }.getOrNull()

    /** Returns the newly applied config, or null when nothing newer/valid arrived. */
    fun fetchConfig(current: KioskConfig?): KioskConfig? {
        val body = request("GET", "runtime/config", null) ?: return null
        val incoming = runCatching { KioskConfig.parse(JSONObject(body).getJSONObject("envelope")) }
            .onFailure { Log.w(TAG, "Malformed config payload, keeping last-known-good", it) }
            .getOrNull() ?: return null
        if (current != null && incoming.version <= current.version) return null
        runCatching {
            val temporary = File(cacheFile.parentFile, cacheFile.name + ".tmp")
            temporary.writeText(JSONObject(body).getJSONObject("envelope").toString())
            temporary.renameTo(cacheFile)
        }.onFailure { Log.w(TAG, "Could not persist config", it) }
        return incoming
    }

    /**
     * Redeems a one-time pairing code issued by the admin portal, formatted as
     * `coreUrl|tokenId|token`. The credential comes back exactly once, so it is
     * persisted before anything else can fail. A fresh runtime id is generated
     * per attempt because the server refuses to re-enroll an id it already
     * knows, revoked or not.
     */
    fun enroll(pairingCode: String): Result<String> {
        val parts = pairingCode.trim().split("|")
        if (parts.size != 3 || parts.any { it.isBlank() }) {
            return Result.failure(IllegalArgumentException("Code d'appairage invalide."))
        }
        val (base, tokenId, token) = parts
        val runtimeId = "runtime-" + java.util.UUID.randomUUID()
        val payload = JSONObject().put("tokenId", tokenId).put("token", token).put("runtimeId", runtimeId)
        val response = post("${base.trimEnd('/')}/runtime/enroll", payload, authenticated = false)
            ?: return Result.failure(IllegalStateException("Serveur injoignable ou code refusé."))
        return runCatching {
            val credential = JSONObject(response).getString("credential")
            val stationId = JSONObject(response).optString("stationId")
            settings.save(base, settings.kioskUrl(), runtimeId, credential)
            settings.markCoreContact()
            stationId
        }
    }

    /**
     * A Stripe Terminal connection token, fetched fresh per reader connection
     * attempt — it is short-lived and never the account secret, so there is
     * nothing to cache here the way the display config is cached.
     */
    fun fetchTerminalConnectionToken(): String? =
        request("POST", "runtime/terminal-connection-token", JSONObject())
            ?.let { runCatching { JSONObject(it).getString("secret") }.getOrNull() }

    fun sendHeartbeat(config: KioskConfig?, network: String, uptimeMs: Long, errors: List<String>) {
        val payload = JSONObject()
            .put("runtimeVersion", BuildConfig.VERSION_NAME)
            .put("network", network)
            .put("appUptimeMs", uptimeMs)
            .put("displayStatus", if (errors.isEmpty()) "OK" else "ERROR")
            .put("providerStatus", JSONObject.NULL)
            .put("lastCoreContactAt", settings.lastCoreContactAt())
            .put("errors", JSONArray(errors))
        config?.let { payload.put("configVersion", it.version) }
        if (request("POST", "runtime/heartbeat", payload) != null) settings.markCoreContact()
    }

    private fun request(method: String, path: String, body: JSONObject?): String? {
        val base = settings.coreUrl().trimEnd('/')
        if (base.isEmpty() || settings.runtimeId().isEmpty() || settings.runtimeToken().isEmpty()) return null
        return send(method, "$base/$path", body, authenticated = true)
    }

    private fun post(url: String, body: JSONObject, authenticated: Boolean): String? =
        send("POST", url, body, authenticated)

    private fun send(method: String, url: String, body: JSONObject?, authenticated: Boolean): String? =
        runCatching {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                if (authenticated) {
                    setRequestProperty("Authorization", "Bearer ${settings.runtimeToken()}")
                    setRequestProperty("X-Batyeo-Runtime-Id", settings.runtimeId())
                }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            body?.let { connection.outputStream.use { stream -> stream.write(it.toString().toByteArray()) } }
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            connection.disconnect()
            if (code !in 200..299) {
                Log.w(TAG, "$method $url failed with HTTP $code: $text")
                return null
            }
            text
        }.onFailure { Log.w(TAG, "$method $url unreachable", it) }.getOrNull()

    private companion object { const val TAG = "BatyeoCoreClient" }
}

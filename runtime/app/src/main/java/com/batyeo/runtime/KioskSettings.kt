package com.batyeo.runtime

import android.content.Context

/**
 * Device-local settings for one station. Mirrors how the factory firmware kept
 * its identity in flat files on the device (DeviceId, RegisterServer, ...), but
 * scoped to this app's private storage.
 *
 * The runtime token is a station credential, not a customer secret: it is
 * single-station, revocable and rotatable from the admin portal. It should move
 * to hardware-backed keystore storage when enrollment is implemented.
 */
class KioskSettings(context: Context) {

    private val prefs = context.getSharedPreferences("batyeo_runtime", Context.MODE_PRIVATE)

    fun coreUrl(): String = prefs.getString(KEY_CORE_URL, "").orEmpty()
    fun kioskUrl(): String = prefs.getString(KEY_KIOSK_URL, "").orEmpty()
    fun runtimeId(): String = prefs.getString(KEY_RUNTIME_ID, "").orEmpty()
    fun runtimeToken(): String = prefs.getString(KEY_RUNTIME_TOKEN, "").orEmpty()
    fun locale(): String = prefs.getString(KEY_LOCALE, "").orEmpty()
    fun lastCoreContactAt(): Long = prefs.getLong(KEY_LAST_CONTACT, 0L)

    fun save(coreUrl: String, kioskUrl: String, runtimeId: String, runtimeToken: String) {
        prefs.edit()
            .putString(KEY_CORE_URL, coreUrl.trim())
            .putString(KEY_KIOSK_URL, kioskUrl.trim())
            .putString(KEY_RUNTIME_ID, runtimeId.trim())
            .putString(KEY_RUNTIME_TOKEN, runtimeToken.trim())
            .apply()
    }

    fun saveLocale(locale: String) = prefs.edit().putString(KEY_LOCALE, locale).apply()

    fun markCoreContact() = prefs.edit().putLong(KEY_LAST_CONTACT, System.currentTimeMillis()).apply()

    private companion object {
        const val KEY_CORE_URL = "core_url"
        const val KEY_KIOSK_URL = "kiosk_url"
        const val KEY_RUNTIME_ID = "runtime_id"
        const val KEY_RUNTIME_TOKEN = "runtime_token"
        const val KEY_LOCALE = "locale"
        const val KEY_LAST_CONTACT = "last_core_contact_at"
    }
}

package com.batyeo.runtime

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Device-local settings for one station. Mirrors how the factory firmware kept
 * its identity in flat files on the device (DeviceId, RegisterServer, ...), but
 * scoped to this app's private storage and, for the runtime token, backed by
 * the Android Keystore rather than a plain file.
 *
 * The runtime token is a station credential: single-station, revocable and
 * rotatable from the admin portal, but still worth keeping off a plain-text
 * file since anyone with physical access to the device could otherwise lift it
 * and impersonate the station. If the encrypted store is ever unreadable (a
 * corrupted keystore key after a factory OS restore is the known real-world
 * case), we drop it and start over rather than crash-loop the kiosk over a
 * token that would need re-pairing anyway.
 */
class KioskSettings(context: Context) {

    private val prefs: SharedPreferences = openEncryptedPrefs(context)

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
        const val FILE_NAME = "batyeo_runtime_secure"
        const val KEY_CORE_URL = "core_url"
        const val KEY_KIOSK_URL = "kiosk_url"
        const val KEY_RUNTIME_ID = "runtime_id"
        const val KEY_RUNTIME_TOKEN = "runtime_token"
        const val KEY_LOCALE = "locale"
        const val KEY_LAST_CONTACT = "last_core_contact_at"
        const val TAG = "BatyeoKioskSettings"

        fun openEncryptedPrefs(context: Context): SharedPreferences {
            return runCatching { createEncryptedPrefs(context) }
                .getOrElse { error ->
                    Log.w(TAG, "Encrypted prefs unreadable, resetting the store", error)
                    context.deleteSharedPreferences(FILE_NAME)
                    runCatching { createEncryptedPrefs(context) }
                        .getOrElse {
                            Log.e(TAG, "Encrypted prefs unavailable even after reset, falling back to plain storage", it)
                            context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
                        }
                }
        }

        fun createEncryptedPrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }
    }
}

package com.batyeo.runtime

import org.json.JSONObject

data class LocaleOption(val code: String, val label: String, val locale: String)

data class MediaItem(val id: String, val kind: String, val uri: String, val durationMs: Long) {
    val isVideo: Boolean get() = kind.equals("VIDEO", ignoreCase = true)
}

/**
 * The station's display configuration as served by GET runtime/config.
 * `version` is monotonic: the runtime refuses to replace a config it already
 * holds with an older one, so a stale or replayed payload can never downgrade
 * a station that is already up to date.
 */
data class KioskConfig(
    val version: Long,
    val venueName: String,
    val locale: String,
    val idleContent: String,
    val maintenanceBanner: String?,
    val refreshIntervalMs: Long,
    val playlist: List<MediaItem>,
    val availableLocales: List<LocaleOption>,
    val defaultLocale: String,
    private val strings: Map<String, Map<String, String>>
) {
    /** A partially translated locale still renders: missing keys fall back to the default locale. */
    fun stringsFor(locale: String): Map<String, String> =
        (strings[defaultLocale] ?: emptyMap()) + (strings[locale] ?: emptyMap())

    fun translate(locale: String, key: String): String = stringsFor(locale)[key] ?: key

    companion object {
        fun parse(envelope: JSONObject): KioskConfig {
            val config = envelope.getJSONObject("config")
            val playlist = mutableListOf<MediaItem>()
            config.optJSONObject("playlist")?.optJSONArray("items")?.let { items ->
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    playlist += MediaItem(
                        id = item.getString("id"),
                        kind = item.optString("kind", "IMAGE"),
                        uri = item.getString("uri"),
                        durationMs = item.optLong("durationMs", 5_000L)
                    )
                }
            }
            val locales = mutableListOf<LocaleOption>()
            val strings = mutableMapOf<String, Map<String, String>>()
            var defaultLocale = config.optString("locale", "fr-FR")
            config.optJSONObject("translations")?.let { translations ->
                defaultLocale = translations.optString("defaultLocale", defaultLocale)
                translations.optJSONArray("available")?.let { available ->
                    for (i in 0 until available.length()) {
                        val entry = available.getJSONObject(i)
                        locales += LocaleOption(
                            code = entry.optString("code"),
                            label = entry.optString("label"),
                            locale = entry.optString("locale")
                        )
                    }
                }
                translations.optJSONObject("strings")?.let { dictionaries ->
                    for (locale in dictionaries.keys()) {
                        val dictionary = dictionaries.getJSONObject(locale)
                        val entries = mutableMapOf<String, String>()
                        for (key in dictionary.keys()) entries[key] = dictionary.getString(key)
                        strings[locale] = entries
                    }
                }
            }
            return KioskConfig(
                version = config.getLong("version"),
                venueName = config.optString("venueName"),
                locale = config.optString("locale", defaultLocale),
                idleContent = config.optString("idleContent"),
                maintenanceBanner = config.optString("maintenanceBanner").takeIf { it.isNotBlank() && it != "null" },
                refreshIntervalMs = config.optLong("refreshIntervalMs", 15_000L),
                playlist = playlist,
                availableLocales = locales,
                defaultLocale = defaultLocale,
                strings = strings
            )
        }
    }
}

package com.batyeo.runtime

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Process
import android.os.SystemClock
import android.util.Log

/**
 * Self-healing budget for the kiosk process, modeled on the factory
 * `RestartRule.txt` shipped on the borne (`{"apkNum":3,"posReconnectNum":15,
 * "posReconnectSecond":40,"rebootNum":3}`): 3 app crashes trigger a restart,
 * a POS/reader reconnect gets 15 tries 40s apart, and 3 restarts inside one
 * rolling window means something is structurally broken — stop looping and
 * surface a static error screen instead of burning the station in a
 * crash-restart-crash cycle. A regular (non device-owner) app cannot reboot
 * Android itself, so "restart" here means relaunching this app's process,
 * which is what actually recovers a hung WebView or a wedged reader session.
 */
class Watchdog(private val context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("batyeo_watchdog", Context.MODE_PRIVATE)

    /** Installs a crash handler that always chains to the platform's default after recording. */
    fun installCrashHandler() {
        val platformDefault = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { onCrash(error) }
            platformDefault?.uncaughtException(thread, error)
                ?: Process.killProcess(Process.myPid())
        }
    }

    /** True once too many restarts happened in the window — the caller should stop self-healing and show a static error instead. */
    fun isHardStopped(): Boolean = prefs.getBoolean(KEY_HARD_STOP, false)

    fun hardStopReason(): String = prefs.getString(KEY_HARD_STOP_REASON, "") ?: ""

    /** Operator recovery: clears counters and the hard-stop flag from the hidden config dialog. */
    fun reset() {
        prefs.edit().clear().apply()
    }

    private fun onCrash(error: Throwable) {
        Log.e(TAG, "Uncaught exception, evaluating restart budget", error)
        val now = SystemClock.elapsedRealtime()
        val windowStart = prefs.getLong(KEY_CRASH_WINDOW_START, now)
        val withinWindow = now - windowStart < CRASH_WINDOW_MS
        val count = (if (withinWindow) prefs.getInt(KEY_CRASH_COUNT, 0) else 0) + 1
        prefs.edit()
            .putLong(KEY_CRASH_WINDOW_START, if (withinWindow) windowStart else now)
            .putInt(KEY_CRASH_COUNT, count)
            .apply()
        if (count < RestartRule.APK_CRASH_BUDGET) {
            scheduleRestart()
            return
        }
        // apkNum crashes inside the window: count this as one restart-cycle
        // failure and decide whether we're still allowed to try again.
        recordRestartCycle()
        if (isHardStopped()) return
        scheduleRestart()
    }

    private fun recordRestartCycle() {
        val now = SystemClock.elapsedRealtime()
        val cycleWindowStart = prefs.getLong(KEY_CYCLE_WINDOW_START, now)
        val withinCycleWindow = now - cycleWindowStart < RESTART_CYCLE_WINDOW_MS
        val cycles = (if (withinCycleWindow) prefs.getInt(KEY_CYCLE_COUNT, 0) else 0) + 1
        prefs.edit()
            .putLong(KEY_CYCLE_WINDOW_START, if (withinCycleWindow) cycleWindowStart else now)
            .putInt(KEY_CYCLE_COUNT, cycles)
            .apply()
        if (cycles >= RestartRule.REBOOT_BUDGET) {
            prefs.edit()
                .putBoolean(KEY_HARD_STOP, true)
                .putString(
                    KEY_HARD_STOP_REASON,
                    "$cycles cycles de ${RestartRule.APK_CRASH_BUDGET} plantages en moins de " +
                        "${RESTART_CYCLE_WINDOW_MS / 60_000} min"
                )
                .apply()
            Log.e(TAG, "Restart budget exhausted, holding for manual recovery")
        }
    }

    private fun scheduleRestart() {
        val restartIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK) }
            ?: Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pending = PendingIntent.getActivity(
            context, 0, restartIntent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + RESTART_DELAY_MS, pending)
        Process.killProcess(Process.myPid())
    }

    private companion object {
        const val TAG = "BatyeoWatchdog"
        const val KEY_CRASH_WINDOW_START = "crash_window_start"
        const val KEY_CRASH_COUNT = "crash_count"
        const val KEY_CYCLE_WINDOW_START = "cycle_window_start"
        const val KEY_CYCLE_COUNT = "cycle_count"
        const val KEY_HARD_STOP = "hard_stop"
        const val KEY_HARD_STOP_REASON = "hard_stop_reason"
        const val CRASH_WINDOW_MS = 5 * 60_000L
        const val RESTART_CYCLE_WINDOW_MS = 30 * 60_000L
        const val RESTART_DELAY_MS = 2_000L
    }
}

/** Thresholds mirrored from the factory app's RestartRule.txt. */
object RestartRule {
    const val APK_CRASH_BUDGET = 3
    const val POS_RECONNECT_BUDGET = 15
    const val POS_RECONNECT_INTERVAL_SECONDS = 40
    const val REBOOT_BUDGET = 3
}

/**
 * Generic bounded-retry policy for a flaky external device connection (the
 * card reader today; anything else with the same "retry N times, M seconds
 * apart, then give up" shape tomorrow). Exhausting the budget is a terminal
 * state the caller must surface, never a silent infinite loop.
 */
class ReconnectPolicy(
    private val budget: Int = RestartRule.POS_RECONNECT_BUDGET,
    private val intervalMs: Long = RestartRule.POS_RECONNECT_INTERVAL_SECONDS * 1_000L
) {
    private var attempts = 0

    val exhausted: Boolean get() = attempts >= budget
    val nextDelayMs: Long get() = intervalMs
    val attemptCount: Int get() = attempts

    /** Call after each failed attempt. Returns false once the budget is exhausted. */
    fun recordFailure(): Boolean {
        attempts += 1
        return !exhausted
    }

    fun reset() {
        attempts = 0
    }
}

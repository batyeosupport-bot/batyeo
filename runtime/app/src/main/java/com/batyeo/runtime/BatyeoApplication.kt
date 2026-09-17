package com.batyeo.runtime

import android.app.Application

/**
 * Installs the crash watchdog before any Activity exists, so a crash during
 * MainActivity's own construction is still counted against the restart budget.
 */
class BatyeoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Watchdog(this).installCrashHandler()
    }
}

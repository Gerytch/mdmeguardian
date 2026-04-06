package com.mdm.enterprise.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.mdm.enterprise.utils.SecurePreferences

/**
 * Restarts MDM services after the app is updated (e.g. via remote APK push).
 * Without this, `adb install -r` or OTA updates kill the polling service and
 * the device goes permanently offline until someone opens the app manually.
 */
class PackageReplacedReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PackageReplacedReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        Log.i(TAG, "Package replaced — restarting MDM services")

        val isEnrolled = SecurePreferences.getInstance(context)
            .getString("device_token", null) != null

        if (isEnrolled) {
            CommandPollingService.start(context)
            Log.i(TAG, "CommandPollingService restarted after update")
        } else {
            Log.w(TAG, "Not enrolled — skipping service restart")
        }
    }
}

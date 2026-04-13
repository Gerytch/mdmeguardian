package com.mdm.enterprise.admin

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.mdm.enterprise.services.CommandPollingService
import com.mdm.enterprise.ui.AdminLockActivity
import com.mdm.enterprise.utils.BootPrefs
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.putBool

class MdmDeviceAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "MdmDeviceAdmin"
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device Admin enabled")
        SecurePreferences.getInstance(context).putBool("device_admin_active", true)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            // Fires before first unlock — use device-protected BootPrefs (credential storage
            // not yet available). Starts polling so commands arrive as soon as the device boots,
            // even if the user never touches the screen.
            Intent.ACTION_LOCKED_BOOT_COMPLETED -> {
                Log.i(TAG, "Locked boot completed — starting MDM services from BootPrefs")
                if (BootPrefs.isEnrolled(context)) {
                    CommandPollingService.start(context)
                }
            }
            // Fires after first unlock — credential storage is available; restore full state.
            Intent.ACTION_BOOT_COMPLETED -> {
                Log.i(TAG, "Boot completed — restoring MDM services")
                val prefs = SecurePreferences.getInstance(context)
                val isEnrolled = prefs.getString("device_token", null) != null
                if (isEnrolled) {
                    CommandPollingService.start(context)
                    AdminLockActivity.restoreIfNeeded(context)
                }
            }
        }
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "Device Admin disabled — MDM control lost")
        SecurePreferences.getInstance(context).putBool("device_admin_active", false)
    }

    override fun onPasswordChanged(context: Context, intent: Intent) {
        super.onPasswordChanged(context, intent)
        Log.i(TAG, "Device password changed")
    }

    override fun onPasswordFailed(context: Context, intent: Intent) {
        super.onPasswordFailed(context, intent)
        Log.w(TAG, "Device password failed")
    }

    override fun onPasswordSucceeded(context: Context, intent: Intent) {
        super.onPasswordSucceeded(context, intent)
        Log.i(TAG, "Device password succeeded")
    }

    override fun onLockTaskModeEntering(context: Context, intent: Intent, pkg: String) {
        super.onLockTaskModeEntering(context, intent, pkg)
        Log.i(TAG, "Lock task mode entering: $pkg")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        super.onLockTaskModeExiting(context, intent)
        Log.i(TAG, "Lock task mode exiting")
    }
}

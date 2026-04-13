package com.mdm.enterprise.utils

import android.content.Context

/**
 * Device-protected SharedPreferences — accessible before the first user unlock (Direct Boot).
 * Stores only the minimal credentials needed to start command polling on LOCKED_BOOT_COMPLETED.
 * Written at enrollment time; read at boot before credential-encrypted storage is available.
 */
object BootPrefs {

    private const val FILE = "mdm_boot_prefs"

    private fun prefs(context: Context) =
        context.createDeviceProtectedStorageContext()
            .getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun save(
        context: Context,
        deviceToken: String,
        deviceId: String,
        tenantId: String,
        serverUrl: String,
    ) {
        prefs(context).edit()
            .putString("device_token", deviceToken)
            .putString("device_id",    deviceId)
            .putString("tenant_id",    tenantId)
            .putString("server_url",   serverUrl)
            .putBoolean("enrolled",    true)
            .apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    fun isEnrolled(context: Context)    = prefs(context).getBoolean("enrolled",     false)
    fun getDeviceToken(context: Context) = prefs(context).getString("device_token", null)
    fun getDeviceId(context: Context)    = prefs(context).getString("device_id",    null)
    fun getTenantId(context: Context)    = prefs(context).getString("tenant_id",    null)
    fun getServerUrl(context: Context)   = prefs(context).getString("server_url",   null)
}

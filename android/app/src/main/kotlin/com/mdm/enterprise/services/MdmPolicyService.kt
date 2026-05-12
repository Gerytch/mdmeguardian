package com.mdm.enterprise.services

import android.Manifest
import android.accounts.AccountManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.UserManager
import android.util.Log
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.api.models.PolicyRules
import com.mdm.enterprise.ui.AdminLockActivity
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors
import kotlin.coroutines.resume

class MdmPolicyService(private val context: Context) {

    companion object {
        private const val TAG = "MdmPolicyService"
        private const val PREF_HIDDEN_APPS = "kiosk_hidden_apps"
        private const val PREF_PENDING_KIOSK_APPS = "pending_kiosk_apps"
        private const val PREF_PENDING_KIOSK_MODE = "pending_kiosk_mode"
    }

    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, MdmDeviceAdminReceiver::class.java)
    private val prefs = context.getSharedPreferences("mdm_kiosk", Context.MODE_PRIVATE)

    val isDeviceOwner: Boolean get() = dpm.isDeviceOwnerApp(context.packageName)
    val isDeviceAdmin: Boolean get() = dpm.isAdminActive(adminComponent)

    /** Sets the device's visible name via BluetoothAdapter.setName() and Settings.Global.
     *  Best-effort — never throws so the caller's command is never marked FAILED. */
    fun setDeviceName(name: String) {
        if (!isDeviceOwner) return

        // API 31+ (Android 12): BLUETOOTH_CONNECT is a runtime permission — auto-grant via Device Owner
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                dpm.setPermissionGrantState(
                    adminComponent,
                    context.packageName,
                    Manifest.permission.BLUETOOTH_CONNECT,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                )
            } catch (e: Exception) {
                Log.w(TAG, "setDeviceName: could not grant BLUETOOTH_CONNECT (${e.message})")
            }
        }

        // BluetoothAdapter.setName() is the reliable way to change the visible device name
        try {
            val bt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
            } else {
                @Suppress("DEPRECATION")
                android.bluetooth.BluetoothAdapter.getDefaultAdapter()
            }
            bt?.setName(name)
            Log.i(TAG, "setDeviceName: BluetoothAdapter name set to \"$name\"")
        } catch (e: Exception) {
            Log.w(TAG, "setDeviceName: BluetoothAdapter.setName failed (${e.message})")
        }

        // Also attempt setGlobalSetting — works on some OEMs, silently ignored on others
        try {
            dpm.setGlobalSetting(adminComponent, android.provider.Settings.Global.DEVICE_NAME, name)
        } catch (_: Exception) { /* device_name not in setGlobalSetting allowlist on most versions */ }
    }

    fun applyPolicy(rules: PolicyRules) {
        Log.i(TAG, "Applying policy: $rules")

        if (!isDeviceAdmin) {
            Log.e(TAG, "Not a device admin — cannot apply policy")
            return
        }

        setPasswordPolicy(rules)
        blockCamera(rules.cameraBlocked)
        blockScreenCapture(rules.screenshotBlocked)

        if (isDeviceOwner) {
            blockFactoryReset(rules.factoryResetBlocked)
            if (rules.kioskMode) {
                enableKioskMode(rules.kioskApps, rules.kioskModeType)
            } else {
                disableKioskMode()
            }
            blockUSBDataTransfer(rules.usbBlocked)
        }

        // Location tracking
        if (rules.locationTracking) {
            // Auto-grant location permissions via Device Owner so real devices don't
            // silently fail the runtime permission check in LocationTrackingWorker.
            if (isDeviceOwner) {
                listOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                ).forEach { perm ->
                    try {
                        dpm.setPermissionGrantState(
                            adminComponent,
                            context.packageName,
                            perm,
                            DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not auto-grant $perm: ${e.message}")
                    }
                }
                Log.i(TAG, "Location permissions auto-granted via Device Owner")

                // Enable location at system level (API 28+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    try {
                        dpm.setLocationEnabled(adminComponent, true)
                        Log.i(TAG, "Location enabled via setLocationEnabled()")
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not enable location: ${e.message}")
                    }
                }
            }
            val intervalMinutes = rules.trackingIntervalMinutes.toLong().coerceAtLeast(1)
            Log.i(TAG, "Location tracking enabled — interval: ${intervalMinutes}min")
            LocationTrackingWorker.schedule(context, intervalMinutes)
            LocationTrackingWorker.scheduleImmediate(context) // send first fix right away
        } else {
            Log.i(TAG, "Location tracking disabled — cancelling worker")
            LocationTrackingWorker.cancel(context)
        }

        Log.i(TAG, "Policy applied successfully")
    }

    private fun setPasswordPolicy(rules: PolicyRules) {
        if (!rules.passwordRequired) return
        try {
            dpm.setPasswordQuality(adminComponent, DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
            dpm.setPasswordMinimumLength(adminComponent, rules.minPasswordLength)
            dpm.setMaximumFailedPasswordsForWipe(adminComponent, rules.maxFailedAttempts)
            dpm.setMaximumTimeToLock(adminComponent, rules.screenTimeoutSeconds * 1000L)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set password policy", e)
        }
    }

    fun enableKioskMode(packages: List<String>, mode: String = "whitelist") {
        if (!isDeviceOwner) {
            Log.e(TAG, "Device Owner required for kiosk mode")
            return
        }
        if (mode !in listOf("whitelist", "blacklist")) {
            Log.e(TAG, "Invalid kiosk mode: $mode")
            return
        }
        val pm = context.packageManager
        val launchIntent = android.content.Intent(android.content.Intent.ACTION_MAIN, null)
            .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        val launcherApps = pm.queryIntentActivities(launchIntent, android.content.pm.PackageManager.MATCH_UNINSTALLED_PACKAGES)
            .mapNotNull { it.activityInfo?.packageName }
            .toSet()

        // System apps that don't show a LAUNCHER entry but must still be hidden in
        // whitelist kiosk mode (Settings, package installer, etc.)
        val systemAppsToControl = setOf(
            "com.android.settings",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
        )

        val allApps = (launcherApps + systemAppsToControl)
            .filter { it != context.packageName }  // MDM agent never hidden
            .toSet()

        // MDM package is always exempt — never goes into toHide
        // Intersect with allApps so uninstalled packages don't cause empty whitelist → all hidden
        val selected = (packages.toSet() - context.packageName).intersect(allApps)
        if (selected.isEmpty() && mode == "whitelist") {
            Log.w(TAG, "Kiosk whitelist: no valid installed apps — saving as pending (apps: $packages)")
            prefs.edit()
                .putStringSet(PREF_PENDING_KIOSK_APPS, packages.toSet())
                .putString(PREF_PENDING_KIOSK_MODE, mode)
                .apply()
            return
        }

        // Apps are installed — clear any pending config and proceed
        prefs.edit().remove(PREF_PENDING_KIOSK_APPS).remove(PREF_PENDING_KIOSK_MODE).apply()
        val toHide = if (mode == "blacklist") {
            selected                             // blacklist: hide only the selected ones
        } else {
            allApps - selected                   // whitelist: hide everything NOT selected
        }

        val actuallyHidden = mutableSetOf<String>()
        for (pkg in allApps) {
            val hide = pkg in toHide
            try {
                dpm.setApplicationHidden(adminComponent, pkg, hide)
                if (hide) actuallyHidden.add(pkg)
            } catch (e: Exception) {
                Log.w(TAG, "Could not set hidden for $pkg: ${e.message}")
            }
        }

        // Persist hidden list so disableKioskMode can restore exactly these
        prefs.edit().putStringSet(PREF_HIDDEN_APPS, actuallyHidden).apply()
        Log.i(TAG, "Kiosk ($mode): hidden ${actuallyHidden.size}, visible ${(allApps - toHide).size}")

        // Clear the launcher's user data so pinned shortcuts on the home screen
        // grid are wiped. The launcher will restart fresh and only render apps
        // that are not hidden via setApplicationHidden.
        clearLauncherData()
    }

    /**
     * Resets the default launcher's user data so that home screen shortcuts
     * (pinned icons) are cleared. The launcher restarts clean and only shows
     * apps that are not hidden via setApplicationHidden().
     * Requires Device Owner + Android 9+.
     */
    private fun clearLauncherData() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        try {
            val launcherPkg = context.packageManager
                .resolveActivity(
                    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                    PackageManager.MATCH_DEFAULT_ONLY,
                )?.activityInfo?.packageName ?: return

            if (launcherPkg == context.packageName) return  // don't clear ourselves

            dpm.clearApplicationUserData(adminComponent, launcherPkg, { it.run() }) { _, _ ->
                Log.i(TAG, "Launcher data cleared — home screen grid reset")
            }
        } catch (e: Exception) {
            Log.w(TAG, "clearLauncherData: ${e.message}")
        }
    }

    fun disableKioskMode() {
        if (!isDeviceOwner) return

        val savedHidden = prefs.getStringSet(PREF_HIDDEN_APPS, emptySet()) ?: emptySet()

        // If we have a saved list use it; otherwise fallback to all installed packages
        val toRestore: Collection<String> = if (savedHidden.isNotEmpty()) {
            savedHidden
        } else {
            @Suppress("DEPRECATION")
            context.packageManager
                .getInstalledApplications(android.content.pm.PackageManager.GET_META_DATA)
                .map { it.packageName }
        }

        var restored = 0
        for (pkg in toRestore) {
            try {
                dpm.setApplicationHidden(adminComponent, pkg, false)
                restored++
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unhide $pkg: ${e.message}")
            }
        }
        prefs.edit().remove(PREF_HIDDEN_APPS).apply()

        try {
            dpm.setLockTaskPackages(adminComponent, emptyArray())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to clear lock task packages: ${e.message}")
        }
        Log.i(TAG, "Kiosk disabled — $restored restored (saved=${savedHidden.size}, fallback=${toRestore.size})")

        // Restart launcher so it refreshes its app list immediately
        try {
            context.packageManager.getLaunchIntentForPackage("com.google.android.apps.nexuslauncher")
                ?.let { context.startActivity(it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
        } catch (e: Exception) {
            Log.w(TAG, "Could not restart launcher: ${e.message}")
        }
    }

    fun blockCamera(block: Boolean) {
        try {
            dpm.setCameraDisabled(adminComponent, block)
            Log.i(TAG, "Camera blocked: $block")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set camera policy", e)
        }
    }

    fun blockScreenCapture(block: Boolean) {
        if (!isDeviceOwner) return
        try {
            dpm.setScreenCaptureDisabled(adminComponent, block)
            Log.i(TAG, "Screenshot blocked: $block")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set screenshot policy", e)
        }
    }

    fun blockUSBDataTransfer(block: Boolean) {
        if (!isDeviceOwner) return
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) {
            Log.i(TAG, "USB blocking skipped: requires API 31+ (device is API ${android.os.Build.VERSION.SDK_INT})")
            return
        }
        try {
            dpm.setUsbDataSignalingEnabled(!block)
            Log.i(TAG, "USB data transfer blocked: $block")
        } catch (e: Exception) {
            Log.w(TAG, "USB blocking not supported on this device", e)
        }
    }

    fun blockFactoryReset(block: Boolean) {
        if (!isDeviceOwner) return
        try {
            if (block) {
                dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_FACTORY_RESET)
                dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_SAFE_BOOT)
            } else {
                dpm.clearUserRestriction(adminComponent, UserManager.DISALLOW_FACTORY_RESET)
                dpm.clearUserRestriction(adminComponent, UserManager.DISALLOW_SAFE_BOOT)
            }
            Log.i(TAG, "Factory reset blocked: $block")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set factory reset restriction", e)
        }
    }

    fun lockDevice() {
        try {
            dpm.lockNow()
            Log.i(TAG, "Device locked")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to lock device", e)
        }
    }

    @Suppress("DEPRECATION")
    fun unlockDevice() {
        if (!isDeviceOwner) {
            Log.w(TAG, "Device Owner required for remote unlock")
            return
        }
        try {
            // Disable keyguard so no PIN is required
            dpm.setKeyguardDisabled(adminComponent, true)

            // Wake the screen (FULL_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP turns display on)
            val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            val wl = pm.newWakeLock(
                android.os.PowerManager.FULL_WAKE_LOCK or
                android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                android.os.PowerManager.ON_AFTER_RELEASE,
                "MDM:unlock"
            )
            wl.acquire(3000L)
            wl.release()

            Log.i(TAG, "Device unlocked and screen woken")

            // Re-enable keyguard after 10s so lock screen returns on next sleep
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                try {
                    dpm.setKeyguardDisabled(adminComponent, false)
                    Log.i(TAG, "Keyguard re-enabled")
                } catch (_: Exception) {}
            }, 10_000)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unlock device", e)
        }
    }

    fun factoryReset() {
        try {
            try {
                dpm.wipeData(DevicePolicyManager.WIPE_RESET_PROTECTION_DATA)
            } catch (e: IllegalStateException) {
                Log.w(TAG, "WIPE_RESET_PROTECTION_DATA failed, falling back to wipeData(0): ${e.message}")
                dpm.wipeData(0)
            }
            Log.i(TAG, "Factory reset initiated")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to factory reset device", e)
        }
    }

    /**
     * Selective wipe: clears all app data, removes accounts, and deletes user files
     * while keeping E.Guardian installed for continued tracking.
     */
    suspend fun selectiveWipe(): Map<String, Any> {
        if (!isDeviceOwner) {
            Log.w(TAG, "selectiveWipe: Device Owner required")
            return mapOf("error" to "Device Owner required")
        }
        // NonCancellable prevents the polling loop restart from killing the wipe mid-execution
        return withContext(NonCancellable) { selectiveWipeInternal() }
    }

    private suspend fun selectiveWipeInternal(): Map<String, Any> {
        val executor = Executors.newSingleThreadExecutor()
        var appsCleared = 0
        var appsFailed = 0
        var accountsRemoved = 0
        var filesDeleted = 0

        // ── Phase 1: Clear app data (user-installed apps only, skip system apps) ──
        Log.i(TAG, "selectiveWipe: Phase 1 — Clearing app data")
        val pm = context.packageManager
        val packages = pm.getInstalledPackages(0)
            .filter { it.packageName != context.packageName }
            .filter { it.applicationInfo != null && (it.applicationInfo!!.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) == 0 }
            .map { it.packageName }
        Log.i(TAG, "selectiveWipe: ${packages.size} user apps to clear")

        for (pkg in packages) {
            try {
                val cleared = suspendCancellableCoroutine { cont ->
                    dpm.clearApplicationUserData(adminComponent, pkg, executor) { _, succeeded ->
                        cont.resume(succeeded)
                    }
                }
                if (cleared) {
                    appsCleared++
                    Log.d(TAG, "selectiveWipe: cleared data for $pkg")
                } else {
                    appsFailed++
                    Log.w(TAG, "selectiveWipe: failed to clear data for $pkg")
                }
            } catch (e: Exception) {
                appsFailed++
                Log.w(TAG, "selectiveWipe: error clearing $pkg: ${e.message}")
            }
        }
        Log.i(TAG, "selectiveWipe: Phase 1 done — cleared=$appsCleared failed=$appsFailed")

        // ── Phase 2: Remove accounts ──
        Log.i(TAG, "selectiveWipe: Phase 2 — Removing accounts")
        try {
            val accountManager = AccountManager.get(context)
            val accounts = accountManager.accounts
            for (account in accounts) {
                try {
                    val removed = accountManager.removeAccountExplicitly(account)
                    if (removed) {
                        accountsRemoved++
                        Log.d(TAG, "selectiveWipe: removed account ${account.type}/${account.name}")
                    } else {
                        Log.w(TAG, "selectiveWipe: could not remove account ${account.type}/${account.name}")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "selectiveWipe: error removing account ${account.type}: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "selectiveWipe: Phase 2 error", e)
        }
        Log.i(TAG, "selectiveWipe: Phase 2 done — accountsRemoved=$accountsRemoved")

        // ── Phase 3: Delete user files from storage ──
        Log.i(TAG, "selectiveWipe: Phase 3 — Deleting user files")
        val storageDirs = listOf(
            Environment.DIRECTORY_DOWNLOADS,
            Environment.DIRECTORY_DCIM,
            Environment.DIRECTORY_PICTURES,
            Environment.DIRECTORY_DOCUMENTS,
            Environment.DIRECTORY_MOVIES,
            Environment.DIRECTORY_MUSIC,
            Environment.DIRECTORY_RINGTONES,
            Environment.DIRECTORY_PODCASTS,
            Environment.DIRECTORY_ALARMS,
            Environment.DIRECTORY_NOTIFICATIONS,
        )
        for (dirName in storageDirs) {
            try {
                val dir = Environment.getExternalStoragePublicDirectory(dirName)
                if (dir.exists() && dir.isDirectory) {
                    filesDeleted += deleteRecursive(dir)
                }
            } catch (e: Exception) {
                Log.w(TAG, "selectiveWipe: error deleting $dirName: ${e.message}")
            }
        }
        Log.i(TAG, "selectiveWipe: Phase 3 done — filesDeleted=$filesDeleted")

        executor.shutdown()
        Log.i(TAG, "selectiveWipe: COMPLETE — apps=$appsCleared/$appsFailed accounts=$accountsRemoved files=$filesDeleted")

        return mapOf(
            "appsCleared" to appsCleared,
            "appsFailed" to appsFailed,
            "accountsRemoved" to accountsRemoved,
            "filesDeleted" to filesDeleted,
        )
    }

    /** Recursively deletes files inside a directory (keeps the directory itself). */
    private fun deleteRecursive(dir: File): Int {
        var count = 0
        dir.listFiles()?.forEach { file ->
            if (file.isDirectory) {
                count += deleteRecursive(file)
                file.delete()
            } else {
                if (file.delete()) count++
            }
        }
        return count
    }

    fun adminLock(message: String, contact: String?, severity: String) {
        Log.i(TAG, "Admin lock: severity=$severity message=$message")
        AdminLockActivity.start(context, message, contact, severity)
    }

    fun adminUnlock() {
        Log.i(TAG, "Admin lock released")
        AdminLockActivity.release(context)
        // Cancel the watchdog full-screen notification if it's showing.
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
            .cancel(AdminLockActivity.ALERT_NOTIF_ID)
        // Send broadcast to finish the activity if it's running.
        context.sendBroadcast(
            android.content.Intent("com.mdm.enterprise.ADMIN_UNLOCK")
                .setPackage(context.packageName)
        )
    }

    fun sendMessage(title: String, message: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channelId = "mdm_messages"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(
                    android.app.NotificationChannel(channelId, "Mensagens do TI",
                        android.app.NotificationManager.IMPORTANCE_HIGH)
                )
            }
        }
        val notif = androidx.core.app.NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .build()
        nm.notify(System.currentTimeMillis().toInt(), notif)
        Log.i(TAG, "Message sent: $title")
    }

    /**
     * Called every poll cycle. If a kiosk was deferred because required apps weren't
     * installed yet, checks whether they are installed now and applies kiosk automatically.
     */
    fun applyPendingKioskIfReady() {
        val pendingApps = prefs.getStringSet(PREF_PENDING_KIOSK_APPS, null) ?: return
        val mode = prefs.getString(PREF_PENDING_KIOSK_MODE, "whitelist") ?: "whitelist"

        val pm = context.packageManager
        val installedPackages = pm.getInstalledApplications(0).map { it.packageName }.toSet()
        val missing = pendingApps.filter { it != context.packageName && it !in installedPackages }

        if (missing.isNotEmpty()) {
            Log.d(TAG, "Pending kiosk: still waiting for ${missing.size} app(s): $missing")
            return
        }

        Log.i(TAG, "Pending kiosk: all apps now installed — applying kiosk ($mode, apps=$pendingApps)")
        prefs.edit().remove(PREF_PENDING_KIOSK_APPS).remove(PREF_PENDING_KIOSK_MODE).apply()
        enableKioskMode(pendingApps.toList(), mode)
    }

    fun reboot() {
        if (!isDeviceOwner) return
        try {
            dpm.reboot(adminComponent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to reboot device", e)
        }
    }
}

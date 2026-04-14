package com.mdm.enterprise.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.mdm.enterprise.R
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.mdm.enterprise.api.MdmApi
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.CommandAckRequest
import com.mdm.enterprise.api.models.PolicyRules
import com.mdm.enterprise.api.models.RequiredApp
import com.mdm.enterprise.ui.AdminLockActivity
import com.mdm.enterprise.ui.DeviceLoginActivity
import com.mdm.enterprise.utils.BootPrefs
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.mdm.enterprise.api.models.OfflineSessionPayload
import com.mdm.enterprise.api.models.SyncOfflineRequest
import com.mdm.enterprise.utils.OfflineSessionStore
import kotlinx.coroutines.*

class CommandPollingService : Service() {

    companion object {
        private const val TAG = "CmdPollService"
        private const val CHANNEL_ID = "mdm_polling"
        private const val ADMIN_LOCK_CHANNEL_ID = "mdm_admin_lock_alert"
        private const val NOTIF_ID = 1001
        const val POLL_INTERVAL_MS = 5_000L
        private const val KEY_PENDING_UPDATE_CMD = "pending_agent_update_cmd"
        private const val KEY_PENDING_UPDATE_VER = "pending_agent_update_ver"
        private const val KEY_PENDING_UPDATE_TS  = "pending_agent_update_ts"

        fun start(context: Context) {
            val intent = Intent(context, CommandPollingService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CommandPollingService::class.java))
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var pollingJob: Job? = null
    private lateinit var api: MdmApi
    private lateinit var prefs: SharedPreferences
    private lateinit var policyService: MdmPolicyService
    private lateinit var apkInstaller: ApkInstaller
    private lateinit var networkTestExecutor: NetworkTestExecutor

    private val connectivityCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Log.i(TAG, "Network available — syncing offline sessions and refreshing user cache")
            scope.launch { syncAndRefresh() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        api = MdmApiClient.getInstance(applicationContext)
        prefs = SecurePreferences.getInstance(applicationContext)
        policyService = MdmPolicyService(applicationContext)
        apkInstaller = ApkInstaller(applicationContext)
        networkTestExecutor = NetworkTestExecutor(applicationContext)
        createNotificationChannel()

        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            cm.registerDefaultNetworkCallback(connectivityCallback)
        } else {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(request, connectivityCallback)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())

        // If admin lock was active before crash/restart, restore it immediately.
        // This prevents the window between service restart and the first watchdog tick
        // (up to 1s) where the device would be exposed.
        if (AdminLockActivity.isActive(applicationContext) && !AdminLockActivity.isInForeground) {
            Log.i(TAG, "Service (re)start: admin lock was active — restoring immediately")
            postAdminLockAlert(applicationContext, forceStart = true)
        }

        // Check if a self-update was in progress — report result to backend
        checkPendingAgentUpdate()

        pollingJob?.cancel()
        pollingJob = startPollingLoop()
        Log.i(TAG, "Command polling service started (interval: ${POLL_INTERVAL_MS}ms)")
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.unregisterNetworkCallback(connectivityCallback)
        } catch (_: Exception) {}
        scope.cancel()
        super.onDestroy()
    }

    /** On service start (including after self-update), check if there was a pending UPDATE_AGENT
     *  and report the install result to the backend based on the current installed version. */
    private fun checkPendingAgentUpdate() {
        val pendingCommandId = prefs.getString(KEY_PENDING_UPDATE_CMD, null) ?: return
        val targetVersion   = prefs.getString(KEY_PENDING_UPDATE_VER, null) ?: return
        val timestampMs     = prefs.getLong(KEY_PENDING_UPDATE_TS, 0L)
        val deviceToken     = prefs.getStr("device_token") ?: return

        val currentVersion = try {
            applicationContext.packageManager
                .getPackageInfo(applicationContext.packageName, 0).versionName
        } catch (_: Exception) { null }

        val ageMs = System.currentTimeMillis() - timestampMs
        val success = currentVersion == targetVersion
        // Only report if install succeeded OR enough time has passed (timeout = 5 min)
        if (!success && ageMs < 5 * 60 * 1_000L) {
            Log.d(TAG, "Pending agent update ($targetVersion) still in progress — waiting")
            return
        }

        // Clear stored state before reporting (prevents double-report on retry)
        prefs.edit()
            .remove(KEY_PENDING_UPDATE_CMD)
            .remove(KEY_PENDING_UPDATE_VER)
            .remove(KEY_PENDING_UPDATE_TS)
            .apply()

        scope.launch {
            try {
                val body = com.mdm.enterprise.api.models.InstallResultRequest(
                    success          = success,
                    installedVersion = currentVersion,
                    errorMessage     = if (!success) "Version mismatch after install: expected $targetVersion, got $currentVersion (timeout ${ageMs / 1000}s)" else null,
                )
                api.reportInstallResult(deviceToken, pendingCommandId, body)
                Log.i(TAG, "Agent update result reported: success=$success version=$currentVersion")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to report agent update result: ${e.message}")
            }
        }
    }


    private fun startPollingLoop(): Job = scope.launch {
        launch {
            while (isActive) {
                try {
                    pollCommands()
                } catch (e: Exception) {
                    Log.w(TAG, "Poll cycle error: ${e.message}")
                }
                delay(POLL_INTERVAL_MS)
            }
        }

        // Watchdog: if admin lock is active but the activity is not in foreground,
        // re-launch AdminLockActivity. Uses Device Owner setKeyguardDisabled+startActivity
        // (same as session watchdog) to work on Android 14+ where USE_FULL_SCREEN_INTENT
        // is restricted. lockFired flag prevents hammering — resets when lock is restored.
        launch {
            var lockFired = false
            while (isActive) {
                delay(1_000L)
                if (AdminLockActivity.isActive(applicationContext) &&
                    !AdminLockActivity.isInForeground
                ) {
                    Log.i(TAG, "Admin lock watchdog: not in foreground (lockFired=$lockFired)")
                    postAdminLockAlert(applicationContext, forceStart = !lockFired)
                    lockFired = true
                } else if (lockFired && AdminLockActivity.isInForeground) {
                    Log.i(TAG, "Admin lock watchdog: activity restored, resetting lockFired")
                    lockFired = false
                }
            }
        }

        // Watchdog: if device-user auth is required and no active session exists,
        // launch DeviceLoginActivity. Uses a 5s cooldown to avoid spamming startActivity
        // while the previous launch is still animating in. No notification is posted —
        // the lock-task activity IS the UI. Notification 4001 is cancelled if stale.
        launch {
            var lastTriggerMs = 0L
            while (isActive) {
                delay(2_000L)
                val authRequired = prefs.getString("device_user_auth_required", "false") == "true"
                val hasSession = com.mdm.enterprise.ui.DeviceLoginActivity.hasActiveSession(applicationContext)
                if (!hasSession) {
                    // Restore pre-admin state if an admin user just logged out / timed out
                    val preAdminState = OfflineSessionStore.getPreAdminState(applicationContext)
                    if (preAdminState != null) {
                        Log.i(TAG, "Session watchdog: restoring pre-admin state (locked=${preAdminState.wasAdminLocked} kiosk=${preAdminState.wasKioskActive})")
                        if (preAdminState.wasAdminLocked) {
                            policyService.adminLock(
                                preAdminState.adminLockMessage,
                                preAdminState.adminLockContact.takeIf { it.isNotBlank() },
                                preAdminState.adminLockSeverity,
                            )
                        }
                        if (preAdminState.wasKioskActive) {
                            policyService.enableKioskMode(preAdminState.kioskHiddenApps, preAdminState.kioskMode)
                            prefs.edit().putString("current_kiosk_mode", preAdminState.kioskMode).apply()
                        }
                        OfflineSessionStore.clearPreAdminState(applicationContext)
                    }
                }
                val loginInForeground = com.mdm.enterprise.ui.DeviceLoginActivity.isInForeground
                if (authRequired && !hasSession && !loginInForeground) {
                    val now = System.currentTimeMillis()
                    if (now - lastTriggerMs > 5_000L) {
                        Log.i(TAG, "Session watchdog: no active session, triggering login")
                        postLoginRequiredAlert(applicationContext)
                        lastTriggerMs = now
                    }
                } else if (hasSession || loginInForeground) {
                    // Cancel any stale notification left from a previous session expiry
                    val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(4001)
                }
            }
        }
    }

    private suspend fun pollCommands() {
        // Apply deferred kiosk if required apps finished installing since last poll
        policyService.applyPendingKioskIfReady()

        // Fall back to device-protected BootPrefs before first unlock (Direct Boot)
        val deviceToken = prefs.getStr("device_token") ?: BootPrefs.getDeviceToken(applicationContext) ?: return
        val deviceId   = prefs.getStr("device_id")    ?: BootPrefs.getDeviceId(applicationContext)    ?: return
        val tenantId   = prefs.getStr("tenant_id")    ?: BootPrefs.getTenantId(applicationContext)    ?: return

        val sessionId = prefs.getStr(com.mdm.enterprise.ui.DeviceLoginActivity.PREF_SESSION_ID)
        val isOfflineSession = prefs.getBoolean(com.mdm.enterprise.ui.DeviceLoginActivity.PREF_SESSION_OFFLINE, false)
        if (sessionId != null && !isOfflineSession) {
            val resp = try { api.validateSession(deviceToken, sessionId) } catch (e: Exception) { null }
            if (resp != null && resp.code() == 410) {
                Log.i(TAG, "Session $sessionId invalidated remotely — forcing re-login")
                com.mdm.enterprise.ui.DeviceLoginActivity.clearSession(applicationContext)
                com.mdm.enterprise.ui.DeviceLoginActivity.start(
                    applicationContext,
                    "Sessão encerrada: login realizado em outro dispositivo"
                )
                return
            }
        }

        // Sync offline sessions pendentes sempre que o poll conectar com sucesso
        if (OfflineSessionStore.getPendingSessions(applicationContext).isNotEmpty()) {
            syncPendingOfflineSessions(deviceToken)
        }

        val commands = api.getPendingCommands(deviceToken, com.mdm.enterprise.BuildConfig.VERSION_NAME)
        if (commands.isEmpty()) return

        Log.i(TAG, "Fetched ${commands.size} pending command(s)")

        // Keep CPU alive during command execution without lighting the screen
        val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val cmdWakeLock = pm.newWakeLock(
            android.os.PowerManager.PARTIAL_WAKE_LOCK,
            "MDM:cmdExec"
        )
        cmdWakeLock.acquire(60_000L) // max 60s safety timeout

        try {
        for (command in commands) {
            Log.i(TAG, "Executing: ${command.type} (${command.id})")
            var success = true
            var errorMessage: String? = null
            val result = mutableMapOf<String, Any?>()

            try {
                when (command.type) {
                    "LOCK"   -> policyService.lockDevice()
                    "UNLOCK" -> policyService.unlockDevice()
                    "WIPE"   -> policyService.wipeDevice()
                    "REBOOT" -> policyService.reboot()

                    "RENAME_DEVICE" -> {
                        // Inner try/catch — command is always EXECUTED regardless of
                        // payload issues or OS restrictions (name is already correct in backend)
                        try {
                            val name = command.payload?.get("name") as? String
                            if (!name.isNullOrBlank()) {
                                policyService.setDeviceName(name)
                                Log.i(TAG, "RENAME_DEVICE: device name set to \"$name\"")
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "RENAME_DEVICE: best-effort failed — ${e.message}")
                        }
                    }

                    "ADMIN_LOCK" -> {
                        // Admin lock must wake the screen to show the lock activity
                        val screenWl = pm.newWakeLock(
                            android.os.PowerManager.FULL_WAKE_LOCK or
                            android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                            android.os.PowerManager.ON_AFTER_RELEASE,
                            "MDM:adminLockWake"
                        )
                        screenWl.acquire(10_000L)
                        val message  = command.payload["message"]  as? String ?: "Leve este dispositivo ao setor de TI"
                        val contact  = command.payload["contact"]  as? String
                        val severity = command.payload["severity"] as? String ?: "warning"
                        policyService.adminLock(message, contact, severity)
                        if (screenWl.isHeld) screenWl.release()
                    }

                    "ADMIN_UNLOCK" -> policyService.adminUnlock()

                    "SEND_MESSAGE" -> {
                        val title = command.payload["title"] as? String ?: "Mensagem do TI"
                        val message = command.payload["message"] as? String ?: ""
                        policyService.sendMessage(title, message)
                    }

                    "ENABLE_KIOSK" -> {
                        val apps = (command.payload["apps"] as? List<*>)
                            ?.filterIsInstance<String>() ?: emptyList()
                        val mode = (command.payload["mode"] as? String)
                            ?.takeIf { it in listOf("whitelist", "blacklist") } ?: "whitelist"
                        policyService.enableKioskMode(apps, mode)
                        prefs.edit().putString("current_kiosk_mode", mode).apply()
                        result["mode"] = mode
                        result["appCount"] = apps.size
                    }
                    "DISABLE_KIOSK" -> policyService.disableKioskMode()

                    "UPDATE_POLICY" -> {
                        // Rules are embedded in the command payload — no extra API call needed
                        val gson = Gson()
                        val rulesJson = gson.toJson(command.payload["rules"])
                        val rules = gson.fromJson(rulesJson, PolicyRules::class.java)
                            ?: PolicyRules()

                        policyService.applyPolicy(rules)

                        // Sync device name — best-effort, same as RENAME_DEVICE
                        val deviceName = command.payload["deviceName"] as? String
                        if (!deviceName.isNullOrBlank()) {
                            policyService.setDeviceName(deviceName)
                        }

                        result["policyId"] = command.payload["policyId"]

                        prefs.edit()
                            .putString("device_user_auth_required", rules.deviceUserAuthRequired.toString())
                            .putString("inactivity_timeout_minutes", rules.inactivityTimeoutMinutes.toString())
                            .apply()

                        if (!rules.deviceUserAuthRequired) {
                            // Auth disabled — stop monitor, clear session, cancel stale notification
                            UserActivityMonitorService.stop(applicationContext)
                            DeviceLoginActivity.clearSession(applicationContext)
                            applicationContext.sendBroadcast(
                                android.content.Intent("com.mdm.enterprise.DISMISS_LOGIN")
                            )
                            // Cancel the "Login Necessário" notification in case it was already posted
                            (applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                                .cancel(4001)
                        }
                        // When deviceUserAuthRequired is true and there's no active session,
                        // the watchdog (running every 2s) will call postLoginRequiredAlert() on
                        // its next tick. Do NOT call DeviceLoginActivity.start() here — doing so
                        // would race with the watchdog and cause the login screen to flash twice.

                        // Install required apps (download APKs not yet installed)
                        val appsJson = gson.toJson(command.payload["requiredApps"])
                        val appsType = object : TypeToken<List<RequiredApp>>() {}.type
                        val requiredApps: List<RequiredApp> = gson.fromJson(appsJson, appsType) ?: emptyList()
                        if (requiredApps.isNotEmpty()) {
                            apkInstaller.installMissingApps(requiredApps)
                            result["requiredAppsCount"] = requiredApps.size
                        }
                    }

                    "LOCATE" -> {
                        LocationTrackingWorker.scheduleImmediate(applicationContext)
                        result["triggered"] = true
                    }

                    "GET_APPS" -> {
                        val pm = applicationContext.packageManager
                        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN, null)
                            .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
                        // MATCH_UNINSTALLED_PACKAGES includes apps hidden by setApplicationHidden()
                        // so the list is complete even when kiosk mode is active (minSdk=25, API 23+)
                        val launchable = pm.queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_UNINSTALLED_PACKAGES)
                        val apps = launchable
                            .filter { it.activityInfo.packageName != applicationContext.packageName }
                            .map { ri ->
                                mapOf(
                                    "packageName" to ri.activityInfo.packageName,
                                    "label" to ri.loadLabel(pm).toString(),
                                )
                            }
                            .sortedBy { it["label"] as String }
                        result["apps"] = apps
                    }

                    "UPDATE_AGENT" -> {
                        val apkUrl = command.payload?.get("apkUrl") as? String
                        val version = command.payload?.get("version") as? String
                        if (apkUrl.isNullOrBlank()) {
                            result["error"] = "apkUrl missing in payload"
                        } else {
                            Log.i(TAG, "UPDATE_AGENT: downloading v$version from $apkUrl")
                            // Save pending update before triggering install.
                            // checkPendingAgentUpdate() on next start will report the real result.
                            prefs.edit()
                                .putString(KEY_PENDING_UPDATE_CMD, command.id)
                                .putString(KEY_PENDING_UPDATE_VER, version ?: "")
                                .putLong(KEY_PENDING_UPDATE_TS, System.currentTimeMillis())
                                .apply()
                            val agentApp = com.mdm.enterprise.api.models.RequiredApp(
                                packageName = applicationContext.packageName,
                                name        = "E.Guardian MDM Agent",
                                apkUrl      = apkUrl,
                                version     = version ?: "0",
                            )
                            apkInstaller.installMissingApps(listOf(agentApp))
                            result["status"] = "INSTALLING"
                            result["targetVersion"] = version ?: "unknown"
                        }
                    }

                    "UNINSTALL_APP" -> {
                        val packageName = command.payload["packageName"] as? String
                        if (packageName.isNullOrBlank()) {
                            throw IllegalArgumentException("UNINSTALL_APP: packageName missing in payload")
                        }
                        if (packageName == applicationContext.packageName) {
                            throw IllegalArgumentException("UNINSTALL_APP: cannot uninstall MDM agent")
                        }
                        val installer = applicationContext.packageManager.packageInstaller
                        val intent = android.content.Intent("android.intent.action.MAIN")
                            .setPackage(applicationContext.packageName)
                        val piFlags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S)
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
                        else
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        val pi = android.app.PendingIntent.getBroadcast(
                            applicationContext, packageName.hashCode(), intent, piFlags)
                        installer.uninstall(packageName, pi.intentSender)
                        result["packageName"] = packageName
                        result["triggered"] = true
                        Log.i(TAG, "UNINSTALL_APP: uninstall triggered for $packageName")
                    }

                    "NETWORK_TEST" -> {
                        val testResult = networkTestExecutor.execute(command.id)
                        result.putAll(testResult)
                    }

                    "UNINSTALL_AGENT" -> {
                        val pkg = applicationContext.packageName
                        // 1. Clear Device Owner so the package can be uninstalled
                        val dpm = applicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE)
                            as android.app.admin.DevicePolicyManager
                        try { dpm.clearDeviceOwnerApp(pkg) } catch (_: Exception) {}
                        // 2. Uninstall the agent silently via PackageInstaller
                        val installer = applicationContext.packageManager.packageInstaller
                        val intent = android.content.Intent("android.intent.action.MAIN")
                            .setPackage(pkg)
                        val piFlags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S)
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
                        else
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        val pi = android.app.PendingIntent.getBroadcast(
                            applicationContext, pkg.hashCode(), intent, piFlags)
                        installer.uninstall(pkg, pi.intentSender)
                        result["uninstalled"] = true
                        Log.i(TAG, "UNINSTALL_AGENT: device owner cleared, uninstall triggered")
                    }

                    else -> {
                        Log.w(TAG, "Unknown command type: ${command.type}")
                        result["warning"] = "Unknown command type"
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Command ${command.id} failed: ${e.message}", e)
                success = false
                errorMessage = e.message
            }

            try {
                withContext(NonCancellable) {
                    api.ackCommand(
                        deviceToken,
                        command.id,
                        CommandAckRequest(success = success, result = result, errorMessage = errorMessage),
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to ACK command ${command.id}: ${e.message}")
            }
        }
        } finally {
            if (cmdWakeLock.isHeld) cmdWakeLock.release()
        }
    }

    @Suppress("DEPRECATION")
    private fun postLoginRequiredAlert(ctx: Context) {
        val loginIntent = Intent(ctx, com.mdm.enterprise.ui.DeviceLoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(com.mdm.enterprise.ui.DeviceLoginActivity.EXTRA_REASON, "Sessão encerrada por inatividade")
        }

        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
        val adminComp = android.content.ComponentName(ctx, com.mdm.enterprise.admin.MdmDeviceAdminReceiver::class.java)

        // Device Owner path: wake screen + disable keyguard + start activity.
        // DeviceLoginActivity will call setKeyguardDisabled(false) on onDestroy() when
        // the user finishes (login success or DISMISS_LOGIN broadcast). No timer needed.
        if (dpm.isDeviceOwnerApp(ctx.packageName)) {
            try {
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                val wl = pm.newWakeLock(
                    android.os.PowerManager.FULL_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                    "MDM:sessionTimeout"
                )
                wl.acquire(5000L)
                wl.release()
                dpm.setKeyguardDisabled(adminComp, true)
                ctx.startActivity(loginIntent)
                Log.i(TAG, "Session watchdog: keyguard disabled, login activity started")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Keyguard-disable approach failed: ${e.message}")
            }
        }

        // Fallback for non-Device-Owner: direct start (API < Q) or lockNow + notification
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            ctx.startActivity(loginIntent)
            return
        }
        try {
            if (dpm.isAdminActive(adminComp)) dpm.lockNow()
        } catch (e: Exception) {
            Log.w(TAG, "lockNow fallback failed: ${e.message}")
        }
        // Post notification as fallback UI for non-owner devices
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "mdm_session_timeout"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Sessão Expirada", NotificationManager.IMPORTANCE_HIGH).apply {
                    setShowBadge(false); enableLights(false); enableVibration(false)
                }
            )
        }
        val pi = PendingIntent.getActivity(ctx, 4001, loginIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        nm.notify(4001, NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Login Necessário")
            .setContentText("Sua sessão expirou. Faça login para continuar.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, true)
            .setOngoing(true).setAutoCancel(false).build())
    }

    private fun postAdminLockAlert(ctx: Context, forceStart: Boolean = true) {
        val lockIntent = Intent(ctx, AdminLockActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
        val adminComp = android.content.ComponentName(ctx, com.mdm.enterprise.admin.MdmDeviceAdminReceiver::class.java)
        val isOwner = dpm.isDeviceOwnerApp(ctx.packageName)

        if (forceStart && isOwner) {
            // Device Owner path: wake screen + disable keyguard + start activity directly.
            // Works on all API levels including Android 14+ where USE_FULL_SCREEN_INTENT
            // is restricted for background apps.
            try {
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                val wl = pm.newWakeLock(
                    android.os.PowerManager.FULL_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                    "MDM:adminLockRestore"
                )
                wl.acquire(5000L)
                wl.release()

                dpm.setKeyguardDisabled(adminComp, true)
                ctx.startActivity(lockIntent)
                Log.i(TAG, "Admin lock restore: keyguard disabled, AdminLockActivity started")

                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try {
                        dpm.setKeyguardDisabled(adminComp, false)
                        Log.i(TAG, "Admin lock restore: keyguard re-enabled")
                    } catch (_: Exception) {}
                }, 3000L)
                return
            } catch (e: Exception) {
                Log.w(TAG, "Admin lock restore via keyguard-disable failed: ${e.message}")
            }
        }

        // Fallback: post ongoing notification with full-screen intent (works on older APIs)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            nm.getNotificationChannel(ADMIN_LOCK_CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    ADMIN_LOCK_CHANNEL_ID,
                    "Alerta de Bloqueio Administrativo",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Força a exibição da tela de bloqueio do MDM"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                }
            )
        }
        val pi = PendingIntent.getActivity(
            ctx, AdminLockActivity.ALERT_NOTIF_ID, lockIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(ctx, ADMIN_LOCK_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Dispositivo Bloqueado")
            .setContentText("Este dispositivo está bloqueado pelo administrador de TI.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
        nm.notify(AdminLockActivity.ALERT_NOTIF_ID, notification)
    }

    private suspend fun syncAndRefresh() {
        val token = prefs.getStr("device_token") ?: return
        // Atualiza cache de usuários para login offline
        try {
            val users = api.getDeviceUsers(token)
            OfflineSessionStore.saveUserCache(applicationContext, users)
            Log.i(TAG, "User cache refreshed: ${users.size} users")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to refresh user cache: ${e.message}")
        }
        // Sincroniza sessões offline pendentes
        syncPendingOfflineSessions(token)
    }

    private suspend fun syncPendingOfflineSessions(token: String) {
        val pending = OfflineSessionStore.getPendingSessions(applicationContext)
        if (pending.isEmpty()) return
        try {
            val payloads = pending.map { s ->
                OfflineSessionPayload(
                    offlineSessionId = s.offlineSessionId,
                    deviceUserId = s.deviceUserId,
                    startedAt = s.startedAt,
                    endedAt = s.endedAt,
                    endedReason = s.endedReason,
                    status = s.status,
                )
            }
            val result = api.syncOfflineSessions(token, SyncOfflineRequest(payloads))
            val syncedIds = pending.map { it.offlineSessionId }.toSet()
            OfflineSessionStore.removeSyncedSessions(applicationContext, syncedIds)
            Log.i(TAG, "Offline sessions synced: ${result.synced}/${pending.size}")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to sync offline sessions: ${e.message}")
        }
    }

    private fun buildNotification() =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("E.Guardian Ativo")
            .setContentText("Dispositivo gerenciado e monitorado")
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Monitoramento E.Guardian", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Mantém comandos ativos em segundo plano"
                        setShowBadge(false)
                    }
                )
            }
        }
    }
}

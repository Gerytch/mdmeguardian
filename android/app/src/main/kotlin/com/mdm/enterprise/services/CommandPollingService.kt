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
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.*

class CommandPollingService : Service() {

    companion object {
        private const val TAG = "CmdPollService"
        private const val CHANNEL_ID = "mdm_polling"
        private const val ADMIN_LOCK_CHANNEL_ID = "mdm_admin_lock_alert"
        private const val NOTIF_ID = 1001
        const val POLL_INTERVAL_MS = 5_000L

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

    override fun onCreate() {
        super.onCreate()
        api = MdmApiClient.getInstance(applicationContext)
        prefs = SecurePreferences.getInstance(applicationContext)
        policyService = MdmPolicyService(applicationContext)
        apkInstaller = ApkInstaller(applicationContext)
        networkTestExecutor = NetworkTestExecutor(applicationContext)
        createNotificationChannel()
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

        pollingJob?.cancel()
        pollingJob = startPollingLoop()
        Log.i(TAG, "Command polling service started (interval: ${POLL_INTERVAL_MS}ms)")
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
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
        // post full-screen notification and lock the screen ONCE. Subsequent ticks
        // only refresh the notification so it stays visible — repeated lockNow() calls
        // would cause an infinite black-screen loop before DeviceLoginActivity can appear.
        launch {
            var lockFired = false
            while (isActive) {
                delay(2_000L)
                val authRequired = prefs.getString("device_user_auth_required", "false") == "true"
                val hasSession = com.mdm.enterprise.ui.DeviceLoginActivity.hasActiveSession(applicationContext)
                if (authRequired && !hasSession && !com.mdm.enterprise.ui.DeviceLoginActivity.isInForeground) {
                    Log.i(TAG, "Session watchdog: no active session, triggering login (lockFired=$lockFired)")
                    postLoginRequiredAlert(applicationContext, lockNow = !lockFired)
                    lockFired = true
                } else {
                    // Session restored or activity visible — reset so next timeout fires lockNow again
                    if (lockFired) Log.i(TAG, "Session watchdog: session restored, resetting lockFired")
                    lockFired = false
                }
            }
        }
    }

    private suspend fun pollCommands() {
        // Apply deferred kiosk if required apps finished installing since last poll
        policyService.applyPendingKioskIfReady()

        val deviceToken = prefs.getStr("device_token") ?: return
        val deviceId   = prefs.getStr("device_id")    ?: return
        val tenantId   = prefs.getStr("tenant_id")    ?: return

        val sessionId = prefs.getStr(com.mdm.enterprise.ui.DeviceLoginActivity.PREF_SESSION_ID)
        if (sessionId != null) {
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

        val commands = api.getPendingCommands(deviceToken, com.mdm.enterprise.BuildConfig.VERSION_NAME)
        if (commands.isEmpty()) return

        Log.i(TAG, "Fetched ${commands.size} pending command(s)")

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

                    "ADMIN_LOCK" -> {
                        val message  = command.payload["message"]  as? String ?: "Leve este dispositivo ao setor de TI"
                        val contact  = command.payload["contact"]  as? String
                        val severity = command.payload["severity"] as? String ?: "warning"
                        policyService.adminLock(message, contact, severity)
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
                        result["policyId"] = command.payload["policyId"]

                        prefs.edit()
                            .putString("device_user_auth_required", rules.deviceUserAuthRequired.toString())
                            .putString("inactivity_timeout_minutes", rules.inactivityTimeoutMinutes.toString())
                            .apply()

                        if (rules.deviceUserAuthRequired && !DeviceLoginActivity.hasActiveSession(applicationContext)) {
                            DeviceLoginActivity.start(applicationContext)
                        } else if (!rules.deviceUserAuthRequired) {
                            // Auth disabled — stop monitor, clear session, dismiss login screen
                            UserActivityMonitorService.stop(applicationContext)
                            DeviceLoginActivity.clearSession(applicationContext)
                            applicationContext.sendBroadcast(
                                android.content.Intent("com.mdm.enterprise.DISMISS_LOGIN")
                            )
                        }

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
                            val agentApp = com.mdm.enterprise.api.models.RequiredApp(
                                packageName = applicationContext.packageName,
                                name        = "E.Guardian MDM Agent",
                                apkUrl      = apkUrl,
                                version     = version ?: "0",
                            )
                            // installMissingApps skips if installed version == target version;
                            // pass a fake current version so it always installs.
                            apkInstaller.installMissingApps(listOf(agentApp))
                            result["triggered"] = true
                            result["version"] = version ?: "unknown"
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
                api.ackCommand(
                    deviceToken,
                    command.id,
                    CommandAckRequest(success = success, result = result, errorMessage = errorMessage),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to ACK command ${command.id}: ${e.message}")
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun postLoginRequiredAlert(ctx: Context, lockNow: Boolean = true) {
        val loginIntent = Intent(ctx, com.mdm.enterprise.ui.DeviceLoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(com.mdm.enterprise.ui.DeviceLoginActivity.EXTRA_REASON, "Sessão encerrada por inatividade")
        }

        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
        val adminComp = android.content.ComponentName(ctx, com.mdm.enterprise.admin.MdmDeviceAdminReceiver::class.java)
        val isOwner = dpm.isDeviceOwnerApp(ctx.packageName)

        if (lockNow) {
            // First trigger: wake screen + disable keyguard + start activity.
            // Device Owner privilege allows this on all API levels — no reliance on
            // USE_FULL_SCREEN_INTENT (restricted on Android 14+).
            if (isOwner) {
                try {
                    // Wake screen (same as unlockDevice())
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
                    Log.i(TAG, "Session timeout: keyguard disabled, login activity started")

                    // Re-enable keyguard after activity has time to appear
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        try {
                            dpm.setKeyguardDisabled(adminComp, false)
                            Log.i(TAG, "Session timeout: keyguard re-enabled")
                        } catch (_: Exception) {}
                    }, 3000L)
                    return
                } catch (e: Exception) {
                    Log.w(TAG, "Keyguard-disable approach failed: ${e.message}")
                }
            }

            // Fallback (non-Device-Owner or exception): lockNow + full-screen notification
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                ctx.startActivity(loginIntent)
                return
            }
            try {
                if (dpm.isAdminActive(adminComp)) dpm.lockNow()
                Log.i(TAG, "lockNow fired for session timeout (fallback)")
            } catch (e: Exception) {
                Log.w(TAG, "lockNow for session timeout failed: ${e.message}")
            }
        }

        // Post/refresh ONGOING notification so user can tap to open login screen
        // (both on first trigger for non-owner fallback and on subsequent watchdog ticks)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "mdm_session_timeout"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Sessão Expirada", NotificationManager.IMPORTANCE_HIGH).apply {
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                }
            )
        }
        val pi = PendingIntent.getActivity(ctx, 4001, loginIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Login Necessário")
            .setContentText("Sua sessão expirou. Faça login para continuar.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
        nm.notify(4001, notification)
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

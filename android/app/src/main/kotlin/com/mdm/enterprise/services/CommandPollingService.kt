package com.mdm.enterprise.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
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
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CommandPollingService::class.java))
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
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
        startPollingLoop()
        Log.i(TAG, "Command polling service started (interval: ${POLL_INTERVAL_MS}ms)")
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startPollingLoop() {
        scope.launch {
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
        // post a full-screen notification. On Android 10+ startActivity() is silently
        // blocked from background; a full-screen notification is the only permitted
        // way to bring an activity to front from a background service.
        scope.launch {
            while (isActive) {
                delay(1_000L)
                if (AdminLockActivity.isActive(applicationContext) &&
                    !AdminLockActivity.isInForeground
                ) {
                    Log.i(TAG, "Admin lock watchdog: posting full-screen alert")
                    postAdminLockAlert(applicationContext)
                }
            }
        }
    }

    private suspend fun pollCommands() {
        val deviceToken = prefs.getStr("device_token") ?: return
        val deviceId   = prefs.getStr("device_id")    ?: return
        val tenantId   = prefs.getStr("tenant_id")    ?: return

        val commands = api.getPendingCommands(deviceToken)
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
                            // Auth disabled — stop monitor and clear session silently
                            UserActivityMonitorService.stop(applicationContext)
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
                        val launchable = pm.queryIntentActivities(intent, 0)
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

                    "NETWORK_TEST" -> {
                        val testResult = networkTestExecutor.execute(command.id)
                        result.putAll(testResult)
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

    private fun postAdminLockAlert(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Ensure the high-importance channel exists.
        if (nm.getNotificationChannel(ADMIN_LOCK_CHANNEL_ID) == null) {
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

        val fullScreenIntent = Intent(ctx, AdminLockActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            ctx,
            AdminLockActivity.ALERT_NOTIF_ID,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(ctx, ADMIN_LOCK_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Dispositivo Bloqueado")
            .setContentText("Este dispositivo está bloqueado pelo administrador de TI.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, /* highPriority= */ true)
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

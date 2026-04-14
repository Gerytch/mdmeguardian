package com.mdm.enterprise.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.ui.DeviceLoginActivity
import com.mdm.enterprise.utils.OfflineSessionStore
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicLong

class UserActivityMonitorService : Service() {

    companion object {
        private const val TAG = "ActivityMonitor"
        private const val CHANNEL_ID = "mdm_activity_monitor"
        private const val TIMEOUT_CHANNEL_ID = "mdm_session_timeout"
        private const val NOTIF_ID = 3002
        private const val TIMEOUT_NOTIF_ID = 3003
        private const val EXTRA_TIMEOUT_MIN = "timeout_minutes"

        @Volatile private var lastActivityMs = AtomicLong(System.currentTimeMillis())

        fun recordActivity() {
            lastActivityMs.set(System.currentTimeMillis())
        }

        fun start(context: Context, timeoutMinutes: Int) {
            val intent = Intent(context, UserActivityMonitorService::class.java).apply {
                putExtra(EXTRA_TIMEOUT_MIN, timeoutMinutes)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, UserActivityMonitorService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var monitorJob: Job? = null
    private var timeoutMs = 5 * 60 * 1000L // default 5 min

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val minutes = intent?.getIntExtra(EXTRA_TIMEOUT_MIN, 5) ?: 5
        timeoutMs = if (minutes <= 0) Long.MAX_VALUE else minutes * 60 * 1000L
        lastActivityMs.set(System.currentTimeMillis())
        Log.i(TAG, "Monitor started. Timeout: ${minutes}min")

        ensureAccessibilityServiceEnabled()

        // Cancel any previous monitor loop before starting a new one
        monitorJob?.cancel()
        monitorJob = serviceScope.launch {
            while (isActive) {
                delay(15_000L) // check every 15 seconds
                // recordActivity() is called by MdmAccessibilityService on every touch/scroll/click,
                // so lastActivityMs reflects real user interaction — not just screen-on time.
                val idle = System.currentTimeMillis() - lastActivityMs.get()
                if (idle >= timeoutMs) {
                    Log.i(TAG, "Inactivity timeout after ${idle / 1000}s")
                    handleTimeout()
                    break
                }
            }
        }
        return START_STICKY
    }

    /** Auto-enables MdmAccessibilityService via Device Owner so touches are detected without manual setup. */
    private fun ensureAccessibilityServiceEnabled() {
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, MdmDeviceAdminReceiver::class.java)
            val svc = ComponentName(this, MdmAccessibilityService::class.java).flattenToString()
            val current = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
            if (!current.split(":").contains(svc)) {
                val updated = if (current.isEmpty()) svc else "$current:$svc"
                dpm.setSecureSetting(admin, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, updated)
                dpm.setSecureSetting(admin, Settings.Secure.ACCESSIBILITY_ENABLED, "1")
                Log.i(TAG, "Accessibility service auto-enabled")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not auto-enable accessibility service: ${e.message}")
        }
    }

    private suspend fun handleTimeout() {
        val prefs = SecurePreferences.getInstance(this)
        val token = prefs.getStr("device_token")
        val sessionId = prefs.getStr(DeviceLoginActivity.PREF_SESSION_ID)
        val isOffline = prefs.getBoolean(DeviceLoginActivity.PREF_SESSION_OFFLINE, false)

        if (isOffline && sessionId != null) {
            // Sessão offline — registra o encerramento localmente para sync posterior
            OfflineSessionStore.updatePendingSession(
                this,
                offlineSessionId = sessionId,
                endedAt = OfflineSessionStore.nowIso(),
                endedReason = "INACTIVITY_TIMEOUT",
                status = "TIMEOUT",
            )
            Log.i(TAG, "Offline session $sessionId marked as TIMEOUT")
        } else {
            // Report timeout to backend
            try {
                if (token != null && sessionId != null) {
                    val api = MdmApiClient.getInstance(this)
                    api.reportSessionTimeout(token, sessionId)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to report timeout: ${e.message}")
            }
        }

        // Clear session — CommandPollingService watchdog will detect the missing session
        // and fire the full-screen login notification every 2s until user logs in.
        DeviceLoginActivity.clearSession(this)
        stopSelf()
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun postTimeoutAlert(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(TIMEOUT_CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        TIMEOUT_CHANNEL_ID,
                        "Sessão Expirada",
                        NotificationManager.IMPORTANCE_HIGH,
                    ).apply {
                        description = "Exibe tela de login após inatividade"
                        setShowBadge(false)
                        enableLights(false)
                        enableVibration(false)
                    }
                )
            }
        }

        val fullScreenIntent = Intent(ctx, DeviceLoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(DeviceLoginActivity.EXTRA_REASON, "Sessão encerrada por inatividade")
        }
        val pi = PendingIntent.getActivity(
            ctx, TIMEOUT_NOTIF_ID, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(ctx, TIMEOUT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Sessão Expirada")
            .setContentText("Sua sessão expirou por inatividade. Faça login novamente.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, true)
            .setOngoing(false)
            .setAutoCancel(true)
            .build()

        nm.notify(TIMEOUT_NOTIF_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Monitor de Atividade", NotificationManager.IMPORTANCE_MIN)
                )
            }
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("E.Guardian")
            .setContentText("Monitorando atividade do dispositivo")
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
}

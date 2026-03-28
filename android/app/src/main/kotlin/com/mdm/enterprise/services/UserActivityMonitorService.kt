package com.mdm.enterprise.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.ui.DeviceLoginActivity
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicLong

class UserActivityMonitorService : Service() {

    companion object {
        private const val TAG = "ActivityMonitor"
        private const val CHANNEL_ID = "mdm_activity_monitor"
        private const val NOTIF_ID = 3002
        private const val EXTRA_TIMEOUT_MIN = "timeout_minutes"

        @Volatile private var lastActivityMs = AtomicLong(System.currentTimeMillis())

        fun recordActivity() {
            lastActivityMs.set(System.currentTimeMillis())
        }

        fun start(context: Context, timeoutMinutes: Int) {
            val intent = Intent(context, UserActivityMonitorService::class.java).apply {
                putExtra(EXTRA_TIMEOUT_MIN, timeoutMinutes)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, UserActivityMonitorService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
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

        serviceScope.launch {
            while (isActive) {
                delay(15_000L) // check every 15 seconds
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

    private suspend fun handleTimeout() {
        // Report timeout to backend
        try {
            val prefs = SecurePreferences.getInstance(this)
            val token = prefs.getStr("device_token")
            val sessionId = prefs.getStr(DeviceLoginActivity.PREF_SESSION_ID)
            if (token != null && sessionId != null) {
                val api = MdmApiClient.getInstance(this)
                api.reportSessionTimeout(token, sessionId)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to report timeout: ${e.message}")
        }

        // Clear session and show login
        DeviceLoginActivity.clearSession(this)
        DeviceLoginActivity.start(this)
        stopSelf()
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Monitor de Atividade", NotificationManager.IMPORTANCE_MIN)
            )
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

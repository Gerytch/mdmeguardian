package com.mdm.enterprise.services

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import android.accessibilityservice.AccessibilityService
import com.mdm.enterprise.BuildConfig
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject

class RemoteViewService : Service() {

    companion object {
        private const val TAG = "RemoteViewService"
        private const val FRAME_INTERVAL_MS = 500L // 2 FPS
        private const val JPEG_QUALITY = 50

        @Volatile
        var isActive = false
            private set

        fun start(context: Context, sessionId: String, serverUrl: String, deviceToken: String) {
            val intent = Intent(context, RemoteViewService::class.java).apply {
                putExtra("sessionId", sessionId)
                putExtra("serverUrl", serverUrl)
                putExtra("deviceToken", deviceToken)
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RemoteViewService::class.java))
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var webSocket: WebSocket? = null
    private var captureJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var screenWidth = 1080
    private var screenHeight = 1920

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sessionId = intent?.getStringExtra("sessionId") ?: return START_NOT_STICKY
        val serverUrl = intent.getStringExtra("serverUrl") ?: return START_NOT_STICKY
        val deviceToken = intent.getStringExtra("deviceToken") ?: return START_NOT_STICKY

        // Get screen dimensions
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(dm)
        screenWidth = dm.widthPixels
        screenHeight = dm.heightPixels

        acquireWakeLock()
        connectWebSocket(sessionId, serverUrl, deviceToken)
        isActive = true

        return START_NOT_STICKY
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MDM:RemoteView")
        wakeLock?.acquire(30 * 60 * 1000L) // 30 min max
    }

    private fun connectWebSocket(sessionId: String, serverUrl: String, deviceToken: String) {
        // Convert https://host/api/v1 → wss://host/remote?params
        val wsUrl = serverUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .replace("/api/v1", "/remote")
            .plus("?role=device&sessionId=$sessionId&token=$deviceToken")

        Log.i(TAG, "Connecting to: $wsUrl")

        val client = OkHttpClient.Builder()
            .readTimeout(0, java.util.concurrent.TimeUnit.SECONDS)
            .pingInterval(15, java.util.concurrent.TimeUnit.SECONDS)
            .build()

        val request = Request.Builder().url(wsUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected")
                // Send device info
                val info = JSONObject().apply {
                    put("type", "device_info")
                    put("screenWidth", screenWidth)
                    put("screenHeight", screenHeight)
                }
                ws.send(info.toString())
                // Start frame capture
                startCapture(ws)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleControlMessage(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failed: ${t.message}")
                stopSelf()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WebSocket closed: $code $reason")
                stopSelf()
            }
        })
    }

    private fun startCapture(ws: WebSocket) {
        captureJob?.cancel()
        captureJob = scope.launch {
            while (isActive) {
                try {
                    val bytes = MdmAccessibilityService.captureToJpegBytes(JPEG_QUALITY)
                    if (bytes != null) {
                        ws.send(ByteString.of(*bytes))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Capture error: ${e.message}")
                }
                delay(FRAME_INTERVAL_MS)
            }
        }
    }

    private fun handleControlMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.getString("type")) {
                "input_tap" -> {
                    val x = (json.getDouble("x") * screenWidth).toFloat()
                    val y = (json.getDouble("y") * screenHeight).toFloat()
                    MdmAccessibilityService.dispatchTap(x, y)
                }
                "input_swipe" -> {
                    val sx = (json.getDouble("startX") * screenWidth).toFloat()
                    val sy = (json.getDouble("startY") * screenHeight).toFloat()
                    val ex = (json.getDouble("endX") * screenWidth).toFloat()
                    val ey = (json.getDouble("endY") * screenHeight).toFloat()
                    val dur = json.optLong("duration", 300)
                    MdmAccessibilityService.dispatchSwipe(sx, sy, ex, ey, dur)
                }
                "input_back" -> {
                    MdmAccessibilityService.doGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                }
                "input_home" -> {
                    MdmAccessibilityService.doGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                }
                "input_recents" -> {
                    MdmAccessibilityService.doGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
                }
                "stop_capture" -> {
                    captureJob?.cancel()
                }
                "request_frame" -> {
                    // Send one frame immediately
                    scope.launch {
                        val bytes = MdmAccessibilityService.captureToJpegBytes(JPEG_QUALITY)
                        if (bytes != null) webSocket?.send(ByteString.of(*bytes))
                    }
                }
                "session_ended" -> {
                    stopSelf()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling message: ${e.message}")
        }
    }

    override fun onDestroy() {
        isActive = false
        captureJob?.cancel()
        scope.cancel()
        webSocket?.close(1000, "Service stopped")
        wakeLock?.let { if (it.isHeld) it.release() }
        Log.i(TAG, "RemoteViewService destroyed")
        super.onDestroy()
    }
}

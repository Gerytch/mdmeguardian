package com.mdm.enterprise.services

import android.accessibilityservice.AccessibilityService
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.mdm.enterprise.ui.RemoteAccessActivity
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject

class RemoteViewService : Service() {

    companion object {
        private const val TAG = "RemoteViewService"

        // JPEG fallback settings (optimised from original 500ms/Q50)
        private const val JPEG_INTERVAL_MS = 150L
        private const val JPEG_QUALITY = 45
        private const val JPEG_MAX_HEIGHT = 1280

        // H.264 streaming settings
        private const val H264_BITRATE = 1_500_000  // 1.5 Mbps
        private const val H264_FPS = 20
        private const val H264_IFRAME_INTERVAL_SEC = 2
        private const val H264_MAX_DIM = 1280

        // Notification
        private const val NOTIFICATION_ID = 2001
        private const val CHANNEL_ID = "remote_view"

        // Binary frame type markers (first byte of every H.264 binary message)
        const val FRAME_CONFIG: Byte = 0x01   // SPS/PPS
        const val FRAME_KEY: Byte = 0x02      // IDR keyframe
        const val FRAME_DELTA: Byte = 0x03    // P-frame

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

    // ── Core ────────────────────────────────────────────────────────────
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var webSocket: WebSocket? = null
    private var captureJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var screenWidth = 1080
    private var screenHeight = 1920

    // ── H.264 pipeline ─────────────────────────────────────────────────
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var encoder: MediaCodec? = null
    private var encoderThread: HandlerThread? = null
    @Volatile
    private var isH264Mode = false
    private var encoderWidth = 720
    private var encoderHeight = 1280

    // ────────────────────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle MediaProjection result from RemoteAccessActivity
        if (intent?.action == "MEDIA_PROJECTION_RESULT") {
            handleMediaProjectionResult(intent)
            return START_NOT_STICKY
        }

        val sessionId = intent?.getStringExtra("sessionId") ?: return START_NOT_STICKY
        val serverUrl = intent.getStringExtra("serverUrl") ?: return START_NOT_STICKY
        val deviceToken = intent.getStringExtra("deviceToken") ?: return START_NOT_STICKY

        // Screen dimensions
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(dm)
        screenWidth = dm.widthPixels
        screenHeight = dm.heightPixels
        computeEncoderDimensions()

        acquireWakeLock()
        connectWebSocket(sessionId, serverUrl, deviceToken)
        isActive = true

        return START_NOT_STICKY
    }

    // ── Screen dimensions ──────────────────────────────────────────────

    private fun computeEncoderDimensions() {
        val maxDim = maxOf(screenWidth, screenHeight)
        if (maxDim > H264_MAX_DIM) {
            val scale = H264_MAX_DIM.toFloat() / maxDim
            encoderWidth = ((screenWidth * scale).toInt() or 1) and 0x7FFFFFFE   // round to even
            encoderHeight = ((screenHeight * scale).toInt() or 1) and 0x7FFFFFFE
        } else {
            encoderWidth = (screenWidth or 1) and 0x7FFFFFFE
            encoderHeight = (screenHeight or 1) and 0x7FFFFFFE
        }
        Log.i(TAG, "Encoder dimensions: ${encoderWidth}x${encoderHeight} (screen ${screenWidth}x${screenHeight})")
    }

    // ── Wake lock ──────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MDM:RemoteView")
        wakeLock?.acquire(30 * 60 * 1000L)
    }

    // ── WebSocket ──────────────────────────────────────────────────────

    private fun connectWebSocket(sessionId: String, serverUrl: String, deviceToken: String) {
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
                ws.send(JSONObject().apply {
                    put("type", "device_info")
                    put("screenWidth", screenWidth)
                    put("screenHeight", screenHeight)
                }.toString())

                // Start with JPEG mode immediately, then request MediaProjection
                startJpegCapture(ws)

                // Launch MediaProjection permission dialog
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    RemoteAccessActivity.launch(this@RemoteViewService)
                }
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

    // ── JPEG capture (fallback / initial mode) ─────────────────────────

    private fun startJpegCapture(ws: WebSocket) {
        captureJob?.cancel()
        captureJob = scope.launch {
            while (isActive && !isH264Mode) {
                val start = System.currentTimeMillis()
                try {
                    val bytes = MdmAccessibilityService.captureToJpegBytes(
                        JPEG_QUALITY, JPEG_MAX_HEIGHT
                    )
                    if (bytes != null) {
                        ws.send(ByteString.of(*bytes))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Capture error: ${e.message}")
                }
                val elapsed = System.currentTimeMillis() - start
                val remaining = JPEG_INTERVAL_MS - elapsed
                if (remaining > 0) delay(remaining)
            }
        }
    }

    // ── H.264 MediaProjection pipeline ─────────────────────────────────

    private fun handleMediaProjectionResult(intent: Intent) {
        val resultCode = intent.getIntExtra("resultCode", Activity.RESULT_CANCELED)
        val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra("data", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra("data")
        }

        if (resultCode != Activity.RESULT_OK || data == null) {
            Log.w(TAG, "MediaProjection denied — staying in JPEG mode")
            return
        }

        try {
            // Foreground promotion MUST happen before getMediaProjection (Android 14+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID, createNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(NOTIFICATION_ID, createNotification())
            }

            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mpm.getMediaProjection(resultCode, data)

            if (mediaProjection == null) {
                Log.e(TAG, "getMediaProjection returned null")
                return
            }

            startH264Pipeline()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start H.264 pipeline: ${e.message}", e)
            // Stay in JPEG mode
        }
    }

    private fun startH264Pipeline() {
        // Stop JPEG capture
        captureJob?.cancel()

        // Configure encoder
        val format = MediaFormat.createVideoFormat(
            MediaFormat.MIMETYPE_VIDEO_AVC, encoderWidth, encoderHeight
        ).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, H264_BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, H264_FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, H264_IFRAME_INTERVAL_SEC)
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
        }

        encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)

        // Async callback on a dedicated thread
        encoderThread = HandlerThread("H264Encoder").also { it.start() }
        val handler = Handler(encoderThread!!.looper)

        encoder!!.setCallback(object : MediaCodec.Callback() {
            override fun onOutputBufferAvailable(
                codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo
            ) {
                try {
                    val buf = codec.getOutputBuffer(index) ?: return
                    if (info.size > 0) {
                        val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                        val isKey = (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                        val type: Byte = when {
                            isConfig -> FRAME_CONFIG
                            isKey -> FRAME_KEY
                            else -> FRAME_DELTA
                        }

                        val frame = ByteArray(1 + info.size)
                        frame[0] = type
                        buf.position(info.offset)
                        buf.get(frame, 1, info.size)

                        webSocket?.send(ByteString.of(*frame))
                    }
                    codec.releaseOutputBuffer(index, false)
                } catch (e: Exception) {
                    Log.e(TAG, "Encoder output error: ${e.message}")
                }
            }

            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
                // Not called in Surface input mode
            }

            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                Log.i(TAG, "Encoder format changed: $format")
            }

            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                Log.e(TAG, "Encoder error: ${e.message}")
            }
        }, handler)

        encoder!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = encoder!!.createInputSurface()
        encoder!!.start()

        isH264Mode = true

        // Notify viewers BEFORE creating virtual display — the virtual display triggers
        // frame production on the encoder, so the viewer must have its decoder ready first.
        // Without this ordering, FRAME_CONFIG arrives before stream_upgrade and the frontend
        // treats it as JPEG (fails silently) → decoder never gets configured → screen freezes.
        webSocket?.send(JSONObject().apply {
            put("type", "stream_upgrade")
            put("codec", "h264")
            put("width", encoderWidth)
            put("height", encoderHeight)
        }.toString())

        // NOW create virtual display — frames start flowing into the encoder
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "RemoteStream",
            encoderWidth, encoderHeight,
            resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            inputSurface, null, null
        )

        Log.i(TAG, "H.264 streaming started (${encoderWidth}x${encoderHeight} @ ${H264_FPS}fps)")
    }

    // ── Notification (required for foreground service) ──────────────────

    private fun createNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Acesso Remoto", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }

        return Notification.Builder(
            this,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) CHANNEL_ID else ""
        )
            .setContentTitle("E.Guardian — Acesso Remoto")
            .setContentText("Compartilhando tela…")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    // ── Control messages ───────────────────────────────────────────────

    private fun handleControlMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.getString("type")) {
                "input_tap" -> {
                    val x = (json.getDouble("x") * screenWidth).toFloat()
                    val y = (json.getDouble("y") * screenHeight).toFloat()
                    val ok = MdmAccessibilityService.dispatchTap(x, y)
                    Log.i(TAG, "Tap at ($x, $y) result=$ok")
                }
                "input_swipe" -> {
                    val sx = (json.getDouble("startX") * screenWidth).toFloat()
                    val sy = (json.getDouble("startY") * screenHeight).toFloat()
                    val ex = (json.getDouble("endX") * screenWidth).toFloat()
                    val ey = (json.getDouble("endY") * screenHeight).toFloat()
                    val dur = json.optLong("duration", 300)
                    val ok = MdmAccessibilityService.dispatchSwipe(sx, sy, ex, ey, dur)
                    Log.i(TAG, "Swipe ($sx,$sy)->($ex,$ey) dur=$dur result=$ok")
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
                "request_keyframe" -> {
                    if (isH264Mode) {
                        encoder?.setParameters(Bundle().apply {
                            putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
                        })
                    }
                }
                "stop_capture" -> {
                    captureJob?.cancel()
                }
                "request_frame" -> {
                    if (!isH264Mode) {
                        scope.launch {
                            val bytes = MdmAccessibilityService.captureToJpegBytes(
                                JPEG_QUALITY, JPEG_MAX_HEIGHT
                            )
                            if (bytes != null) webSocket?.send(ByteString.of(*bytes))
                        }
                    } else {
                        // Force a keyframe for the new viewer
                        encoder?.setParameters(Bundle().apply {
                            putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
                        })
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

    // ── Cleanup ────────────────────────────────────────────────────────

    override fun onDestroy() {
        isActive = false
        isH264Mode = false
        captureJob?.cancel()

        // H.264 pipeline teardown
        try { encoder?.stop() } catch (_: Exception) {}
        try { encoder?.release() } catch (_: Exception) {}
        encoder = null

        virtualDisplay?.release()
        virtualDisplay = null

        mediaProjection?.stop()
        mediaProjection = null

        encoderThread?.quitSafely()
        encoderThread = null

        scope.cancel()
        webSocket?.close(1000, "Service stopped")
        wakeLock?.let { if (it.isHeld) it.release() }

        Log.i(TAG, "RemoteViewService destroyed")
        super.onDestroy()
    }
}

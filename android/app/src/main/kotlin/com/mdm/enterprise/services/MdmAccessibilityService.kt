package com.mdm.enterprise.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

class MdmAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "MdmA11yService"

        @Volatile
        var instance: MdmAccessibilityService? = null
            private set

        val isRunning: Boolean get() = instance != null

        /**
         * Takes a screenshot using AccessibilityService.takeScreenshot() (API 30+).
         * Saves it to a temp file and returns the file, or null on failure.
         */
        suspend fun captureScreenshot(cacheDir: File): File? {
            val svc = instance ?: run {
                Log.w(TAG, "Accessibility service not running")
                return null
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                Log.w(TAG, "takeScreenshot requires API 30+")
                return null
            }
            return svc.doCapture(cacheDir)
        }

        /** Fast JPEG capture for remote streaming — no file I/O */
        suspend fun captureToJpegBytes(quality: Int = 60): ByteArray? {
            val svc = instance ?: run {
                Log.w(TAG, "Accessibility service not running")
                return null
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                Log.w(TAG, "takeScreenshot requires API 30+")
                return null
            }
            return svc.doCaptureJpeg(quality)
        }

        /** Dispatch a tap at absolute screen coordinates */
        fun dispatchTap(x: Float, y: Float): Boolean {
            val svc = instance ?: return false
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
            return svc.doTap(x, y)
        }

        /** Dispatch a swipe gesture */
        fun dispatchSwipe(
            startX: Float, startY: Float,
            endX: Float, endY: Float,
            durationMs: Long = 300
        ): Boolean {
            val svc = instance ?: return false
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
            return svc.doSwipe(startX, startY, endX, endY, durationMs)
        }

        /** Perform global action: BACK, HOME, RECENTS */
        fun doGlobalAction(action: Int): Boolean {
            val svc = instance ?: return false
            return svc.performGlobalAction(action)
        }
    }

    override fun onServiceConnected() {
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        // Any touch or gesture interaction resets the inactivity timer
        when (event.eventType) {
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_START,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_GESTURE_DETECTION_START -> {
                UserActivityMonitorService.recordActivity()
            }
        }
    }

    override fun onInterrupt() { /* unused */ }

    override fun onDestroy() {
        instance = null
        Log.i(TAG, "Accessibility service destroyed")
        super.onDestroy()
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private suspend fun doCapture(cacheDir: File): File? =
        suspendCancellableCoroutine { cont ->
            takeScreenshot(
                android.view.Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        val hw = result.hardwareBuffer
                        val bmp = Bitmap.wrapHardwareBuffer(hw, null)
                            ?.copy(Bitmap.Config.ARGB_8888, false)
                        hw.close()
                        if (bmp == null) { cont.resume(null); return }

                        val out = File(cacheDir, "nettest_${System.currentTimeMillis()}.png")
                        try {
                            FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.PNG, 85, it) }
                            bmp.recycle()
                            Log.i(TAG, "Screenshot saved: ${out.length()} bytes")
                            cont.resume(out)
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to save bitmap: ${e.message}")
                            bmp.recycle()
                            cont.resume(null)
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        Log.w(TAG, "takeScreenshot failed, errorCode=$errorCode")
                        cont.resume(null)
                    }
                },
            )
        }

    @RequiresApi(Build.VERSION_CODES.R)
    private suspend fun doCaptureJpeg(quality: Int): ByteArray? =
        suspendCancellableCoroutine { cont ->
            takeScreenshot(
                android.view.Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        val hw = result.hardwareBuffer
                        val bmp = Bitmap.wrapHardwareBuffer(hw, null)
                            ?.copy(Bitmap.Config.ARGB_8888, false)
                        hw.close()
                        if (bmp == null) { cont.resume(null); return }

                        val baos = ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                        bmp.recycle()
                        cont.resume(baos.toByteArray())
                    }

                    override fun onFailure(errorCode: Int) {
                        Log.w(TAG, "takeScreenshot failed, errorCode=$errorCode")
                        cont.resume(null)
                    }
                }
            )
        }

    @RequiresApi(Build.VERSION_CODES.N)
    private fun doTap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 100)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    @RequiresApi(Build.VERSION_CODES.N)
    private fun doSwipe(startX: Float, startY: Float, endX: Float, endY: Float, durationMs: Long): Boolean {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }
}

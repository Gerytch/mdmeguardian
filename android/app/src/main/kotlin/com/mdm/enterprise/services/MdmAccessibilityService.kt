package com.mdm.enterprise.services

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
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
    }

    override fun onServiceConnected() {
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) { /* unused */ }

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
}

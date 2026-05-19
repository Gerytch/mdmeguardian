package com.mdm.enterprise.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager

/**
 * Transparent activity whose only job is to request the MediaProjection
 * system dialog and forward the result back to RemoteViewService.
 */
class RemoteAccessActivity : Activity() {

    companion object {
        private const val TAG = "RemoteAccessActivity"
        private const val REQUEST_CODE = 1001

        fun launch(context: Context) {
            val intent = Intent(context, RemoteAccessActivity::class.java)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Allow this activity to show over the lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_CODE)
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                Log.i(TAG, "MediaProjection approved")
                val svcIntent = Intent(this, com.mdm.enterprise.services.RemoteViewService::class.java).apply {
                    action = "MEDIA_PROJECTION_RESULT"
                    putExtra("resultCode", resultCode)
                    putExtra("data", data)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(svcIntent)
                } else {
                    startService(svcIntent)
                }
            } else {
                Log.w(TAG, "MediaProjection denied by user")
            }
            finish()
        }
    }
}

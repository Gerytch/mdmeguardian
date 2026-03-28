package com.mdm.enterprise

import android.app.Application
import android.util.Log
import androidx.work.WorkManager
import com.mdm.enterprise.services.CommandPollingWorker
import com.mdm.enterprise.services.LocationTrackingWorker
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getBool

class MdmApplication : Application() {

    companion object {
        private const val TAG = "MdmApplication"
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "MDM Application starting")
        scheduleBackgroundWork()
    }

    private fun scheduleBackgroundWork() {
        val prefs = SecurePreferences.getInstance(this)
        val isEnrolled = prefs.getBool("is_enrolled")

        if (!isEnrolled) {
            Log.i(TAG, "Device not enrolled — skipping background work")
            return
        }

        Log.i(TAG, "Scheduling background workers")
        CommandPollingWorker.schedule(this)
        LocationTrackingWorker.schedule(this)
    }
}

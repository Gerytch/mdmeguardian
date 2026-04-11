package com.mdm.enterprise.services

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.work.*
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.LocationRequest
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

class LocationTrackingWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "LocationTracking"
        const val WORK_NAME = "mdm_location_tracking"

        fun schedule(context: Context, intervalMinutes: Long = 5) {
            val clampedInterval = intervalMinutes.coerceAtLeast(15) // WorkManager minimum is 15 min
            val request = PeriodicWorkRequestBuilder<LocationTrackingWorker>(
                clampedInterval, TimeUnit.MINUTES,
                1, TimeUnit.MINUTES,
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            // REPLACE so a change in trackingIntervalMinutes takes effect immediately
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.REPLACE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        fun scheduleImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<LocationTrackingWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }

    private val api = MdmApiClient.getInstance(applicationContext)
    private val prefs = SecurePreferences.getInstance(applicationContext)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val tenantId = prefs.getStr("tenant_id") ?: return@withContext Result.failure()
        val deviceId = prefs.getStr("device_id") ?: return@withContext Result.failure()

        if (ActivityCompat.checkSelfPermission(
                applicationContext, Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Location permission not granted")
            return@withContext Result.failure()
        }

        try {
            val fusedClient = LocationServices.getFusedLocationProviderClient(applicationContext)

            // 1st try: GPS high accuracy (may be null indoors / cold start)
            var location = Tasks.await(
                fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null),
                15, TimeUnit.SECONDS,
            )
            // 2nd try: last known location from any app
            if (location == null) {
                Log.w(TAG, "getCurrentLocation returned null, trying lastLocation")
                location = Tasks.await(fusedClient.lastLocation, 5, TimeUnit.SECONDS)
            }
            // 3rd try: balanced (WiFi/cell) — works indoors without GPS
            if (location == null) {
                Log.w(TAG, "lastLocation null, trying BALANCED_POWER_ACCURACY")
                location = Tasks.await(
                    fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null),
                    15, TimeUnit.SECONDS,
                )
            }

            if (location == null) {
                Log.w(TAG, "All location strategies failed, retrying later")
                return@withContext Result.retry()
            }

            val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }

            api.postLocation(
                tenantId,
                LocationRequest(
                    deviceId = deviceId,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = location.accuracy,
                    altitude = if (location.hasAltitude()) location.altitude else null,
                    speed = if (location.hasSpeed()) location.speed else null,
                    timestamp = iso.format(Date(location.time)),
                ),
            )

            Log.i(TAG, "Location reported: ${location.latitude}, ${location.longitude}")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Location tracking failed: ${e.message}", e)
            Result.retry()
        }
    }
}

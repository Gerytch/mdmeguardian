package com.mdm.enterprise.services

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.work.*
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.LocationRequest as MdmLocationRequest
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class LocationTrackingWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "LocationTracking"
        const val WORK_NAME = "mdm_location_tracking"

        fun schedule(context: Context, intervalMinutes: Long = 5) {
            val clampedInterval = intervalMinutes.coerceAtLeast(15)
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

    /** Passive: gets cached fix without waking GPS hardware */
    private suspend fun awaitLastLocation(fusedClient: FusedLocationProviderClient): Location? =
        withTimeoutOrNull(5_000) {
            suspendCancellableCoroutine { cont ->
                fusedClient.lastLocation
                    .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
                    .addOnCanceledListener { if (cont.isActive) cont.resume(null) }
            }
        }

    /** Active: wakes GPS hardware and waits for first real fix */
    private suspend fun requestActiveLocation(
        fusedClient: FusedLocationProviderClient,
        priority: Int,
        timeoutMs: Long,
    ): Location? = withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine { cont ->
            val req = LocationRequest.Builder(priority, 0)
                .setMaxUpdates(1)
                .setWaitForAccurateLocation(false)
                .build()
            val cb = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    if (cont.isActive) cont.resume(result.lastLocation)
                }
            }
            fusedClient.requestLocationUpdates(req, cb, Looper.getMainLooper())
            cont.invokeOnCancellation { fusedClient.removeLocationUpdates(cb) }
        }
    }

    override suspend fun doWork(): Result {
        val tenantId = prefs.getStr("tenant_id") ?: return Result.failure()
        val deviceId = prefs.getStr("device_id") ?: return Result.failure()

        if (ActivityCompat.checkSelfPermission(
                applicationContext, Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Location permission not granted")
            return Result.failure()
        }

        return try {
            val fusedClient = LocationServices.getFusedLocationProviderClient(applicationContext)

            // 1: cached last fix (instant)
            var location = awaitLastLocation(fusedClient)
            if (location != null) Log.i(TAG, "Got lastLocation")

            // 2: active BALANCED request — wakes WiFi/cell positioning
            if (location == null) {
                Log.w(TAG, "lastLocation null, requesting BALANCED update")
                location = requestActiveLocation(fusedClient, Priority.PRIORITY_BALANCED_POWER_ACCURACY, 20_000)
                if (location != null) Log.i(TAG, "Got BALANCED active fix")
            }

            // 3: active HIGH_ACCURACY — wakes GPS hardware
            if (location == null) {
                Log.w(TAG, "BALANCED failed, requesting HIGH_ACCURACY update")
                location = requestActiveLocation(fusedClient, Priority.PRIORITY_HIGH_ACCURACY, 30_000)
                if (location != null) Log.i(TAG, "Got HIGH_ACCURACY fix")
            }

            // 4: Android native LocationManager (bypasses GMS entirely)
            if (location == null) {
                Log.w(TAG, "Fused failed, trying native LocationManager")
                val lm = applicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                location = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                    ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
                if (location != null) Log.i(TAG, "Got native LocationManager fix")
            }

            if (location == null) {
                Log.w(TAG, "All location strategies failed, retrying later")
                return Result.retry()
            }

            val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }

            api.postLocation(
                tenantId,
                MdmLocationRequest(
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

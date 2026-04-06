package com.mdm.enterprise.services

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.CommandAckRequest
import com.mdm.enterprise.api.models.PolicyRules
import com.mdm.enterprise.api.models.RequiredApp
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class CommandPollingWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "CommandPolling"
        const val WORK_NAME = "mdm_command_polling"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CommandPollingWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES,
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        fun scheduleImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<CommandPollingWorker>()
                .build() // No constraints — run immediately regardless of network state

            WorkManager.getInstance(context).enqueue(request)
        }
    }

    private val api = MdmApiClient.getInstance(applicationContext)
    private val prefs = SecurePreferences.getInstance(applicationContext)
    private val policyService = MdmPolicyService(applicationContext)
    private val apkInstaller = ApkInstaller(applicationContext)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        // Watchdog: restart the real-time foreground service if the OS killed it.
        // WorkManager is exempt from Android 14+ background start restrictions, so
        // startForegroundService() is always allowed here.
        try {
            CommandPollingService.start(applicationContext)
        } catch (e: Exception) {
            Log.w(TAG, "Watchdog: could not restart CommandPollingService: ${e.message}")
        }

        val deviceToken = prefs.getStr("device_token") ?: return@withContext Result.failure()
        val deviceId = prefs.getStr("device_id") ?: return@withContext Result.failure()
        val tenantId = prefs.getStr("tenant_id") ?: return@withContext Result.failure()

        try {
            val commands = api.getPendingCommands(deviceToken, com.mdm.enterprise.BuildConfig.VERSION_NAME)
            Log.i(TAG, "Fetched ${commands.size} pending commands")

            for (command in commands) {
                Log.i(TAG, "Executing command: ${command.type} (${command.id})")
                var success = true
                var errorMessage: String? = null
                val result = mutableMapOf<String, Any?>()

                try {
                    when (command.type) {
                        "LOCK" -> policyService.lockDevice()
                        "UNLOCK" -> policyService.unlockDevice()
                        "WIPE" -> policyService.wipeDevice()
                        "REBOOT" -> policyService.reboot()

                        "ENABLE_KIOSK" -> {
                            val apps = (command.payload["apps"] as? List<*>)
                                ?.filterIsInstance<String>() ?: emptyList()
                            policyService.enableKioskMode(apps)
                        }

                        "DISABLE_KIOSK" -> policyService.disableKioskMode()

                        "UPDATE_POLICY" -> {
                            // Rules are embedded in the command payload — no extra API call needed
                            val gson = Gson()
                            val rulesJson = gson.toJson(command.payload["rules"])
                            val rules = gson.fromJson(rulesJson, PolicyRules::class.java)
                                ?: PolicyRules()

                            policyService.applyPolicy(rules)
                            result["policyId"] = command.payload["policyId"]

                            // Install required apps (download APKs not yet installed)
                            val appsJson = gson.toJson(command.payload["requiredApps"])
                            val appsType = object : TypeToken<List<RequiredApp>>() {}.type
                            val requiredApps: List<RequiredApp> = gson.fromJson(appsJson, appsType) ?: emptyList()
                            if (requiredApps.isNotEmpty()) {
                                apkInstaller.installMissingApps(requiredApps)
                                result["requiredAppsCount"] = requiredApps.size
                            }
                        }

                        "LOCATE" -> {
                            // Trigger immediate location update
                            LocationTrackingWorker.scheduleImmediate(applicationContext)
                            result["triggered"] = true
                        }

                        else -> {
                            Log.w(TAG, "Unknown command type: ${command.type}")
                            result["warning"] = "Unknown command type"
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Command ${command.id} failed: ${e.message}", e)
                    success = false
                    errorMessage = e.message
                }

                // ACK the command
                try {
                    api.ackCommand(
                        deviceToken,
                        command.id,
                        CommandAckRequest(success = success, result = result, errorMessage = errorMessage),
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to ACK command ${command.id}", e)
                }
            }

            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Command polling failed: ${e.message}", e)
            Result.retry()
        }
    }
}

package com.mdm.enterprise.api.models

import com.google.gson.annotations.SerializedName

// ─── Auth ─────────────────────────────────────────────────────────────────────

data class DeviceLoginResponse(
    val token: String,
    val device: DeviceInfo,
)

data class UserProfile(
    val id: String,
    val email: String?,
    val firstName: String?,
    val lastName: String?,
    val role: String,
    val tenantId: String,
    val isActive: Boolean,
)

// ─── Device ───────────────────────────────────────────────────────────────────

data class DeviceInfo(
    val id: String,
    val name: String,
    val tenantId: String,
    val status: String,
    val policyId: String?,
    val isKioskMode: Boolean = false,
    val kioskApps: List<String> = emptyList(),
)

data class RegisterDeviceRequest(
    val name: String,
    val serialNumber: String,
    val imei: String? = null,
    val androidVersion: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val policyId: String? = null,
)

data class RegisterDeviceResponse(
    val id: String,
    val name: String,
    val tenantId: String,
    val deviceToken: String,
    val enrollmentDate: String,
)

data class DeviceResponse(
    val id: String,
    val name: String,
    val status: String,
    val batteryLevel: Int?,
    val isOnline: Boolean,
    val lastSeenAt: String?,
)

data class HeartbeatRequest(
    val batteryLevel: Int?,
    val isOnline: Boolean = true,
    val osVersion: String? = null,
)

// ─── Commands ─────────────────────────────────────────────────────────────────

data class CommandResponse(
    val id: String,
    val type: String,
    val payload: Map<String, Any?> = emptyMap(),
    val status: String,
    val createdAt: String,
)

data class CommandAckRequest(
    val success: Boolean,
    val result: Map<String, Any?>? = null,
    val errorMessage: String? = null,
)

// ─── Location ─────────────────────────────────────────────────────────────────

data class LocationRequest(
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float? = null,
    val altitude: Double? = null,
    val speed: Float? = null,
    val timestamp: String? = null,
)

data class LocationResponse(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val timestamp: String,
)

// ─── Policy ───────────────────────────────────────────────────────────────────

data class PolicyResponse(
    val id: String,
    val name: String,
    val rules: PolicyRules,
)

data class AppInfo(val packageName: String, val name: String)
data class SyncAppsRequest(val apps: List<AppInfo>)

data class RequiredApp(
    val id: String = "",
    val name: String = "",
    val packageName: String = "",
    val version: String = "",
    val apkUrl: String? = null,
)

data class PolicyRules(
    val kioskMode: Boolean = false,
    val kioskModeType: String = "whitelist",
    val kioskApps: List<String> = emptyList(),
    val passwordRequired: Boolean = false,
    val minPasswordLength: Int = 6,
    val maxFailedAttempts: Int = 10,
    val locationTracking: Boolean = true,
    val trackingIntervalMinutes: Int = 5,
    val screenshotBlocked: Boolean = false,
    val cameraBlocked: Boolean = false,
    val usbBlocked: Boolean = false,
    val screenTimeoutSeconds: Int = 300,
    val deviceUserAuthRequired: Boolean = false,
    val inactivityTimeoutMinutes: Int = 5,
)

// ─── Device User Auth ──────────────────────────────────────────────────────

data class DeviceUserLoginRequest(
    val username: String,
    val pin: String,
)

data class DeviceUserLoginResponse(
    val sessionId: String,
    val deviceUserId: String,
    val fullName: String,
    val jobTitle: String?,
    val photoUrl: String?,
)

data class DeviceUserLogoutRequest(
    val sessionId: String,
    val reason: String = "MANUAL_LOGOUT",
)

// ─── Network Test ─────────────────────────────────────────────────────────────

data class ReportProgressRequest(
    val progress: Int,
    val message: String,
)

data class ScreenshotUploadResponse(
    val screenshotUrl: String,
)

// ─── Agent Update Result ───────────────────────────────────────────────────────

data class InstallResultRequest(
    val success: Boolean,
    val installedVersion: String? = null,
    val errorMessage: String? = null,
)

// ─── Enrollment ───────────────────────────────────────────────────────────────

data class QrEnrollmentData(
    val serverUrl: String,
    val tenantId: String,
    val enrollmentToken: String,
    val policyId: String? = null,
)

data class EnrollDeviceRequest(
    val enrollmentToken: String,
    val name: String,
    val serialNumber: String,
    val imei: String? = null,
    val androidVersion: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val policyId: String? = null,
)

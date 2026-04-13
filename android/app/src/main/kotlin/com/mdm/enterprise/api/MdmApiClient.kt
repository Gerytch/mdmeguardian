package com.mdm.enterprise.api

import android.content.Context
import com.mdm.enterprise.BuildConfig
import com.mdm.enterprise.api.models.*
import com.mdm.enterprise.utils.BootPrefs
import com.mdm.enterprise.utils.SecurePreferences
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import okhttp3.MultipartBody
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// ─── API Interface ────────────────────────────────────────────────────────────

interface MdmApi {
    // Auth
    @POST("auth/device/login")
    suspend fun deviceLogin(@Header("X-Device-Token") token: String): DeviceLoginResponse

    @GET("auth/me")
    suspend fun getMe(@Header("Authorization") token: String): UserProfile

    // Commands (device-facing, token via header)
    @GET("device/commands/pending")
    suspend fun getPendingCommands(
        @Header("X-Device-Token") token: String,
        @Header("X-Agent-Version") agentVersion: String,
    ): List<CommandResponse>

    @PATCH("device/commands/{id}/ack")
    suspend fun ackCommand(
        @Header("X-Device-Token") token: String,
        @Path("id") commandId: String,
        @Body ack: CommandAckRequest,
    ): CommandResponse

    // Location — endpoint is @Public on the backend, no auth required
    @POST("tenants/{tenantId}/geolocation")
    suspend fun postLocation(
        @Path("tenantId") tenantId: String,
        @Body location: LocationRequest,
    ): LocationResponse

    // Heartbeat
    @PATCH("tenants/{tenantId}/devices/{deviceId}/heartbeat")
    suspend fun sendHeartbeat(
        @Header("Authorization") token: String,
        @Path("tenantId") tenantId: String,
        @Path("deviceId") deviceId: String,
        @Body heartbeat: HeartbeatRequest,
    ): DeviceResponse

    // Device registration (requires JWT — used by admin)
    @POST("tenants/{tenantId}/devices")
    suspend fun registerDevice(
        @Header("Authorization") token: String,
        @Path("tenantId") tenantId: String,
        @Body device: RegisterDeviceRequest,
    ): RegisterDeviceResponse

    // QR enrollment — no auth required (@Public on backend)
    @POST("tenants/{tenantId}/devices/enroll")
    suspend fun enrollWithToken(
        @Path("tenantId") tenantId: String,
        @Body device: EnrollDeviceRequest,
    ): RegisterDeviceResponse

    // App catalog sync (fire-and-forget on enrollment)
    @POST("device/apps/sync")
    suspend fun syncApps(
        @Header("X-Device-Token") token: String,
        @Body body: SyncAppsRequest,
    ): retrofit2.Response<Unit>

    // Network Test progress
    @PATCH("device/commands/{id}/install-result")
    suspend fun reportInstallResult(
        @Header("X-Device-Token") token: String,
        @Path("id") commandId: String,
        @Body body: InstallResultRequest,
    ): retrofit2.Response<Unit>

    @PATCH("device/commands/{id}/progress")
    suspend fun reportProgress(
        @Header("X-Device-Token") token: String,
        @Path("id") commandId: String,
        @Body body: com.mdm.enterprise.api.models.ReportProgressRequest,
    ): retrofit2.Response<Unit>

    @Multipart
    @POST("device/commands/{id}/screenshot")
    suspend fun uploadCommandScreenshot(
        @Header("X-Device-Token") token: String,
        @Path("id") commandId: String,
        @Part file: MultipartBody.Part,
    ): com.mdm.enterprise.api.models.ScreenshotUploadResponse

    // Device User Auth
    @POST("device/user-auth/login")
    suspend fun loginDeviceUser(
        @Header("X-Device-Token") token: String,
        @Body body: DeviceUserLoginRequest,
    ): DeviceUserLoginResponse

    @POST("device/user-auth/logout")
    @retrofit2.http.Headers("Content-Type: application/json")
    suspend fun logoutDeviceUser(
        @Header("X-Device-Token") token: String,
        @Body body: DeviceUserLogoutRequest,
    ): retrofit2.Response<Unit>

    @PATCH("device/user-auth/session/{sessionId}/timeout")
    suspend fun reportSessionTimeout(
        @Header("X-Device-Token") token: String,
        @Path("sessionId") sessionId: String,
    ): retrofit2.Response<Unit>

    @GET("device/user-auth/session/{sessionId}/validate")
    suspend fun validateSession(
        @Header("X-Device-Token") token: String,
        @Path("sessionId") sessionId: String,
    ): retrofit2.Response<Unit>

    @GET("device/user-auth/users")
    suspend fun getDeviceUsers(
        @Header("X-Device-Token") token: String,
    ): List<DeviceUserCacheEntry>

    @POST("device/user-auth/sync-offline")
    suspend fun syncOfflineSessions(
        @Header("X-Device-Token") token: String,
        @Body body: SyncOfflineRequest,
    ): SyncOfflineResponse
}

// ─── Client Factory ───────────────────────────────────────────────────────────

object MdmApiClient {

    @Volatile
    private var instance: MdmApi? = null

    fun getInstance(context: Context): MdmApi {
        return instance ?: synchronized(this) {
            instance ?: buildClient(context).also { instance = it }
        }
    }

    private fun buildClient(context: Context): MdmApi {
        val prefs = SecurePreferences.getInstance(context)

        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG)
                HttpLoggingInterceptor.Level.BODY
            else
                HttpLoggingInterceptor.Level.NONE
        }

        val okHttp = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .addInterceptor { chain ->
                // Retry once on connection failure
                var response = try {
                    chain.proceed(chain.request())
                } catch (e: Exception) {
                    chain.proceed(chain.request())
                }
                response
            }
            .build()

        // Fall back to BootPrefs (device-protected storage) before first unlock (Direct Boot)
        val baseUrl = (prefs.getString("server_url", null)
            ?: BootPrefs.getServerUrl(context)
            ?: BuildConfig.API_BASE_URL)
            .trimEnd('/') + "/"

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(MdmApi::class.java)
    }

    fun reset() {
        instance = null
    }
}

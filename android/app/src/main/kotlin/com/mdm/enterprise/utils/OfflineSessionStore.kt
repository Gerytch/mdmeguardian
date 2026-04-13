package com.mdm.enterprise.utils

import android.content.Context
import android.util.Log
import at.favre.lib.crypto.bcrypt.BCrypt
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.mdm.enterprise.api.models.DeviceUserCacheEntry
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class PendingOfflineSession(
    val offlineSessionId: String,
    val deviceUserId: String,
    val username: String,
    val fullName: String,
    val jobTitle: String?,
    val photoUrl: String?,
    val startedAt: String,
    val endedAt: String? = null,
    val endedReason: String? = null,
    val status: String = "CLOSED",
)

data class PreAdminState(
    val wasAdminLocked: Boolean = false,
    val adminLockMessage: String = "",
    val adminLockContact: String = "",
    val adminLockSeverity: String = "warning",
    val wasKioskActive: Boolean = false,
    val kioskHiddenApps: List<String> = emptyList(),
    val kioskMode: String = "whitelist",
)

object OfflineSessionStore {

    private const val TAG = "OfflineSessionStore"
    private const val KEY_USER_CACHE = "offline_user_cache"
    private const val KEY_PENDING_SESSIONS = "offline_pending_sessions"
    private const val KEY_PRE_ADMIN_STATE = "pre_admin_state"
    private val gson = Gson()

    fun nowIso(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    // ─── User Cache ────────────────────────────────────────────────────────────

    fun saveUserCache(context: Context, users: List<DeviceUserCacheEntry>) {
        val json = gson.toJson(users)
        SecurePreferences.getInstance(context).edit()
            .putString(KEY_USER_CACHE, json)
            .apply()
        Log.d(TAG, "User cache saved: ${users.size} users")
    }

    fun getUserCache(context: Context): List<DeviceUserCacheEntry> {
        val json = SecurePreferences.getInstance(context).getString(KEY_USER_CACHE, null)
            ?: return emptyList()
        return try {
            val type = object : TypeToken<List<DeviceUserCacheEntry>>() {}.type
            gson.fromJson(json, type) ?: emptyList()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse user cache: ${e.message}")
            emptyList()
        }
    }

    /** Returns the cached user if username+pin are valid, null otherwise. */
    fun validatePin(context: Context, username: String, pin: String): DeviceUserCacheEntry? {
        val user = getUserCache(context).firstOrNull {
            it.username == username && it.status == "ACTIVE"
        } ?: return null
        return try {
            val result = BCrypt.verifyer().verify(pin.toCharArray(), user.pinHash)
            if (result.verified) user else null
        } catch (e: Exception) {
            Log.w(TAG, "BCrypt verification error: ${e.message}")
            null
        }
    }

    // ─── Pending Sessions ──────────────────────────────────────────────────────

    fun addPendingSession(context: Context, session: PendingOfflineSession) {
        val sessions = getPendingSessions(context).toMutableList()
        sessions.add(session)
        savePendingSessions(context, sessions)
        Log.d(TAG, "Pending session added: ${session.offlineSessionId}")
    }

    fun updatePendingSession(
        context: Context,
        offlineSessionId: String,
        endedAt: String,
        endedReason: String,
        status: String,
    ) {
        val sessions = getPendingSessions(context).toMutableList()
        val idx = sessions.indexOfFirst { it.offlineSessionId == offlineSessionId }
        if (idx >= 0) {
            sessions[idx] = sessions[idx].copy(
                endedAt = endedAt,
                endedReason = endedReason,
                status = status,
            )
            savePendingSessions(context, sessions)
            Log.d(TAG, "Pending session updated: $offlineSessionId status=$status")
        }
    }

    fun getPendingSessions(context: Context): List<PendingOfflineSession> {
        val json = SecurePreferences.getInstance(context).getString(KEY_PENDING_SESSIONS, null)
            ?: return emptyList()
        return try {
            val type = object : TypeToken<List<PendingOfflineSession>>() {}.type
            gson.fromJson(json, type) ?: emptyList()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse pending sessions: ${e.message}")
            emptyList()
        }
    }

    fun removeSyncedSessions(context: Context, syncedIds: Set<String>) {
        val remaining = getPendingSessions(context).filter { it.offlineSessionId !in syncedIds }
        savePendingSessions(context, remaining)
        Log.d(TAG, "Removed ${syncedIds.size} synced sessions. Remaining: ${remaining.size}")
    }

    private fun savePendingSessions(context: Context, sessions: List<PendingOfflineSession>) {
        val json = gson.toJson(sessions)
        SecurePreferences.getInstance(context).edit()
            .putString(KEY_PENDING_SESSIONS, json)
            .apply()
    }

    // ─── Pre-Admin State ───────────────────────────────────────────────────────

    fun savePreAdminState(context: Context, state: PreAdminState) {
        val json = gson.toJson(state)
        SecurePreferences.getInstance(context).edit()
            .putString(KEY_PRE_ADMIN_STATE, json)
            .apply()
        Log.d(TAG, "PreAdminState saved: locked=${state.wasAdminLocked} kiosk=${state.wasKioskActive}")
    }

    fun getPreAdminState(context: Context): PreAdminState? {
        val json = SecurePreferences.getInstance(context).getString(KEY_PRE_ADMIN_STATE, null)
            ?: return null
        return try {
            gson.fromJson(json, PreAdminState::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse PreAdminState: ${e.message}")
            null
        }
    }

    fun clearPreAdminState(context: Context) {
        SecurePreferences.getInstance(context).edit()
            .remove(KEY_PRE_ADMIN_STATE)
            .apply()
        Log.d(TAG, "PreAdminState cleared")
    }
}

package com.mdm.enterprise.ui

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.mdm.enterprise.R
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.services.MdmPolicyService
import com.mdm.enterprise.api.models.DeviceUserCacheEntry
import com.mdm.enterprise.api.models.DeviceUserLoginRequest
import com.mdm.enterprise.api.models.DeviceUserLoginResponse
import com.mdm.enterprise.services.UserActivityMonitorService
import com.mdm.enterprise.utils.OfflineSessionStore
import com.mdm.enterprise.utils.PendingOfflineSession
import com.mdm.enterprise.utils.PreAdminState
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DeviceLoginActivity : AppCompatActivity() {

    private sealed class LoginResult {
        data class Online(val response: DeviceUserLoginResponse) : LoginResult()
        data class Offline(val user: DeviceUserCacheEntry) : LoginResult()
        object InvalidCredentials : LoginResult()
        object NoOfflineCache : LoginResult()
    }

    companion object {
        private const val TAG = "DeviceLoginActivity"
        const val PREF_SESSION_ID = "device_user_session_id"
        const val PREF_USER_ID = "device_user_id"
        const val PREF_USER_NAME = "device_user_name"
        const val PREF_SESSION_OFFLINE = "device_user_session_offline"
        const val PREF_SESSION_TYPE = "device_user_session_type" // "operational" | "admin"
        const val EXTRA_REASON = "reason"

        @Volatile var isInForeground = false

        fun start(context: Context, reason: String? = null) {
            val intent = Intent(context, DeviceLoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                if (reason != null) putExtra(EXTRA_REASON, reason)
            }
            context.startActivity(intent)
        }

        fun hasActiveSession(context: Context): Boolean =
            SecurePreferences.getInstance(context).getStr(PREF_SESSION_ID) != null

        fun clearSession(context: Context) {
            SecurePreferences.getInstance(context).edit()
                .remove(PREF_SESSION_ID)
                .remove(PREF_USER_ID)
                .remove(PREF_USER_NAME)
                .remove(PREF_SESSION_OFFLINE)
                .remove(PREF_SESSION_TYPE)
                .apply()
        }

        fun isAdminSession(context: Context): Boolean =
            SecurePreferences.getInstance(context).getString(PREF_SESSION_TYPE, "operational") == "admin"
    }

    private lateinit var dpm: DevicePolicyManager
    private lateinit var adminComponent: ComponentName
    // When true, onDestroy skips setKeyguardDisabled(false) — the policy-dismiss flow
    // re-enables keyguard AFTER waking the screen, so the home screen shows directly.
    private var dismissedByPolicy = false

    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            dismissedByPolicy = true
            stopLockTask()
            val localDpm = dpm
            val localAdmin = adminComponent
            // Go to home screen directly — no lock/wake dance needed
            val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(homeIntent)
            finish()
            // Re-enable keyguard after home is shown
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                try { localDpm.setKeyguardDisabled(localAdmin, false) } catch (_: Exception) {}
            }, 800L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        adminComponent = ComponentName(this, MdmDeviceAdminReceiver::class.java)

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )

        setContentView(R.layout.activity_device_login)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        intent.getStringExtra(EXTRA_REASON)?.let { reason ->
            android.widget.Toast.makeText(this, reason, android.widget.Toast.LENGTH_LONG).show()
        }

        enterLockTask()

        val etUsername = findViewById<EditText>(R.id.etUsername)
        val etPin = findViewById<EditText>(R.id.etPin)
        val tvError = findViewById<TextView>(R.id.tvLoginError)
        val btnLogin = findViewById<Button>(R.id.btnLogin)
        val progress = findViewById<ProgressBar>(R.id.progressLogin)

        etPin.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) { btnLogin.performClick(); true } else false
        }

        btnLogin.setOnClickListener {
            val username = etUsername.text.toString().trim()
            val pin = etPin.text.toString().trim()

            if (username.isEmpty() || pin.isEmpty()) {
                tvError.text = "Preencha todos os campos"
                tvError.visibility = View.VISIBLE
                return@setOnClickListener
            }

            btnLogin.isEnabled = false
            progress.visibility = View.VISIBLE
            tvError.visibility = View.INVISIBLE

            lifecycleScope.launch {
                val loginResult = withContext(Dispatchers.IO) {
                    val prefs = SecurePreferences.getInstance(this@DeviceLoginActivity)
                    val token = prefs.getStr("device_token")
                    if (token == null) return@withContext LoginResult.NoOfflineCache

                    try {
                        val api = MdmApiClient.getInstance(this@DeviceLoginActivity)
                        LoginResult.Online(api.loginDeviceUser(token, DeviceUserLoginRequest(username, pin)))
                    } catch (e: retrofit2.HttpException) {
                        // 4xx = credenciais inválidas — não tentar offline
                        if (e.code() in 400..499) {
                            Log.w(TAG, "Login rejected by server (${e.code()}) — not trying offline")
                            LoginResult.InvalidCredentials
                        } else {
                            Log.w(TAG, "Server error ${e.code()}, trying offline")
                            tryOfflineLogin(username, pin)
                        }
                    } catch (e: Exception) {
                        // Erro de rede → tenta offline
                        Log.w(TAG, "Network error, trying offline: ${e.message}")
                        tryOfflineLogin(username, pin)
                    }
                }

                progress.visibility = View.GONE
                btnLogin.isEnabled = true

                when (loginResult) {
                    is LoginResult.Online -> {
                        val r = loginResult.response
                        SecurePreferences.getInstance(this@DeviceLoginActivity).edit()
                            .putString(PREF_SESSION_ID, r.sessionId)
                            .putString(PREF_USER_ID, r.deviceUserId)
                            .putString(PREF_USER_NAME, r.fullName)
                            .putBoolean(PREF_SESSION_OFFLINE, false)
                            .putString(PREF_SESSION_TYPE, r.sessionType)
                            .apply()
                        Log.i(TAG, "Login online OK: ${r.fullName} session=${r.sessionId} type=${r.sessionType}")
                        if (r.sessionType == "admin") {
                            applyAdminBypass()
                        }
                        startSessionMonitor()
                        stopLockTask()
                        finish()
                    }
                    is LoginResult.Offline -> {
                        val user = loginResult.user
                        val offlineId = UUID.randomUUID().toString()
                        val now = OfflineSessionStore.nowIso()
                        OfflineSessionStore.addPendingSession(
                            this@DeviceLoginActivity,
                            PendingOfflineSession(
                                offlineSessionId = offlineId,
                                deviceUserId = user.id,
                                username = user.username,
                                fullName = user.fullName,
                                jobTitle = user.jobTitle,
                                photoUrl = user.photoUrl,
                                startedAt = now,
                            )
                        )
                        val sessionType = if (user.isDeviceAdmin) "admin" else "operational"
                        SecurePreferences.getInstance(this@DeviceLoginActivity).edit()
                            .putString(PREF_SESSION_ID, offlineId)
                            .putString(PREF_USER_ID, user.id)
                            .putString(PREF_USER_NAME, user.fullName)
                            .putBoolean(PREF_SESSION_OFFLINE, true)
                            .putString(PREF_SESSION_TYPE, sessionType)
                            .apply()
                        Log.i(TAG, "Login OFFLINE OK: ${user.fullName} offlineId=$offlineId type=$sessionType")
                        if (user.isDeviceAdmin) {
                            applyAdminBypass()
                        } else {
                            android.widget.Toast.makeText(
                                this@DeviceLoginActivity,
                                "Modo offline — sessão será sincronizada quando houver rede",
                                android.widget.Toast.LENGTH_LONG
                            ).show()
                        }
                        startSessionMonitor()
                        stopLockTask()
                        finish()
                    }
                    is LoginResult.InvalidCredentials, LoginResult.NoOfflineCache -> {
                        val msg = if (loginResult is LoginResult.NoOfflineCache)
                            "Sem rede e sem cache offline disponível"
                        else
                            "Credenciais inválidas"
                        tvError.text = msg
                        tvError.visibility = View.VISIBLE
                        etPin.setText("")
                    }
                }
            }
        }

        val filter = IntentFilter("com.mdm.enterprise.DISMISS_LOGIN")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(dismissReceiver, filter)
        }
    }

    private fun applyAdminBypass() {
        val prefs = SecurePreferences.getInstance(this)
        val kioskPrefs = getSharedPreferences("mdm_kiosk", Context.MODE_PRIVATE)
        val kioskHiddenApps = kioskPrefs.getStringSet("kiosk_hidden_apps", emptySet()) ?: emptySet()
        val kioskMode = prefs.getString("current_kiosk_mode", "whitelist") ?: "whitelist"
        val wasAdminLocked = AdminLockActivity.isActive(this)

        OfflineSessionStore.savePreAdminState(
            this,
            PreAdminState(
                wasAdminLocked    = wasAdminLocked,
                adminLockMessage  = prefs.getStr("admin_lock_message")  ?: "",
                adminLockContact  = prefs.getStr("admin_lock_contact")  ?: "",
                adminLockSeverity = prefs.getStr("admin_lock_severity") ?: "warning",
                wasKioskActive    = kioskHiddenApps.isNotEmpty(),
                kioskHiddenApps   = kioskHiddenApps.toList(),
                kioskMode         = kioskMode,
            )
        )

        if (kioskHiddenApps.isNotEmpty()) {
            MdmPolicyService(this).disableKioskMode()
        }
        if (wasAdminLocked) {
            AdminLockActivity.release(this)
            sendBroadcast(Intent("com.mdm.enterprise.ADMIN_UNLOCK"))
        }
        Log.i(TAG, "Admin bypass applied: locked=$wasAdminLocked kiosk=${kioskHiddenApps.isNotEmpty()}")
    }

    private fun tryOfflineLogin(username: String, pin: String): LoginResult {
        val cached = OfflineSessionStore.validatePin(this, username, pin)
        return if (cached != null) LoginResult.Offline(cached) else LoginResult.NoOfflineCache
    }

    private fun startSessionMonitor() {
        val prefs = SecurePreferences.getInstance(this)
        val timeoutMin = prefs.getString("inactivity_timeout_minutes", "5")?.toIntOrNull() ?: 5
        UserActivityMonitorService.start(this, timeoutMin)
    }

    private fun enterLockTask() {
        if (dpm.isDeviceOwnerApp(packageName)) {
            try {
                dpm.setLockTaskPackages(adminComponent, arrayOf(packageName))
                startLockTask()
            } catch (e: Exception) {
                Log.w(TAG, "Could not enter lock task: ${e.message}")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        isInForeground = true

        // If auth was disabled while we were paused/hidden (broadcast missed), self-dismiss
        val prefs = SecurePreferences.getInstance(this)
        val authRequired = prefs.getString("device_user_auth_required", "true")?.toBoolean() ?: true
        if (!authRequired) {
            dismissedByPolicy = true
            stopLockTask()
            val localDpm = dpm
            val localAdmin = adminComponent
            val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(homeIntent)
            finish()
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                try { localDpm.setKeyguardDisabled(localAdmin, false) } catch (_: Exception) {}
            }, 800L)
            return
        }
    }

    override fun onPause() {
        super.onPause()
        isInForeground = false
    }

    @Deprecated("required override")
    override fun onBackPressed() { /* intentionally blocked */ }

    override fun onDestroy() {
        try { unregisterReceiver(dismissReceiver) } catch (_: Exception) {}
        try {
            if (dpm.isDeviceOwnerApp(packageName)) {
                dpm.setLockTaskPackages(adminComponent, emptyArray())
                if (!dismissedByPolicy) {
                    // Re-enable keyguard on normal exit (login success / user logout).
                    // When dismissed by policy, the dismissReceiver re-enables keyguard
                    // AFTER waking the screen, so the home screen shows without obstruction.
                    dpm.setKeyguardDisabled(adminComponent, false)
                    Log.i(TAG, "onDestroy: keyguard re-enabled")
                }
            }
        } catch (_: Exception) {}
        super.onDestroy()
    }
}

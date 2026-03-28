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
import com.mdm.enterprise.api.models.DeviceUserLoginRequest
import com.mdm.enterprise.services.UserActivityMonitorService
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DeviceLoginActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "DeviceLoginActivity"
        const val PREF_SESSION_ID = "device_user_session_id"
        const val PREF_USER_ID = "device_user_id"
        const val PREF_USER_NAME = "device_user_name"

        fun start(context: Context) {
            val intent = Intent(context, DeviceLoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
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
                .apply()
        }
    }

    private lateinit var dpm: DevicePolicyManager
    private lateinit var adminComponent: ComponentName

    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            stopLockTask()
            finish()
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
        setShowWhenLocked(true)
        setTurnScreenOn(true)

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
                val result = withContext(Dispatchers.IO) {
                    try {
                        val prefs = SecurePreferences.getInstance(this@DeviceLoginActivity)
                        val token = prefs.getStr("device_token") ?: return@withContext null
                        val api = MdmApiClient.getInstance(this@DeviceLoginActivity)
                        api.loginDeviceUser(token, DeviceUserLoginRequest(username, pin))
                    } catch (e: Exception) {
                        Log.w(TAG, "Login failed: ${e.message}")
                        null
                    }
                }

                progress.visibility = View.GONE
                btnLogin.isEnabled = true

                if (result != null) {
                    // Persist session
                    SecurePreferences.getInstance(this@DeviceLoginActivity).edit()
                        .putString(PREF_SESSION_ID, result.sessionId)
                        .putString(PREF_USER_ID, result.deviceUserId)
                        .putString(PREF_USER_NAME, result.fullName)
                        .apply()

                    Log.i(TAG, "Login OK: ${result.fullName} session=${result.sessionId}")

                    // Start inactivity monitor
                    val prefs = SecurePreferences.getInstance(this@DeviceLoginActivity)
                    val timeoutMin = prefs.getString("inactivity_timeout_minutes", "5")?.toIntOrNull() ?: 5
                    UserActivityMonitorService.start(this@DeviceLoginActivity, timeoutMin)

                    stopLockTask()
                    finish()
                } else {
                    tvError.text = "Credenciais inválidas"
                    tvError.visibility = View.VISIBLE
                    etPin.setText("")
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

    @Deprecated("required override")
    override fun onBackPressed() { /* intentionally blocked */ }

    override fun onDestroy() {
        try { unregisterReceiver(dismissReceiver) } catch (_: Exception) {}
        try {
            if (dpm.isDeviceOwnerApp(packageName)) {
                dpm.setLockTaskPackages(adminComponent, emptyArray())
            }
        } catch (_: Exception) {}
        super.onDestroy()
    }
}

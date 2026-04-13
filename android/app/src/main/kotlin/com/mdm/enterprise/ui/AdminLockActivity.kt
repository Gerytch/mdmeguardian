package com.mdm.enterprise.ui

import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.mdm.enterprise.R
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr

class AdminLockActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_MESSAGE  = "admin_lock_message"
        const val EXTRA_CONTACT  = "admin_lock_contact"
        const val EXTRA_SEVERITY = "admin_lock_severity"

        /** True while AdminLockActivity is in the foreground (onResume → onPause). */
        @Volatile var isInForeground: Boolean = false
            private set

        internal const val ALERT_NOTIF_ID = 9001

        private const val PREF_ACTIVE   = "admin_lock_active"
        private const val PREF_MESSAGE  = "admin_lock_message"
        private const val PREF_CONTACT  = "admin_lock_contact"
        private const val PREF_SEVERITY = "admin_lock_severity"

        fun start(context: Context, message: String, contact: String?, severity: String) {
            // Persist so it survives reboot/service restart
            val prefs = SecurePreferences.getInstance(context)
            prefs.edit()
                .putString(PREF_ACTIVE,   "true")
                .putString(PREF_MESSAGE,  message)
                .putString(PREF_CONTACT,  contact ?: "")
                .putString(PREF_SEVERITY, severity)
                .apply()

            val intent = Intent(context, AdminLockActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(EXTRA_MESSAGE,  message)
                putExtra(EXTRA_CONTACT,  contact ?: "")
                putExtra(EXTRA_SEVERITY, severity)
            }
            context.startActivity(intent)
        }

        fun release(context: Context) {
            SecurePreferences.getInstance(context).edit()
                .remove(PREF_ACTIVE)
                .remove(PREF_MESSAGE)
                .remove(PREF_CONTACT)
                .remove(PREF_SEVERITY)
                .apply()
        }

        fun isActive(context: Context): Boolean =
            SecurePreferences.getInstance(context).getStr(PREF_ACTIVE) == "true"

        fun restoreIfNeeded(context: Context) {
            val prefs = SecurePreferences.getInstance(context)
            if (prefs.getStr(PREF_ACTIVE) != "true") return
            start(
                context,
                message  = prefs.getStr(PREF_MESSAGE)  ?: "Dispositivo bloqueado",
                contact  = prefs.getStr(PREF_CONTACT),
                severity = prefs.getStr(PREF_SEVERITY) ?: "warning",
            )
        }
    }

    private lateinit var dpm: DevicePolicyManager
    private lateinit var adminComponent: ComponentName

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            stopLockTask()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // API 26+: request keyguard dismiss — no interaction needed on Device Owner
                val km = getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
                km.requestDismissKeyguard(this@AdminLockActivity, null)
            } else {
                // API 25: go directly to home screen to avoid the keyguard
                startActivity(
                    Intent(Intent.ACTION_MAIN).apply {
                        addCategory(Intent.CATEGORY_HOME)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                )
            }

            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        adminComponent = ComponentName(this, MdmDeviceAdminReceiver::class.java)

        // Keep screen ON and show above lock screen
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )

        setContentView(R.layout.activity_admin_lock)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        val message  = intent.getStringExtra(EXTRA_MESSAGE)  ?: "Dispositivo bloqueado"
        val contact  = intent.getStringExtra(EXTRA_CONTACT)  ?: ""
        val severity = intent.getStringExtra(EXTRA_SEVERITY) ?: "warning"

        applyTheme(severity)
        bindViews(message, contact)
        enterLockTask()
        alertUser()

        // Register receiver to listen for remote ADMIN_UNLOCK
        val filter = IntentFilter("com.mdm.enterprise.ADMIN_UNLOCK")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(unlockReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(unlockReceiver, filter)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Re-apply if a new ADMIN_LOCK came in while activity was running
        val message  = intent.getStringExtra(EXTRA_MESSAGE)  ?: return
        val contact  = intent.getStringExtra(EXTRA_CONTACT)  ?: ""
        val severity = intent.getStringExtra(EXTRA_SEVERITY) ?: "warning"
        applyTheme(severity)
        bindViews(message, contact)
    }

    private fun applyTheme(severity: String) {
        val bgColor = when (severity) {
            "critical" -> Color.parseColor("#7F1D1D")  // dark red
            "warning"  -> Color.parseColor("#78350F")  // dark amber
            else       -> Color.parseColor("#1E3A5F")  // dark blue (info)
        }
        findViewById<View>(R.id.rootAdminLock).setBackgroundColor(bgColor)
    }

    private fun bindViews(message: String, contact: String) {
        findViewById<TextView>(R.id.tvAdminMessage).text = message

        val tvContact = findViewById<TextView>(R.id.tvAdminContact)
        if (contact.isNotBlank()) {
            tvContact.text = "Contato TI: $contact"
            tvContact.visibility = View.VISIBLE
        } else {
            tvContact.visibility = View.GONE
        }
    }

    /** Vibrate + play notification sound to alert the user the device was locked. */
    @Suppress("DEPRECATION")
    private fun alertUser() {
        try {
            // Vibrate: three short pulses
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator.vibrate(
                    VibrationEffect.createWaveform(longArrayOf(0, 200, 100, 200, 100, 200), -1)
                )
            } else {
                val vm = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vm.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 200, 100, 200, 100, 200), -1))
                } else {
                    vm.vibrate(longArrayOf(0, 200, 100, 200, 100, 200), -1)
                }
            }
        } catch (_: Exception) {}

        try {
            // Play the default notification sound
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            ringtone?.let {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    it.isLooping = false
                }
                it.play()
            }
        } catch (_: Exception) {}
    }

    private fun enterLockTask() {
        if (dpm.isDeviceOwnerApp(packageName)) {
            try {
                dpm.setLockTaskPackages(adminComponent, arrayOf(packageName))
                startLockTask()
            } catch (e: Exception) {
                android.util.Log.w("AdminLock", "Could not enter lock task: ${e.message}")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        isInForeground = true
        // Cancel the watchdog notification — the lock screen is now visible.
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(ALERT_NOTIF_ID)
        if (isActive(this)) enterLockTask()
    }

    override fun onPause() {
        super.onPause()
        isInForeground = false
    }

    // Block back button — user cannot exit
    @Deprecated("required override")
    override fun onBackPressed() { /* intentionally blocked */ }

    override fun onDestroy() {
        try { unregisterReceiver(unlockReceiver) } catch (_: Exception) {}
        // Do NOT clear setLockTaskPackages here — the watchdog or restoreIfNeeded
        // may re-launch this activity and needs the packages whitelist to stay set.
        // Lock task packages are only cleared in MdmPolicyService.adminUnlock().
        super.onDestroy()
    }
}

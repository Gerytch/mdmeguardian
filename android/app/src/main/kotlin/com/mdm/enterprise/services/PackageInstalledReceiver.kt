package com.mdm.enterprise.services

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import java.lang.ref.WeakReference
import java.util.LinkedList

class PackageInstalledReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_SHORTCUT_CONFIRMED) {
            Log.i(TAG, "Shortcut confirmed — advancing queue")
            onShortcutConfirmed()
        }
    }

    companion object {
        private const val TAG = "PkgInstalledReceiver"
        private const val PREFS_NAME = "mdm_pending_shortcuts"
        private const val KEY_PACKAGES = "packages"
        const val ACTION_SHORTCUT_CONFIRMED = "com.mdm.enterprise.SHORTCUT_CONFIRMED"

        private val handler = Handler(Looper.getMainLooper())
        private val queue = LinkedList<String>()
        private var activityRef: WeakReference<Activity>? = null
        private var waitingForCallback = false

        fun addPending(context: Context, packageName: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val current = prefs.getStringSet(KEY_PACKAGES, emptySet())!!.toMutableSet()
            current.add(packageName)
            prefs.edit().putStringSet(KEY_PACKAGES, current).apply()
        }

        /**
         * Call from onWindowFocusChanged(hasFocus=true) in MainActivity.
         * Shows one "Add to Home Screen?" dialog at a time, advancing only after
         * the user confirms or a 8s timeout elapses.
         */
        fun processPendingShortcuts(activity: Activity) {
            val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getStringSet(KEY_PACKAGES, emptySet())!!.toMutableSet()
            if (pending.isEmpty()) return
            prefs.edit().putStringSet(KEY_PACKAGES, emptySet()).apply()

            activityRef = WeakReference(activity)
            queue.clear()
            queue.addAll(pending)
            Log.i(TAG, "Starting shortcut queue: ${queue.size} apps")
            showNext()
        }

        private fun showNext() {
            val pkg = queue.poll() ?: return
            val activity = activityRef?.get() ?: run {
                Log.w(TAG, "Activity lost — aborting shortcut queue")
                return
            }

            Log.i(TAG, "Showing pin dialog for $pkg (${queue.size} remaining)")
            waitingForCallback = true

            // Callback fired when user taps "Add"
            val callbackIntent = Intent(activity, PackageInstalledReceiver::class.java).apply {
                action = ACTION_SHORTCUT_CONFIRMED
            }
            val pi = PendingIntent.getBroadcast(
                activity, pkg.hashCode(), callbackIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )

            tryPinShortcut(activity, pkg, pi)

            // Timeout: advance after 8s even if user dismisses without confirming
            handler.postDelayed({
                if (waitingForCallback) {
                    Log.i(TAG, "Timeout for $pkg — advancing")
                    waitingForCallback = false
                    showNext()
                }
            }, 8_000)
        }

        private fun onShortcutConfirmed() {
            handler.removeCallbacksAndMessages(null)
            waitingForCallback = false
            handler.postDelayed({ showNext() }, 400)
        }

        private fun tryPinShortcut(activity: Activity, packageName: String, callback: PendingIntent) {
            if (!ShortcutManagerCompat.isRequestPinShortcutSupported(activity)) {
                Log.w(TAG, "Launcher does not support pin shortcut")
                return
            }
            val pm = activity.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(packageName) ?: return
            val appInfo = try { pm.getApplicationInfo(packageName, 0) } catch (_: Exception) { return }
            val appName = pm.getApplicationLabel(appInfo).toString()

            val icon = try {
                IconCompat.createWithBitmap(drawableToBitmap(pm.getApplicationIcon(appInfo)))
            } catch (_: Exception) {
                IconCompat.createWithResource(activity, android.R.drawable.sym_def_app_icon)
            }

            val shortcut = ShortcutInfoCompat.Builder(activity, "mdm_$packageName")
                .setShortLabel(appName)
                .setIntent(launchIntent.apply { action = Intent.ACTION_MAIN })
                .setIcon(icon)
                .build()

            ShortcutManagerCompat.requestPinShortcut(activity, shortcut, callback.intentSender)
            Log.i(TAG, "Pin dialog shown for $packageName ($appName)")
        }

        private fun drawableToBitmap(drawable: Drawable): Bitmap {
            if (drawable is BitmapDrawable && drawable.bitmap != null) return drawable.bitmap
            val size = 192
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(canvas)
            return bitmap
        }
    }
}

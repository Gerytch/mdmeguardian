package com.mdm.enterprise.ui

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.work.*
import android.view.MotionEvent
import com.mdm.enterprise.R
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.AppInfo
import com.mdm.enterprise.api.models.SyncAppsRequest
import com.mdm.enterprise.api.models.EnrollDeviceRequest
import com.mdm.enterprise.provisioning.QrProvisioningActivity
import com.mdm.enterprise.services.CommandPollingService
import com.mdm.enterprise.services.CommandPollingWorker
import com.mdm.enterprise.services.LocationTrackingWorker
import com.mdm.enterprise.services.UserActivityMonitorService
import com.mdm.enterprise.services.InstallProgressTracker
import com.mdm.enterprise.services.PackageInstalledReceiver
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        // Dev-mode enrollment intent action — used by ADB for emulator testing
        const val ACTION_DEV_ENROLL = "com.mdm.enterprise.DEV_ENROLL"
        // Production ADB enrollment — calls real API, same as QR flow
        const val ACTION_ADB_ENROLL = "com.mdm.enterprise.ADB_ENROLL"
    }

    private lateinit var dpm: DevicePolicyManager
    private lateinit var adminComponent: ComponentName

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result handled silently */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        adminComponent = ComponentName(this, MdmDeviceAdminReceiver::class.java)

        // Request POST_NOTIFICATIONS on Android 13+
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // Handle dev-mode enrollment from ADB intent extras
        handleDevEnrollIntent(intent)
        // Handle production ADB enrollment (calls real API)
        if (intent?.action == ACTION_ADB_ENROLL) handleAdbEnrollIntent(intent)

        updateUI()
        observeInstallProgress()
        showGpsSetupDialogIfNeeded()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDevEnrollIntent(intent)
        if (intent.action == ACTION_ADB_ENROLL) handleAdbEnrollIntent(intent)
        updateUI()
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) PackageInstalledReceiver.processPendingShortcuts(this)
    }

    /** IDs usados como tag nas views de cada app para atualização in-place. */
    private val ROW_TAG_PREFIX = "install_row_"
    private val PB_TAG_PREFIX  = "install_pb_"
    private val TV_STATUS_TAG_PREFIX = "install_tv_"

    // Reset inactivity timer on every touch while this activity is in foreground
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        UserActivityMonitorService.recordActivity()
        return super.dispatchTouchEvent(ev)
    }

    /**
     * Dev-mode enrollment: inject credentials via ADB without scanning QR.
     * Usage:
     *   adb shell am start -n com.mdm.enterprise.debug/...MainActivity \
     *     --es dev_device_token "TOKEN" \
     *     --es dev_device_id "UUID" \
     *     --es dev_tenant_id "UUID" \
     *     --es dev_server_url "http://10.0.2.2:3002/api/v1"
     */
    private fun handleDevEnrollIntent(intent: Intent?) {
        val token = intent?.getStringExtra("dev_device_token") ?: return
        val deviceId = intent.getStringExtra("dev_device_id") ?: return
        val tenantId = intent.getStringExtra("dev_tenant_id") ?: return
        val serverUrl = intent.getStringExtra("dev_server_url") ?: "http://10.0.2.2:3002/api/v1"

        Log.i(TAG, "Dev enrollment: deviceId=$deviceId tenantId=$tenantId")

        val prefs = SecurePreferences.getInstance(this)
        prefs.edit()
            .putString("device_token", token)
            .putString("device_id", deviceId)
            .putString("tenant_id", tenantId)
            .putString("server_url", serverUrl)
            .putString("jwt_token", token)
            .putBoolean("is_enrolled", true)
            .apply()

        // Reset API client so it rebuilds with the new server_url
        com.mdm.enterprise.api.MdmApiClient.reset()

        // Start real-time foreground polling service (polls every 5s)
        CommandPollingService.stop(this)
        CommandPollingService.start(this)
        // Keep periodic WorkManager as fallback for when service is killed
        CommandPollingWorker.schedule(this)
        LocationTrackingWorker.schedule(this)

        // Fire-and-forget: sync installed app catalog to MDM server
        val enrollToken = token
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val pm = packageManager
                val launchIntent = Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER)
                @Suppress("DEPRECATION")
                val apps = pm.queryIntentActivities(launchIntent, 0)
                    .mapNotNull { it.activityInfo?.packageName }
                    .filter { it != packageName }
                    .distinct()
                    .map { pkg ->
                        val label = try {
                            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                        } catch (_: Exception) { pkg }
                        AppInfo(packageName = pkg, name = label)
                    }
                val api = MdmApiClient.getInstance(this@MainActivity)
                api.syncApps(enrollToken, SyncAppsRequest(apps))
                Log.i(TAG, "App catalog synced: ${apps.size} apps")
            } catch (e: Exception) {
                Log.w(TAG, "App catalog sync failed (non-critical): ${e.message}")
            }
        }

        Toast.makeText(this, "✓ Cadastro dev concluído!", Toast.LENGTH_LONG).show()
        Log.i(TAG, "Dev enrollment saved. Workers started.")
    }

    /**
     * Production ADB enrollment — calls the real enrollWithToken API (same as QR flow).
     * Usage (after adb install + set-device-owner):
     *   adb shell am start \
     *     -n "com.mdm.enterprise.homolog/com.mdm.enterprise.ui.MainActivity" \
     *     -a "com.mdm.enterprise.ADB_ENROLL" \
     *     --es enrollment_token "TOKEN_FROM_DASHBOARD" \
     *     --es server_url "https://eg.expresso3300.com.br/api/v1" \
     *     --es tenant_id "TENANT_UUID"
     */
    private fun handleAdbEnrollIntent(intent: Intent?) {
        val enrollmentToken = intent?.getStringExtra("enrollment_token") ?: return
        val serverUrl = intent.getStringExtra("server_url") ?: return
        val tenantId = intent.getStringExtra("tenant_id") ?: return

        Log.i(TAG, "ADB enrollment: tenantId=$tenantId serverUrl=$serverUrl")
        Toast.makeText(this, "Cadastrando dispositivo...", Toast.LENGTH_SHORT).show()

        // Pre-configure server URL so MdmApiClient builds with the correct base
        val prefs = SecurePreferences.getInstance(this)
        prefs.edit().putString("server_url", serverUrl).apply()
        MdmApiClient.reset()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val androidId = android.provider.Settings.Secure.getString(
                    contentResolver, android.provider.Settings.Secure.ANDROID_ID
                )
                val api = MdmApiClient.getInstance(this@MainActivity)
                val response = api.enrollWithToken(
                    tenantId,
                    EnrollDeviceRequest(
                        enrollmentToken = enrollmentToken,
                        name = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
                        serialNumber = androidId,
                        manufacturer = android.os.Build.MANUFACTURER,
                        model = android.os.Build.MODEL,
                        androidVersion = android.os.Build.VERSION.RELEASE,
                        policyId = null,
                    )
                )

                // Persist credentials — same fields as QrProvisioningActivity
                prefs.edit()
                    .putString("device_id", response.id)
                    .putString("device_token", response.deviceToken)
                    .putString("tenant_id", tenantId)
                    .putString("server_url", serverUrl)
                    .putBoolean("is_enrolled", true)
                    .apply()

                MdmApiClient.reset()

                // Start polling services
                CommandPollingService.stop(this@MainActivity)
                CommandPollingService.start(this@MainActivity)
                CommandPollingWorker.schedule(this@MainActivity)
                LocationTrackingWorker.schedule(this@MainActivity)

                // Sync app catalog (fire-and-forget)
                try {
                    val pm = packageManager
                    val launchIntent = Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER)
                    @Suppress("DEPRECATION")
                    val apps = pm.queryIntentActivities(launchIntent, 0)
                        .mapNotNull { it.activityInfo?.packageName }
                        .filter { it != packageName }
                        .distinct()
                        .map { pkg ->
                            val label = try {
                                pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                            } catch (_: Exception) { pkg }
                            com.mdm.enterprise.api.models.AppInfo(packageName = pkg, name = label)
                        }
                    api.syncApps(response.deviceToken, com.mdm.enterprise.api.models.SyncAppsRequest(apps))
                } catch (e: Exception) {
                    Log.w(TAG, "App catalog sync failed (non-critical): ${e.message}")
                }

                runOnUiThread {
                    Toast.makeText(this@MainActivity, "✓ Dispositivo cadastrado com sucesso!", Toast.LENGTH_LONG).show()
                    updateUI()
                }
                Log.i(TAG, "ADB enrollment complete. deviceId=${response.id}")
            } catch (e: Exception) {
                Log.e(TAG, "ADB enrollment failed: ${e.message}", e)
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Erro no cadastro: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun updateUI() {
        val prefs = SecurePreferences.getInstance(this)
        val isEnrolled = prefs.getStr("device_token") != null
        val isDeviceOwner = dpm.isDeviceOwnerApp(packageName)
        val isAdmin = dpm.isAdminActive(adminComponent)

        val statusTitle = findViewById<TextView>(R.id.tvStatusTitle)
        val statusSubtitle = findViewById<TextView>(R.id.tvStatusSubtitle)
        val enrollLayout = findViewById<LinearLayout>(R.id.layoutEnroll)
        val enrolledLayout = findViewById<LinearLayout>(R.id.layoutEnrolled)
        val btnEnroll = findViewById<Button>(R.id.btnEnroll)
        val tvDeviceOwner = findViewById<TextView>(R.id.tvDeviceOwner)
        val tvServerUrl = findViewById<TextView>(R.id.tvServerUrl)

        if (isEnrolled) {
            statusTitle.text = "Dispositivo Cadastrado"
            statusSubtitle.text = "E.Guardian está ativo e monitorando este dispositivo"
            enrollLayout.isVisible = false
            enrolledLayout.isVisible = true

            // Ensure polling service is running whenever the enrolled screen is shown
            CommandPollingService.start(this)

            val ownerStatus = when {
                isDeviceOwner -> "✓ Proprietário do Dispositivo (controle total)"
                isAdmin -> "⚠ Somente Admin (controle limitado)"
                else -> "✗ Sem privilégios de admin"
            }
            tvDeviceOwner.text = ownerStatus
            tvServerUrl.text = "Servidor: ${prefs.getStr("server_url") ?: "Não configurado"}"

            // Device user auth: show login if required and no active session
            val authRequired = prefs.getStr("device_user_auth_required") == "true"
            if (authRequired && !DeviceLoginActivity.hasActiveSession(this)) {
                DeviceLoginActivity.start(this)
            }

            // Logout button: show when auth is required and a session is active
            val btnLogout = findViewById<Button?>(R.id.btnLogout)
            if (authRequired && DeviceLoginActivity.hasActiveSession(this)) {
                btnLogout?.visibility = android.view.View.VISIBLE
            } else {
                btnLogout?.visibility = android.view.View.GONE
            }
            btnLogout?.setOnClickListener {
                val token = prefs.getStr("device_token")
                val sessionId = prefs.getStr(DeviceLoginActivity.PREF_SESSION_ID)

                if (token != null && sessionId != null) {
                    lifecycleScope.launch(Dispatchers.IO) {
                        try {
                            val api = MdmApiClient.getInstance(this@MainActivity)
                            api.logoutDeviceUser(token, com.mdm.enterprise.api.models.DeviceUserLogoutRequest(sessionId))
                        } catch (_: Exception) {}
                    }
                }

                UserActivityMonitorService.stop(this)
                DeviceLoginActivity.clearSession(this)
                DeviceLoginActivity.start(this)
            }
        } else {
            statusTitle.text = "Não Cadastrado"
            statusSubtitle.text = "Escaneie o QR code do console E.Guardian para cadastrar"
            enrollLayout.isVisible = true
            enrolledLayout.isVisible = false
        }

        btnEnroll.setOnClickListener {
            startActivity(Intent(this, QrProvisioningActivity::class.java))
        }

        val btnTestEnroll = findViewById<Button?>(R.id.btnTestEnroll)
        btnTestEnroll?.setOnClickListener {
            showServerUrlDialog()
        }

        // Poll Now button (debug only)
        val btnPollNow = findViewById<Button?>(R.id.btnPollNow)
        btnPollNow?.setOnClickListener {
            CommandPollingService.start(this)
            Toast.makeText(this, "Monitoramento ativo (intervalo de 5s)", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showServerUrlDialog() {
        val prefs = SecurePreferences.getInstance(this)
        val input = android.widget.EditText(this)
        input.hint = "http://10.0.2.2:3002"
        input.setText(prefs.getStr("server_url") ?: "http://10.0.2.2:3002")

        android.app.AlertDialog.Builder(this)
            .setTitle("Configurar URL do Servidor")
            .setMessage("10.0.2.2 = localhost ao executar no emulador")
            .setView(input)
            .setPositiveButton("Salvar") { _, _ ->
                prefs.edit().putString("server_url", input.text.toString().trim()).apply()
                Toast.makeText(this, "Salvo!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun observeInstallProgress() {
        lifecycleScope.launch(Dispatchers.Main) {
            InstallProgressTracker.items.collectLatest { items ->
                val card = findViewById<android.widget.LinearLayout>(R.id.layoutInstallProgress) ?: return@collectLatest
                val container = findViewById<android.widget.LinearLayout>(R.id.installItemsContainer) ?: return@collectLatest

                if (items.isEmpty()) {
                    card.visibility = android.view.View.GONE
                    return@collectLatest
                }

                card.visibility = android.view.View.VISIBLE

                // Adiciona rows apenas para apps novos; atualiza in-place os existentes
                for (item in items) {
                    val rowTag = ROW_TAG_PREFIX + item.packageName
                    val existingRow = container.findViewWithTag<android.widget.LinearLayout>(rowTag)

                    if (existingRow == null) {
                        // Criar row pela primeira vez
                        val row = android.widget.LinearLayout(this@MainActivity).apply {
                            tag = rowTag
                            orientation = android.widget.LinearLayout.VERTICAL
                            setPadding(0, 0, 0, 12)
                        }
                        val nameRow = android.widget.LinearLayout(this@MainActivity).apply {
                            orientation = android.widget.LinearLayout.HORIZONTAL
                        }
                        val tvName = android.widget.TextView(this@MainActivity).apply {
                            text = item.appName
                            textSize = 13f
                            setTextColor(0xFF111827.toInt())
                            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        val tvStatus = android.widget.TextView(this@MainActivity).apply {
                            tag = TV_STATUS_TAG_PREFIX + item.packageName
                            textSize = 13f
                        }
                        nameRow.addView(tvName)
                        nameRow.addView(tvStatus)
                        row.addView(nameRow)

                        val pb = android.widget.ProgressBar(this@MainActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                            tag = PB_TAG_PREFIX + item.packageName
                            max = 100
                            layoutParams = android.widget.LinearLayout.LayoutParams(
                                android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 20
                            ).apply { topMargin = 6 }
                        }
                        row.addView(pb)
                        container.addView(row)
                    }

                    // Atualizar status text e barra in-place
                    val tvStatus = container.findViewWithTag<android.widget.TextView>(TV_STATUS_TAG_PREFIX + item.packageName)
                    val pb = container.findViewWithTag<android.widget.ProgressBar>(PB_TAG_PREFIX + item.packageName)

                    tvStatus?.apply {
                        text = when (item.status) {
                            InstallProgressTracker.Status.QUEUED      -> "⏳"
                            InstallProgressTracker.Status.DOWNLOADING -> "⬇ ${item.downloadProgress}%"
                            InstallProgressTracker.Status.INSTALLING  -> "⚙ instalando..."
                            InstallProgressTracker.Status.DONE        -> "✓"
                            InstallProgressTracker.Status.FAILED      -> "✗"
                        }
                        setTextColor(when (item.status) {
                            InstallProgressTracker.Status.DONE   -> 0xFF065F46.toInt()
                            InstallProgressTracker.Status.FAILED -> 0xFFDC2626.toInt()
                            else -> 0xFF1D4ED8.toInt()
                        })
                    }

                    pb?.apply {
                        when (item.status) {
                            InstallProgressTracker.Status.DOWNLOADING -> {
                                visibility = android.view.View.VISIBLE
                                isIndeterminate = false
                                progress = item.downloadProgress
                            }
                            InstallProgressTracker.Status.INSTALLING -> {
                                visibility = android.view.View.VISIBLE
                                isIndeterminate = true
                            }
                            else -> visibility = android.view.View.GONE
                        }
                    }
                }

                // Quando tudo concluir, dispara dialogs de atalho sem precisar sair do app
                val allDone = items.all {
                    it.status == InstallProgressTracker.Status.DONE ||
                    it.status == InstallProgressTracker.Status.FAILED
                }
                if (allDone) PackageInstalledReceiver.processPendingShortcuts(this@MainActivity)
            }
        }
    }

    /**
     * Shows a one-time dialog guiding the IT admin to enable GPS settings
     * required for location tracking. Shown only once after enrollment.
     */
    private fun showGpsSetupDialogIfNeeded() {
        val prefs = getSharedPreferences("mdm_setup", Context.MODE_PRIVATE)
        if (prefs.getBoolean("gps_setup_shown", false)) return

        // Only show if device is enrolled
        val enrolled = SecurePreferences.getInstance(this).getStr("device_token") != null
        if (!enrolled) return

        prefs.edit().putBoolean("gps_setup_shown", true).apply()

        val message = """
            Para o rastreamento de localização funcionar corretamente:

            1️⃣  Abra Configurações
               Toque na lupa 🔍 e pesquise "Serviços de localização"

            2️⃣  Abra Serviços de localização → Serviços de localização

            3️⃣  Ative as duas opções na mesma tela:
               • Precisão de localização
               • Procura de Wi-Fi

            Feito uma vez — não precisa repetir.
        """.trimIndent()

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⚙️ Configuração de GPS")
            .setMessage(message)
            .setPositiveButton("Entendido") { d, _ -> d.dismiss() }
            .setCancelable(false)
            .show()
    }
}

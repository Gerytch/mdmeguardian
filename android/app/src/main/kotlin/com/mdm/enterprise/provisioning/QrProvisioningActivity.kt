package com.mdm.enterprise.provisioning

import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.gson.Gson
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.mdm.enterprise.R
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.EnrollDeviceRequest
import com.mdm.enterprise.api.models.QrEnrollmentData
import com.mdm.enterprise.services.CommandPollingWorker
import com.mdm.enterprise.services.LocationTrackingWorker
import com.mdm.enterprise.utils.BootPrefs
import com.mdm.enterprise.utils.OfflineSessionStore
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.launch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@ExperimentalGetImage
class QrProvisioningActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "QrProvisioning"
    }

    private lateinit var cameraExecutor: ExecutorService
    private var isProcessing = false
    private val gson = Gson()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_qr_provisioning)
        cameraExecutor = Executors.newSingleThreadExecutor()
        startCamera()

        findViewById<Button>(R.id.btnCancel).setOnClickListener { finish() }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val previewView = findViewById<PreviewView>(R.id.previewView)

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { analysis ->
                    analysis.setAnalyzer(cameraExecutor) { proxy ->
                        processImage(proxy)
                    }
                }

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis)
            } catch (e: Exception) {
                Log.e(TAG, "Camera binding failed", e)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun processImage(imageProxy: ImageProxy) {
        if (isProcessing) { imageProxy.close(); return }

        val mediaImage = imageProxy.image ?: run { imageProxy.close(); return }
        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        val scanner = BarcodeScanning.getClient()

        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                for (barcode in barcodes) {
                    if (barcode.format == Barcode.FORMAT_QR_CODE) {
                        barcode.rawValue?.let { qrValue ->
                            if (!isProcessing) {
                                isProcessing = true
                                onQrCodeDetected(qrValue)
                            }
                        }
                    }
                }
            }
            .addOnFailureListener { Log.e(TAG, "Scan failed", it) }
            .addOnCompleteListener { imageProxy.close() }
    }

    private fun onQrCodeDetected(rawValue: String) {
        val enrollmentData = try {
            gson.fromJson(rawValue, QrEnrollmentData::class.java)
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this, "QR code inválido", Toast.LENGTH_SHORT).show() }
            isProcessing = false
            return
        }
        lifecycleScope.launch { enrollDevice(enrollmentData) }
    }

    private suspend fun enrollDevice(data: QrEnrollmentData) {
        runOnUiThread { Toast.makeText(this, "Cadastrando dispositivo...", Toast.LENGTH_SHORT).show() }

        try {
            val prefs = SecurePreferences.getInstance(this)
            val serverUrl = data.serverUrl.trimEnd('/')
            prefs.edit()
                .putString("server_url", "$serverUrl/api/v1")
                .putString("tenant_id", data.tenantId)
                .apply()

            MdmApiClient.reset()
            val api = MdmApiClient.getInstance(this)

            val androidId = android.provider.Settings.Secure.getString(
                contentResolver, android.provider.Settings.Secure.ANDROID_ID
            )

            val response = api.enrollWithToken(
                data.tenantId,
                EnrollDeviceRequest(
                    enrollmentToken = data.enrollmentToken,
                    name = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
                    serialNumber = androidId,
                    manufacturer = android.os.Build.MANUFACTURER,
                    model = android.os.Build.MODEL,
                    androidVersion = android.os.Build.VERSION.RELEASE,
                    policyId = data.policyId,
                )
            )

            prefs.edit()
                .putString("device_id", response.id)
                .putString("device_token", response.deviceToken)
                .putString("jwt_token", response.deviceToken)
                .putBoolean("is_enrolled", true)
                .apply()

            // Mirror credentials to device-protected storage so the service can
            // start on LOCKED_BOOT_COMPLETED (before user unlocks after reboot).
            BootPrefs.save(
                context     = this,
                deviceToken = response.deviceToken,
                deviceId    = response.id,
                tenantId    = data.tenantId,
                serverUrl   = "${serverUrl}/api/v1",
            )

            CommandPollingWorker.schedule(this)
            LocationTrackingWorker.schedule(this)

            // Pre-populate offline user cache so admin users work from day 1 without first login
            try {
                val users = api.getDeviceUsers(response.deviceToken)
                OfflineSessionStore.saveUserCache(this, users)
                Log.i(TAG, "Device user cache populated: ${users.size} users (${users.count { it.isDeviceAdmin }} admins)")
            } catch (e: Exception) {
                Log.w(TAG, "Could not fetch device users at enrollment (non-critical): ${e.message}")
            }

            Log.i(TAG, "Enrolled: ${response.id}")
            runOnUiThread {
                Toast.makeText(this, "✓ Dispositivo cadastrado com sucesso!", Toast.LENGTH_LONG).show()
                finish()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Enrollment failed", e)
            isProcessing = false
            runOnUiThread {
                Toast.makeText(this, "Falha no cadastro: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }
}

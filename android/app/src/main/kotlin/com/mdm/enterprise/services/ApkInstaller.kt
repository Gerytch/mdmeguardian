package com.mdm.enterprise.services

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.FileProvider
import com.mdm.enterprise.admin.MdmDeviceAdminReceiver
import com.mdm.enterprise.api.models.RequiredApp
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipFile

class ApkInstaller(private val context: Context) {

    companion object {
        private const val TAG = "ApkInstaller"
    }

    private val prefs = SecurePreferences.getInstance(context)
    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, MdmDeviceAdminReceiver::class.java)

    suspend fun installMissingApps(apps: List<RequiredApp>) {
        val serverUrl = (prefs.getStr("server_url") ?: "").trimEnd('/')
        if (serverUrl.isEmpty()) {
            Log.w(TAG, "Server URL not set — cannot download APKs")
            return
        }

        // Inicializa sessão de progresso apenas com apps que serão processados
        val toProcess = apps.filter { app ->
            !app.apkUrl.isNullOrBlank() && getInstalledVersion(app.packageName) != app.version
        }
        val alreadyInstalled = apps.filter { app ->
            !app.apkUrl.isNullOrBlank() && getInstalledVersion(app.packageName) == app.version
        }

        if (toProcess.isNotEmpty()) {
            val allForTracker = (toProcess + alreadyInstalled).map { it.packageName to it.name }
            InstallProgressTracker.startSession(allForTracker)
            alreadyInstalled.forEach { InstallProgressTracker.markSkipped(it.packageName) }
        }

        for (app in apps) {
            if (app.apkUrl.isNullOrBlank()) {
                Log.d(TAG, "App ${app.packageName} has no APK URL — skipping")
                continue
            }

            val installed = getInstalledVersion(app.packageName)
            if (installed == app.version) {
                Log.d(TAG, "App ${app.packageName} v${app.version} already installed — skipping")
                continue
            }

            Log.i(TAG, "Installing ${app.name} (${app.packageName}) v${app.version}")
            try {
                val downloadedFile = downloadFile(serverUrl, app)
                val isXapk = downloadedFile.extension.equals("xapk", ignoreCase = true)
                    || app.apkUrl!!.endsWith(".xapk", ignoreCase = true)

                InstallProgressTracker.startInstall(app.packageName)

                if (dpm.isDeviceOwnerApp(context.packageName)) {
                    if (isXapk) silentInstallXapk(downloadedFile, app.packageName)
                    else silentInstall(downloadedFile, app.packageName)
                } else {
                    if (isXapk) triggerInstallDialogXapk(downloadedFile, app.packageName)
                    else triggerInstallDialog(downloadedFile, app.packageName)
                }

                InstallProgressTracker.markDone(app.packageName)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to install ${app.packageName}: ${e.message}", e)
                InstallProgressTracker.markFailed(app.packageName, e.message)
            }
        }
    }

    private fun getInstalledVersion(packageName: String): String? {
        return try {
            val info = context.packageManager.getPackageInfo(packageName, 0)
            info.versionName
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
    }

    private fun downloadFile(serverUrl: String, app: RequiredApp): File {
        val apkUrlValue = app.apkUrl ?: throw Exception("APK URL is null for ${app.packageName}")
        val baseUrl = serverUrl.replace(Regex("/api/v\\d+$"), "")
        val downloadUrl = if (apkUrlValue.startsWith("http")) apkUrlValue else "$baseUrl$apkUrlValue"
        Log.d(TAG, "Downloading from: $downloadUrl")

        val ext = if (apkUrlValue.endsWith(".xapk", ignoreCase = true)) "xapk" else "apk"
        val cacheDir = File(context.cacheDir, "apk_downloads").also { it.mkdirs() }
        val destFile = File(cacheDir, "${app.packageName}_${app.version}.$ext")

        val conn = URL(downloadUrl).openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 120_000
        conn.connect()

        if (conn.responseCode != HttpURLConnection.HTTP_OK) {
            throw Exception("HTTP ${conn.responseCode} downloading file")
        }

        val contentLength = conn.contentLengthLong
        var bytesRead = 0L
        var lastReported = -1

        conn.inputStream.use { input ->
            FileOutputStream(destFile).use { output ->
                val buffer = ByteArray(8192)
                var n: Int
                while (input.read(buffer).also { n = it } != -1) {
                    output.write(buffer, 0, n)
                    bytesRead += n
                    if (contentLength > 0) {
                        val pct = (bytesRead * 100 / contentLength).toInt()
                        if (pct != lastReported) {
                            lastReported = pct
                            InstallProgressTracker.updateDownload(app.packageName, pct)
                        }
                    }
                }
            }
        }

        Log.d(TAG, "Downloaded to ${destFile.absolutePath} (${destFile.length()} bytes)")
        return destFile
    }

    // ─── XAPK support ──────────────────────────────────────────────────────────

    /**
     * Extracts the .xapk (ZIP) and returns the list of .apk files inside.
     * Also copies any .obb files to the correct location on external storage.
     */
    private fun extractXapk(xapkFile: File, packageName: String): List<File> {
        val extractDir = File(context.cacheDir, "xapk_extract/${packageName}").also {
            it.deleteRecursively()
            it.mkdirs()
        }

        val apkFiles = mutableListOf<File>()

        ZipFile(xapkFile).use { zip ->
            val entries = zip.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                val name = entry.name

                when {
                    name.endsWith(".apk", ignoreCase = true) && !name.contains("/") -> {
                        val dest = File(extractDir, name)
                        zip.getInputStream(entry).use { input ->
                            FileOutputStream(dest).use { output -> input.copyTo(output) }
                        }
                        apkFiles.add(dest)
                        Log.d(TAG, "Extracted APK: $name (${dest.length()} bytes)")
                    }
                    name.endsWith(".obb", ignoreCase = true) -> {
                        copyObbFile(zip, entry, packageName, name)
                    }
                    // manifest.json and icons are ignored
                }
            }
        }

        if (apkFiles.isEmpty()) throw Exception("No APK files found inside XAPK for $packageName")

        // Put base.apk first, splits after
        apkFiles.sortWith(compareBy { if (it.name == "base.apk") 0 else 1 })
        return apkFiles
    }

    private fun copyObbFile(zip: ZipFile, entry: java.util.zip.ZipEntry, packageName: String, entryName: String) {
        val obbDir = File(context.getExternalFilesDir(null)
            ?.parentFile?.parentFile, "Android/obb/$packageName").also { it.mkdirs() }
        val obbFile = File(obbDir, File(entryName).name)
        zip.getInputStream(entry).use { input ->
            FileOutputStream(obbFile).use { output -> input.copyTo(output) }
        }
        Log.i(TAG, "OBB copied to ${obbFile.absolutePath}")
    }

    /** Silent multi-APK install for XAPK (Device Owner only). */
    private fun silentInstallXapk(xapkFile: File, packageName: String) {
        val apkFiles = extractXapk(xapkFile, packageName)
        Log.i(TAG, "XAPK: installing ${apkFiles.size} APK(s) for $packageName")

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }

        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            for (apk in apkFiles) {
                apk.inputStream().use { input ->
                    session.openWrite(apk.name, 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                Log.d(TAG, "Written to session: ${apk.name}")
            }

            val intent = Intent("android.intent.action.MAIN").apply {
                setPackage(context.packageName)
            }
            val piFlags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
            } else {
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = android.app.PendingIntent.getBroadcast(context, sessionId, intent, piFlags)
            PackageInstalledReceiver.addPending(context, packageName)
            session.commit(pendingIntent.intentSender)
        }

        Log.i(TAG, "XAPK silent install committed for $packageName (sessionId=$sessionId)")
    }

    /** Fallback XAPK install dialog — extracts base.apk and opens it. */
    private fun triggerInstallDialogXapk(xapkFile: File, packageName: String) {
        val apkFiles = extractXapk(xapkFile, packageName)
        val baseApk = apkFiles.first()
        Log.i(TAG, "XAPK fallback: showing install dialog for base APK of $packageName")
        triggerInstallDialog(baseApk, packageName)
    }

    // ─── Single APK helpers ────────────────────────────────────────────────────

    /** Silent install via PackageInstaller — works only when app is Device Owner. */
    private fun silentInstall(apkFile: File, packageName: String) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }

        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)

        session.use { s ->
            apkFile.inputStream().use { input ->
                s.openWrite(packageName, 0, apkFile.length()).use { output ->
                    input.copyTo(output)
                    s.fsync(output)
                }
            }

            val intent = Intent(PackageInstalledReceiver.ACTION_INSTALL_STATUS).apply {
                setPackage(context.packageName)
            }
            val piFlags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
            } else {
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = android.app.PendingIntent.getBroadcast(context, sessionId, intent, piFlags)
            PackageInstalledReceiver.addPending(context, packageName)
            s.commit(pendingIntent.intentSender)
        }

        Log.i(TAG, "Silent install committed for $packageName (sessionId=$sessionId)")
    }

    /** Fallback: show install dialog when not Device Owner. */
    private fun triggerInstallDialog(apkFile: File, packageName: String) {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile,
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        context.startActivity(intent)
        Log.i(TAG, "Install dialog triggered for $packageName")
    }
}

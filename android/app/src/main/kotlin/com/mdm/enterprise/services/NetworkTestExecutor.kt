package com.mdm.enterprise.services

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import com.mdm.enterprise.api.MdmApi
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.ReportProgressRequest
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class NetworkTestExecutor(private val context: Context) {

    companion object {
        private const val TAG = "NetworkTestExec"
    }

    private val prefs = SecurePreferences.getInstance(context)

    // Separate OkHttpClient for speed tests (longer read timeout)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Suppress("DEPRECATION")
    suspend fun execute(commandId: String): Map<String, Any?> {
        val deviceToken = prefs.getStr("device_token") ?: throw Exception("Device not enrolled")
        val api = MdmApiClient.getInstance(context)

        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        // 1. Connected network
        reportProgress(api, deviceToken, commandId, 15, "Lendo rede conectada...")
        delay(500L)
        val connectedNetwork = getConnectedNetwork(wm)

        // 2. Nearby networks scan
        reportProgress(api, deviceToken, commandId, 35, "Escaneando redes próximas...")
        delay(500L)
        val nearbyNetworks = scanNearbyNetworks(wm)

        // 3. Download speed via fast.com
        reportProgress(api, deviceToken, commandId, 55, "Medindo velocidade de download (fast.com)...")
        val downloadMbps = measureDownloadSpeedMbps()

        // 4. Done
        reportProgress(api, deviceToken, commandId, 90, "Consolidando resultados...")
        delay(300L)

        val speedStr = if (downloadMbps > 0)
            "${"%.1f".format(downloadMbps)} Mbps"
        else
            "Indisponível"

        val msg = buildString {
            if (connectedNetwork != null) append("Conectado: ${connectedNetwork["ssid"]}. ")
            append("${nearbyNetworks.size} redes próximas. ")
            append("Download: $speedStr.")
        }

        return mapOf(
            "progress"         to 100,
            "message"          to msg,
            "connectedNetwork" to connectedNetwork,
            "wifiNetworks"     to nearbyNetworks,
            "downloadMbps"     to if (downloadMbps > 0) downloadMbps else null,
            "downloadSpeed"    to speedStr,
        )
    }

    // ── fast.com speed measurement ────────────────────────────────────────────

    private suspend fun measureDownloadSpeedMbps(): Double = withContext(Dispatchers.IO) {
        try {
            // 1. Fetch fast.com homepage to find the app JS bundle URL
            val homeHtml = get("https://fast.com/") ?: return@withContext -1.0

            val jsPath = Regex("""src="(/app[^"]+\.js)"""")
                .find(homeHtml)?.groupValues?.get(1)
                ?: return@withContext -1.0

            // 2. Fetch JS bundle and extract the API token
            val jsContent = get("https://fast.com$jsPath") ?: return@withContext -1.0

            val token = Regex("""token:"([^"]+)"""")
                .find(jsContent)?.groupValues?.get(1)
                ?: return@withContext -1.0

            Log.d(TAG, "fast.com token extracted OK")

            // 3. Call fast.com API to get test download URLs
            val apiUrl = "https://api.fast.com/netflix/speedtest/v2?https=true&token=$token&urlCount=3"
            val apiResp = get(apiUrl) ?: return@withContext -1.0

            val testUrls = Regex(""""url":"([^"]+)"""")
                .findAll(apiResp)
                .map { it.groupValues[1] }
                .toList()

            if (testUrls.isEmpty()) {
                Log.w(TAG, "fast.com: no test URLs returned")
                return@withContext -1.0
            }

            // 4. Stream download for up to 8 seconds, measure throughput
            val testUrl = testUrls[0]
            Log.d(TAG, "Measuring against: $testUrl")

            val startMs  = System.currentTimeMillis()
            val stopAtMs = startMs + 8_000L
            var totalBytes = 0L

            val resp   = httpClient.newCall(Request.Builder().url(testUrl).build()).execute()
            val stream = resp.body?.byteStream()
            val buf    = ByteArray(65_536)

            stream?.use {
                while (System.currentTimeMillis() < stopAtMs) {
                    val read = it.read(buf)
                    if (read == -1) break
                    totalBytes += read
                }
            }

            val elapsedSec = (System.currentTimeMillis() - startMs) / 1_000.0
            if (elapsedSec < 0.5 || totalBytes == 0L) return@withContext -1.0

            // bytes → Mbps  (bits per second / 1_000_000)
            val mbps = (totalBytes * 8.0) / (elapsedSec * 1_000_000.0)
            Log.d(TAG, "Download: ${"%.2f".format(mbps)} Mbps ($totalBytes bytes in ${elapsedSec}s)")
            mbps

        } catch (e: Exception) {
            Log.w(TAG, "Speed test failed: ${e.message}")
            -1.0
        }
    }

    private fun get(url: String): String? = try {
        httpClient.newCall(Request.Builder().url(url).build())
            .execute().body?.string()
    } catch (e: Exception) {
        Log.w(TAG, "GET $url failed: ${e.message}")
        null
    }

    // ── WiFi helpers ─────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun getConnectedNetwork(wm: WifiManager): Map<String, Any>? {
        val info = wm.connectionInfo ?: return null
        val rawSsid = info.ssid?.removePrefix("\"")?.removeSuffix("\"") ?: ""
        val ssid = if (rawSsid.isBlank() || rawSsid == "<unknown ssid>") "Desconhecida" else rawSsid
        val dbm  = info.rssi
        if (dbm == 0 || dbm < -120) return null
        val bars = WifiManager.calculateSignalLevel(dbm, 4) + 1
        val freq = info.frequency
        return mapOf(
            "ssid"      to ssid,
            "bssid"     to (info.bssid ?: ""),
            "rssi"      to dbm,
            "bars"      to bars,
            "frequency" to freq,
            "channel"   to frequencyToChannel(freq),
            "linkSpeed" to info.linkSpeed,
            "ipAddress" to intToIp(info.ipAddress),
        )
    }

    @Suppress("DEPRECATION")
    private fun scanNearbyNetworks(wm: WifiManager): List<Map<String, Any>> {
        val results = wm.scanResults ?: return emptyList()
        return results
            .sortedByDescending { it.level }
            .take(20)
            .map { r ->
                val dbm  = r.level
                val bars = WifiManager.calculateSignalLevel(dbm, 4) + 1
                mapOf(
                    "ssid"      to (r.SSID.takeIf { it.isNotBlank() } ?: "<hidden>"),
                    "bssid"     to r.BSSID,
                    "rssi"      to dbm,
                    "bars"      to bars,
                    "frequency" to r.frequency,
                    "channel"   to frequencyToChannel(r.frequency),
                    "security"  to securityString(r.capabilities),
                )
            }
    }

    private fun frequencyToChannel(freq: Int): Int = when {
        freq in 2412..2484 -> (freq - 2412) / 5 + 1
        freq in 5170..5825 -> (freq - 5170) / 5 + 34
        else               -> 0
    }

    private fun securityString(caps: String): String = when {
        caps.contains("WPA3") -> "WPA3"
        caps.contains("WPA2") -> "WPA2"
        caps.contains("WPA")  -> "WPA"
        caps.contains("WEP")  -> "WEP"
        caps.isEmpty() || caps == "[ESS]" -> "Open"
        else                  -> "Other"
    }

    private fun intToIp(ip: Int): String =
        "${ip and 0xFF}.${(ip shr 8) and 0xFF}.${(ip shr 16) and 0xFF}.${(ip shr 24) and 0xFF}"

    private suspend fun reportProgress(api: MdmApi, token: String, commandId: String, pct: Int, msg: String) {
        Log.d(TAG, "Progress $pct%: $msg")
        try { api.reportProgress(token, commandId, ReportProgressRequest(pct, msg)) }
        catch (e: Exception) { Log.w(TAG, "reportProgress: ${e.message}") }
    }
}

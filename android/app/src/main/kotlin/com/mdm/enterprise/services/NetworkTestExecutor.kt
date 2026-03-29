package com.mdm.enterprise.services

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import com.mdm.enterprise.api.MdmApi
import com.mdm.enterprise.api.MdmApiClient
import com.mdm.enterprise.api.models.ReportProgressRequest
import com.mdm.enterprise.utils.SecurePreferences
import com.mdm.enterprise.utils.getStr
import kotlinx.coroutines.delay

class NetworkTestExecutor(private val context: Context) {

    companion object {
        private const val TAG = "NetworkTestExec"
    }

    private val prefs = SecurePreferences.getInstance(context)

    @Suppress("DEPRECATION")
    suspend fun execute(commandId: String): Map<String, Any?> {
        val deviceToken = prefs.getStr("device_token") ?: throw Exception("Device not enrolled")
        val api = MdmApiClient.getInstance(context)

        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        // 1. Connected network
        reportProgress(api, deviceToken, commandId, 20, "Lendo rede conectada...")
        delay(500L)
        val connectedNetwork = getConnectedNetwork(wm)

        // 2. Nearby networks scan
        reportProgress(api, deviceToken, commandId, 50, "Escaneando redes próximas...")
        delay(500L)
        val nearbyNetworks = scanNearbyNetworks(wm)

        // 3. Done
        reportProgress(api, deviceToken, commandId, 90, "Consolidando resultados...")
        delay(300L)

        val msg = buildString {
            if (connectedNetwork != null) append("Conectado: ${connectedNetwork["ssid"]}. ")
            append("${nearbyNetworks.size} redes próximas encontradas.")
        }

        return mapOf(
            "progress"         to 100,
            "message"          to msg,
            "connectedNetwork" to connectedNetwork,
            "wifiNetworks"     to nearbyNetworks,
        )
    }

    @Suppress("DEPRECATION")
    private fun getConnectedNetwork(wm: WifiManager): Map<String, Any>? {
        val info = wm.connectionInfo ?: return null
        val rawSsid = info.ssid?.removePrefix("\"")?.removeSuffix("\"") ?: ""
        val ssid = if (rawSsid.isBlank() || rawSsid == "<unknown ssid>") "Desconhecida" else rawSsid
        val dbm  = info.rssi
        if (dbm == 0 || dbm < -120) return null  // bogus RSSI = truly disconnected
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

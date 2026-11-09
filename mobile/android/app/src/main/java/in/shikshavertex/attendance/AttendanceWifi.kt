package `in`.shikshavertex.attendance

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.SupplicantState
import android.net.wifi.WifiManager
import android.net.wifi.WifiInfo
import android.os.Build
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/** Reads only the currently connected network. Does not scan or know its password. */
object AttendanceWifi {
    private val connectedInfo = ConcurrentHashMap<Network, WifiInfo>()
    private var observer: ConnectivityManager.NetworkCallback? = null
    private var observingManager: ConnectivityManager? = null

    // Android 12+ redacts office connection identifiers unless location-sensitive callback
    // data is explicitly requested and precise-location access is granted.
    fun startObserving(context: Context) {
        if (Build.VERSION.SDK_INT < 31 || observer != null || !LocationAccess.precisePermission(context)) return
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                val info = capabilities.transportInfo as? WifiInfo
                if (info != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) connectedInfo[network] = info
                else connectedInfo.remove(network)
            }
            override fun onLost(network: Network) { connectedInfo.remove(network) }
        }
        try { manager.registerDefaultNetworkCallback(callback); observer = callback; observingManager = manager }
        catch (_: SecurityException) { connectedInfo.clear() }
    }
    fun stopObserving() {
        observer?.let { runCatching { observingManager?.unregisterNetworkCallback(it) } }
        observer = null; observingManager = null; connectedInfo.clear()
    }
    data class Connection(val network: Network, val ssid: String, val bssid: String?, val observedAt: Long) {
        fun observation(): JSONObject = JSONObject().put("transport", "wifi").put("ssid", ssid).put("observedAt", observedAt)
            .also { if (bssid != null) it.put("bssid", bssid) }
    }
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    fun requireConnected(context: Context): Connection {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val network = connectivity.activeNetwork ?: throw IllegalStateException(WifiRule.rejection(null, false, false))
        val capabilities = connectivity.getNetworkCapabilities(network)
        val wifiTransport = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == false
        if (!wifiTransport) throw IllegalStateException(WifiRule.rejection(null, false, false))
        if (!LocationAccess.precisePermission(context)) throw SecurityException("Allow precise location so Android can confirm the office connection.")
        val manager = context.applicationContext.getSystemService(WifiManager::class.java)
        val info = connectedInfo[network]?.takeIf { WifiRule.normalizeSsid(it.ssid) != null } ?: manager.connectionInfo
        val rejection = WifiRule.rejection(info?.ssid, true, info?.supplicantState == SupplicantState.COMPLETED && info.networkId != -1)
        if (rejection != null) throw IllegalStateException(rejection)
        if (connectivity.activeNetwork != network) throw IllegalStateException("The network changed. Reconnect to ${WifiRule.REQUIRED_SSID} and try again.")
        val bssid = info.bssid?.takeIf { Regex("(?i)(?:[0-9a-f]{2}:){5}[0-9a-f]{2}").matches(it) && it != "02:00:00:00:00:00" && it != "00:00:00:00:00:00" }
        return Connection(network, WifiRule.normalizeSsid(info.ssid)!!, bssid, System.currentTimeMillis())
    }
}

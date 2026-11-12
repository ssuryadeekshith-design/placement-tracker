package `in`.shikshavertex.attendance

/** Pure matching logic. No office connection credentials are stored or used by this app. */
object WifiRule {
    const val REQUIRED_SSID = "Shikshavertex_5G"
    fun normalizeSsid(raw: String?): String? {
        if (raw == null || raw.isEmpty() || raw == "<unknown ssid>") return null
        val value = if (raw.length >= 2 && raw.first() == '"' && raw.last() == '"') raw.substring(1, raw.length - 1) else raw
        return value.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
    }
    fun rejection(rawSsid: String?, activeWifi: Boolean, associated: Boolean): String? {
        if (!activeWifi) return "The phone's active connection is not a direct office connection. Select $REQUIRED_SSID and check mobile-data switching or VPN settings. Attendance already saved remains recorded."
        val ssid = normalizeSsid(rawSsid) ?: return "A wireless connection is active, but Android has not provided its name. Office connection is not confirmed. Keep precise location and Location services enabled, then refresh office readiness."
        if (!associated) return "Android has not confirmed an active connection to $REQUIRED_SSID yet. Wait a moment, then refresh office readiness."
        if (ssid != REQUIRED_SSID) return "Connect to $REQUIRED_SSID in Android network settings before marking attendance."
        return null
    }
}

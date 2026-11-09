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
        if (!activeWifi || !associated) return "Connect this phone to $REQUIRED_SSID at the office before marking attendance. Mobile data and VPN connections do not qualify."
        val ssid = normalizeSsid(rawSsid) ?: return "Android could not confirm the office connection. Enable precise location and Location services, then reconnect to $REQUIRED_SSID."
        if (ssid != REQUIRED_SSID) return "Connect to $REQUIRED_SSID in Android network settings before marking attendance."
        return null
    }
}

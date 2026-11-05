package `in`.shikshavertex.attendance

/** Pure matching logic. No Wi-Fi credentials are stored or used by this app. */
object WifiRule {
    const val REQUIRED_SSID = "Shikshavertex_5G"
    fun normalizeSsid(raw: String?): String? {
        if (raw == null || raw.isEmpty() || raw == "<unknown ssid>") return null
        val value = if (raw.length >= 2 && raw.first() == '"' && raw.last() == '"') raw.substring(1, raw.length - 1) else raw
        return value.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
    }
    fun rejection(rawSsid: String?, activeWifi: Boolean, associated: Boolean): String? {
        if (!activeWifi || !associated) return "Connect this phone to Wi-Fi $REQUIRED_SSID and use it as the active Internet connection. Mobile data, VPN and disconnected Wi-Fi cannot mark attendance."
        val ssid = normalizeSsid(rawSsid) ?: return "Android could not read the connected Wi-Fi name. Enable precise location and Location services, then reconnect to $REQUIRED_SSID."
        if (ssid != REQUIRED_SSID) return "Attendance requires Wi-Fi $REQUIRED_SSID. Open Android Wi-Fi settings and connect to that network."
        return null
    }
}

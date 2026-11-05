package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class WifiRuleTest {
    @Test fun onlyExactConnectedWifiNameMatches() {
        assertNull(WifiRule.rejection("Shikshavertex_5G", true, true))
        assertNull(WifiRule.rejection("\"Shikshavertex_5G\"", true, true))
        for (ssid in listOf("Shikshavertex", "Shikshavertex_2G", "shikshavertex_5g", "Shikshavertex_5G ", "Guest", "<unknown ssid>", null)) {
            assertNotNull(WifiRule.rejection(ssid, true, true))
        }
    }
    @Test fun savedNetworkOrMobileConnectionCannotPretendToBeConnectedWifi() {
        assertNotNull(WifiRule.rejection("Shikshavertex_5G", false, true))
        assertNotNull(WifiRule.rejection("Shikshavertex_5G", true, false))
        assertNotNull(WifiRule.rejection("Shikshavertex_5G", false, false))
    }
    @Test fun redactedOrEmptyNetworkNameDoesNotUnlockCheckin() {
        for (ssid in listOf("", "\"\"", "<unknown ssid>", "\"<unknown ssid>\"")) assertNull(WifiRule.normalizeSsid(ssid))
        assertEquals("SSID with spaces", WifiRule.normalizeSsid("\"SSID with spaces\""))
    }
}

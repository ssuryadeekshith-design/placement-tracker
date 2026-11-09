package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class EmployeePresentationTest {
    private val today = "2026-11-09"
    private fun model() = EmployeeDashboardModel(
        employeeName = "Alex Example", email = "alex@example.com", department = "Operations", team = "Campus",
        venue = "Sample venue", onsite = false, requiresRoomCode = true, passkeyRegistered = true,
        passkeyConfigured = true, events = listOf(DashboardSession("daily", "Daily attendance", today)),
        receipts = emptyMap(), gpsStatus = "Not required", wifiStatus = "Not required", trackingStatus = "Off",
        canViewAll = false, isHr = false, loadedDate = today)
    private fun gate(model: EmployeeDashboardModel, session: String? = "daily", consent: Boolean = true, code: String = "") =
        EmployeePresentation.checkInGate(model, session, consent, code, today = today)

    @Test fun setupModeStillRequiresAPasskeyAndStatementWithoutCollectingLocation() {
        assertEquals(CheckInGate.READY, gate(model()))
        assertEquals(CheckInGate.STATEMENT_REQUIRED, gate(model(), consent = false))
        assertEquals(CheckInGate.PASSKEY_SETUP, gate(model().copy(passkeyConfigured = false)))
        assertEquals(CheckInGate.PASSKEY_ENROLLMENT, gate(model().copy(passkeyRegistered = false)))
    }

    @Test fun failedRefreshAndDateRolloverBlockNewCheckIns() {
        assertEquals(CheckInGate.REFRESH_REQUIRED, gate(model().copy(refreshRequired = true)))
        assertEquals(CheckInGate.REFRESH_REQUIRED, gate(model().copy(loadedDate = "2026-11-08")))
        assertEquals(CheckInGate.REFRESH_REQUIRED, gate(model().copy(events = listOf(DashboardSession("daily", "Yesterday", "2026-11-08")))))
    }

    @Test fun emptyMissingAndClosedSessionsNeverPermitSubmission() {
        assertEquals(CheckInGate.NO_SESSIONS, gate(model().copy(events = emptyList())))
        assertEquals(CheckInGate.NO_SELECTION, gate(model(), session = null))
        assertEquals(CheckInGate.NO_SELECTION, gate(model(), session = "missing"))
        assertEquals(CheckInGate.SESSION_CLOSED, gate(model().copy(events = listOf(DashboardSession("daily", "Closed", today, false)))))
    }

    @Test fun onsiteNeedsLocationWifiAndAnAsciiSixDigitCodeWhenRequired() {
        val onsite = model().copy(onsite = true)
        assertEquals(CheckInGate.GPS_REQUIRED, gate(onsite, code = "123456"))
        assertEquals(CheckInGate.WIFI_REQUIRED, gate(onsite.copy(gpsStatus = "Confirmed now"), code = "123456"))
        val ready = onsite.copy(gpsStatus = "Confirmed now", wifiStatus = "Connected now")
        for (code in listOf("", "12345", "1234567", "１２３４５６", "12A456")) assertEquals(CheckInGate.ROOM_CODE_REQUIRED, gate(ready, code = code))
        assertEquals(CheckInGate.READY, gate(ready, code = "123456"))
        assertEquals(CheckInGate.READY, gate(ready.copy(requiresRoomCode = false)))
    }

    @Test fun aRecordedClosedSessionKeepsItsReceiptWhenRefreshIsUnavailable() {
        val receipt = DashboardReceipt("2026-11-09T05:14:00Z", "setup", phoneVerified = true)
        val fallback = model().copy(refreshRequired = true, receipts = mapOf("daily" to receipt),
            events = listOf(DashboardSession("daily", "Daily attendance", today, false), DashboardSession("other", "Another session", today)))
        assertEquals(CheckInGate.RECORDED, gate(fallback, consent = false))
        assertEquals(receipt.timestamp, fallback.receipts["daily"]!!.timestamp)
        assertEquals(CheckInGate.REFRESH_REQUIRED, gate(fallback, session = "other"))
    }

    @Test fun keepsOwnOriginalReceiptEvenForAnAlreadyClosedSession() {
        val first = ReceiptRecord("self", "closed-today", "2026-11-08T05:00:00Z", "setup", true, false)
        val repeated = first.copy(timestamp = "2026-11-08T06:00:00Z", mode = "onsite", venueWifiObserved = true)
        val map = EmployeePresentation.receipts("self", setOf("closed-today"), listOf(repeated, first, first.copy(uid = "other", timestamp = "2026-11-08T04:00:00Z"), first.copy(eventId = "yesterday")))
        assertEquals(1, map.size)
        assertEquals(first.timestamp, map["closed-today"]!!.timestamp)
        assertEquals("setup", map["closed-today"]!!.mode)
        assertTrue(map["closed-today"]!!.phoneVerified)
        assertFalse(map["closed-today"]!!.venueWifiObserved)
    }
    @Test fun invalidTimeNeverFabricatesATimeOrAllowsAnotherCheckIn() {
        val record = ReceiptRecord("self", "today", "invalid", "legacy", false, false)
        val receipt = EmployeePresentation.receipts("self", setOf("today"), listOf(record))["today"]!!
        assertEquals("invalid", receipt.timestamp)
        assertFalse(receipt.phoneVerified)
    }
}

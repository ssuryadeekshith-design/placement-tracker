package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class EmployeePresentationTest {
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

package `in`.shikshavertex.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class WorkdayTest {
    private fun at(utc: String) = Instant.parse(utc).toEpochMilli()
    @Test fun indiaTimeWindowIsInclusiveAt1030AndExclusiveAt2030() {
        assertFalse(Workday.contains(at("2026-11-04T04:59:59Z")))
        assertTrue(Workday.contains(at("2026-11-04T05:00:00Z")))
        assertTrue(Workday.contains(at("2026-11-04T14:59:59Z")))
        assertFalse(Workday.contains(at("2026-11-04T15:00:00Z")))
        assertFalse(Workday.contains(at("2026-11-04T23:00:00Z")))
    }
    @Test fun indiaDateIsIndependentOfPhoneTimezone() {
        assertEquals("2026-11-05", Workday.date(at("2026-11-04T20:00:00Z")))
    }
}

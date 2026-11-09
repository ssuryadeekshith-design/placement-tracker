package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class ViewerPresentationTest {
    @Test fun unknownOrContradictoryRowStatesNeverBecomeNotMarkedYet() {
        assertTrue(ViewerPresentation.validRowState("not-marked", 0))
        assertTrue(ViewerPresentation.validRowState("marked", 1))
        for (status in listOf(null, "", "absent", "unknown")) assertFalse(ViewerPresentation.validRowState(status, 0))
        assertFalse(ViewerPresentation.validRowState("marked", 0))
        assertFalse(ViewerPresentation.validRowState("not-marked", 1))
        assertFalse(ViewerPresentation.validRowState("not-marked", null))
    }
    @Test fun unavailableTimestampsDoNotGetAnInventedTimeZoneSuffix() {
        assertEquals("Time unavailable", ViewerPresentation.checkInTime("invalid"))
        assertEquals("10:30:00 AM IST", ViewerPresentation.checkInTime("2026-11-08T05:00:00Z"))
    }
    private val setup = ViewerCheckIn("Morning", "2026-11-08T05:00:00Z", "self", "setup", false)
    private val employee = ViewerEmployee("Surya Deekshith", "surya_deekshith@shikshavertex.in", "Business Operations", "Bops", true, listOf(setup))

    @Test fun searchCombinesIdentityDepartmentAndStatusWithoutAssumingAbsence() {
        assertTrue(ViewerPresentation.matches(employee, query = " SURYA ", department = "Business Operations", status = ViewerStatusFilter.MARKED))
        assertTrue(ViewerPresentation.matches(employee, query = "bops"))
        assertFalse(ViewerPresentation.matches(employee, team = "Sales"))
        assertFalse(ViewerPresentation.matches(employee, status = ViewerStatusFilter.NOT_MARKED))
        val unmarked = employee.copy(marked = false, checkIns = emptyList())
        assertTrue(ViewerPresentation.matches(unmarked, status = ViewerStatusFilter.NOT_MARKED))
        assertFalse(ViewerPresentation.matches(unmarked, mode = ViewerModeFilter.SETUP))
    }

    @Test fun overridesAreDistinctFromActualOnsiteCheckEvidence() {
        val override = setup.copy(mode = "onsite", method = "committee", locationChecked = false)
        assertTrue(ViewerPresentation.matchesMode(override, ViewerModeFilter.OVERRIDE))
        assertFalse(ViewerPresentation.matchesMode(override, ViewerModeFilter.ONSITE))
        assertFalse(ViewerPresentation.evidence(override).contains("check recorded"))
        val onsite = setup.copy(mode = "onsite", locationChecked = true)
        assertEquals("Onsite location check recorded", ViewerPresentation.evidence(onsite))
        assertTrue(ViewerPresentation.evidence(onsite.copy(locationChecked = false)).contains("not verified"))
        assertTrue(ViewerPresentation.evidence(setup).contains("not verified"))
    }

    @Test fun modeFiltersMatchAnySessionAndDoNotInventMissingVerification() {
        val legacy = setup.copy(mode = "legacy")
        val mixed = employee.copy(checkIns = listOf(setup, legacy))
        assertTrue(ViewerPresentation.matches(mixed, mode = ViewerModeFilter.LEGACY))
        assertTrue(ViewerPresentation.matches(mixed, mode = ViewerModeFilter.SETUP))
        assertFalse(ViewerPresentation.matches(mixed, mode = ViewerModeFilter.ONSITE))
        assertEquals("Legacy record · verification unavailable", ViewerPresentation.evidence(legacy))
    }

    @Test fun timestampsAreIndiaTimeAndInvalidValuesStayUnavailable() {
        assertEquals("10:30:00 AM", ViewerPresentation.time("2026-11-08T05:00:00Z"))
        assertEquals("8 Nov, 10:30 AM IST", ViewerPresentation.refreshed("2026-11-08T05:00:00Z"))
        assertEquals("Time unavailable", ViewerPresentation.time("invalid"))
    }

    @Test fun initialsHandleLinkedAndUnlinkedNames() {
        assertEquals("SD", ViewerPresentation.initials(employee))
        assertEquals("SD", ViewerPresentation.initials(employee.copy(name = "")))
        assertEquals("?", ViewerPresentation.initials(employee.copy(name = "", email = "")))
    }
}

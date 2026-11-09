package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class AttendancePolicyTest {
    @Test fun retiredSetupFlagsCannotDisableAttendanceChecks() {
        assertTrue(AttendancePolicy.fromFlags("setup", false, false, false, false).onsiteRequired)
    }
    @Test fun missingOrInconsistentPolicyKeepsVenueChecks() {
        assertTrue(AttendancePolicy().onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags(null, null, null, null, null).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("setup", false, false, null, false).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("setup", true, false, false, false).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("setup", false, true, false, false).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("setup", false, false, true, false).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("setup", false, false, false, true).onsiteRequired)
    }
    @Test fun onsitePolicyRestoresVenueChecks() {
        assertTrue(AttendancePolicy.fromFlags("onsite", true, true, true, true).onsiteRequired)
        assertTrue(AttendancePolicy.fromFlags("onsite", false, false, false, false).onsiteRequired)
    }
}

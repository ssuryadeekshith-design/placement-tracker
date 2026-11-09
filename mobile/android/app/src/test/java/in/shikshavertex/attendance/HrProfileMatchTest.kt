package `in`.shikshavertex.attendance
import org.junit.Assert.*
import org.junit.Test

class HrProfileMatchTest {
    @Test fun activeUnlinkedAndSameIdentityProfilesAreEligible() {
        assertTrue(HrProfileMatch.eligible(true, "SV001", null, null, "applicant", "alex@example.com"))
        assertTrue(HrProfileMatch.eligible(true, "SV001", "applicant", "alex@example.com", "applicant", "alex@example.com"))
    }
    @Test fun mismatchedInactiveOrMalformedProfilesAreBlocked() {
        assertFalse(HrProfileMatch.eligible(false, "SV001", null, null, "applicant", "alex@example.com"))
        assertFalse(HrProfileMatch.eligible(true, "SV001", "someone-else", null, "applicant", "alex@example.com"))
        assertFalse(HrProfileMatch.eligible(true, "SV001", null, "another@example.com", "applicant", "alex@example.com"))
        assertFalse(HrProfileMatch.eligible(true, "bad", null, null, "applicant", "alex@example.com"))
        assertFalse(HrProfileMatch.eligible(true, "SV001", null, null, "", "alex@example.com"))
    }
    @Test fun sessionActionExpressesTheLoadedIntentRatherThanInvertingAnotherAdminsLatestChange() {
        val intendedOpen = HrProfileMatch.desiredSessionState(false)
        val anotherAdminOpened = true
        assertTrue(intendedOpen)
        assertEquals(anotherAdminOpened, intendedOpen)
        assertFalse(HrProfileMatch.desiredSessionState(true))
    }
}

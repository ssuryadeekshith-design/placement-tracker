package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class AttendanceFeedbackTest {
    private val now=1800000000000L
    private val venue=VenueGate.Venue()
    private fun fix(offset: Double=0.0,accuracy: Double=5.0,age: Long=0L,mocked: Boolean=false)=
        VenueGate.Fix(venue.latitude+offset,venue.longitude,accuracy,now-age,age,mocked)

    @Test fun onlyAnUnambiguouslyOutsidePositionUsesTheExactOutsideAlert() {
        val outside=VenueGate.evaluate(fix(offset=.002),venue,now)
        assertFalse(outside.allowed); assertTrue(outside.outside)
        val edge=VenueGate.evaluate(fix(offset=.00072,accuracy=30.0),venue,now)
        assertFalse(edge.allowed); assertFalse(edge.outside)
        for(point in listOf(null,fix(age=15001),fix(accuracy=60.0),fix(mocked=true),fix(offset=.002,mocked=true))) {
            assertFalse(VenueGate.evaluate(point,venue,now).outside)
        }
    }
    @Test fun unavailableOrWrongConnectionNeverPretendsToProveAnOutsideLocation() {
        val exact="You are not at the office, so attendance will not be marked."
        for(kind in AttendanceFailureKind.values()) {
            val message=AttendanceFailure(kind,"unknown","unknown").primary
            assertEquals(kind==AttendanceFailureKind.OUTSIDE,message==exact)
        }
    }
    @Test fun readySignalsExpireAndClockChangesCannotKeepGreenStatus() {
        val gps=ReadinessSignal(ReadinessState.READY,"Inside",now)
        assertEquals(ReadinessState.READY,gps.fresh(now+15000).state)
        assertEquals(ReadinessState.UNKNOWN,gps.fresh(now+15001).state)
        assertEquals(ReadinessState.UNKNOWN,gps.fresh(now-1).state)
        assertEquals(ReadinessState.UNKNOWN,gps.fresh(now+5001,5000).state)
        assertEquals(ReadinessState.UNKNOWN,ReadinessSignal().fresh(now).state)
    }
    @Test fun definiteFailureAlsoExpiresRatherThanHoldingAnOldOutsideStatus() {
        val failed=ReadinessSignal(ReadinessState.FAILED,"Outside",now)
        assertEquals(ReadinessState.UNKNOWN,failed.fresh(now+15001).state)
    }
    @Test fun transitionHasAMinimumButNeverDelaysSlowChecksTwice() {
        assertEquals(1000L,AttendanceFeedback.remainingTransition(0,true))
        assertEquals(650L,AttendanceFeedback.remainingTransition(350,true))
        assertEquals(0L,AttendanceFeedback.remainingTransition(1000,true))
        assertEquals(0L,AttendanceFeedback.remainingTransition(25000,true))
        assertEquals(0L,AttendanceFeedback.remainingTransition(0,false))
    }
    @Test fun successNeedsAnActualMatchingParseableServerReceipt() {
        val timestamp="2026-11-09T05:12:31Z"
        assertTrue(AttendanceFeedback.receiptAccepted(true,"self","self","daily","daily",timestamp))
        assertFalse(AttendanceFeedback.receiptAccepted(false,"self","self","daily","daily",timestamp))
        assertFalse(AttendanceFeedback.receiptAccepted(true,"other","self","daily","daily",timestamp))
        assertFalse(AttendanceFeedback.receiptAccepted(true,"self","self","other","daily",timestamp))
        assertFalse(AttendanceFeedback.receiptAccepted(true,"self","self","daily","daily",""))
        assertFalse(AttendanceFeedback.receiptAccepted(true,"","","daily","daily",timestamp))
    }
    @Test fun verifiedOfficeBadgeRequiresEverySavedEvidenceFlag() {
        val receipt=DashboardReceipt("2026-11-09T05:12:31Z","onsite",phoneVerified=true,venueWifiObserved=true,venueLocationVerified=true)
        assertTrue(AttendanceFeedback.officeVerified(receipt))
        assertFalse(AttendanceFeedback.officeVerified(receipt.copy(mode="setup")))
        assertFalse(AttendanceFeedback.officeVerified(receipt.copy(phoneVerified=false)))
        assertFalse(AttendanceFeedback.officeVerified(receipt.copy(venueWifiObserved=false)))
        assertFalse(AttendanceFeedback.officeVerified(receipt.copy(venueLocationVerified=false)))
    }
    @Test fun anAmbiguousSubmissionRequiresRefreshInsteadOfAnAutomaticRetry() {
        for(status in listOf(null,500,503)) {
            assertEquals(AttendanceFailureKind.UNCONFIRMED,AttendanceFeedback.serviceFailureKind(true,status))
        }
        assertEquals(AttendanceFailureKind.SERVICE,AttendanceFeedback.serviceFailureKind(false,null))
        assertEquals(AttendanceFailureKind.SERVICE,AttendanceFeedback.serviceFailureKind(true,403))
        assertEquals("Refresh attendance",AttendanceFailure(AttendanceFailureKind.UNCONFIRMED,"unknown","unknown").retryLabel)
        assertEquals("Re-verify Office Location",AttendanceFailure(AttendanceFailureKind.OUTSIDE,"outside","connected").retryLabel)
    }
    @Test fun firstReceiptEvidenceAndTimestampSurviveDuplicateRecordsAndOtherEmployees() {
        val first=ReceiptRecord("self","daily","2026-11-09T05:12:31Z","onsite",true,true,true)
        val receipts=EmployeePresentation.receipts("self",setOf("daily"),listOf(
            first.copy(timestamp="2026-11-09T07:00:00Z",venueLocationVerified=false),
            first.copy(uid="someone-else",timestamp="2026-11-09T04:00:00Z"),first))
        assertEquals(first.timestamp,receipts["daily"]!!.timestamp)
        assertTrue(AttendanceFeedback.officeVerified(receipts["daily"]!!))
    }
}

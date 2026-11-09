package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class ApprovalPresentationTest {
    @Test fun onlyAnExplicitNotRequestedResponseOffersARequest() {
        assertEquals(EmployeeApprovalState.REQUEST, ApprovalPresentation.state("not-requested", false))
        for (status in listOf(null, "", "future-status", "approved"))
            assertEquals(EmployeeApprovalState.UNAVAILABLE, ApprovalPresentation.state(status, false))
        assertEquals(EmployeeApprovalState.UNAVAILABLE, ApprovalPresentation.state("not-requested", null))
    }

    @Test fun pendingRejectionAndRecoveryNeverOfferAnotherRequest() {
        assertEquals(EmployeeApprovalState.PENDING, ApprovalPresentation.state("pending", false))
        assertEquals(EmployeeApprovalState.REJECTED, ApprovalPresentation.state("rejected", false))
        assertEquals(EmployeeApprovalState.RECOVERY, ApprovalPresentation.state("access-unavailable", false))
    }

    @Test fun approvalNeedsConsistentExplicitFields() {
        assertEquals(EmployeeApprovalState.APPROVED, ApprovalPresentation.state("approved", true))
        for (status in listOf(null, "pending", "rejected", "not-requested", "access-unavailable"))
            assertEquals(EmployeeApprovalState.UNAVAILABLE, ApprovalPresentation.state(status, true))
    }

    @Test fun nameValidationKeepsUnicodeAndPunctuationAndRejectsBlankOrOverlongInput() {
        assertFalse(ApprovalPresentation.validName("   "))
        assertFalse(ApprovalPresentation.validName(" A "))
        assertTrue(ApprovalPresentation.validName("  R. Sai Divya  "))
        assertTrue(ApprovalPresentation.validName("अनुषा"))
        assertTrue(ApprovalPresentation.validName("A".repeat(120)))
        assertFalse(ApprovalPresentation.validName("A".repeat(121)))
    }
}

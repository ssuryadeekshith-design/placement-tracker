package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class SharingStateTest {
    private val date = "2026-11-09"

    @Test fun consentRequestAloneDoesNotClaimCollectionOrUpload() {
        val store = SharingStateStore()
        val run = store.begin("self", date)!!
        assertEquals(SharingPhase.STARTING, store.current.phase)
        assertFalse(store.current.collecting)
        assertNull(store.current.lastSampleAt)
        assertNull(store.current.lastUploadAt)
        assertNull(store.begin("self", date))
        store.uploaded(run, 2000)
        assertNull(store.current.lastUploadAt)
        assertTrue(store.collectorStarted(run))
        assertEquals(SharingPhase.WAITING, store.current.phase)
        assertTrue(store.current.collecting)
    }

    @Test fun localSampleAndServerUploadAreIndependentEvidence() {
        val store = SharingStateStore(); val run = store.begin("self", date)!!
        store.collectorStarted(run); store.sampled(run, 1000)
        assertEquals(1000L, store.current.lastSampleAt)
        assertNull(store.current.lastUploadAt)
        store.uploaded(run, 2000)
        assertEquals(2000L, store.current.lastUploadAt)
        store.delayed(run, "Uploads delayed")
        store.sampled(run, 3000)
        assertTrue(store.current.collecting)
        assertEquals(SharingPhase.DELAYED, store.current.phase)
        assertEquals(2000L, store.current.lastUploadAt)
        assertEquals(3000L, store.current.lastSampleAt)
    }

    @Test fun stopIsImmediateAndLateCallbacksCannotReviveIt() {
        val store = SharingStateStore(); val run = store.begin("self", date)!!
        store.collectorStarted(run); store.sampled(run, 1000)
        val stop = store.stop("self", "Stopped locally")
        assertFalse(store.current.collecting)
        assertEquals(SharingPhase.STOPPED, store.current.phase)
        store.sampled(run, 9999); store.uploaded(run, 9999); store.delayed(run, "Late callback"); store.collectorStarted(run)
        assertFalse(store.current.collecting)
        assertEquals(1000L, store.current.lastSampleAt)
        assertNull(store.current.lastUploadAt)
        assertEquals(stop, store.current.token)
    }

    @Test fun anUnconfirmedStopBlocksRestartAndAllowsASeparateRetry() {
        val store = SharingStateStore(); store.begin("self", date)
        val stop = store.stop("self", "Stopped")
        assertTrue(store.stopRequestStarted(stop))
        assertFalse(store.stopRequestStarted(stop))
        store.stopUnconfirmed(stop)
        assertFalse(store.current.collecting)
        assertTrue(store.current.stopPending)
        assertFalse(store.current.stopInFlight)
        assertNull(store.begin("self", date))
        assertTrue(store.stopRequestStarted(stop))
        store.stopConfirmed(stop)
        assertFalse(store.current.stopPending)
        assertNotNull(store.begin("self", date))
    }

    @Test fun staleStopOrUploadResponsesCannotChangeANewerRun() {
        val store = SharingStateStore(); val first = store.begin("self", date)!!
        val stop = store.stop("self", "Stopped")
        store.stopConfirmed(stop)
        val next = store.begin("self", date)!!; store.collectorStarted(next)
        store.stopUnconfirmed(stop); store.uploaded(first, 99); store.failed(first, "Old failure")
        assertEquals(next, store.current.token)
        assertTrue(store.current.collecting)
        assertFalse(store.current.stopPending)
        assertNull(store.current.lastUploadAt)
    }

    @Test fun deniedStartupCannotProduceSamplesAndNeedsAnotherExplicitBegin() {
        val store = SharingStateStore(); val run = store.begin("self", date)!!
        store.failed(run, "Permission denied")
        store.sampled(run, 99); store.collectorStarted(run)
        assertEquals(SharingPhase.ERROR, store.current.phase)
        assertFalse(store.current.collecting)
        assertNull(store.current.lastSampleAt)
        assertNotEquals(run, store.begin("self", date))
    }

    @Test fun anotherAccountCannotSeePriorTimesOrServiceMessages() {
        val store = SharingStateStore(); val run = store.begin("other", date)!!
        store.collectorStarted(run); store.sampled(run, 123); store.uploaded(run, 456)
        val projected = store.current.forUser("self")
        assertNull(projected.lastSampleAt); assertNull(projected.lastUploadAt)
        assertFalse(projected.collecting)
        assertEquals("", projected.uid)
        assertNotEquals(store.current.message, projected.message)
    }
}

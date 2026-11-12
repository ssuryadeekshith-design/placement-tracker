package `in`.shikshavertex.attendance

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OfficeConnectionCheckTest {
    @Test fun returningFromPhonePromptWaitsForTheCallbackBeforeOneSubmission() = runBlocking {
        var reads = 0; var pauses = 0; var writes = 0
        val ssid = OfficeConnectionCheck.await(pause = { pauses++ }) {
            reads++
            if (reads < 3) error("Android has not provided the connection name yet")
            "Shikshavertex_5G"
        }
        assertEquals("Shikshavertex_5G", ssid)
        writes++
        assertEquals(3, reads); assertEquals(2, pauses); assertEquals(1, writes)
    }
    @Test fun unknownOrWrongNetworkNeverBecomesASuccessOrAnAttendanceWrite() = runBlocking {
        for (ssid in listOf("<unknown ssid>", "Guest", "Shikshavertex_2G")) {
            var reads = 0; var writes = 0
            try {
                OfficeConnectionCheck.await(attempts = 3, pause = {}) {
                    reads++
                    WifiRule.rejection(ssid, true, true)?.let { error(it) }
                }
                writes++; fail("Must not accept unknown or different network")
            } catch (_: IllegalStateException) { }
            assertEquals(3, reads); assertEquals(0, writes)
        }
    }
    @Test fun permissionFailureAndCancellationAreNeverRetried() = runBlocking {
        for (failure in listOf(SecurityException("Permission denied"), CancellationException("Dashboard left"))) {
            var reads = 0; var pauses = 0
            try {
                OfficeConnectionCheck.await(pause = { pauses++ }) { reads++; throw failure }
                fail("Must propagate")
            } catch (actual: Exception) { assertSame(failure, actual) }
            assertEquals(1, reads); assertEquals(0, pauses)
        }
    }
    @Test fun leavingDuringCallbackWaitStopsFurtherReads() = runBlocking {
        var reads = 0
        val cancelled = CancellationException("Paused")
        try {
            OfficeConnectionCheck.await(pause = { throw cancelled }) { reads++; error("No observation yet") }
            fail("Must cancel")
        } catch (actual: CancellationException) { assertSame(cancelled, actual) }
        assertEquals(1, reads)
    }
    @Test fun aReadyConnectionIsNotArtificiallyDelayed() = runBlocking {
        var pauses = 0
        assertEquals("ready", OfficeConnectionCheck.await(pause = { pauses++ }) { "ready" })
        assertEquals(0, pauses)
    }
}

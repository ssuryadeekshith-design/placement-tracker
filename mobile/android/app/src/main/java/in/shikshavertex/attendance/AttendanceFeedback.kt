package `in`.shikshavertex.attendance

import java.time.Instant

enum class ReadinessState { UNKNOWN, CHECKING, READY, FAILED }
object OfficeReadinessPolicy {
    // Permission allows a local foreground check, never an attendance write or
    // a background sharing session. All four conditions must remain true.
    fun canMonitor(precisePermission: Boolean, attached: Boolean, resumed: Boolean, matchingAccount: Boolean) =
        precisePermission && attached && resumed && matchingAccount
}
data class ReadinessSignal(val state: ReadinessState = ReadinessState.UNKNOWN,
                           val detail: String = "Not checked", val observedAt: Long = 0L) {
    fun fresh(now: Long, maxAge: Long = 15000): ReadinessSignal =
        if (state != ReadinessState.CHECKING && state != ReadinessState.UNKNOWN && now - observedAt !in 0..maxAge)
            ReadinessSignal(detail = "Reading expired; recheck office readiness.") else this
}

enum class AttendanceFailureKind { OUTSIDE, CONNECTION, LOCATION_UNAVAILABLE, SERVICE, UNCONFIRMED }
data class AttendanceFailure(val kind: AttendanceFailureKind, val gps: String, val connection: String,
                             val detail: String = "") {
    val primary: String get() = when (kind) {
        AttendanceFailureKind.OUTSIDE -> "You are not at the office, so attendance will not be marked."
        AttendanceFailureKind.UNCONFIRMED -> "Attendance status could not be confirmed."
        else -> "Attendance could not be marked."
    }
    val retryLabel: String get() = if (kind == AttendanceFailureKind.UNCONFIRMED) "Refresh attendance"
        else "Re-verify Office Location"
}

object AttendanceFeedback {
    const val MIN_VERIFY_MILLIS = 1000L
    fun remainingTransition(elapsed: Long, animations: Boolean): Long =
        if (animations) (MIN_VERIFY_MILLIS - elapsed.coerceAtLeast(0)).coerceAtLeast(0) else 0

    // A local readiness check never constitutes a saved attendance receipt.
    fun receiptAccepted(success: Boolean, uid: String, expectedUid: String, eventId: String,
                        expectedEventId: String, timestamp: String): Boolean = success &&
        uid.isNotBlank() && uid == expectedUid && eventId.isNotBlank() && eventId == expectedEventId &&
        runCatching { Instant.parse(timestamp) }.isSuccess

    fun serviceFailureKind(submitted: Boolean, status: Int?): AttendanceFailureKind =
        if(submitted && (status==null || status>=500)) AttendanceFailureKind.UNCONFIRMED else AttendanceFailureKind.SERVICE

    fun officeVerified(receipt: DashboardReceipt) = receipt.mode == "onsite" && receipt.phoneVerified &&
        receipt.venueLocationVerified && receipt.venueWifiObserved
}

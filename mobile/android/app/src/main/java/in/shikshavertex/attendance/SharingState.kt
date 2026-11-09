package `in`.shikshavertex.attendance

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class SharingPhase { OFF, STARTING, WAITING, ACTIVE, DELAYED, STOPPED, ERROR }

/** Service observations only: no coordinates, biometric data or inferred attendance. */
data class SharingSnapshot(
    val token: Long = 0,
    val uid: String = "",
    val date: String = "",
    val phase: SharingPhase = SharingPhase.OFF,
    val message: String = "Location sharing is off on this phone.",
    val collecting: Boolean = false,
    val lastSampleAt: Long? = null,
    val lastUploadAt: Long? = null,
    val stopPending: Boolean = false,
    val stopInFlight: Boolean = false,
) {
    val canStart: Boolean get() = phase != SharingPhase.STARTING && !collecting && !stopPending
    fun forUser(userUid: String): SharingSnapshot = if (uid.isBlank() || uid == userUid) this
        else SharingSnapshot(message = "No location-sharing status for this signed-in account.")
}

/** Generation guards prevent a late provider, upload or stop response reviving a stopped run. */
class SharingStateStore {
    private val mutable = MutableStateFlow(SharingSnapshot())
    val flow = mutable.asStateFlow()
    val current get() = mutable.value

    fun begin(uid: String, date: String): Long? {
        if (!current.canStart || uid.isBlank()) return null
        val token = current.token + 1
        mutable.value = SharingSnapshot(token, uid, date, SharingPhase.STARTING, "Waiting for permission and daily consent confirmation.")
        return token
    }
    fun isCurrent(token: Long) = current.token == token && current.phase !in listOf(SharingPhase.OFF, SharingPhase.STOPPED, SharingPhase.ERROR)
    fun starting(token: Long, message: String) { if (isCurrent(token)) mutable.value = current.copy(message = message) }
    fun collectorStarted(token: Long): Boolean {
        if (!isCurrent(token)) return false
        mutable.value = current.copy(phase = SharingPhase.WAITING, collecting = true, message = "Service running. Waiting for a fresh location; no upload is confirmed yet.")
        return true
    }
    fun sampled(token: Long, capturedAt: Long) {
        if (!isCurrent(token) || !current.collecting) return
        mutable.value = current.copy(lastSampleAt = capturedAt, phase = if (current.phase == SharingPhase.DELAYED) SharingPhase.DELAYED else SharingPhase.ACTIVE,
            message = if (current.phase == SharingPhase.DELAYED) current.message else "Service running. Collecting location samples.")
    }
    fun uploaded(token: Long, at: Long) {
        if (!isCurrent(token) || !current.collecting) return
        mutable.value = current.copy(lastUploadAt = at, phase = SharingPhase.ACTIVE, message = "Service running. The attendance service confirmed a location upload.")
    }
    fun delayed(token: Long, message: String) {
        if (isCurrent(token) && current.collecting) mutable.value = current.copy(phase = SharingPhase.DELAYED, message = message)
    }
    fun waiting(token: Long) {
        if (isCurrent(token) && current.collecting && current.phase != SharingPhase.DELAYED)
            mutable.value = current.copy(phase = SharingPhase.WAITING, message = "Service running. Waiting for a fresh location. Missing observations remain unknown.")
    }
    fun failed(token: Long, message: String) {
        if (isCurrent(token)) mutable.value = current.copy(token = token + 1, phase = SharingPhase.ERROR, collecting = false, message = message)
    }
    fun stop(uid: String, message: String, failed: Boolean = false): Long {
        val prior = if (current.uid == uid) current else SharingSnapshot()
        val token = current.token + 1
        mutable.value = prior.copy(token = token, uid = uid, phase = if (failed) SharingPhase.ERROR else SharingPhase.STOPPED,
            collecting = false, message = message, stopPending = uid.isNotBlank(), stopInFlight = false)
        return token
    }
    fun stopRequestStarted(token: Long): Boolean {
        if (current.token != token || !current.stopPending || current.stopInFlight) return false
        mutable.value = current.copy(stopInFlight = true)
        return true
    }
    fun stopConfirmed(token: Long) {
        if (current.token == token) mutable.value = current.copy(stopPending = false, stopInFlight = false)
    }
    fun stopUnconfirmed(token: Long) {
        if (current.token == token) mutable.value = current.copy(stopPending = true, stopInFlight = false)
    }
}

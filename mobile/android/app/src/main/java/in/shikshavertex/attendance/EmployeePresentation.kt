package `in`.shikshavertex.attendance

import java.time.Instant

data class ReceiptRecord(val uid: String, val eventId: String, val timestamp: String, val mode: String,
                         val phoneVerified: Boolean, val venueWifiObserved: Boolean)

enum class CheckInGate { RECORDED, REFRESH_REQUIRED, NO_SESSIONS, PASSKEY_SETUP, PASSKEY_ENROLLMENT,
    NO_SELECTION, SESSION_CLOSED, GPS_REQUIRED, WIFI_REQUIRED, STATEMENT_REQUIRED, ROOM_CODE_REQUIRED, READY }

object EmployeePresentation {
    /** These UI prerequisites supplement, and never replace, fresh native and server checks. */
    fun checkInGate(model: EmployeeDashboardModel, sessionId: String?, consent: Boolean, roomCode: String,
                    refreshRequired: Boolean = model.refreshRequired, today: String = Workday.date()): CheckInGate {
        val selected = model.events.find { it.id == sessionId }
        return when {
            selected != null && model.receipts.containsKey(selected.id) -> CheckInGate.RECORDED
            refreshRequired || model.loadedDate != today || (selected != null && selected.date != today) -> CheckInGate.REFRESH_REQUIRED
            model.events.isEmpty() -> CheckInGate.NO_SESSIONS
            !model.passkeyConfigured -> CheckInGate.PASSKEY_SETUP
            !model.passkeyRegistered -> CheckInGate.PASSKEY_ENROLLMENT
            selected == null -> CheckInGate.NO_SELECTION
            !selected.checkInOpen -> CheckInGate.SESSION_CLOSED
            model.onsite && model.gpsStatus != "Confirmed now" -> CheckInGate.GPS_REQUIRED
            model.onsite && model.wifiStatus != "Connected now" -> CheckInGate.WIFI_REQUIRED
            !consent -> CheckInGate.STATEMENT_REQUIRED
            model.onsite && model.requiresRoomCode && !roomCode.matches(Regex("[0-9]{6}")) -> CheckInGate.ROOM_CODE_REQUIRED
            else -> CheckInGate.READY
        }
    }

    /** Admin summaries may include other employees. Keep only this account's first record per session. */
    fun receipts(uid: String, todaySessions: Set<String>, records: List<ReceiptRecord>): Map<String, DashboardReceipt> =
        records.filter { it.uid == uid && it.eventId in todaySessions }.groupBy { it.eventId }.mapValues { (_, entries) ->
            val first = entries.minBy { runCatching { Instant.parse(it.timestamp) }.getOrDefault(Instant.MAX) }
            DashboardReceipt(first.timestamp, first.mode, phoneVerified = first.phoneVerified, venueWifiObserved = first.venueWifiObserved)
        }
}

package `in`.shikshavertex.attendance

import java.time.Instant

data class ReceiptRecord(val uid: String, val eventId: String, val timestamp: String, val mode: String,
                         val phoneVerified: Boolean, val venueWifiObserved: Boolean)

object EmployeePresentation {
    /** Admin summaries may include other employees. Keep only this account's first record per session. */
    fun receipts(uid: String, todaySessions: Set<String>, records: List<ReceiptRecord>): Map<String, DashboardReceipt> =
        records.filter { it.uid == uid && it.eventId in todaySessions }.groupBy { it.eventId }.mapValues { (_, entries) ->
            val first = entries.minBy { runCatching { Instant.parse(it.timestamp) }.getOrDefault(Instant.MAX) }
            DashboardReceipt(first.timestamp, first.mode, phoneVerified = first.phoneVerified, venueWifiObserved = first.venueWifiObserved)
        }
}

package `in`.shikshavertex.attendance

import org.json.JSONArray
import org.json.JSONObject

/** Reject incomplete/mismatched responses instead of turning unknown data into unmarked accounts. */
object ViewerReportValidator {
    fun validate(report: JSONObject, date: String, eventId: String) {
        fun requireReport(valid: Boolean) = check(valid) { "Attendance data could not be confirmed. Refresh attendance to retry." }
        requireReport(report.opt("date") == date)
        val events = report.opt("events") as? JSONArray
        val rows = report.opt("rows") as? JSONArray
        val totals = report.optJSONObject("totals")
        requireReport(events != null && rows != null && totals != null)
        events!!; rows!!; totals!!
        val ids = (0 until events.length()).map { index ->
            val event = events.optJSONObject(index)
            requireReport(event?.opt("id") is String && event.optString("id").isNotBlank() && event.opt("title") is String)
            event!!.getString("id")
        }.toSet()
        requireReport(ids.size == events.length() && (eventId.isBlank() || eventId in ids))
        var marked = 0
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index)
            requireReport(row != null && listOf("name", "email", "department", "team").all { row.opt(it) is String })
            val checks = row!!.opt("checkIns") as? JSONArray
            requireReport(ViewerPresentation.validRowState(row.opt("status") as? String, checks?.length()))
            if (row.opt("status") == "marked") marked++
            for (n in 0 until checks!!.length()) {
                val check = checks.optJSONObject(n)
                requireReport(check != null && check.opt("eventId") in ids && (eventId.isBlank() || check.opt("eventId") == eventId))
                requireReport(listOf("locationChecked", "phoneVerified", "venueWifiObserved").all {
                    !check!!.has(it) || check.opt(it) is Boolean
                })
            }
        }
        fun count(key: String, expected: Int) = (totals.opt(key) as? Number)?.toDouble() == expected.toDouble()
        requireReport(count("accounts", rows.length()) && count("marked", marked) && count("notMarked", rows.length() - marked))
    }
}

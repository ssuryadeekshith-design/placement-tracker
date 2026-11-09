package `in`.shikshavertex.attendance

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate

/** A report must match its requested account, day and observation cutoff. */
object MovementReportValidator {
    fun validate(report: JSONObject, date: String, uid: String) {
        fun requireReport(valid: Boolean) = check(valid) { "Movement data could not be confirmed for this account and date. Refresh to retry." }
        fun epoch(value: Any?): Long? = (value as? String)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        val day = LocalDate.parse(date)
        val start = day.atTime(10, 30).atZone(Workday.zone).toInstant().toEpochMilli()
        val end = day.atTime(20, 30).atZone(Workday.zone).toInstant().toEpochMilli()
        val window = report.optJSONObject("window")
        val through = epoch(report.opt("observedThrough"))
        requireReport(report.opt("uid") == uid && report.opt("date") == date && report.opt("timezone") == "Asia/Kolkata")
        requireReport(epoch(window?.opt("start")) == start && epoch(window?.opt("end")) == end)
        requireReport(through != null && through in start..end)
        requireReport(report.opt("final") is Boolean && report.optBoolean("final") == (through == end))
        for (key in listOf("timeline", "excursions", "visits", "route")) {
            val values = report.opt(key) as? JSONArray
            requireReport(values != null && (0 until values.length()).all { values.opt(it) is JSONObject })
        }
    }
}

package `in`.shikshavertex.attendance

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/** Presentation values contain no Android or JSON dependencies, so interval safety is unit-testable. */
data class MovementInterval(val start: Long, val end: Long, val state: String, val reason: String = "")
data class MovementSegment(val start: Long, val end: Long, val state: String, val future: Boolean, val reason: String) {
    val seconds: Double get() = (end - start) / 1000.0
}

object MovementTimelinePresentation {
    /** Fill the whole workday. Unknown, contradictory, missing and future intervals never become presence. */
    fun segments(start: Long, end: Long, through: Long, source: List<MovementInterval>): List<MovementSegment> {
        if (end <= start) return emptyList()
        val cutoff = through.coerceIn(start, end)
        val valid = source.filter { it.end > it.start }.mapNotNull {
            val left = max(start, it.start)
            val right = min(cutoff, it.end)
            if (right <= left) null else it.copy(start = left, end = right, state = if (it.state in setOf("inside", "away")) it.state else "unknown")
        }
        val bounds = (listOf(start, cutoff, end) + valid.flatMap { listOf(it.start, it.end) }).distinct().sorted()
        val result = mutableListOf<MovementSegment>()
        for ((left, right) in bounds.zipWithNext()) {
            if (right <= left) continue
            val covering = valid.filter { it.start <= left && it.end >= right }
            val future = left >= cutoff
            val states = covering.map { it.state }.distinct()
            val state = if (!future && states.size == 1 && states[0] != "unknown") states[0] else "unknown"
            val reason = when {
                future -> "Not yet observed"
                covering.isEmpty() -> "No location observations"
                states.size > 1 -> "Conflicting or uncertain observations"
                state == "unknown" -> covering.map { it.reason }.firstOrNull { it.isNotBlank() } ?: "Uncertain location observations"
                else -> ""
            }
            val next = MovementSegment(left, right, state, future, reason)
            val previous = result.lastOrNull()
            if (previous != null && previous.end == left && previous.state == state && previous.future == future && previous.reason == reason) {
                result[result.lastIndex] = previous.copy(end = right)
            } else result.add(next)
        }
        return result
    }

    fun duration(seconds: Double): String {
        if (!seconds.isFinite() || seconds < 0) return "Unavailable"
        if (seconds == 0.0) return "0 min"
        if (seconds < 60) return "<1 min"
        val minutes = (seconds / 60).toLong()
        return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes} min"
    }
}

data class MovementReportActions(
    val onBack: () -> Unit,
    val onRefresh: () -> Unit,
    val onOpenMap: (String) -> Unit,
)

/** Read-only report presentation. The caller owns fetching, authorization and external navigation. */
class MovementReportScreen(
    private val context: Context,
    private val report: JSONObject,
    private val actions: MovementReportActions,
    private val employeeName: String = "",
    private val employeeEmail: String = "",
) {
    private val ui = AttendanceUi(context)
    private val body = ui.canvas()
    private val reportContent = ui.column()
    private val controls = mutableListOf<View>()
    private val message = ui.text("", 13f, AttendanceUi.RED).apply {
        visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private val reportDate = LocalDate.parse(report.optString("date", Workday.date()))
    private val start = reportDate.atTime(10, 30).atZone(Workday.zone).toInstant().toEpochMilli()
    private val end = reportDate.atTime(20, 30).atZone(Workday.zone).toInstant().toEpochMilli()
    private val through = epoch(report.optString("observedThrough"))?.coerceIn(start, end) ?: start
    private val source = objects("timeline").mapNotNull { value ->
        val left = epoch(value.optString("startAt")); val right = epoch(value.optString("endAt"))
        if (left == null || right == null) null else MovementInterval(left, right, value.optString("state"), value.optString("reason"))
    }
    private val segments = MovementTimelinePresentation.segments(start, end, through, source)
    private val observed = segments.filterNot { it.future }
    private val excursions = objects("excursions")
    private val visits = objects("visits")
    private val samplesAvailable = (report.optJSONArray("route")?.length() ?: 0) > 0 || observed.any { it.state != "unknown" }
    private lateinit var refresh: Button
    private var busy = false

    val root: View = ui.column().apply {
        setBackgroundColor(AttendanceUi.CANVAS)
        fitsSystemWindows = true
        addView(ScrollView(context).apply {
            isFillViewport = true
            clipToPadding = false
            addView(body)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        val footer = ui.column().apply {
            setPadding(ui.dp(20), ui.dp(10), ui.dp(20), ui.dp(12))
            background = ui.rounded(Color.WHITE, AttendanceUi.BORDER, 0)
        }
        refresh = action(footer, "Refresh movement report", true, actions.onRefresh)
        addView(footer, LinearLayout.LayoutParams(-1, -2))
    }

    init { build() }

    private fun build() {
        val toolbar = ui.row()
        action(toolbar, "‹ Back", onClick = actions.onBack).layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = ui.dp(10) }
        toolbar.addView(ui.text("SHIKSHAVERTEX", 11f, AttendanceUi.INDIGO, true).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(0, -2, 1f))
        body.addView(toolbar)
        ui.space(body, 20)
        body.addView(ui.text("Movement report", 27f, AttendanceUi.INDIGO, true))
        body.addView(ui.text(reportDate.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH)), 13f, AttendanceUi.MUTED))
        ui.space(body, 10)
        body.addView(message)
        body.addView(reportContent)
        buildIdentity()
        buildSummary()
        buildTimeline()
        if (!report.optBoolean("trackingConsented", true)) {
            ui.banner(reportContent, "No daily sharing record", "No location-sharing consent record is available for this day. Missing observations remain unknown and are not an absence decision.", Tone.NEUTRAL)
        } else if (!samplesAvailable) {
            ui.banner(reportContent, "No location observations yet", "There are no usable movement observations in this report snapshot. No presence, absence or visited place can be concluded from this.", Tone.NEUTRAL)
        }
        buildExcursions()
        buildVisits()
        buildUnknownGaps()
        val explanation = ui.card(reportContent)
        ui.section(explanation, "Read this as an estimate", "GPS samples indicate approximate proximity to the venue, not a building floor or uninterrupted presence.")
        ui.space(explanation, 8)
        explanation.addView(ui.text("Unknown time includes missing, inaccurate and interrupted observations. It is never assigned to a place or treated as absence. This is a fetched snapshot; refresh to request updated records.", 12f, AttendanceUi.MUTED))
        ui.space(body, 14)
    }

    private fun buildIdentity() {
        val card = ui.card(reportContent)
        val name = employeeName.ifBlank { clean(report.optString("fullName")) }.ifBlank { "Daily movement summary" }
        val email = employeeEmail.ifBlank { clean(report.optString("email")) }
        card.addView(ui.text(name, 19f, AttendanceUi.INDIGO, true))
        if (email.isNotBlank()) card.addView(ui.text(email, 13f, AttendanceUi.MUTED).apply { setTextIsSelectable(true) })
        ui.space(card, 9)
        ui.chip(card, "10:30 AM–8:30 PM IST", Tone.NEUTRAL)
        ui.chip(card, if (through >= end) "Day window ended" else "Partial-day report snapshot", Tone.NEUTRAL)
        card.addView(ui.text("Observations through ${time(through)} IST. ${if (through < end) "Later hours have not been observed in this snapshot." else "Estimated from available samples for this workday."}", 12f, AttendanceUi.MUTED))
    }

    private fun buildSummary() {
        val narrow = context.resources.configuration.screenWidthDp < 360 || context.resources.configuration.fontScale >= 1.3f
        val metrics = if (narrow) ui.column() else ui.row()
        reportContent.addView(metrics)
        metric(metrics, "Estimated at venue", total("inside"), AttendanceUi.GREEN, narrow)
        metric(metrics, "Estimated away", total("away"), AttendanceUi.BLUE, narrow)
        metric(metrics, "Unknown so far", total("unknown"), AttendanceUi.MUTED, narrow)
        ui.space(reportContent, 8)
        reportContent.addView(ui.text("Totals cover the observed period through ${time(through)} IST. Future time is striped on the timeline and excluded from these totals.", 12f, AttendanceUi.MUTED))
        ui.space(reportContent, 16)
    }

    private fun metric(parent: LinearLayout, label: String, value: Double, color: Int, stacked: Boolean) {
        val card = ui.column().apply { background = ui.rounded(); setPadding(ui.dp(12), ui.dp(16), ui.dp(10), ui.dp(16)) }
        parent.addView(card, if (stacked) LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = ui.dp(7) } else LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(6) })
        card.addView(ui.text(MovementTimelinePresentation.duration(value), 21f, color, true))
        card.addView(ui.text(label, 11f, AttendanceUi.MUTED))
    }

    private fun buildTimeline() {
        val card = ui.card(reportContent)
        ui.section(card, "Workday presence", "A full ten-hour view, including observation gaps.")
        ui.space(card, 12)
        val markerTimes = excursions.flatMap { listOfNotNull(epoch(it.optString("leftAt"))?.let { value -> value to false }, epoch(it.optString("returnedAt"))?.let { value -> value to true }) }
        card.addView(TimelineChart(context, start, end, through, segments, markerTimes).apply {
            contentDescription = "Workday timeline from 10:30 AM to 8:30 PM India time. Estimated at venue ${MovementTimelinePresentation.duration(total("inside"))}; estimated away ${MovementTimelinePresentation.duration(total("away"))}; unknown observed time ${MovementTimelinePresentation.duration(total("unknown"))}. Stripes also cover later unobserved hours. Departure and return markers are estimates."
        }, LinearLayout.LayoutParams(-1, ui.dp(70)))
        val labels = ui.row()
        labels.addView(ui.text("10:30 AM", 11f, AttendanceUi.MUTED), LinearLayout.LayoutParams(0, -2, 1f))
        labels.addView(ui.text("3:30 PM", 11f, AttendanceUi.MUTED).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f))
        labels.addView(ui.text("8:30 PM", 11f, AttendanceUi.MUTED).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(0, -2, 1f))
        card.addView(labels)
        ui.space(card, 12)
        legend(card, "At venue · estimated", 0xFF10B981.toInt())
        legend(card, "Away · estimated", AttendanceUi.BLUE)
        legend(card, "Striped · unknown / not yet observed", 0xFFCBD5E1.toInt(), true)
        ui.space(card, 8)
        card.addView(ui.text("↓ Outside observation   ↑ Return observation\nMarkers show sample-based estimates, not exact boundary crossings.", 11f, AttendanceUi.MUTED))
    }

    private fun legend(parent: LinearLayout, title: String, color: Int, striped: Boolean = false) {
        val row = ui.row()
        row.addView(object : View(context) {
            private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            override fun onDraw(canvas: Canvas) {
                paint.color = color; canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
                if (striped) { paint.color = 0xFF94A3B8.toInt(); paint.strokeWidth = ui.dp(1).toFloat(); for (x in -height..width step ui.dp(5).coerceAtLeast(1)) canvas.drawLine(x.toFloat(), height.toFloat(), (x + height).toFloat(), 0f, paint) }
            }
        }, LinearLayout.LayoutParams(ui.dp(16), ui.dp(12)).apply { marginEnd = ui.dp(8) })
        row.addView(ui.text(title, 11f, AttendanceUi.MUTED), LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(row)
    }

    private fun buildExcursions() {
        val section = ui.card(reportContent)
        ui.section(section, "Departures & returns", "Observation-based estimates; gaps remain unknown.")
        if (excursions.isEmpty()) {
            ui.space(section, 12)
            section.addView(ui.text("No departure or return estimate available", 14f, AttendanceUi.INK, true))
            section.addView(ui.text("This does not establish that the employee remained at the venue. There may be no qualifying observations.", 12f, AttendanceUi.MUTED))
            return
        }
        excursions.forEachIndexed { index, value ->
            ui.space(section, 16)
            ui.chip(section, "Estimated away interval ${index + 1}", Tone.NEUTRAL)
            detail(section, "First outside observation", time(epoch(value.optString("leftAt"))))
            val returned = epoch(value.optString("returnedAt"))
            detail(section, "Next inside observation", returned?.let { time(it) } ?: "No later return observation")
            windowText(value.optJSONObject("departureWindow"), "Departure estimated between")?.let { section.addView(ui.text(it, 12f, AttendanceUi.MUTED)) }
            windowText(value.optJSONObject("returnWindow"), "Return estimated between")?.let { section.addView(ui.text(it, 12f, AttendanceUi.MUTED)) }
            ui.space(section, 7)
            section.addView(ui.text("Observed away: ${MovementTimelinePresentation.duration(nonnegative(value, "durationSeconds"))}", 13f, AttendanceUi.BLUE, true))
            val unknown = nonnegative(value, "unknownSeconds")
            if (unknown.isFinite() && unknown > 0) section.addView(ui.text("Unknown during this interval: ${MovementTimelinePresentation.duration(unknown)}", 12f, AttendanceUi.MUTED))
            if (returned == null) section.addView(ui.text("The report cannot establish where the employee is after the last sample.", 12f, AttendanceUi.MUTED))
        }
    }

    private fun buildVisits() {
        val section = ui.card(reportContent)
        ui.section(section, "Approximate offsite stops", "Nearby samples grouped into estimated stops. Business and address names are not inferred.")
        if (visits.isEmpty()) {
            ui.space(section, 12)
            section.addView(ui.text("No offsite stop estimates", 14f, AttendanceUi.INK, true))
            section.addView(ui.text("No qualifying stop appears in this snapshot. Travel or missing observations may still have occurred.", 12f, AttendanceUi.MUTED))
            return
        }
        visits.forEachIndexed { index, visit ->
            ui.space(section, 16)
            section.addView(ui.text("Approximate stop ${index + 1}", 15f, AttendanceUi.INDIGO, true))
            val latitude = visit.optDouble("latitude", Double.NaN)
            val longitude = visit.optDouble("longitude", Double.NaN)
            val valid = latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0
            if (valid) section.addView(ui.text(String.format(Locale.US, "%.6f, %.6f", latitude, longitude), 13f, AttendanceUi.MUTED).apply { setTextIsSelectable(true) })
            else section.addView(ui.text("Coordinates unavailable", 12f, AttendanceUi.MUTED))
            section.addView(ui.text("${time(epoch(visit.optString("startAt")))}–${time(epoch(visit.optString("endAt")))} IST", 13f, AttendanceUi.INK, true))
            section.addView(ui.text("Estimated dwell: ${MovementTimelinePresentation.duration(nonnegative(visit, "dwellSeconds"))}", 12f, AttendanceUi.MUTED))
            if (valid) action(section, "View approximate coordinates on Maps") {
                actions.onOpenMap("https://www.google.com/maps/search/?api=1&query=$latitude,$longitude")
            }
        }
        ui.space(section, 8)
        section.addView(ui.text("A coordinate cluster is not proof of visiting a named business, a specific floor, or staying continuously for the entire interval.", 12f, AttendanceUi.MUTED))
    }

    private fun buildUnknownGaps() {
        val card = ui.card(reportContent)
        ui.section(card, "Unknown observation gaps", "Elapsed gaps cannot be assigned to the venue or an offsite place.")
        val gaps = observed.filter { it.state == "unknown" }
        if (gaps.isEmpty()) {
            ui.space(card, 10)
            card.addView(ui.text("No elapsed unknown gap appears in this snapshot. This does not prove uninterrupted presence.", 12f, AttendanceUi.MUTED))
        }
        for (gap in gaps) {
            ui.space(card, 14)
            ui.chip(card, "Unknown location", Tone.WARNING)
            card.addView(ui.text("${time(gap.start)}–${time(gap.end)} IST · ${MovementTimelinePresentation.duration(gap.seconds)}", 13f, AttendanceUi.INDIGO, true))
            card.addView(ui.text(gap.reason, 12f, AttendanceUi.MUTED))
        }
        if (through < end) {
            ui.space(card, 14)
            card.addView(ui.text("Not yet observed: ${time(through)}–${time(end)} IST · ${MovementTimelinePresentation.duration((end - through) / 1000.0)}. Later hours are separate from elapsed unknown time.", 12f, AttendanceUi.MUTED))
        }
    }

    private fun detail(parent: LinearLayout, label: String, value: String) {
        parent.addView(ui.text(label, 11f, AttendanceUi.MUTED))
        parent.addView(ui.text(value, 17f, AttendanceUi.INDIGO, true))
    }
    private fun action(parent: LinearLayout, title: String, primary: Boolean = false, onClick: () -> Unit): Button =
        ui.button(parent, title, primary) { if (!busy) onClick() }.also { controls.add(it) }
    private fun objects(key: String): List<JSONObject> = report.optJSONArray(key)?.let { values -> (0 until values.length()).mapNotNull { values.optJSONObject(it) } } ?: emptyList()
    private fun total(state: String) = observed.filter { it.state == state }.sumOf { it.seconds }
    private fun epoch(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    private fun time(value: Long?): String = value?.let { DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(Workday.zone).format(Instant.ofEpochMilli(it)) } ?: "Unavailable"
    private fun clean(value: String) = value.takeUnless { it == "null" }.orEmpty()
    private fun nonnegative(value: JSONObject, key: String): Double = value.optDouble(key, Double.NaN).let { if (it.isFinite() && it >= 0) it else Double.NaN }
    private fun windowText(value: JSONObject?, label: String): String? {
        if (value == null) return null
        val after = epoch(value.optString("after")) ?: return null
        val before = epoch(value.optString("before")) ?: return null
        if (before < after) return null
        return "$label ${time(after)} and ${time(before)} IST."
    }

    fun setBusy(value: Boolean) {
        busy = value
        controls.forEach { it.isEnabled = !value }
        refresh.text = if (value) "Refreshing movement report…" else "Refresh movement report"
        if (value) message.visibility = View.GONE
    }
    fun showMessage(value: String) {
        message.text = value; message.setTextColor(AttendanceUi.RED)
        message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isNotBlank()) reportContent.visibility = View.GONE
    }
    fun showNotice(value: String) {
        message.text = value; message.setTextColor(AttendanceUi.GREEN)
        message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
    }

    private class TimelineChart(
        context: Context,
        private val start: Long,
        private val end: Long,
        private val through: Long,
        private val segments: List<MovementSegment>,
        private val markers: List<Pair<Long, Boolean>>,
    ) : View(context) {
        private val density = resources.displayMetrics.density
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (width == 0 || end <= start) return
            fun x(time: Long) = (((time - start).toDouble() / (end - start)).coerceIn(0.0, 1.0) * width).toFloat()
            val top = 9 * density
            val bottom = 36 * density
            val outline = Path().apply { addRoundRect(RectF(0f, top, width.toFloat(), bottom), 7 * density, 7 * density, Path.Direction.CW) }
            canvas.save(); canvas.clipPath(outline)
            for (segment in segments) {
                val left = x(segment.start); val right = x(segment.end)
                paint.color = when (segment.state) { "inside" -> 0xFF10B981.toInt(); "away" -> AttendanceUi.BLUE; else -> 0xFFE2E8F0.toInt() }
                canvas.drawRect(left, top, right, bottom, paint)
                if (segment.state == "unknown") {
                    canvas.save(); canvas.clipRect(left, top, right, bottom)
                    paint.color = if (segment.future) 0xFFCBD5E1.toInt() else 0xFF94A3B8.toInt()
                    paint.strokeWidth = density
                    var offset = left - (bottom - top)
                    while (offset < right) { canvas.drawLine(offset, bottom, offset + bottom - top, top, paint); offset += 7 * density }
                    canvas.restore()
                }
            }
            canvas.restore()
            // The snapshot cutoff is a separator, never an assertion of current live position.
            if (through > start && through < end) {
                paint.color = AttendanceUi.INDIGO; paint.strokeWidth = 2 * density
                canvas.drawLine(x(through), top - 3 * density, x(through), bottom + 4 * density, paint)
            }
            for ((time, returned) in markers.filter { it.first in start..min(through, end) }) {
                val at = x(time)
                paint.color = if (returned) AttendanceUi.GREEN else AttendanceUi.BLUE
                val marker = Path().apply {
                    if (returned) { moveTo(at, bottom + 8 * density); lineTo(at - 4 * density, bottom + 15 * density); lineTo(at + 4 * density, bottom + 15 * density) }
                    else { moveTo(at, bottom + 15 * density); lineTo(at - 4 * density, bottom + 8 * density); lineTo(at + 4 * density, bottom + 8 * density) }
                    close()
                }
                canvas.drawPath(marker, paint)
            }
        }
    }
}

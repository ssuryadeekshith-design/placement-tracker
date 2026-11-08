package `in`.shikshavertex.attendance

import android.app.DatePickerDialog
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class AttendanceViewerActions(
    val onLoad: (date: String, eventId: String) -> Unit,
    val onBack: () -> Unit,
    val onSignOut: () -> Unit,
)

/** Read-only presentation. Authorization and report fetching remain in MainActivity/API. */
class AttendanceViewerScreen(
    private val context: Context,
    private val report: JSONObject,
    selectedDate: String,
    selectedEventId: String,
    private val actions: AttendanceViewerActions,
) {
    private val ui = AttendanceUi(context)
    private val content = ui.canvas().apply { setPadding(ui.dp(18), ui.dp(16), ui.dp(18), ui.dp(20)) }
    private val controls = mutableListOf<View>()
    private val statusButtons = mutableMapOf<ViewerStatusFilter, Button>()
    private val loadedDate = report.optString("date", selectedDate)
    private val loadedSession = selectedEventId
    private var pendingDate = selectedDate
    private var pendingSession = selectedEventId
    private var query = ""
    private var department = ""
    private var team = ""
    private var status = ViewerStatusFilter.ALL
    private var mode = ViewerModeFilter.ALL
    private var pendingLoad = false
    private var busy = false
    private val events = report.optJSONArray("events")?.let { values -> (0 until values.length()).map { values.getJSONObject(it) } } ?: emptyList()
    private val employees = report.optJSONArray("rows")?.let { rows -> (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val checks = row.optJSONArray("checkIns")
        ViewerEmployee(row.optString("name"), row.optString("email"), row.optString("department"), row.optString("team"), row.optString("status") == "marked",
            if (checks == null) emptyList() else (0 until checks.length()).map { n -> checks.getJSONObject(n).let { check ->
                ViewerCheckIn(check.optString("eventTitle"), check.optString("timestamp"), check.optString("method"), check.optString("attendanceMode", "legacy"), check.opt("locationChecked") == true,
                    check.opt("phoneVerified") == true, check.opt("venueWifiObserved") == true)
            } })
    } } ?: emptyList()
    private val message = ui.text("", 14f, AttendanceUi.RED).apply {
        visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private lateinit var snapshotLabel: TextView
    private lateinit var resultLabel: TextView
    private lateinit var list: LinearLayout
    private lateinit var metrics: LinearLayout
    private lateinit var refresh: Button
    private lateinit var dateButton: Button
    private lateinit var sessionPicker: Spinner
    val root: View = ScrollView(context).apply {
        isFillViewport = true
        setBackgroundColor(AttendanceUi.CANVAS)
        clipToPadding = false
        addView(content)
    }

    init { build() }

    private fun build() {
        val toolbar = ui.row()
        content.addView(toolbar)
        ui.button(toolbar, "‹ Back") { actions.onBack() }.also {
            it.layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = ui.dp(12) }
            controls.add(it)
        }
        val brand = ui.text("SHIKSHAVERTEX", 12f, AttendanceUi.INDIGO, true).apply { gravity = Gravity.CENTER_VERTICAL or Gravity.END }
        toolbar.addView(brand, LinearLayout.LayoutParams(0, -1, 1f))
        ui.space(content, 16)
        content.addView(ui.text("Everyone’s attendance", 26f, AttendanceUi.INDIGO, true))
        content.addView(ui.text("A clear view of your team's check-ins.", 14f, AttendanceUi.MUTED))
        ui.chip(content, "Read-only attendance access", Tone.NEUTRAL)
        content.addView(ui.text("Last refreshed: ${ViewerPresentation.refreshed(report.optString("generatedAt"))}. Refresh for new records.", 12f, AttendanceUi.MUTED))
        ui.space(content, 16)

        metrics = ui.row()
        content.addView(metrics)
        val totals = report.optJSONObject("totals")
        metric(metrics, "Registered / recorded", totals?.optInt("accounts") ?: employees.size, AttendanceUi.INDIGO)
        metric(metrics, "Checked in", totals?.optInt("marked") ?: employees.count { it.marked }, AttendanceUi.GREEN)
        metric(metrics, "Not marked yet", totals?.optInt("notMarked") ?: employees.count { !it.marked }, AttendanceUi.AMBER)
        ui.space(content, 8)
        content.addView(ui.text("Current approved registered accounts and historical check-ins. Unregistered roster entries are excluded; not marked is not an absence or leave decision.", 12f, AttendanceUi.MUTED))

        val scope = ui.card(content)
        ui.section(scope, "Attendance period", "Choose a date and session, then refresh.")
        dateButton = ui.button(scope, dateCaption(pendingDate)) { openCalendar() }.also { controls.add(it) }
        dateButton.contentDescription = "Attendance date: $pendingDate"
        sessionPicker = selector(scope, "Attendance session", listOf("All sessions on this date") + events.map { it.optString("title") }, (events.indexOfFirst { it.optString("id") == pendingSession } + 1).coerceAtLeast(0)) { position ->
            pendingSession = if (position > 0) events[position - 1].optString("id") else ""
            updateScopeCaption()
        }
        snapshotLabel = ui.text("", 12f, AttendanceUi.MUTED)
        scope.addView(snapshotLabel)
        refresh = ui.button(scope, "Refresh attendance records", true) {
            pendingLoad = true
            list.visibility = View.GONE
            metrics.visibility = View.GONE
            resultLabel.text = "Loading selected attendance…"
            actions.onLoad(pendingDate, pendingSession)
        }.also { controls.add(it) }
        scope.addView(message)
        updateScopeCaption()

        val filters = ui.card(content)
        ui.section(filters, "Find an employee")
        val search = ui.field(filters, "Search name, work email, department or team")
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { query = s?.toString() ?: ""; drawRows() }
            override fun afterTextChanged(s: Editable?) {}
        })
        controls.add(search)
        val statusRow = ui.row()
        filters.addView(statusRow)
        for ((value, label) in listOf(ViewerStatusFilter.ALL to "All", ViewerStatusFilter.MARKED to "Checked in", ViewerStatusFilter.NOT_MARKED to "Not marked\nyet")) {
            val button = Button(context).apply {
                text = label; isAllCaps = false; textSize = 12f; minWidth = 0; minimumWidth = 0; minHeight = ui.dp(48)
                setPadding(ui.dp(5), ui.dp(8), ui.dp(5), ui.dp(8))
                contentDescription = if (value == ViewerStatusFilter.NOT_MARKED) "Filter: not marked yet" else "Filter: $label"
                setOnClickListener { status = value; updateStatusButtons(); drawRows() }
            }
            statusRow.addView(button, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(4); topMargin = ui.dp(8) })
            statusButtons[value] = button; controls.add(button)
        }
        updateStatusButtons()
        val more = ui.column().apply { visibility = View.GONE }
        val filterToggle = ui.button(filters, "More filters  +") { more.visibility = if (more.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
        filterToggle.setOnClickListener {
            val opening = more.visibility != View.VISIBLE
            more.visibility = if (opening) View.VISIBLE else View.GONE
            filterToggle.text = if (opening) "Fewer filters  −" else "More filters  +"
        }
        filters.addView(more); controls.add(filterToggle)
        val departments = employees.map { it.department }.filter { it.isNotBlank() }.distinct().sorted()
        val teams = employees.map { it.team }.filter { it.isNotBlank() }.distinct().sorted()
        selector(more, "Department", listOf("All departments") + departments) { department = if (it > 0) departments[it - 1] else ""; drawRows() }
        selector(more, "Team", listOf("All teams") + teams) { team = if (it > 0) teams[it - 1] else ""; drawRows() }
        selector(more, "Verification mode", listOf("All modes", "Setup mode", "Onsite mode", "Committee override", "Legacy / unavailable")) { mode = ViewerModeFilter.values()[it]; drawRows() }

        resultLabel = ui.text("", 13f, AttendanceUi.MUTED, true)
        content.addView(resultLabel)
        list = ui.column()
        content.addView(list)
        drawRows()
        val footer = ui.card(content)
        ui.section(footer, "Need a spreadsheet?", "Use Download attendance CSV in the web dashboard. It exports the selected day and filtered rows.")
        footer.addView(ui.text("This screen has no attendance editing, HR approval or movement-history controls.", 12f, AttendanceUi.MUTED))
        ui.button(content, "Sign out") { actions.onSignOut() }.also { controls.add(it) }
        ui.space(content, 16)
    }

    private fun metric(parent: LinearLayout, title: String, value: Int, color: Int) {
        val card = ui.column().apply {
            setPadding(ui.dp(10), ui.dp(14), ui.dp(8), ui.dp(14))
            background = rounded(0xFFFFFFFF.toInt(), AttendanceUi.BORDER)
        }
        parent.addView(card, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(6) })
        card.addView(ui.text(value.toString(), 25f, color, true).apply { fontFeatureSettings = "tnum" })
        card.addView(ui.text(title, 11f, AttendanceUi.MUTED))
    }

    private fun selector(parent: LinearLayout, label: String, options: List<String>, selected: Int = 0, changed: (Int) -> Unit): Spinner {
        val id = View.generateViewId()
        parent.addView(ui.text(label, 12f, AttendanceUi.INK, true).apply { labelFor = id; setPadding(0, ui.dp(10), 0, ui.dp(4)) })
        return Spinner(context).apply {
            this.id = id; contentDescription = label
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, options)
            minimumHeight = ui.dp(52); background = rounded(0xFFFFFFFF.toInt(), AttendanceUi.BORDER)
            setPadding(ui.dp(12), ui.dp(6), ui.dp(8), ui.dp(6))
            parent.addView(this, LinearLayout.LayoutParams(-1, -2))
            setSelection(selected)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) {}
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { changed(position) }
            }
            controls.add(this)
        }
    }

    private fun openCalendar() {
        val date = runCatching { LocalDate.parse(pendingDate) }.getOrElse { LocalDate.now(ZoneId.of("Asia/Kolkata")) }
        DatePickerDialog(context, { _, year, month, day ->
            pendingDate = LocalDate.of(year, month + 1, day).toString()
            pendingSession = ""
            dateButton.text = dateCaption(pendingDate)
            dateButton.contentDescription = "Attendance date: $pendingDate"
            sessionPicker.setSelection(0)
            sessionPicker.isEnabled = pendingDate == loadedDate && !busy
            updateScopeCaption()
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            // DatePicker uses the phone's calendar zone; the report day is always India time.
            datePicker.maxDate = LocalDate.now(Workday.zone).atTime(23, 59).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            show()
        }
    }

    private fun dateCaption(value: String) = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.ENGLISH)) }.getOrDefault(value)

    private fun updateScopeCaption() {
        if (!::snapshotLabel.isInitialized || !::refresh.isInitialized) return
        val selectedTitle = events.firstOrNull { it.optString("id") == loadedSession }?.optString("title") ?: "all sessions"
        val changed = pendingDate != loadedDate || pendingSession != loadedSession
        snapshotLabel.text = "Showing ${dateCaption(loadedDate)} · $selectedTitle." + if (changed) " Date/session changes are not applied yet." else " All times are India time."
        snapshotLabel.setTextColor(if (changed) AttendanceUi.AMBER else AttendanceUi.MUTED)
        refresh.text = if (changed) "Apply selection & refresh" else "Refresh attendance records"
    }

    private fun updateStatusButtons() {
        for ((value, button) in statusButtons) {
            val active = value == status
            button.isSelected = active
            button.setTextColor(if (active) 0xFFFFFFFF.toInt() else AttendanceUi.INK)
            button.background = rounded(if (active) AttendanceUi.BLUE else AttendanceUi.CANVAS, if (active) AttendanceUi.BLUE else AttendanceUi.BORDER)
        }
    }

    private fun drawRows() {
        if (!::list.isInitialized || pendingLoad) return
        list.removeAllViews()
        val matches = employees.filter { ViewerPresentation.matches(it, query, department, team, status, mode) }
        resultLabel.text = "${matches.size} of ${employees.size} accounts · read-only"
        if (events.isEmpty()) ui.banner(list, "No session on this date", "HR has not created an attendance session for this day. This is not an absence decision.", Tone.NEUTRAL)
        if (matches.isEmpty()) {
            ui.banner(list, if (employees.isEmpty()) "No registered attendance accounts" else "No matching employees", if (employees.isEmpty()) "Approved registered accounts and recorded check-ins will appear here." else "Try another name or clear a status, team or verification filter.", Tone.NEUTRAL)
            return
        }
        for (employee in matches) employeeCard(employee)
    }

    private fun employeeCard(employee: ViewerEmployee) {
        val card = ui.card(list)
        val identity = ui.row()
        identity.gravity = Gravity.CENTER_VERTICAL
        card.addView(identity)
        identity.addView(ui.text(ViewerPresentation.initials(employee), 15f, AttendanceUi.BLUE, true).apply {
            gravity = Gravity.CENTER; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            background = rounded(0xFFEFF6FF.toInt(), 0xFFEFF6FF.toInt())
        }, LinearLayout.LayoutParams(ui.dp(44), ui.dp(44)).apply { marginEnd = ui.dp(12) })
        val labels = ui.column()
        identity.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
        labels.addView(ui.text(employee.name.ifBlank { "Name not linked" }, 16f, AttendanceUi.INDIGO, true))
        labels.addView(ui.text(employee.email, 12f, AttendanceUi.MUTED).apply { setTextIsSelectable(true) })
        val organization = listOf(employee.department, employee.team).filter { it.isNotBlank() }.joinToString(" · ")
        if (organization.isNotEmpty()) card.addView(ui.text(organization, 12f, AttendanceUi.MUTED))
        ui.chip(card, if (employee.marked) "Checked in" else "Not marked yet", if (employee.marked) Tone.SUCCESS else Tone.WARNING)
        val checks = employee.checkIns.filter { ViewerPresentation.matchesMode(it, mode) }
        if (checks.isEmpty() && !employee.marked) card.addView(ui.text("No check-in recorded for the loaded selection.", 12f, AttendanceUi.MUTED))
        for (check in checks) {
            ui.space(card, 8)
            card.addView(ui.text(check.session.ifBlank { "Attendance session" }, 13f, AttendanceUi.INK, true))
            card.addView(ui.text(ViewerPresentation.time(check.timestamp) + " IST", 19f, AttendanceUi.INDIGO, true).apply { fontFeatureSettings = "tnum" })
            card.addView(ui.text(ViewerPresentation.evidence(check), 12f, if (check.locationChecked && check.method !in listOf("committee", "manual") && check.mode == "onsite") AttendanceUi.GREEN else AttendanceUi.MUTED))
            if (check.phoneVerified) ui.chip(card, "Phone verified", Tone.SUCCESS)
            if (check.venueWifiObserved) ui.chip(card, "Venue Wi-Fi observed", Tone.NEUTRAL)
        }
    }

    private fun rounded(fill: Int, stroke: Int) = GradientDrawable().apply { setColor(fill); cornerRadius = ui.dp(12).toFloat(); setStroke(ui.dp(1), stroke) }

    fun setBusy(value: Boolean) {
        busy = value
        controls.forEach { it.isEnabled = !value }
        if (::sessionPicker.isInitialized) sessionPicker.isEnabled = !value && pendingDate == loadedDate
        if (value) message.visibility = View.GONE
        if (::refresh.isInitialized) {
            if (value) refresh.text = "Loading attendance…" else updateScopeCaption()
        }
    }

    fun showMessage(value: String) {
        message.text = value
        message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isNotBlank()) {
            pendingLoad = true
            if (::list.isInitialized) { list.removeAllViews(); list.visibility = View.GONE }
            if (::metrics.isInitialized) metrics.visibility = View.GONE
            if (::resultLabel.isInitialized) resultLabel.text = "Records hidden. Refresh attendance to retry."
        }
    }
}

package `in`.shikshavertex.attendance

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.core.view.doOnLayout
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class DashboardSession(val id: String, val title: String, val date: String, val checkInOpen: Boolean = true)
data class DashboardReceipt(
    val timestamp: String,
    val mode: String,
    val alreadyMarked: Boolean = false,
    val phoneVerified: Boolean = false,
    val venueWifiObserved: Boolean = false,
)

data class EmployeeDashboardModel(
    val employeeName: String,
    val email: String,
    val department: String,
    val team: String,
    val venue: String,
    val onsite: Boolean,
    val requiresRoomCode: Boolean,
    val passkeyRegistered: Boolean,
    val passkeyConfigured: Boolean,
    val events: List<DashboardSession>,
    val receipts: Map<String, DashboardReceipt>,
    val gpsStatus: String,
    val wifiStatus: String,
    val trackingStatus: String,
    val canViewAll: Boolean,
    val isHr: Boolean,
    val preferredSessionId: String = "",
    val loadedDate: String = Workday.date(),
    val refreshRequired: Boolean = false,
    val employeeUid: String = "",
    val sharingSnapshot: SharingSnapshot = SharingSnapshot(),
)

data class EmployeeDashboardActions(
    val onRefresh: () -> Unit,
    val onEnroll: () -> Unit,
    val onSubmit: (eventId: String, consent: Boolean, roomCode: String) -> Unit,
    val onViewAttendance: () -> Unit,
    val onHrControls: () -> Unit,
    val onStartSharing: (consent: Boolean) -> Unit,
    val onStopSharing: () -> Unit,
    val onMovementReport: () -> Unit,
    val onSignOut: () -> Unit,
    val onMaps: () -> Unit,
    val onCheckWifi: () -> Unit,
)

/** Presentation only: successful attendance and prerequisite states come from the supplied model. */
class EmployeeDashboardScreen(
    private val context: Context,
    private val model: EmployeeDashboardModel,
    private val actions: EmployeeDashboardActions,
) {
    private val ui = AttendanceUi(context)
    private var busy = false
    private var refreshRequired = model.refreshRequired
    private var receiptFocused = false
    private val enabled = mutableListOf<Pair<View, () -> Boolean>>()
    private val body = ui.canvas()
    private val sticky = ui.column()
    private val message = ui.text("", 14f, AttendanceUi.RED)
    private val dataNotice = ui.text(context.getString(R.string.dashboard_refresh_needed), 12f, AttendanceUi.AMBER).apply {
        background = ui.rounded(Color.rgb(255, 251, 235), Color.rgb(254, 243, 199))
        setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10)); visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private lateinit var sessions: Spinner
    private lateinit var statement: CheckBox
    private var roomCode: EditText? = null
    private lateinit var submit: Button
    private lateinit var submitHelp: TextView
    private lateinit var receiptContainer: LinearLayout
    private lateinit var checkInControls: LinearLayout
    private lateinit var sharingCard: LocationSharingCard
    private var selectedSessionId: String? = null

    val root: View = ui.column().apply {
        setBackgroundColor(AttendanceUi.CANVAS)
        fitsSystemWindows = true
        addView(ScrollView(context).apply {
            isFillViewport = true
            clipToPadding = false
            addView(body)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        addView(sticky, LinearLayout.LayoutParams(-1, -2))
    }

    init {
        buildHeader()
        buildIdentity()
        buildMode()
        body.addView(dataNotice)
        ui.space(body, 8)
        message.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        message.visibility = View.GONE
        body.addView(message)
        buildCheckIn()
        buildSharing()
        actionButton(body, "Sign out", action = actions.onSignOut)
        ui.space(body, 16)
        buildStickyAction()
        updateSelection()
        // Re-evaluate at an India-date rollover while the dashboard remains visible.
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            private var date = Workday.date()
            private val tick = object : Runnable {
                override fun run() {
                    val today = Workday.date()
                    if (today != date) { date = today; statement.isChecked = false; roomCode?.text?.clear(); updateSelection() }
                    root.postDelayed(this, 1000)
                }
            }
            override fun onViewAttachedToWindow(view: View) { updateSelection(); root.post(tick) }
            override fun onViewDetachedFromWindow(view: View) { root.removeCallbacks(tick) }
        })
    }

    private fun actionButton(parent: LinearLayout, label: String, primary: Boolean = false,
                             available: () -> Boolean = { true }, action: () -> Unit): Button {
        val button = ui.button(parent, label, primary) { if (!busy && available()) action() }
        enabled.add(button to available)
        return button
    }

    private fun buildHeader() {
        body.addView(ui.text("SHIKSHAVERTEX", 12f, AttendanceUi.INDIGO, true).apply { letterSpacing = .14f })
        val narrow = context.resources.configuration.screenWidthDp < 360 || context.resources.configuration.fontScale >= 1.3f
        val titleRow = if (narrow) ui.column() else ui.row()
        val title = ui.column()
        ui.section(title, "My attendance", "${LocalDate.parse(model.loadedDate).format(DateTimeFormatter.ofPattern("EEEE, d MMMM"))} · India time")
        titleRow.addView(title, if (narrow) LinearLayout.LayoutParams(-1, -2) else LinearLayout.LayoutParams(0, -2, 1f))
        actionButton(titleRow, "Refresh", action = actions.onRefresh).apply {
            contentDescription = "Refresh attendance"
            layoutParams = LinearLayout.LayoutParams(if (narrow) -1 else -2, -2).apply { topMargin = ui.dp(8) }
        }
        body.addView(titleRow)
        ui.space(body, 14)
        if (model.canViewAll || model.isHr) {
            val navigation = ui.row()
            body.addView(navigation)
            if (model.canViewAll) actionButton(navigation, "All attendance", action = actions.onViewAttendance).apply {
                contentDescription = "View all employees' attendance"
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(6) }
            }
            if (model.isHr) actionButton(navigation, "HR controls", action = actions.onHrControls).apply {
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            }
            ui.space(body, 14)
        }
    }

    private fun buildIdentity() {
        val card = ui.card(body)
        val identity = ui.row()
        val initials = model.employeeName.ifBlank { model.email.substringBefore('@').replace('_', ' ') }
            .split(Regex("\\s+")).filter(String::isNotBlank).take(2).joinToString("") { it.first().uppercase() }
        identity.addView(ui.text(initials, 18f, Color.WHITE, true).apply {
            gravity = android.view.Gravity.CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(AttendanceUi.INDIGO) }
        }, LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)).apply { marginEnd = ui.dp(12) })
        val details = ui.column()
        details.addView(ui.text(model.employeeName.ifBlank { "Your employee profile" }, 20f, AttendanceUi.INK, true))
        details.addView(ui.text(model.email, 13f, AttendanceUi.MUTED))
        identity.addView(details, LinearLayout.LayoutParams(0, -2, 1f))
        card.addView(identity)
        ui.space(card, 12)
        ui.chip(card, "Verified work email", Tone.SUCCESS)
        if (model.department.isNotBlank() || model.team.isNotBlank()) {
            ui.chip(card, listOf(model.department, model.team).filter(String::isNotBlank).joinToString(" · "), Tone.NEUTRAL)
        }
        ui.space(card, 10)
        card.addView(ui.text("ATTENDANCE VENUE", 11f, AttendanceUi.MUTED, true))
        card.addView(ui.text(model.venue, 13f))
        actionButton(card, "View venue on Maps", action = actions.onMaps)
    }

    private fun buildMode() {
        if (!model.onsite) {
            ui.banner(body, "Temporary setup mode", "Physical location, Wi-Fi and room codes are not required. Your check-in location is unverified.", Tone.WARNING)
            return
        }
        val card = ui.card(body)
        ui.section(card, "Onsite check-in", "Your connected phone and fresh location are checked before submission.")
        ui.chip(card, "Venue GPS · ${if (model.gpsStatus == "Confirmed now") "Confirmed on refresh" else model.gpsStatus}", if (model.gpsStatus == "Confirmed now") Tone.SUCCESS else Tone.WARNING)
        ui.chip(card, "Wi-Fi · ${if (model.wifiStatus == "Connected now") "Connected on refresh" else model.wifiStatus}", if (model.wifiStatus == "Connected now") Tone.SUCCESS else Tone.WARNING)
        ui.chip(card, if (model.requiresRoomCode) "Room code · required for check-in" else "Room code · not required", Tone.NEUTRAL)
        card.addView(ui.text("GPS verifies building proximity, not floor level. Unknown or stale readings do not count as verified.", 12f, AttendanceUi.MUTED))
        card.addView(ui.text("Prerequisite status is checked on refresh and again at submission.", 12f, AttendanceUi.MUTED))
        actionButton(card, "Check Shikshavertex_5G connection", action = actions.onCheckWifi)
    }

    private fun step(parent: LinearLayout, number: String, title: String, body: String = ""): LinearLayout {
        ui.space(parent, 16)
        val line = ui.row()
        line.addView(ui.text(number, 12f, AttendanceUi.BLUE, true).apply {
            gravity = android.view.Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(239, 246, 255)) }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(ui.dp(28), ui.dp(28)).apply { marginEnd = ui.dp(10) })
        line.addView(ui.text(title, 15f, AttendanceUi.INK, true), LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(line)
        val content = ui.column().apply { setPadding(ui.dp(38), ui.dp(4), 0, 0) }
        if (body.isNotBlank()) content.addView(ui.text(body, 13f, AttendanceUi.MUTED))
        parent.addView(content)
        return content
    }

    private fun buildCheckIn() {
        val card = ui.card(body)
        ui.section(card, "Your check-in", "Four simple steps. One original attendance record.")
        val passkey = step(card, "1", "Device passkey")
        when {
            !model.passkeyConfigured -> ui.banner(passkey, "Verification setup needed", "HR must finish the attendance service’s passkey configuration before you can check in.", Tone.DANGER)
            model.passkeyRegistered -> ui.chip(passkey, "Passkey enrolled", Tone.SUCCESS)
            else -> {
                passkey.addView(ui.text("Enroll your phone once before marking attendance.", 13f, AttendanceUi.MUTED))
                actionButton(passkey, "Enroll phone passkey", action = actions.onEnroll)
            }
        }
        val sessionStep = step(card, "2", "Today’s session")
        sessions = Spinner(context).apply {
            contentDescription = "Today’s attendance session"
            minimumHeight = ui.dp(52)
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item,
                listOf("Choose today’s session") + model.events.map { if (it.checkInOpen) it.title else context.getString(R.string.dashboard_closed_session, it.title) })
        }
        enabled.add(sessions to { model.events.isNotEmpty() })
        sessionStep.addView(sessions, LinearLayout.LayoutParams(-1, -2))
        if (model.events.isEmpty()) ui.banner(sessionStep, "No open attendance session", "Waiting for HR to open today’s attendance. Use Refresh attendance after HR opens it.", Tone.NEUTRAL)
        receiptContainer = ui.column()
        card.addView(receiptContainer)
        checkInControls = ui.column()
        card.addView(checkInControls)
        if (model.onsite && model.requiresRoomCode) {
            roomCode = ui.field(checkInControls, "Current 6-digit room code").apply {
                id = View.generateViewId()
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                filters = arrayOf(InputFilter.LengthFilter(6))
                letterSpacing = .16f
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { updateSelection() }
                    override fun afterTextChanged(s: Editable?) {}
                })
            }
            (checkInControls.getChildAt(checkInControls.indexOfChild(roomCode) - 1) as TextView).labelFor = roomCode!!.id
            enabled.add(roomCode!! to { true })
        }
        val consent = step(checkInControls, "3", "Attendance statement")
        statement = CheckBox(context).apply {
            text = if (model.onsite) "I agree to save my location, accuracy and time for this check-in." else "I confirm I am marking my own attendance. Physical location is not verified in setup mode."
            textSize = 13f
            setTextColor(AttendanceUi.INK)
            minHeight = ui.dp(48)
            setOnCheckedChangeListener { _, _ -> updateSelection() }
        }
        enabled.add(statement to { true })
        consent.addView(statement, LinearLayout.LayoutParams(-1, -2))
        step(checkInControls, "4", "Verify phone & mark attendance", "Use the blue action below to finish securely.")
        ui.space(card, 12)
        card.addView(ui.text("Verified via Android fingerprint, face or device PIN. Shikshavertex never collects or stores your biometric templates.", 12f, AttendanceUi.MUTED))
        sessions.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { updateSelection() }
            override fun onNothingSelected(parent: AdapterView<*>?) { updateSelection() }
        }
        val preferred = model.events.indexOfFirst { it.id == model.preferredSessionId }
        if (preferred >= 0) sessions.setSelection(preferred + 1)
        else if (model.events.size == 1) sessions.setSelection(1)
    }

    private fun buildStickyAction() {
        sticky.setBackgroundColor(Color.WHITE)
        sticky.elevation = ui.dp(7).toFloat()
        sticky.setPadding(ui.dp(20), ui.dp(10), ui.dp(20), ui.dp(12))
        submitHelp = ui.text("", 12f, AttendanceUi.MUTED)
        submitHelp.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        sticky.addView(submitHelp)
        submit = actionButton(sticky, "Verify phone & mark attendance", primary = true, available = { canSubmit() }) {
            selectedSession()?.let { actions.onSubmit(it.id, statement.isChecked, roomCode?.text?.toString()?.trim().orEmpty()) }
        }
    }

    private fun buildSharing() {
        sharingCard = LocationSharingCard(context, body, model.employeeUid, model.sharingSnapshot,
            LocationSharingActions(actions.onStartSharing, actions.onStopSharing, actions.onMovementReport))
    }

    private fun selectedSession(): DashboardSession? = if (::sessions.isInitialized) model.events.getOrNull(sessions.selectedItemPosition - 1) else null
    private fun gate() = EmployeePresentation.checkInGate(model, selectedSession()?.id,
        ::statement.isInitialized && statement.isChecked, roomCode?.text?.toString().orEmpty(), refreshRequired)
    private fun canSubmit() = gate() == CheckInGate.READY
    fun currentSessionId(): String? = selectedSession()?.id
    fun invalidateCheckIn() { refreshRequired = true; statement.isChecked = false; roomCode?.text?.clear(); updateSelection() }

    private fun updateSelection() {
        if (!::submit.isInitialized || !::statement.isInitialized) return
        val selected = selectedSession()
        if (selected?.id != selectedSessionId) {
            selectedSessionId = selected?.id
            statement.isChecked = false
            roomCode?.text?.clear()
        }
        val receipt = selected?.let { model.receipts[it.id] }
        dataNotice.visibility = if (refreshRequired || model.loadedDate != Workday.date()) View.VISIBLE else View.GONE
        receiptContainer.removeAllViews()
        checkInControls.visibility = if (receipt == null) View.VISIBLE else View.GONE
        if (receipt != null) {
            val recordedAt = runCatching {
                DateTimeFormatter.ofPattern("d MMM yyyy · h:mm:ss a 'IST'").withZone(Workday.zone).format(Instant.parse(receipt.timestamp))
            }.getOrDefault("Original record time unavailable")
            ui.banner(receiptContainer, "Attendance recorded", "$recordedAt\n${if (receipt.mode == "setup") "Setup check-in · location not verified.\n" else ""}Repeat verifications preserve your original check-in time.", Tone.SUCCESS)
            if (receipt.phoneVerified) ui.chip(receiptContainer, "Phone passkey verified", Tone.SUCCESS)
            if (receipt.venueWifiObserved) ui.chip(receiptContainer, "Shikshavertex_5G observed at check-in", Tone.SUCCESS)
            if (!receiptFocused && selected.id == model.preferredSessionId) {
                receiptFocused = true
                receiptContainer.doOnLayout { it.requestRectangleOnScreen(android.graphics.Rect(0, 0, it.width, it.height), true) }
            }
        }
        submit.text = when {
            busy -> "Please wait…"
            receipt != null -> "Attendance already recorded"
            else -> "Verify phone & mark attendance"
        }
        submitHelp.setText(when (gate()) {
            CheckInGate.RECORDED -> R.string.dashboard_record_preserved
            CheckInGate.REFRESH_REQUIRED -> R.string.dashboard_refresh_needed
            CheckInGate.NO_SESSIONS -> R.string.dashboard_waiting
            CheckInGate.PASSKEY_SETUP -> R.string.dashboard_passkey_setup
            CheckInGate.PASSKEY_ENROLLMENT -> R.string.dashboard_passkey_enroll
            CheckInGate.NO_SELECTION -> R.string.dashboard_choose_session
            CheckInGate.SESSION_CLOSED -> R.string.dashboard_session_closed
            CheckInGate.GPS_REQUIRED -> R.string.dashboard_gps_needed
            CheckInGate.WIFI_REQUIRED -> R.string.dashboard_wifi_needed
            CheckInGate.STATEMENT_REQUIRED -> R.string.dashboard_statement
            CheckInGate.ROOM_CODE_REQUIRED -> R.string.dashboard_room_code
            CheckInGate.READY -> if (model.onsite) R.string.dashboard_ready_onsite else R.string.dashboard_ready_setup
        })
        applyEnabled()
    }

    private fun applyEnabled() { enabled.forEach { (view, available) -> view.isEnabled = !busy && available() } }

    fun setBusy(value: Boolean) { busy = value; updateSelection(); sharingCard.setBusy(value) }
    fun showMessage(value: String) {
        message.setTextColor(AttendanceUi.RED)
        message.text = value
        message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isNotBlank()) {
            message.sendAccessibilityEvent(AccessibilityEvent.TYPE_ANNOUNCEMENT)
            message.doOnLayout { it.requestRectangleOnScreen(android.graphics.Rect(0, 0, it.width, it.height), true) }
        }
    }
    fun showNotice(value: String) {
        message.setTextColor(AttendanceUi.GREEN); message.text = value
        message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isNotBlank()) message.doOnLayout { it.requestRectangleOnScreen(android.graphics.Rect(0, 0, it.width, it.height), true) }
    }
    fun updateSharing(value: SharingSnapshot) { sharingCard.update(value) }
}

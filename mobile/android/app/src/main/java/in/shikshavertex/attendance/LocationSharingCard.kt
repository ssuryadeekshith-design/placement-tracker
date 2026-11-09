package `in`.shikshavertex.attendance

import android.animation.ValueAnimator
import android.content.Context
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import androidx.core.view.ViewCompat
import java.time.Instant
import java.time.format.DateTimeFormatter

data class LocationSharingActions(val onStart: (Boolean) -> Unit, val onStop: () -> Unit, val onReport: () -> Unit)

/** Displays actual service observations. This card never infers activity from a saved consent record. */
class LocationSharingCard(private val context: Context, parent: LinearLayout, private val uid: String,
                          initial: SharingSnapshot, private val actions: LocationSharingActions) {
    private val ui = AttendanceUi(context)
    val root = ui.card(parent)
    private var snapshot = initial.forUser(uid)
    private var busy = false
    private var consentDate = Workday.date()
    private val details = ui.column().apply { visibility = View.GONE }
    private val status = ui.text("", 12f, AttendanceUi.MUTED, true)
    private val signal = ui.text("●", 14f, AttendanceUi.GREEN).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
    private val message = ui.text("", 13f, AttendanceUi.MUTED)
    private val lastSample = ui.text("", 12f, AttendanceUi.MUTED)
    private val lastUpload = ui.text("", 12f, AttendanceUi.MUTED)
    private val help = ui.text("", 12f, AttendanceUi.MUTED)
    private val notification = ui.column()
    private var pulse: ValueAnimator? = null
    private val toggle = ui.button(root, context.getString(R.string.sharing_show)) {
        details.visibility = if (details.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        updateToggle()
    }
    private val consent = CheckBox(context).apply {
        setText(R.string.sharing_consent); textSize = 13f; setTextColor(AttendanceUi.INK); minHeight = ui.dp(48)
    }
    private val start: android.widget.Button
    private val stop: android.widget.Button
    private val report: android.widget.Button

    init {
        ui.chip(root, "10:30 AM – 8:30 PM IST", Tone.NEUTRAL)
        val statusRow = ui.row()
        statusRow.addView(signal, LinearLayout.LayoutParams(ui.dp(22), -2))
        statusRow.addView(status, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(statusRow)
        status.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        root.addView(message); ui.space(root, 8)
        root.addView(lastSample); root.addView(lastUpload)
        // Keep Stop above the expandable consent/notification content and independent of dashboard busy state.
        stop = ui.button(root, context.getString(R.string.sharing_stop)) { if (!snapshot.stopInFlight) actions.onStop() }
        root.addView(details)
        ui.space(details, 10)
        details.addView(ui.text(context.getString(R.string.sharing_explanation), 13f, AttendanceUi.MUTED))
        details.addView(consent)
        start = ui.button(details, context.getString(R.string.sharing_start), true) {
            if (!busy && snapshot.canStart && Workday.contains() && consent.isChecked) actions.onStart(true)
        }
        root.addView(notification)
        ui.banner(notification, context.getString(R.string.sharing_notification), context.getString(R.string.sharing_notification_help), Tone.NEUTRAL)
        root.addView(help)
        report = ui.button(details, context.getString(R.string.sharing_report)) { if (!busy) actions.onReport() }
        consent.setOnCheckedChangeListener { _, _ -> updateControls() }
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            private var inWindow = Workday.contains()
            private val tick = object : Runnable {
                override fun run() {
                    val now = Workday.contains()
                    if (now != inWindow) { inWindow = now; consent.isChecked = false; updateControls() }
                    root.postDelayed(this, 1000)
                }
            }
            override fun onViewAttachedToWindow(v: View) { updateControls(); updatePulse(); root.post(tick) }
            override fun onViewDetachedFromWindow(v: View) { root.removeCallbacks(tick); pulse?.cancel(); pulse = null; signal.alpha = 1f }
        })
        update(initial)
        updateToggle()
    }
    private fun updateToggle() {
        val expanded = details.visibility == View.VISIBLE
        toggle.setText(if (expanded) R.string.sharing_hide else R.string.sharing_show)
        ViewCompat.setStateDescription(toggle, if (expanded) "Expanded" else "Collapsed")
    }
    fun update(value: SharingSnapshot) {
        val next = value.forUser(uid)
        if (next.token != snapshot.token || next.phase == SharingPhase.STARTING) consent.isChecked = false
        snapshot = next
        val (label, color) = when (snapshot.phase) {
            SharingPhase.OFF -> R.string.sharing_off to AttendanceUi.MUTED
            SharingPhase.STARTING -> R.string.sharing_starting to AttendanceUi.AMBER
            SharingPhase.WAITING -> R.string.sharing_waiting to AttendanceUi.AMBER
            SharingPhase.ACTIVE -> R.string.sharing_active to AttendanceUi.GREEN
            SharingPhase.DELAYED -> R.string.sharing_delayed to AttendanceUi.AMBER
            SharingPhase.STOPPED -> R.string.sharing_stopped to AttendanceUi.MUTED
            SharingPhase.ERROR -> R.string.sharing_failed to AttendanceUi.RED
        }
        if (status.text.toString() != context.getString(label)) status.setText(label)
        status.setTextColor(color)
        signal.setTextColor(if (snapshot.collecting) AttendanceUi.GREEN else color)
        message.text = snapshot.message
        message.setTextColor(if (snapshot.phase == SharingPhase.ERROR) AttendanceUi.RED else AttendanceUi.MUTED)
        lastSample.text = snapshot.lastSampleAt?.let { context.getString(R.string.sharing_last_sample, time(it)) } ?: context.getString(R.string.sharing_no_sample)
        lastUpload.text = snapshot.lastUploadAt?.let { context.getString(R.string.sharing_last_upload, time(it)) } ?: context.getString(R.string.sharing_no_upload)
        notification.visibility = if (snapshot.collecting) View.VISIBLE else View.GONE
        updateControls(); updatePulse()
    }
    private fun time(value: Long) = DateTimeFormatter.ofPattern("d MMM · h:mm:ss a 'IST'").withZone(Workday.zone).format(Instant.ofEpochMilli(value))
    private fun updateControls() {
        val today = Workday.date()
        if (today != consentDate) { consentDate = today; consent.isChecked = false }
        consent.isEnabled = !busy && snapshot.canStart
        start.isEnabled = !busy && snapshot.canStart && consent.isChecked && Workday.contains()
        start.setText(if (snapshot.phase == SharingPhase.STARTING) R.string.sharing_starting else R.string.sharing_start)
        stop.isEnabled = !snapshot.stopInFlight
        stop.setText(when {
            snapshot.stopInFlight -> R.string.sharing_stop_sending
            snapshot.stopPending -> R.string.sharing_retry_stop
            else -> R.string.sharing_stop
        })
        report.isEnabled = !busy
        help.setText(when {
            snapshot.stopInFlight -> R.string.sharing_confirming_stop
            snapshot.stopPending -> R.string.sharing_pending_stop
            snapshot.collecting || snapshot.phase == SharingPhase.STARTING -> R.string.sharing_running_help
            !Workday.contains() -> R.string.sharing_window
            else -> R.string.sharing_need_consent
        })
    }
    private fun updatePulse() {
        if (!root.isAttachedToWindow || !snapshot.collecting || !ValueAnimator.areAnimatorsEnabled()) {
            pulse?.cancel(); pulse = null; signal.alpha = 1f; return
        }
        if (pulse != null) return
        pulse = ValueAnimator.ofFloat(1f, .55f, 1f).apply {
            duration = 1900; repeatCount = ValueAnimator.INFINITE
            addUpdateListener { signal.alpha = it.animatedValue as Float }; start()
        }
    }
    fun setBusy(value: Boolean) { busy = value; updateControls() }
}

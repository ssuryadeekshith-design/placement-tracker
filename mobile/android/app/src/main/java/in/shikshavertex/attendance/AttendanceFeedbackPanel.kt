package `in`.shikshavertex.attendance

import android.content.Context
import android.view.View
import android.widget.LinearLayout
import java.time.Instant
import java.time.format.DateTimeFormatter

/** The receipt shown here is supplied by the server; animation never advances its timestamp. */
class AttendanceFeedbackPanel(context: Context, parent: LinearLayout, retry: () -> Unit) {
    private val ui = AttendanceUi(context)
    val root = ui.column().apply { visibility = View.GONE; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val icon = AttendanceOutcomeView(context)
    private val title = ui.text("", 20f, AttendanceUi.INDIGO, true).apply { gravity = android.view.Gravity.CENTER }
    private val detail = ui.text("", 13f, AttendanceUi.MUTED).apply { gravity = android.view.Gravity.CENTER }
    private val diagnostics = ui.column().apply { background = ui.rounded(AttendanceUi.CANVAS); setPadding(ui.dp(12),ui.dp(12),ui.dp(12),ui.dp(12)) }
    private val gps = ui.text("", 13f)
    private val connection = ui.text("", 13f)
    private val retryButton = ui.button(root,"Re-verify Office Location",action=retry)
    init {
        root.removeView(retryButton)
        root.addView(icon,LinearLayout.LayoutParams(-1,ui.dp(150)))
        root.addView(title); ui.space(root,8); root.addView(detail); ui.space(root,12)
        diagnostics.addView(gps); ui.space(diagnostics,6); diagnostics.addView(connection)
        root.addView(diagnostics); root.addView(retryButton); parent.addView(root)
    }
    fun verifying() {
        root.visibility=View.VISIBLE; title.text="Verifying Office Location…"
        title.setTextColor(AttendanceUi.BLUE); detail.text="Checking a fresh venue position and the office connection. No attendance is confirmed yet."
        diagnostics.visibility=View.GONE; retryButton.visibility=View.GONE
        icon.show(AttendanceOutcome.VERIFYING,true)
    }
    fun failure(value: AttendanceFailure) {
        root.visibility=View.VISIBLE; title.text=value.primary; title.setTextColor(AttendanceUi.RED)
        detail.text=value.detail; diagnostics.visibility=View.VISIBLE
        gps.text="Venue GPS · ${value.gps}"; connection.text="Shikshavertex_5G · ${value.connection}"
        retryButton.text=value.retryLabel; retryButton.visibility=View.VISIBLE
        icon.show(AttendanceOutcome.REJECTED,true)
    }
    fun receipt(value: DashboardReceipt, celebrate: Boolean) {
        root.visibility=View.VISIBLE; title.text="Attendance Marked!"; title.setTextColor(AttendanceUi.GREEN)
        val time=runCatching { DateTimeFormatter.ofPattern("d MMM yyyy · h:mm:ss a 'IST'").withZone(Workday.zone).format(Instant.parse(value.timestamp)) }.getOrDefault("Original check-in time unavailable")
        val verified=AttendanceFeedback.officeVerified(value)
        detail.text="Checked in at $time\n${if(verified) "Verified at Office" else "Office presence is not fully verified in this saved record."}\nYour first check-in timestamp is locked in. Checking again preserves this original time."
        diagnostics.visibility=View.GONE; retryButton.visibility=View.GONE
        icon.show(AttendanceOutcome.SUCCESS,celebrate)
    }
    fun setBusy(value: Boolean) { retryButton.isEnabled=!value }
    fun clear() { icon.pauseMotion(); root.visibility=View.GONE }
}

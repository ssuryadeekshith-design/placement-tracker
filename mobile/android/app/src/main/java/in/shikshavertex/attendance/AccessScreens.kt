package `in`.shikshavertex.attendance

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.core.view.doOnLayout
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class AuthActions(
    val onSignIn: (email: String, password: String) -> Unit,
    val onRegister: (email: String, password: String) -> Unit,
    val onReset: (email: String) -> Unit,
)

data class VerificationActions(val onVerified: () -> Unit, val onResend: () -> Unit, val onSignOut: () -> Unit)
data class ApprovalActions(val onRequest: (fullName: String) -> Unit, val onRefresh: () -> Unit, val onSignOut: () -> Unit)
data class HrActions(
    val onToggleSession: () -> Unit,
    val onApprove: (requestId: String, employeeId: String) -> Unit,
    val onReject: (requestId: String, reason: String) -> Unit,
    val onRefresh: () -> Unit,
    val onBack: () -> Unit,
    val onViewAttendance: () -> Unit,
)

/** Shared layout for the remaining account/HR surfaces; networking stays with the Activity. */
private class AccessFrame(context: Context, title: String, subtitle: String, step: Int = 0, showBrandLogo: Boolean = false) {
    val ui = AttendanceUi(context)
    val body = ui.canvas()
    private val available = mutableListOf<Pair<View, () -> Boolean>>()
    private var busy = false
    private val message = ui.text("", 14f, AttendanceUi.RED).apply {
        visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    val root: View = ScrollView(context).apply {
        setBackgroundColor(AttendanceUi.CANVAS); isFillViewport = true; clipToPadding = false
        addView(body)
    }

    init {
        val brand = ui.row().apply {
            setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(AttendanceUi.INDIGO, AttendanceUi.BLUE)).apply { cornerRadius = ui.dp(12).toFloat() }
        }
        if (showBrandLogo) {
            brand.addView(ImageView(context).apply {
                setImageResource(R.drawable.shikshavertex_launcher)
                scaleType = ImageView.ScaleType.FIT_CENTER
                background = ui.rounded(Color.WHITE, Color.WHITE, 10)
                clipToOutline = true
                // The adjacent SHIKSHAVERTEX text supplies the accessible brand name.
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(ui.dp(56), ui.dp(56)).apply { marginEnd = ui.dp(12) })
        } else {
            brand.addView(ui.text("SV", 18f, Color.WHITE, true).apply { letterSpacing = .08f }, LinearLayout.LayoutParams(ui.dp(46), -2))
        }
        val words = ui.column()
        words.addView(ui.text("SHIKSHAVERTEX", 12f, Color.WHITE, true).apply { letterSpacing = .12f })
        words.addView(ui.text("Employee workspace", 12f, Color.rgb(219, 234, 254)))
        brand.addView(words, LinearLayout.LayoutParams(0, -2, 1f)); body.addView(brand)
        ui.space(body, 20)
        if (step > 0) {
            val progress = ui.row()
            listOf("1  Account", "2  Verify", "3  Approval").forEachIndexed { index, label ->
                val active = index + 1 == step
                progress.addView(ui.text(label, 11f, if (active) AttendanceUi.BLUE else AttendanceUi.MUTED, active).apply {
                    gravity = Gravity.CENTER; setPadding(ui.dp(2), ui.dp(8), ui.dp(2), ui.dp(8))
                    background = ui.rounded(if (active) Color.rgb(239, 246, 255) else AttendanceUi.CANVAS)
                    contentDescription = "${label.substring(3)}${if (active) ", current step" else ""}"
                }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(4) })
            }
            body.addView(progress); ui.space(body, 16)
        }
        ui.section(body, title, subtitle); ui.space(body, 16)
        body.addView(message); ui.space(body, 6)
    }

    fun track(view: View, predicate: () -> Boolean = { true }) { available.add(view to predicate); update() }
    fun action(parent: LinearLayout, label: String, primary: Boolean = false, predicate: () -> Boolean = { true }, action: () -> Unit): Button =
        ui.button(parent, label, primary) { if (!busy && predicate()) action() }.also { track(it, predicate) }
    fun setBusy(value: Boolean) { busy = value; update() }
    fun update() { available.forEach { (view, predicate) -> view.isEnabled = !busy && predicate() } }
    fun forgetChildren(parent: ViewGroup) {
        available.removeAll { (view, _) ->
            var p = view.parent
            var found = view === parent
            while (p is View) { if (p === parent) found = true; p = p.parent }
            found
        }
    }
    fun showMessage(value: String) { displayMessage(value, AttendanceUi.RED) }
    fun showNotice(value: String) { displayMessage(value, AttendanceUi.GREEN) }
    private fun displayMessage(value: String, color: Int) {
        message.setTextColor(color)
        message.text = value; message.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isNotBlank()) message.doOnLayout { it.requestRectangleOnScreen(android.graphics.Rect(0, 0, it.width, it.height), true) }
    }
}

private fun EditText.onChanged(action: () -> Unit) = addTextChangedListener(object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { action() }
    override fun afterTextChanged(s: Editable?) {}
})

/** Respect Android's animation setting and stop pulse work as soon as the view leaves the window. */
private fun gentlePulse(view: View) {
    var animation: ValueAnimator? = null
    view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v: View) {
            if (!ValueAnimator.areAnimatorsEnabled()) return
            animation = ValueAnimator.ofFloat(1f, .6f, 1f).apply {
                duration = 1900; repeatCount = ValueAnimator.INFINITE
                addUpdateListener { v.alpha = it.animatedValue as Float }; start()
            }
        }
        override fun onViewDetachedFromWindow(v: View) { animation?.cancel(); animation = null; v.alpha = 1f }
    })
}

class AuthScreen(context: Context, boundEmail: String, private val actions: AuthActions) {
    private val frame = AccessFrame(context, "Your workday starts here", "Sign in or register with your work email.", 1, showBrandLogo = true)
    private val ui = frame.ui
    private var registration = false
    private var visiblePassword = false
    private val signInTab: Button
    private val registrationTab: Button
    private val email: EditText
    private val password: EditText
    private val passwordLabel: TextView
    private lateinit var visibility: Button
    private val submit: Button
    private val helper: TextView
    val root: View get() = frame.root

    init {
        val card = ui.card(frame.body)
        val tabs = ui.row(); card.addView(tabs)
        signInTab = frame.action(tabs, "Sign in") { selectMode(false) }
        registrationTab = frame.action(tabs, "First-time registration") { selectMode(true) }
        for (tab in listOf(signInTab, registrationTab)) tab.layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ui.dp(4) }
        helper = ui.text("", 12f, AttendanceUi.MUTED)
        card.addView(helper, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(14) })
        if (boundEmail.isNotBlank()) ui.banner(card, "This app profile has an account", "This profile was first registered to $boundEmail. Signing out retains the binding. Contact HR if this account needs recovery.", Tone.NEUTRAL)
        email = ui.field(card, "Work email", boundEmail).apply {
            id = View.generateViewId()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            imeOptions = EditorInfo.IME_ACTION_NEXT
            filters = arrayOf(InputFilter.LengthFilter(254)); importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
            setAutofillHints(View.AUTOFILL_HINT_EMAIL_ADDRESS)
        }
        (card.getChildAt(card.indexOfChild(email) - 1) as TextView).labelFor = email.id
        password = ui.field(card, "Password").apply {
            id = View.generateViewId()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            isSaveEnabled = false
            transformationMethod = PasswordTransformationMethod.getInstance()
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES; setAutofillHints(View.AUTOFILL_HINT_PASSWORD)
        }
        passwordLabel = (card.getChildAt(card.indexOfChild(password) - 1) as TextView).apply { labelFor = password.id }
        frame.track(email); frame.track(password)
        visibility = frame.action(card, "Show password") {
            visiblePassword = !visiblePassword
            password.transformationMethod = if (visiblePassword) null else PasswordTransformationMethod.getInstance()
            password.setSelection(password.text.length)
            visibility.text = if (visiblePassword) "Hide password" else "Show password"
            visibility.contentDescription = visibility.text
            visibility.isSelected = visiblePassword
        }
        submit = frame.action(card, "Sign in", true) {
            val address = email.text.toString().trim()
            val secret = password.text.toString()
            email.error = null; password.error = null
            when {
                !android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches() -> invalid(email, "Enter a valid work email address.")
                secret.isEmpty() -> invalid(password, if (registration) "Choose a password for this attendance account." else "Enter the password you chose when registering in this app.")
                registration && secret.length < 6 -> invalid(password, "Choose at least 6 characters. Your organization may require a stronger password.")
                registration -> { hidePassword(); actions.onRegister(address, secret) }
                else -> { hidePassword(); actions.onSignIn(address, secret) }
            }
        }
        email.nextFocusForwardId = password.id
        password.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) { submit.performClick(); true } else false
        }
        frame.action(card, "Reset password") {
            val address = email.text.toString().trim()
            email.error = null; password.error = null
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches()) invalid(email, "Enter your work email first so a reset link can be requested.")
            else { hidePassword(); actions.onReset(address) }
        }
        email.onChanged { email.error = null }
        password.onChanged { password.error = null }
        frame.body.addView(ui.text("Use your attendance account password. It can be different from your email password. Reset links are sent to the work email entered above.", 12f, AttendanceUi.MUTED))
        selectMode(false)
    }

    private fun invalid(field: EditText, message: String) { field.error = message; field.requestFocus(); frame.showMessage(message) }
    private fun selectMode(register: Boolean) {
        registration = register; clearPassword(); email.error = null; password.error = null; frame.showMessage("")
        for ((tab, selected) in listOf(signInTab to !register, registrationTab to register)) {
            tab.isSelected = selected
            tab.background = ui.rounded(if (selected) AttendanceUi.BLUE else AttendanceUi.CANVAS, if (selected) AttendanceUi.BLUE else AttendanceUi.BORDER)
            tab.setTextColor(if (selected) Color.WHITE else AttendanceUi.INK)
        }
        helper.text = if (register) "Directory listing does not auto-create an account. Register once with your work email." else "Welcome back. Sign in to your attendance account."
        passwordLabel.text = if (register) "Create password" else "Password"
        password.hint = passwordLabel.text; password.contentDescription = passwordLabel.text
        // The standard newPassword hint is recognized by autofill providers; View exposes only password.
        password.setAutofillHints(if (register) "newPassword" else View.AUTOFILL_HINT_PASSWORD)
        if (register) {
            helper.setTextColor(AttendanceUi.AMBER); helper.background = ui.rounded(Color.rgb(255, 251, 235), Color.rgb(254, 243, 199))
            helper.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10))
        } else { helper.setTextColor(AttendanceUi.MUTED); helper.background = null; helper.setPadding(0, 0, 0, 0) }
        submit.text = if (register) "Register & send verification email" else "Sign in"
    }
    fun hidePassword() {
        visiblePassword = false; password.transformationMethod = PasswordTransformationMethod.getInstance()
        visibility.text = "Show password"; visibility.contentDescription = visibility.text; visibility.isSelected = false
    }
    fun clearPassword() { password.text.clear(); hidePassword() }
    fun setBusy(value: Boolean) { frame.setBusy(value); submit.text = if (value) "Please wait…" else if (registration) "Register & send verification email" else "Sign in" }
    fun showMessage(value: String) = frame.showMessage(value)
    fun showNotice(value: String) = frame.showNotice(value)
}

enum class VerificationOperation { IDLE, CHECKING, SENDING }

class VerificationScreen(context: Context, email: String, resendWaitSeconds: Int, private val actions: VerificationActions) {
    private val frame = AccessFrame(context, "Verify your work email", "One email link confirms ownership of your account.", 2)
    private var waitSeconds = resendWaitSeconds.coerceAtLeast(0)
    private var verified = false
    private var operation = VerificationOperation.IDLE
    private val verify: Button
    private val resend: Button
    private val status: TextView
    private val guidance: TextView
    private val cooldownHelp: TextView
    val root: View get() = frame.root

    init {
        val ui = frame.ui
        val card = ui.card(frame.body)
        val icon = ui.text("✉", 40f, AttendanceUi.BLUE, true).apply { gravity = Gravity.CENTER; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        card.addView(icon, LinearLayout.LayoutParams(-1, ui.dp(78))); gentlePulse(icon)
        card.addView(ui.text(email, 16f, AttendanceUi.INDIGO, true).apply { textDirection = View.TEXT_DIRECTION_LTR })
        ui.space(card)
        status = ui.chip(card, "Awaiting email verification", Tone.WARNING).apply {
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        guidance = ui.text("Open the verification email and tap its link. Then return here and check your status. If you need another email, use Resend below. Check your spam folder too.", 14f, AttendanceUi.MUTED)
        card.addView(guidance)
        verify = frame.action(card, "I have verified my email", true, action = actions.onVerified)
        resend = frame.action(card, "Resend verification email", predicate = { !verified && waitSeconds == 0 }, action = actions.onResend)
        cooldownHelp = ui.text("", 12f, AttendanceUi.MUTED)
        card.addView(cooldownHelp, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(10) })
        frame.body.addView(ui.text("Email verification confirms your address. Existing HR approval and attendance access rules still apply. If a link has expired or was already used, check your status before requesting another.", 12f, AttendanceUi.MUTED))
        frame.action(frame.body, "Sign out", action = actions.onSignOut)
        updateCooldown(waitSeconds)
    }
    fun updateCooldown(seconds: Int) {
        waitSeconds = seconds.coerceAtLeast(0)
        cooldownHelp.setText(when {
            verified -> R.string.verification_confirmed_help
            waitSeconds > 0 -> R.string.verification_wait_help
            else -> R.string.verification_resend_help
        })
        updateLabels(); frame.update()
    }
    fun setOperation(value: VerificationOperation) { operation = value; updateLabels() }
    private fun updateLabels() {
        verify.setText(when {
            operation == VerificationOperation.CHECKING -> R.string.verification_checking
            verified -> R.string.verification_continue
            else -> R.string.verification_check
        })
        resend.text = when {
            operation == VerificationOperation.SENDING -> root.context.getString(R.string.verification_sending)
            verified -> root.context.getString(R.string.verification_already_confirmed)
            waitSeconds > 0 -> root.context.getString(R.string.verification_resend_wait, waitSeconds)
            else -> root.context.getString(R.string.verification_resend)
        }
    }
    fun showUnverified() {
        verified = false
        status.setText(R.string.verification_pending)
        status.setTextColor(AttendanceUi.AMBER)
        status.background = frame.ui.rounded(Color.rgb(255, 251, 235), Color.rgb(255, 251, 235), 8)
        guidance.setText(R.string.verification_pending_help)
        updateCooldown(waitSeconds)
    }
    fun markVerified() {
        verified = true
        status.setText(R.string.verification_confirmed)
        status.setTextColor(AttendanceUi.GREEN)
        status.background = frame.ui.rounded(Color.rgb(236, 253, 245), Color.rgb(236, 253, 245), 8)
        guidance.setText(R.string.verification_access_help)
        updateCooldown(waitSeconds)
    }
    fun setBusy(value: Boolean) { frame.setBusy(value); if (!value) operation = VerificationOperation.IDLE; updateLabels() }
    fun showMessage(value: String) = frame.showMessage(value)
    fun showNotice(value: String) = frame.showNotice(value)
}

enum class ApprovalOperation { IDLE, REQUESTING, CHECKING }

class EmployeeApprovalScreen(context: Context, email: String, private val status: JSONObject, private val actions: ApprovalActions, emailVerified: Boolean = false) {
    private val frame = AccessFrame(context, "Employee access approval", "HR links your verified account to the correct employee profile.", 3)
    private val ui = frame.ui
    private var state = ApprovalPresentation.state(status.opt("status") as? String, status.opt("approved") as? Boolean)
    private var operation = ApprovalOperation.IDLE
    private val panel: LinearLayout
    private val refresh: Button
    private var request: Button? = null
    val root: View get() = frame.root

    init {
        val identity = ui.card(frame.body)
        identity.addView(ui.text("Work email", 12f, AttendanceUi.MUTED, true))
        identity.addView(ui.text(email, 15f, AttendanceUi.INDIGO, true).apply { textDirection = View.TEXT_DIRECTION_LTR; setTextIsSelectable(true) })
        if (emailVerified) { ui.space(identity, 8); ui.chip(identity, "Email verified", Tone.SUCCESS) }
        panel = ui.card(frame.body)
        refresh = frame.action(frame.body, context.getString(R.string.approval_check), true, action = actions.onRefresh)
        val support = ui.card(frame.body)
        ui.section(support, context.getString(R.string.approval_hr_contact), context.getString(R.string.approval_contact_help))
        ui.space(support, 8)
        support.addView(ui.text("hr@shikshavertex.in", 14f, AttendanceUi.BLUE, true).apply { setTextIsSelectable(true); textDirection = View.TEXT_DIRECTION_LTR })
        frame.action(support, context.getString(R.string.approval_copy_contact)) {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("HR contact", "hr@shikshavertex.in"))
            frame.showNotice(context.getString(R.string.approval_contact_copied))
        }
        frame.body.addView(ui.text(context.getString(R.string.approval_access_note), 12f, AttendanceUi.MUTED))
        frame.action(frame.body, "Sign out", action = actions.onSignOut)
        renderState()
    }

    private fun renderState() {
        frame.forgetChildren(panel); panel.removeAllViews(); request = null
        fun words(id: Int) { panel.addView(ui.text(root.context.getString(id), 14f, AttendanceUi.MUTED)) }
        fun chip(id: Int, tone: Tone) = ui.chip(panel, root.context.getString(id), tone).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        when (state) {
            EmployeeApprovalState.REQUEST -> {
                ui.section(panel, root.context.getString(R.string.approval_request_title), root.context.getString(R.string.approval_request_help))
                val name = ui.field(panel, root.context.getString(R.string.approval_name)).apply {
                    id = View.generateViewId(); filters = arrayOf(InputFilter.LengthFilter(120))
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
                    imeOptions = EditorInfo.IME_ACTION_DONE
                    setAutofillHints(View.AUTOFILL_HINT_NAME)
                }
                (panel.getChildAt(panel.indexOfChild(name) - 1) as TextView).labelFor = name.id
                frame.track(name)
                words(R.string.approval_name_help)
                request = frame.action(panel, root.context.getString(R.string.approval_request_title), true,
                    predicate = { state == EmployeeApprovalState.REQUEST && ApprovalPresentation.validName(name.text.toString()) }) {
                    actions.onRequest(name.text.toString().trim())
                }
                name.onChanged(frame::update)
                name.setOnEditorActionListener { _, actionId, _ ->
                    if (actionId == EditorInfo.IME_ACTION_DONE) { request?.performClick(); true } else false
                }
            }
            EmployeeApprovalState.PENDING -> {
                val heading = ui.row(); panel.addView(heading)
                val dot = ui.text("●", 14f, AttendanceUi.AMBER).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
                heading.addView(dot, LinearLayout.LayoutParams(ui.dp(20), -2)); gentlePulse(dot)
                ui.chip(heading, root.context.getString(R.string.approval_pending), Tone.WARNING)
                words(R.string.approval_pending_help)
                (status.opt("requestedName") as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let { name ->
                    ui.space(panel)
                    panel.addView(ui.text(root.context.getString(R.string.approval_requested_name), 12f, AttendanceUi.MUTED, true))
                    panel.addView(ui.text(name, 15f, AttendanceUi.INDIGO, true))
                }
            }
            EmployeeApprovalState.REJECTED -> {
                chip(R.string.approval_rejected, Tone.DANGER)
                panel.addView(ui.text(root.context.getString(R.string.approval_reason), 12f, AttendanceUi.MUTED, true))
                val reason = (status.opt("reason") as? String)?.trim()?.takeIf { it.isNotEmpty() }
                panel.addView(ui.text(reason ?: root.context.getString(R.string.approval_no_reason), 14f, AttendanceUi.INK).apply { setTextIsSelectable(true) })
                ui.space(panel); words(R.string.approval_rejected_help)
            }
            EmployeeApprovalState.RECOVERY -> {
                chip(R.string.approval_recovery, Tone.DANGER); words(R.string.approval_recovery_help)
            }
            EmployeeApprovalState.APPROVED -> {
                chip(R.string.approval_confirmed, Tone.SUCCESS); words(R.string.approval_confirmed_help)
            }
            EmployeeApprovalState.UNAVAILABLE -> {
                chip(R.string.approval_unavailable, Tone.NEUTRAL); words(R.string.approval_unavailable_help)
            }
        }
        updateLabels(); frame.update()
    }
    fun markStatusUnavailable() { state = EmployeeApprovalState.UNAVAILABLE; renderState() }
    fun setOperation(value: ApprovalOperation) { operation = value; updateLabels() }
    private fun updateLabels() {
        request?.setText(if (operation == ApprovalOperation.REQUESTING) R.string.approval_sending else R.string.approval_request_title)
        refresh.setText(when {
            operation == ApprovalOperation.CHECKING -> R.string.approval_checking
            state == EmployeeApprovalState.APPROVED -> R.string.approval_continue
            else -> R.string.approval_check
        })
    }
    fun setBusy(value: Boolean) { frame.setBusy(value); if (!value) operation = ApprovalOperation.IDLE; updateLabels() }
    fun showMessage(value: String) = frame.showMessage(value)
    fun showNotice(value: String) = frame.showNotice(value)
}

class HrControlsScreen(context: Context, dailyOpen: Boolean, pendingRequests: JSONArray, employees: JSONArray, private val actions: HrActions) {
    private val frame = AccessFrame(context, "HR command center", "Manage daily check-in and review employee identities.")
    private val ui = frame.ui
    private val requests = (0 until pendingRequests.length()).map { pendingRequests.getJSONObject(it) }
    private val profiles = (0 until employees.length()).map { employees.getJSONObject(it) }
    private val queue: LinearLayout
    private val sessionSection: LinearLayout
    private val queueHeader: LinearLayout
    private var fresh = true
    private val context = context
    val root: View get() = frame.root

    init {
        frame.action(frame.body, "‹ Back to my attendance", action = actions.onBack)
        val session = ui.card(frame.body); sessionSection = session
        ui.section(session, "Today's attendance", "${Workday.date()} · India time · loaded session state")
        ui.space(session)
        ui.chip(session, if (dailyOpen) "Check-in open" else "Check-in closed", if (dailyOpen) Tone.SUCCESS else Tone.DANGER)
        session.addView(ui.text(if (dailyOpen) "Employees can select today's attendance and mark their own check-in." else "Open today's attendance before employees try to check in. Existing records remain available when a session closes.", 13f, AttendanceUi.MUTED))
        frame.action(session, if (dailyOpen) "Close today's attendance" else "Open today's attendance", true, predicate = { fresh }, action = actions.onToggleSession)
        frame.action(frame.body, "View everyone's attendance", action = actions.onViewAttendance)
        frame.action(frame.body, "Refresh HR controls", action = actions.onRefresh)
        val heading = ui.card(frame.body); queueHeader = heading
        ui.section(heading, "Pending approval queue", "Match each verified account to the right directory profile. A job title does not grant administrator access.")
        ui.space(heading, 10); ui.chip(heading, "${requests.size} pending requests", Tone.WARNING)
        val search = ui.field(heading, "Search requests by employee name or email")
        frame.track(search)
        queue = ui.column(); frame.body.addView(queue)
        search.onChanged { drawRequests(search.text.toString()) }
        drawRequests("")
    }

    private fun drawRequests(query: String) {
        frame.forgetChildren(queue); queue.removeAllViews()
        val match = requests.filter { "${it.optString("fullName")} ${it.optString("email")}".lowercase(Locale.ROOT).contains(query.trim().lowercase(Locale.ROOT)) }
        if (match.isEmpty()) {
            ui.banner(queue, if (requests.isEmpty()) "No pending requests" else "No matching requests", if (requests.isEmpty()) "Verified employee applications will appear here for review." else "Try another name or work email.", Tone.NEUTRAL)
        }
        for (request in match) requestCard(request)
        frame.update()
    }

    private fun requestCard(request: JSONObject) {
        val card = ui.card(queue)
        val name = request.optString("fullName").ifBlank { "Employee request" }
        val email = request.optString("email")
        card.addView(ui.text(name, 16f, AttendanceUi.INDIGO, true))
        card.addView(ui.text(email, 13f, AttendanceUi.MUTED))
        if (request.opt("emailVerified") == true) ui.chip(card, "Verified work email", Tone.SUCCESS)
        ui.chip(card, "Pending review", Tone.WARNING)
        val details = ui.column().apply { visibility = View.GONE }
        val toggle = frame.action(card, "Review application") { details.visibility = if (details.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
        toggle.contentDescription = "Review application for $name"
        card.addView(details)
        ui.space(details)
        details.addView(ui.text("Confirm this person's identity before selecting a directory profile. Search does not select a match automatically.", 13f, AttendanceUi.MUTED))
        val profileSearch = ui.field(details, "Search matching employee profiles")
        val picker = Spinner(context).apply { contentDescription = "Matching employee for $name"; minimumHeight = ui.dp(52) }
        details.addView(picker, LinearLayout.LayoutParams(-1, -2))
        var choices = emptyList<JSONObject>()
        var selectedId = ""
        var replacing = false
        val selectedSummary = ui.text(context.getString(R.string.hr_match_none), 13f, AttendanceUi.INDIGO, true)
        details.addView(selectedSummary)
        val confirmed = android.widget.CheckBox(context).apply {
            setText(R.string.hr_match_confirm); textSize = 13f; setTextColor(AttendanceUi.INK); minHeight = ui.dp(48)
        }
        details.addView(confirmed)
        frame.track(confirmed) { selectedId.isNotBlank() && fresh }
        val eligible = profiles.filter { profile ->
            HrProfileMatch.eligible(profile.opt("active") == true, profile.optString("employeeId"), profile.opt("uid") as? String,
                profile.opt("email") as? String, request.optString("uid"), email)
        }
        fun updateChoices() {
            selectedId = ""; replacing = true; confirmed.isChecked = false; selectedSummary.setText(R.string.hr_match_none)
            val filter = profileSearch.text.toString().trim().lowercase(Locale.ROOT)
            choices = eligible.filter { "${it.optString("employeeId")} ${it.optString("fullName")} ${it.optString("designation")} ${it.optString("department")} ${it.optString("team")}".lowercase(Locale.ROOT).contains(filter) }
            picker.adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item,
                listOf(if (choices.isEmpty()) "No matching active employee" else "Select matching employee") + choices.map { "${it.optString("employeeId")} · ${it.optString("fullName")} · ${it.optString("department")} · ${it.optString("team")}" })
            picker.setSelection(0, false); replacing = false; frame.update()
        }
        picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) { selectedId = ""; confirmed.isChecked = false; selectedSummary.setText(R.string.hr_match_none); frame.update() }
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (replacing || picker.selectedItemPosition != position) return
                val profile = choices.getOrNull(position - 1)
                selectedId = profile?.optString("employeeId").orEmpty(); confirmed.isChecked = false
                selectedSummary.text = if (profile == null) context.getString(R.string.hr_match_none) else context.getString(R.string.hr_match_summary,
                    selectedId, profile.optString("fullName"), profile.optString("department"), profile.optString("team"), profile.optString("designation"))
                frame.update()
            }
        }
        frame.track(profileSearch); frame.track(picker) { choices.isNotEmpty() }
        confirmed.setOnCheckedChangeListener { _, _ -> frame.update() }
        if (request.opt("emailVerified") != true) details.addView(ui.text("Work-email verification is not confirmed in this request. Refresh or review the account before approving.", 13f, AttendanceUi.RED))
        frame.action(details, "Approve employee", true, predicate = { fresh && request.opt("emailVerified") == true && selectedId.isNotBlank() && confirmed.isChecked }) { actions.onApprove(request.getString("id"), selectedId) }
        val reason = ui.field(details, "Reason if rejecting (at least 5 characters)").apply { filters = arrayOf(InputFilter.LengthFilter(300)) }
        frame.track(reason)
        details.addView(ui.text(context.getString(R.string.hr_rejection_help), 12f, AttendanceUi.MUTED))
        frame.action(details, "Reject request", predicate = { fresh && reason.text.toString().trim().length in 5..300 }) { actions.onReject(request.getString("id"), reason.text.toString().trim()) }
        reason.onChanged(frame::update); profileSearch.onChanged { updateChoices() }; updateChoices()
    }

    fun markUnavailable() {
        fresh = false
        for (section in listOf(sessionSection, queueHeader, queue)) { frame.forgetChildren(section); section.removeAllViews() }
        queueHeader.visibility = View.GONE
        ui.section(sessionSection, context.getString(R.string.hr_unavailable), context.getString(R.string.hr_unavailable_help))
        frame.update()
    }
    fun setBusy(value: Boolean) = frame.setBusy(value)
    fun showMessage(value: String) = frame.showMessage(value)
    fun showNotice(value: String) = frame.showNotice(value)
}

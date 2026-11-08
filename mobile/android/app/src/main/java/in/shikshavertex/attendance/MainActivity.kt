package `in`.shikshavertex.attendance

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeFormatter

class MainActivity : FragmentActivity() {
    private lateinit var content: LinearLayout
    private lateinit var message: TextView
    private lateinit var auth: FirebaseAuth
    private lateinit var api: ApiClient
    private var busy = false
    private var venueUnlocked = false
    private var ceremonyInProgress = false
    private var restoreAfterPrompt = false
    private var actionGeneration = 0L
    private var venueRevision = 0L
    private var actionJob: Job? = null
    private var policyJob: Job? = null
    private var policyLoaded = false
    private var reportDialog: AlertDialog? = null
    private lateinit var venueMonitor: VenueMonitor
    private var session: JSONObject? = null
    private var registeredPasskey = false
    private var biometricConfigured = false
    private var pendingPermissions: (() -> Unit)? = null
    private val buttons = mutableListOf<Button>()
    private var trackingLabel: TextView? = null
    private var dashboardScreen: EmployeeDashboardScreen? = null
    private var viewerScreen: AttendanceViewerScreen? = null
    private var designedBusy: ((Boolean) -> Unit)? = null
    private var designedMessage: ((String) -> Unit)? = null
    private var preferredAttendanceSession = ""
    private val savedReceipts = mutableMapOf<String, JSONObject>()
    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val action = pendingPermissions
        pendingPermissions = null
        if (grants.values.all { it }) action?.invoke()
        else showMessage("Permission was not granted. No tracking or check-in has started. Enable precise location and notifications in Android settings as needed.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        venueMonitor = VenueMonitor(this) { allowed, reason ->
            if (allowed && !venueUnlocked) {
                AttendanceWifi.startObserving(this)
                venueUnlocked = true; venueRevision++
                if (AttendanceApplication.configured && !ceremonyInProgress) openAccount()
            } else if (!allowed) lockVenue(reason)
        }
        layout()
        if (!AttendanceApplication.configured) {
            if (AttendanceApplication.firebaseConfigured) {
                heading("Firebase connected — attendance service needed")
                text("Firebase is configured. The attendance service address is still missing from this build. Ask the administrator for an updated build connected to the hosted attendance service. No tracking is running.")
            } else {
                heading("Connect your attendance project")
                text("Firebase Android configuration is missing or invalid in this build. Ask the administrator for a configured build. No tracking is running.")
            }
            return
        }
        try { auth = FirebaseAuth.getInstance(); api = ApiClient(this) }
        catch (_: Exception) { text("The app configuration is invalid. Ask the administrator for a configured build. No tracking is running."); return }
        lifecycleScope.launch { TrackingService.state.collect { trackingLabel?.text = it; dashboardScreen?.updateTracking(it) } }
        lockVenue("Loading attendance settings…")
    }
    override fun onResume() {
        super.onResume()
        if (::api.isInitialized) refreshAccessPolicy()
    }
    override fun onPause() {
        policyJob?.cancel()
        AttendanceWifi.stopObserving()
        if (::venueMonitor.isInitialized) venueMonitor.stop()
        if (::api.isInitialized) {
            lockVenue("Return to the app to continue.")
        }
        super.onPause()
    }
    private fun refreshAccessPolicy() {
        policyJob?.cancel()
        policyJob = lifecycleScope.launch {
            try {
                AttendancePolicyState.current = api.loadPolicy()
                policyLoaded = true
                if (AttendancePolicyState.current.onsiteRequired) {
                    lockVenue("Allow precise location to open the app at the venue.")
                    venueMonitor.start()
                } else {
                    venueUnlocked = true; venueRevision++
                    if (!ceremonyInProgress) openAccount()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { policyLoaded = false; lockVenue(error.message ?: "Cannot load attendance settings. Check your internet and retry.") }
        }
    }
    private fun openAccount() {
        if (!venueUnlocked) return
        val user = auth.currentUser
        if (user == null) renderLogin() else if (!user.isEmailVerified) renderVerification() else runAction { establishSession() }
    }
    private fun lockVenue(reason: String) {
        val wasUnlocked = venueUnlocked
        if (wasUnlocked && AttendancePolicyState.current.onsiteRequired && ::api.isInitialized && !ceremonyInProgress) lifecycleScope.launch { runCatching { api.json("/access/lock", "POST", JSONObject()) } }
        venueUnlocked = false; venueRevision++; if (!ceremonyInProgress) actionJob?.cancel(); busy = false
        VenueAccessState.lock(); reportDialog?.dismiss(); reportDialog = null
        layout(); heading(if (policyLoaded && AttendancePolicyState.current.onsiteRequired) "App locked — venue access required" else "Attendance access"); text(reason)
        if (policyLoaded && AttendancePolicyState.current.onsiteRequired) {
            text("Visit Srivari Arcade at 12.912773610440954, 77.62322878099566. Access requires a fresh, accurate location inside the 100 m venue area. GPS cannot identify the second floor.", 14f)
            text("Foreground location checks unlock the app; they do not start workday tracking or save an access-location history. If you already consented to daily sharing, that visible service continues while away so departure and return can be reported.", 13f)
            button("Allow precise location / retry") {
                requestPermissionsThen(false) { venueMonitor.start() }
            }
            button("View venue on Maps") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.app.goo.gl/1t5uN5hefMxJEWKdA"))) }
        } else button("Retry attendance settings") { refreshAccessPolicy() }
        button("Stop location sharing") {
            stopService(Intent(this, TrackingService::class.java)); TrackingService.state.value = "Location tracking stopped on this phone."
            lifecycleScope.launch { runCatching { api.json("/tracking/stop", "POST", JSONObject()) }; showMessage("Location sharing stopped on this phone.") }
        }
        if (::auth.isInitialized && auth.currentUser != null) button("Sign out and stop sharing") {
            stopService(Intent(this, TrackingService::class.java)); auth.signOut(); session = null
            showMessage("Signed out. The browser/app binding is retained.")
        }
    }

    private fun layout() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        dashboardScreen = null; viewerScreen = null; designedBusy = null; designedMessage = null
        buttons.clear()
        trackingLabel = null
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(24), dp(22), dp(34))
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(content) })
        text("SHIKSHA VERTEX · BENGALURU", 12f).setTextColor(Color.rgb(22, 112, 86))
        heading("Attendance portal")
        if (policyLoaded && !AttendancePolicyState.current.onsiteRequired) text("Temporary setup mode: attendance does not check GPS, venue Wi-Fi or a room code. Physical presence is not verified.", 14f)
        message = text("").apply { setTextColor(Color.rgb(150, 48, 25)); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    }
    private fun heading(value: String) = text(value, 25f).apply { setPadding(0, dp(12), 0, dp(10)); setTextColor(Color.rgb(23, 49, 45)) }
    private fun text(value: String, size: Float = 15f): TextView = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.rgb(65, 82, 75)); setLineSpacing(dp(4).toFloat(), 1f)
        setPadding(0, dp(6), 0, dp(8)); content.addView(this)
    }
    private fun input(label: String, password: Boolean = false): EditText {
        text(label, 14f)
        return EditText(this).apply {
            hint = label; contentDescription = label; isSingleLine = true
            inputType = if (password) android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD else android.text.InputType.TYPE_CLASS_TEXT
            content.addView(this, LinearLayout.LayoutParams(-1, dp(54)))
        }
    }
    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label; isAllCaps = false; minHeight = dp(52); setTextColor(Color.rgb(22, 112, 86))
        setOnClickListener { if (!busy) action() }
        content.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }); buttons.add(this)
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun showMessage(value: String) {
        val display = designedMessage
        if (display != null) display(value) else message.text = value
    }
    private fun mountDesigned(view: View, setBusy: (Boolean) -> Unit, displayMessage: (String) -> Unit) {
        restoreAfterPrompt = false
        buttons.clear(); trackingLabel = null
        designedBusy = setBusy; designedMessage = displayMessage
        view.fitsSystemWindows = false
        val left = view.paddingLeft; val top = view.paddingTop
        val right = view.paddingRight; val bottom = view.paddingBottom
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + maxOf(bars.bottom, ime.bottom))
            insets
        }
        setContentView(view); ViewCompat.requestApplyInsets(view)
        setBusy(busy)
    }
    private fun runAction(action: suspend () -> Unit) {
        if (busy || !venueUnlocked) return
        val generation = ++actionGeneration
        busy = true; buttons.forEach { it.isEnabled = false }; designedBusy?.invoke(true); showMessage("")
        actionJob = lifecycleScope.launch {
            try { action() } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) {
                if (venueUnlocked && generation == actionGeneration) {
                    if (restoreAfterPrompt) { restoreAfterPrompt = false; runCatching { renderDashboard() } }
                    showMessage(error.message ?: "The operation failed. Please try again.")
                }
            } finally { if (generation == actionGeneration) { busy = false; buttons.forEach { it.isEnabled = true }; designedBusy?.invoke(false) } }
        }
    }
    private fun showDesignLoading(title: String) {
        val ui = AttendanceUi(this)
        val root = ui.canvas()
        root.addView(ui.text("SHIKSHAVERTEX", 12f, AttendanceUi.INDIGO, true))
        ui.space(root); ui.section(root, title, "Retrieving your authorized attendance data.")
        ui.space(root)
        val card = ui.card(root)
        val progress = android.widget.ProgressBar(this)
        card.addView(progress)
        val error = ui.text("", 14f, AttendanceUi.RED).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        card.addView(error)
        val retry = ui.button(card, "Retry", true) { runAction { renderDashboard() } }
        val signOut = ui.button(card, "Sign out") { signOutAccount() }
        mountDesigned(root, { loading -> progress.visibility = if (loading) View.VISIBLE else View.GONE; retry.isEnabled = !loading; signOut.isEnabled = !loading }, { value -> error.text = value; if (value.isNotBlank()) progress.visibility = View.GONE })
    }

    private fun renderLogin() {
        if (!venueUnlocked) return
        layout()
        text("Use your Shiksha Vertex work email. Verify ownership, then request HR approval before marking attendance.")
        val binding = getSharedPreferences("browser_binding", MODE_PRIVATE).getString("bound_email", null)
        if (binding != null) text("This app profile was first registered to $binding. Signing out keeps its binding. Clearing app data or reinstalling resets this profile; it is not a permanent physical-phone identifier.", 13f)
        val email = input("Email address").apply { inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; setText(binding ?: "") }
        val password = input("Password", true)
        button("Sign in") { runAction {
            auth.signInWithEmailAndPassword(email.text.toString().trim(), password.text.toString()).await()
            password.text.clear()
            auth.currentUser?.reload()?.await()
            if (auth.currentUser?.isEmailVerified == true) establishSession() else renderVerification()
        } }
        button("Register and send verification email") { runAction {
            val result = auth.createUserWithEmailAndPassword(email.text.toString().trim(), password.text.toString()).await()
            result.user?.sendEmailVerification()?.await()
            password.text.clear(); renderVerification(); showMessage("Verification email sent. Open its link, then return here.")
        } }
        button("Reset password") { runAction {
            auth.sendPasswordResetEmail(email.text.toString().trim()).await()
            showMessage("If this email has an account, a password reset link has been sent.")
        } }
        text("Fingerprints and face templates never leave Android. Passkeys confirm the phone's user verification; Android may use a device PIN instead of biometrics. GPS cannot identify the second floor.", 13f)
    }
    private fun renderVerification() {
        if (!venueUnlocked) return
        layout()
        text("Verify your email: ${auth.currentUser?.email ?: ""}. Open the email verification link before continuing.")
        button("I have verified my email") { runAction {
            auth.currentUser?.reload()?.await()
            if (auth.currentUser?.isEmailVerified == true) establishSession() else showMessage("Email is not verified yet. Check your inbox and spam folder.")
        } }
        button("Resend verification email") { runAction { auth.currentUser?.sendEmailVerification()?.await(); showMessage("Verification email sent.") } }
        button("Sign out") { auth.signOut(); renderLogin() }
    }
    private suspend fun establishSession() {
        if (!venueUnlocked) return
        // reload() updates the profile; force-refresh the signed email_verified claim as well.
        auth.currentUser?.getIdToken(true)?.await()
        try {
            session = api.json("/session", "POST", JSONObject())
        } catch (error: ApiException) {
            if (error.code != "HR_APPROVAL_REQUIRED") throw error
            val status = api.json("/registration/status")
            if (!status.optBoolean("approved")) { renderEmployeeApproval(status); return }
            // HR bootstrap/approval changes signed claims, so refresh before use.
            auth.currentUser?.getIdToken(true)?.await()
            session = api.json("/session", "POST", JSONObject())
        }
        val email = session?.optJSONObject("user")?.optString("email") ?: ""
        getSharedPreferences("browser_binding", MODE_PRIVATE).edit().putString("bound_email", email).apply()
        renderDashboard()
    }
    private fun renderEmployeeApproval(status: JSONObject) {
        if (!venueUnlocked) return
        layout(); heading("Employee access approval")
        text(auth.currentUser?.email ?: "Verified work email")
        text("Use your verified @shikshavertex.in email. HR must approve your identity before you can mark attendance.")
        when (status.optString("status")) {
            "pending" -> text("Your request is pending HR approval. Attendance access is not yet available.")
            "rejected" -> text("Request rejected: ${status.optString("reason")}. Contact HR for review.")
            "access-unavailable" -> text("Your account requires HR recovery. A new registration cannot restore revoked access.")
            else -> {
                val name = input("Full employee name")
                button("Request HR approval") { runAction {
                    api.json("/registration/request", "POST", JSONObject().put("fullName", name.text.toString().trim()))
                    renderEmployeeApproval(api.json("/registration/status"))
                } }
            }
        }
        button("Check approval status") { runAction { establishSession() } }
        button("Sign out") { auth.signOut(); session = null; renderLogin() }
    }
    private suspend fun renderDashboard() {
        if (!venueUnlocked) return
        val employee = session?.optJSONObject("user") ?: return
        if (dashboardScreen == null && viewerScreen == null) showDesignLoading(if (employee.optString("role") == "attendance-viewer") "Loading attendance records" else "Loading my attendance")
        if (employee.optString("role") == "attendance-viewer") { renderAttendanceReport(); return }
        val eventResponse = api.array("/events")
        val biometric = api.json("/biometrics")
        val history = api.json("/attendance-summary").optJSONArray("logs")
        registeredPasskey = biometric.optBoolean("registered")
        biometricConfigured = biometric.optBoolean("configured")
        val allEvents = (0 until eventResponse.length()).map { eventResponse.getJSONObject(it) }
        val today = allEvents.filter { it.optString("date") == Workday.date() }
        val uid = employee.optString("uid")
        if (history != null) for (i in 0 until history.length()) {
            val record = history.getJSONObject(i)
            if (record.optString("uid") == uid) savedReceipts["$uid:${record.optString("eventId")}"] = record
        }
        val receipts = savedReceipts.values.filter { it.optString("uid") == uid }.map { record ->
            ReceiptRecord(uid, record.optString("eventId"), record.optString("timestamp"), record.optString("attendanceMode", "legacy"),
                record.optJSONObject("verification")?.optString("method") == "passkey-user-verification",
                record.optJSONObject("wifi")?.let { it.optString("ssid") == WifiRule.REQUIRED_SSID && it.optString("verification") == "native-client-observation" } == true)
        }
        val todayReceipts = EmployeePresentation.receipts(uid, today.map { it.optString("id") }.toSet(), receipts)
        val sessions = today.filter { it.optBoolean("checkInOpen") || todayReceipts.containsKey(it.optString("id")) }
        val onsite = AttendancePolicyState.current.onsiteRequired
        val model = EmployeeDashboardModel(
            employee.optString("fullName"), employee.optString("email"), employee.optString("department"), employee.optString("team"),
            session?.optJSONObject("venue")?.optString("address") ?: "2nd floor, Srivari Arcade, Bengaluru",
            onsite, session?.optJSONObject("venue")?.optBoolean("requiresRoomCode", true) != false,
            registeredPasskey, biometricConfigured, sessions.map { DashboardSession(it.getString("id"), it.optString("title"), it.optString("date")) }, todayReceipts,
            if (!onsite) "Not required" else if (runCatching { VenueAccessState.current() }.isSuccess) "Confirmed now" else "Not confirmed",
            if (!onsite) "Not required" else if (runCatching { AttendanceWifi.requireConnected(this) }.isSuccess) "Connected now" else "Not confirmed",
            TrackingService.state.value, employee.optBoolean("canViewAllAttendance"), employee.optString("role") == "committee", preferredAttendanceSession)
        val screen = EmployeeDashboardScreen(this, model, EmployeeDashboardActions(
            onRefresh = { runAction { renderDashboard() } },
            onEnroll = { runAction { enrollPasskey(); renderDashboard(); showMessage("Phone passkey enrolled.") } },
            onSubmit = { eventId, consent, code -> submitAttendance(eventId, consent, code) },
            onViewAttendance = { runAction { renderAttendanceReport() } },
            onHrControls = { renderHrControls(allEvents) },
            onStartSharing = { consent -> startDailySharing(consent) },
            onStopSharing = { runAction { stopService(Intent(this, TrackingService::class.java)); TrackingService.state.value = "Location sharing stopped on this phone."; runCatching { api.json("/tracking/stop", "POST", JSONObject()) }.onFailure { showMessage("Sharing stopped on this phone. The server could not be reached.") } } },
            onMovementReport = { runAction { showReport(api.json("/tracking/report?date=${Workday.date()}")) } },
            onSignOut = { signOutAccount() },
            onMaps = { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.app.goo.gl/1t5uN5hefMxJEWKdA"))) },
            onCheckWifi = { runAction { AttendanceWifi.requireConnected(this); renderDashboard(); showMessage("Connected to venue Wi-Fi at this check. It is checked again on submission.") } }
        ))
        dashboardScreen = screen; viewerScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage)
    }
    private fun submitAttendance(eventId: String, consent: Boolean, roomCode: String) {
        if (!consent) { showMessage("Confirm the attendance statement first."); return }
        if (!registeredPasskey || !biometricConfigured) { showMessage("Enroll a phone passkey first."); return }
        val onsite = AttendancePolicyState.current.onsiteRequired
        val submit: () -> Unit = { runAction {
            if (onsite) AttendanceWifi.requireConnected(this)
            val proof = verifyPasskey(eventId)
            // Obtain the point after the OS prompt; an old pre-prompt fix may expire.
            val location = if (onsite) LocationAccess.current(this) else null
            val body = JSONObject().put("eventId", eventId).put("biometricProof", proof)
            if (location != null) body.put("location", LocationAccess.point(location))
            if (onsite) body.put("roomCode", roomCode)
            val response = api.json("/attendance", "POST", body)
            val record = response.getJSONObject("attendance")
            savedReceipts["${record.optString("uid")}:$eventId"] = record
            preferredAttendanceSession = eventId
            try { renderDashboard() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                showRecordedReceipt(record)
            }
        } }
        if (onsite) requestPermissionsThen(false, submit) else submit()
    }
    private fun showRecordedReceipt(record: JSONObject) {
        layout(); heading("Attendance recorded")
        val firstTime = runCatching { DateTimeFormatter.ofPattern("d MMM yyyy · h:mm:ss a 'IST'").withZone(Workday.zone).format(Instant.parse(record.optString("timestamp"))) }.getOrDefault("Original record time unavailable")
        text("Original check-in: $firstTime")
        text(if (record.optString("attendanceMode") == "setup") "Setup check-in · location not verified." else "Your original attendance record is preserved.")
        text("Your check-in succeeded. The dashboard could not refresh; retry when connected.")
        button("Refresh attendance") { runAction { renderDashboard() } }
    }
    private fun startDailySharing(consent: Boolean) {
        if (!consent) { showMessage("Read and agree to workday location sharing first."); return }
        if (!Workday.contains()) { showMessage("Sharing can start only from 10:30 AM to 8:30 PM, India time."); return }
        requestPermissionsThen(true) { runAction {
            if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) throw IllegalStateException("Enable notifications before starting sharing so its active status stays visible.")
            api.json("/tracking/start", "POST", JSONObject().put("consent", true))
            ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_START))
            showMessage("Daily consent saved. The visible location service is starting.")
        } }
    }
    private fun signOutAccount() { runAction {
        stopService(Intent(this, TrackingService::class.java)); TrackingService.state.value = "Tracking stopped. Signed out."
        if (session?.optJSONObject("user")?.optString("role") != "attendance-viewer") runCatching { api.json("/tracking/stop", "POST", JSONObject()) }
        auth.signOut(); session = null; savedReceipts.clear(); preferredAttendanceSession = ""; renderLogin()
    } }
    private fun renderHrControls(allEvents: List<JSONObject>) {
        if (!venueUnlocked || session?.optJSONObject("user")?.optString("role") != "committee") return
        layout(); heading("HR controls")
        button("Back to my attendance") { runAction { renderDashboard() } }
        button("Review employee approval requests") { runAction { showEmployeeRequests(api.array("/registration-requests"), api.array("/employees")) } }
        val daily = allEvents.firstOrNull { it.optString("date") == Workday.date() && it.optString("title") == "Daily employee attendance" }
        button("Open today's attendance") { runAction {
            val latest = api.array("/events"); val today = Workday.date()
            val existing = (0 until latest.length()).map { latest.getJSONObject(it) }.firstOrNull { it.optString("date") == today && it.optString("title") == "Daily employee attendance" }
            val event = existing ?: api.json("/events", "POST", JSONObject().put("title", "Daily employee attendance").put("date", today).put("isMandatory", true))
            api.json("/events/${event.getString("id")}", "PATCH", JSONObject().put("checkInOpen", true))
            renderDashboard(); showMessage("Today's attendance is open.")
        } }
        if (daily?.optBoolean("checkInOpen") == true) button("Close today's attendance") { runAction {
            api.json("/events/${daily.getString("id")}", "PATCH", JSONObject().put("checkInOpen", false))
            renderDashboard(); showMessage("Today's attendance is closed.")
        } }
    }

    private fun showEmployeeRequests(requests: org.json.JSONArray, employees: org.json.JSONArray) {
        if (!venueUnlocked) return
        if (requests.length() == 0) { showMessage("There are no pending employee requests."); return }
        val labels = (0 until requests.length()).map { index ->
            val item = requests.getJSONObject(index); "${item.optString("fullName")} — ${item.optString("email") }"
        }.toTypedArray()
        reportDialog = AlertDialog.Builder(this).setTitle("Pending employee requests").setItems(labels) { _, index ->
            if (!venueUnlocked) return@setItems
            val request = requests.getJSONObject(index)
            val choices = (0 until employees.length()).map { employees.getJSONObject(it) }.filter {
                it.optBoolean("active") && (it.isNull("uid") || !it.has("uid") || it.optString("uid") == request.optString("uid"))
            }
            val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(10), dp(20), dp(10)) }
            body.addView(TextView(this).apply { text = "${request.optString("fullName")}\n${request.optString("email")}\nConfirm the employee identity before approving. A job title does not grant HR privileges." })
            val picker = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item,
                listOf("Select matching employee") + choices.map { "${it.optString("fullName")} · ${it.optString("department")}" }) }
            body.addView(picker)
            val reason = EditText(this).apply { hint = "Reason if rejecting (at least 5 characters)" }; body.addView(reason)
            reportDialog = AlertDialog.Builder(this).setTitle("HR identity review").setView(body)
                .setPositiveButton("Approve") { _, _ ->
                    val selected = picker.selectedItemPosition - 1
                    if (selected !in choices.indices) { showMessage("Select a matching employee, then reopen the request."); return@setPositiveButton }
                    runAction {
                        api.json("/registration-requests/${request.getString("id")}/approve", "POST", JSONObject().put("employeeId", choices[selected].getString("employeeId")))
                        showMessage("Employee approved. They can refresh approval status and sign in.")
                    }
                }.setNeutralButton("Reject") { _, _ -> runAction {
                    api.json("/registration-requests/${request.getString("id")}/reject", "POST", JSONObject().put("reason", reason.text.toString()))
                    showMessage("Request rejected. No attendance access was granted.")
                } }.setNegativeButton("Cancel", null).show()
        }.setNegativeButton("Close", null).show()
    }
    private suspend fun renderAttendanceReport(date: String = Workday.date(), eventId: String = "") {
        val report = api.json("/attendance-report?date=${Uri.encode(date)}${if (eventId.isNotBlank()) "&eventId=${Uri.encode(eventId)}" else ""}")
        if (!venueUnlocked) return
        val screen = AttendanceViewerScreen(this, report, date, eventId, AttendanceViewerActions(
            onLoad = { day, event -> runAction { renderAttendanceReport(day, event) } },
            onBack = { if (session?.optJSONObject("user")?.optString("role") == "attendance-viewer") finish() else runAction { renderDashboard() } },
            onSignOut = { signOutAccount() }
        ))
        viewerScreen = screen; dashboardScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage)
    }
    private suspend fun enrollPasskey() {
        if (!venueUnlocked) return
        val options = api.json("/biometrics/registration/options", "POST", JSONObject())
        restoreAfterPrompt = dashboardScreen != null
        ceremonyInProgress = true
        val response = try {
            CredentialManager.create(this).createCredential(this,
                CreatePublicKeyCredentialRequest(options.getJSONObject("options").toString())) as? CreatePublicKeyCredentialResponse
                ?: throw IllegalStateException("The phone did not return a passkey registration.")
        } catch (error: Exception) { ceremonyInProgress = false; throw error }
        try { awaitVenueAfterSystemPrompt() } finally { ceremonyInProgress = false }
        api.json("/biometrics/registration/verify", "POST", JSONObject().put("challengeId", options.getString("challengeId")).put("response", JSONObject(response.registrationResponseJson)))
    }
    private suspend fun verifyPasskey(eventId: String): String {
        val options = api.json("/biometrics/authentication/options", "POST", JSONObject().put("eventId", eventId))
        restoreAfterPrompt = dashboardScreen != null
        ceremonyInProgress = true
        val result = try {
            CredentialManager.create(this).getCredential(this,
                GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options.getJSONObject("options").toString()))))
        } catch (error: Exception) { ceremonyInProgress = false; throw error }
        try { awaitVenueAfterSystemPrompt() } finally { ceremonyInProgress = false }
        val credential = result.credential as? PublicKeyCredential ?: throw IllegalStateException("A phone passkey is required.")
        val verified = api.json("/biometrics/authentication/verify", "POST", JSONObject().put("challengeId", options.getString("challengeId")).put("response", JSONObject(credential.authenticationResponseJson)))
        return verified.getString("proof")
    }
    private suspend fun awaitVenueAfterSystemPrompt() {
        // Credential Manager may pause this Activity. Cover its content while
        // paused, then reload policy (and require a new fix in onsite mode).
        kotlinx.coroutines.withTimeout(30000) {
            while (!venueUnlocked) kotlinx.coroutines.delay(100)
        }
        if (AttendancePolicyState.current.onsiteRequired) VenueAccessState.current()
    }
    private fun requestPermissionsThen(tracking: Boolean, action: () -> Unit) {
        val needed = mutableListOf<String>()
        if (!LocationAccess.precisePermission(this)) needed.addAll(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        if (tracking && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        if (needed.isEmpty()) action() else { pendingPermissions = action; permissionRequest.launch(needed.toTypedArray()) }
    }
    private fun showReport(report: JSONObject) {
        if (!venueUnlocked) return
        val format = DateTimeFormatter.ofPattern("h:mm a").withZone(Workday.zone)
        fun time(value: String): String = runCatching { format.format(Instant.parse(value)) }.getOrDefault(value)
        fun minutes(value: Long) = "${value / 60} min"
        val totals = report.optJSONObject("totals") ?: JSONObject()
        val description = StringBuilder("${report.optString("date")} · India time\n\n")
            .append("Inside venue: ${minutes(totals.optLong("insideSeconds"))}\n")
            .append("Away: ${minutes(totals.optLong("awaySeconds"))}\n")
            .append("Unknown/unobserved: ${minutes(totals.optLong("unknownSeconds"))}\n\n")
        val excursions = report.optJSONArray("excursions")
        if (excursions != null) for (index in 0 until excursions.length()) {
            val excursion = excursions.getJSONObject(index)
            description.append("Away observed from ${time(excursion.optString("leftAt"))}")
            if (!excursion.isNull("returnedAt")) description.append(" to ${time(excursion.optString("returnedAt"))}")
            description.append(" · ${minutes(excursion.optLong("durationSeconds"))} (estimated)\n")
        }
        val visits = report.optJSONArray("visits")
        if (visits != null) for (index in 0 until visits.length()) {
            val visit = visits.getJSONObject(index)
            description.append("\n${visit.optString("label", "Approximate stop")}: ${visit.optDouble("latitude")}, ${visit.optDouble("longitude")}\n")
                .append("${time(visit.optString("startAt"))}–${time(visit.optString("endAt"))} · ${minutes(visit.optLong("dwellSeconds"))} observed\n")
        }
        description.append("\nSamples estimate visits and boundary crossings. Gaps are not assigned to any place. Coordinates do not identify a business or address without a configured map/geocoding provider.")
        val reportBody = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(12)) }
        reportBody.addView(TextView(this).apply { text = description; textSize = 15f; setTextIsSelectable(true) })
        if (visits != null) for (index in 0 until visits.length()) {
            val visit = visits.getJSONObject(index)
            val map = "https://www.google.com/maps/search/?api=1&query=${visit.optDouble("latitude")},${visit.optDouble("longitude")}"
            reportBody.addView(Button(this).apply {
                text = "View approximate stop ${index + 1} on Maps"; isAllCaps = false
                setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(map))) }
            })
        }
        reportDialog = AlertDialog.Builder(this).setTitle("Today's movement report").setView(ScrollView(this).apply { addView(reportBody) }).setPositiveButton("Close", null).show()
        showMessage("")
    }
}

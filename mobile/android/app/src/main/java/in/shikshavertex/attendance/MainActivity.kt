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
        lifecycleScope.launch { TrackingService.state.collect { trackingLabel?.text = it } }
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
    private fun showMessage(value: String) { message.text = value }
    private fun runAction(action: suspend () -> Unit) {
        if (busy || !venueUnlocked) return
        busy = true; buttons.forEach { it.isEnabled = false }; showMessage("Please wait…")
        actionJob = lifecycleScope.launch {
            try { action() } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) {
                if (venueUnlocked) showMessage(error.message ?: "The operation failed. Please try again.")
            } finally { busy = false; buttons.forEach { it.isEnabled = true } }
        }
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
        val eventsResponse = api.array("/events")
        val biometric = api.json("/biometrics")
        registeredPasskey = biometric.optBoolean("registered")
        biometricConfigured = biometric.optBoolean("configured")
        val allEvents = (0 until eventsResponse.length()).map { eventsResponse.getJSONObject(it) }
        val events = allEvents.filter { it.optBoolean("checkInOpen") && it.optString("date") == Workday.date() }
        layout()
        val employee = session?.optJSONObject("user")
        if (!employee?.optString("fullName").isNullOrBlank()) heading(employee!!.optString("fullName"))
        text(employee?.optString("email") ?: "Signed in")
        if (!employee?.optString("department").isNullOrBlank()) text("${employee!!.optString("department")} · ${employee.optString("team")}", 14f)
        val venue = session?.optJSONObject("venue")
        text(venue?.optString("address") ?: "2nd floor, Srivari Arcade, Bengaluru")
        button("View venue on Maps") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.app.goo.gl/1t5uN5hefMxJEWKdA"))) }
        if (employee?.optString("role") == "committee") {
            button("Review employee approval requests") { runAction {
                showEmployeeRequests(api.array("/registration-requests"), api.array("/employees"))
            } }
            val daily = allEvents.firstOrNull { it.optString("date") == Workday.date() && it.optString("title") == "Daily employee attendance" }
            button("Open today's attendance") { runAction {
                val latest = api.array("/events")
                val today = Workday.date()
                val existing = (0 until latest.length()).map { latest.getJSONObject(it) }.firstOrNull { it.optString("date") == today && it.optString("title") == "Daily employee attendance" }
                val event = existing ?: api.json("/events", "POST", JSONObject().put("title", "Daily employee attendance").put("date", today).put("isMandatory", true))
                api.json("/events/${event.getString("id")}", "PATCH", JSONObject().put("checkInOpen", true))
                renderDashboard(); showMessage("Today's attendance is open. Approved employees can tap Refresh attendance to load it.")
            } }
            if (daily?.optBoolean("checkInOpen") == true) button("Close today's attendance") { runAction {
                api.json("/events/${daily.getString("id")}", "PATCH", JSONObject().put("checkInOpen", false))
                renderDashboard(); showMessage("Today's attendance is closed.")
            } }
        }
        if (AttendancePolicyState.current.onsiteRequired) {
            heading("Required attendance Wi-Fi")
            text("Connect to ${WifiRule.REQUIRED_SSID} before marking attendance. The app checks the connected network immediately before submission. It does not save or enter the Wi-Fi password.", 14f)
            button("Open Android Wi-Fi settings") { startActivity(Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)) }
            button("Check attendance Wi-Fi connection") { runAction {
                AttendanceWifi.requireConnected(this)
                showMessage("Connected to the required Wi-Fi. Location, passkey and room-code checks still apply.")
            } }
        }
        heading("Biometric / passkey attendance")
        text("Your phone verifies you using a passkey. Depending on Android settings, this can use a fingerprint, face or device PIN. The app receives a signed proof, never your biometric template.", 13f)
        text(if (!biometricConfigured) "Passkey setup is incomplete on the server. Contact the administrator." else if (registeredPasskey) "Passkey enrolled. Verify with it each time you mark attendance." else "Enroll a passkey before your first attendance check-in.", 14f)
        button("Enroll phone passkey") { runAction { enrollPasskey(); renderDashboard(); showMessage("Phone passkey enrolled.") } }.isEnabled = biometricConfigured
        button("Refresh attendance") { runAction { renderDashboard() } }
        val picker = Spinner(this)
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, listOf("Select an open event") + events.map { it.optString("title") + " · " + it.optString("date") })
        picker.contentDescription = "Attendance event"
        content.addView(picker, LinearLayout.LayoutParams(-1, dp(54)))
        val onsite = AttendancePolicyState.current.onsiteRequired
        val roomCode = if (onsite && venue?.optBoolean("requiresRoomCode", true) != false) input("Current room code").apply { inputType = android.text.InputType.TYPE_CLASS_NUMBER } else null
        val checkinConsent = CheckBox(this).apply {
            text = if (onsite) "I agree to save my location, accuracy and time for this attendance check-in." else "I confirm I am marking my own attendance. Physical location is not verified in setup mode."
            setPadding(0, dp(8), 0, dp(8)); content.addView(this)
        }
        button("Verify phone and mark attendance") {
            if (!checkinConsent.isChecked) { showMessage("Read and confirm the attendance statement first."); return@button }
            val selected = picker.selectedItemPosition - 1
            if (selected !in events.indices) { showMessage("Select an open event."); return@button }
            if (!registeredPasskey || !biometricConfigured) { showMessage("Enroll a phone passkey first."); return@button }
            val submit: () -> Unit = { runAction {
                if (onsite) AttendanceWifi.requireConnected(this)
                val event = events[selected]
                val location = if (onsite) LocationAccess.current(this) else null
                val proof = verifyPasskey(event.getString("id"))
                val body = JSONObject().put("eventId", event.getString("id")).put("biometricProof", proof)
                if (location != null) body.put("location", LocationAccess.point(location))
                roomCode?.let { body.put("roomCode", it.text.toString().trim()) }
                val response = api.json("/attendance", "POST", body)
                checkinConsent.isChecked = false; roomCode?.text?.clear()
                renderDashboard()
                showMessage(if (response.optBoolean("alreadyMarked")) "Your attendance was already recorded. The first record was preserved." else if (onsite) "Attendance recorded with phone user verification and location." else "Attendance recorded in setup mode. Physical location was not verified.")
            } }
            if (onsite) requestPermissionsThen(false, submit) else submit()
        }
        heading("Workday location sharing")
        text("10:30 AM–8:30 PM, India time. Start each day explicitly. While active, the app records your route, time away from the venue and approximate stops. You and committee members can see the report. The configured retention target is 30 days; ask the committee to confirm deletion policy. A persistent notification includes Stop. GPS uncertainty or missing signals appear as unknown time, not proof that you stayed or left.", 14f)
        trackingLabel = text(TrackingService.state.value, 14f)
        val trackingConsent = CheckBox(this).apply {
            text = "I agree to share my location during today's workday, including places visited away from the venue, for the attendance report. I can stop sharing at any time."
            setPadding(0, dp(8), 0, dp(8)); content.addView(this)
        }
        button("Start today's location sharing") {
            if (!trackingConsent.isChecked) { showMessage("Read and agree to workday location sharing first."); return@button }
            if (!Workday.contains()) { showMessage("Tracking can start only from 10:30 AM to 8:30 PM, India time."); return@button }
            requestPermissionsThen(true) { runAction {
                if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) throw IllegalStateException("Enable this app's notifications before tracking. Its active status must remain visible.")
                api.json("/tracking/start", "POST", JSONObject().put("consent", true))
                ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_START))
                trackingConsent.isChecked = false
                showMessage("Daily sharing consent saved. The visible location service is starting.")
            } }
        }
        button("Stop location sharing") { runAction {
            // Local GPS stops immediately; never wait for the network before stopping collection.
            stopService(Intent(this, TrackingService::class.java))
            TrackingService.state.value = "Location tracking stopped on this phone."
            runCatching { api.json("/tracking/stop", "POST", JSONObject()) }.onFailure { showMessage("Sharing stopped on this phone. The server could not be reached; unobserved time will be shown as a gap.") }.onSuccess { showMessage("Location sharing stopped.") }
        } }
        button("View today's movement report") { runAction { showReport(api.json("/tracking/report?date=${Workday.date()}")) } }
        button("Refresh events and passkey status") { runAction { renderDashboard() } }
        button("Sign out") { runAction {
            stopService(Intent(this, TrackingService::class.java))
            TrackingService.state.value = "Tracking stopped. Signed out."
            runCatching { api.json("/tracking/stop", "POST", JSONObject()) }
            auth.signOut(); session = null; renderLogin()
        } }
        text("Location sampling is approximately once a minute, not exact continuous observation. Force-stop, battery restrictions, no network, disabled GPS or revoked permissions cause gaps. The app does not auto-start at boot or secretly restart tracking.", 13f)
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
    private suspend fun enrollPasskey() {
        if (!venueUnlocked) return
        val options = api.json("/biometrics/registration/options", "POST", JSONObject())
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

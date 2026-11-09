package `in`.shikshavertex.attendance

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
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
    private var appAvailable = false
    private var ceremonyInProgress = false
    private var restoreAfterPrompt = false
    private var actionGeneration = 0L
    private var actionJob: Job? = null
    private var policyJob: Job? = null
    private var connectingToServer = false
    private var connectionBanner: TextView? = null
    private var readinessJob: Job? = null
    private var session: JSONObject? = null
    private var registeredPasskey = false
    private var biometricConfigured = false
    private var pendingPermissions: (() -> Unit)? = null
    private var pendingSharingPermission: Long? = null
    private var sharingStartJob: Job? = null
    private var sharingStartToken: Long? = null
    private val buttons = mutableListOf<Button>()
    private var trackingLabel: TextView? = null
    private var dashboardScreen: EmployeeDashboardScreen? = null
    private var lastDashboardModel: EmployeeDashboardModel? = null
    private var authScreen: AuthScreen? = null
    private var verificationScreen: VerificationScreen? = null
    private var verificationJob: Job? = null
    private var viewerScreen: AttendanceViewerScreen? = null
    private var designedBusy: ((Boolean) -> Unit)? = null
    private var designedMessage: ((String) -> Unit)? = null
    private var designedNotice: ((String) -> Unit)? = null
    private var preferredAttendanceSession = ""
    private val savedReceipts = mutableMapOf<String, JSONObject>()
    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val action = pendingPermissions
        val sharingToken = pendingSharingPermission
        pendingPermissions = null; pendingSharingPermission = null
        if (grants.values.all { it }) {
            if (sharingToken == null || TrackingService.status.isCurrent(sharingToken)) action?.invoke()
        } else if (sharingToken != null) {
            TrackingService.status.failed(sharingToken, "Sharing did not start. Allow precise location and notifications, then give consent again when ready.")
            sharingStartToken = null
        } else showMessage("Permission was not granted. No tracking or check-in has started. Enable precise location and notifications in Android settings as needed.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        try { auth = FirebaseAuth.getInstance(); api = ApiClient(this) { connecting -> lifecycleScope.launch {
            connectingToServer=connecting; connectionBanner?.visibility=if(connecting) View.VISIBLE else View.GONE
        } } }
        catch (_: Exception) { text("The app configuration is invalid. Ask the administrator for a configured build. No tracking is running."); return }
        lifecycleScope.launch { TrackingService.status.flow.collect {
            trackingLabel?.text = it.forUser(auth.currentUser?.uid.orEmpty()).message
            dashboardScreen?.updateSharing(it)
        } }
        appAvailable = true
        openAccount()
    }
    override fun onResume() {
        super.onResume()
        if (::api.isInitialized) {
            AttendanceWifi.startObserving(this)
            refreshAccessPolicy()
            dashboardScreen?.let { if(it.readinessEnabled) startReadiness(it) }
        }
    }
    override fun onPause() {
        authScreen?.clearPassword()
        policyJob?.cancel()
        stopReadiness()
        AttendanceWifi.stopObserving()
        super.onPause()
    }
    override fun onDestroy() {
        if (pendingSharingPermission != null || sharingStartJob?.isActive == true) stopDailySharing()
        super.onDestroy()
    }
    private fun refreshAccessPolicy() {
        policyJob?.cancel()
        policyJob = lifecycleScope.launch {
            try {
                AttendancePolicyState.current = api.loadPolicy()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { showMessage(error.message ?: "Cannot load attendance settings. Check your internet and retry.") }
        }
    }
    private fun openAccount() {
        if (!appAvailable) return
        val user = auth.currentUser
        if (user == null) renderLogin() else if (!user.isEmailVerified) renderVerification() else runAction { establishSession() }
    }
    private fun layout() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        dashboardScreen = null; viewerScreen = null; authScreen = null; verificationScreen = null; verificationJob?.cancel(); designedBusy = null; designedMessage = null; designedNotice = null
        buttons.clear(); trackingLabel = null
        val ui = AttendanceUi(this)
        val body = ui.canvas()
        body.addView(ui.text("SHIKSHAVERTEX", 12f, AttendanceUi.INDIGO, true))
        ui.space(body, 18)
        content = ui.card(body)
        mountWithConnectionBanner(ScrollView(this).apply { isFillViewport = true; fitsSystemWindows = true; addView(body) }, false)
        heading("Employee workspace")
        message = text("").apply { setTextColor(AttendanceUi.RED); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    }
    private fun heading(value: String) = AttendanceUi(this).text(value, 24f, AttendanceUi.INDIGO, true).apply { setPadding(0, dp(10), 0, dp(12)); content.addView(this) }
    private fun text(value: String, size: Float = 15f): TextView = AttendanceUi(this).text(value, size).apply {
        setPadding(0, dp(6), 0, dp(8)); content.addView(this)
    }
    private fun button(label: String, action: () -> Unit): Button = AttendanceUi(this).button(content, label, label.contains("retry", true) || label.startsWith("Allow")) {
        if (!busy) action()
    }.also { buttons.add(it) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun showMessage(value: String) {
        val display = designedMessage
        if (display != null) display(value) else { message.setTextColor(AttendanceUi.RED); message.text = value }
    }
    private fun showNotice(value: String) {
        val display = designedNotice
        if (display != null) display(value) else { message.setTextColor(AttendanceUi.GREEN); message.text = value }
    }
    private fun mountDesigned(view: View, setBusy: (Boolean) -> Unit, displayMessage: (String) -> Unit, displayNotice: (String) -> Unit = displayMessage) {
        restoreAfterPrompt = false
        if (verificationScreen?.root !== view) { verificationJob?.cancel(); verificationScreen = null }
        if (authScreen?.root !== view) authScreen = null
        buttons.clear(); trackingLabel = null
        designedBusy = setBusy; designedMessage = displayMessage; designedNotice = displayNotice
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
        mountWithConnectionBanner(view, true); ViewCompat.requestApplyInsets(view)
        setBusy(busy)
    }
    private fun mountWithConnectionBanner(view: View, edgeToEdge: Boolean) {
        val ui=AttendanceUi(this)
        val host=ui.column()
        val banner=ui.text(ServerConnectionGate.MESSAGE,14f,AttendanceUi.AMBER).apply {
            background=ui.rounded(android.graphics.Color.rgb(255,251,235))
            setPadding(dp(16),dp(12),dp(16),dp(12))
            visibility=if(connectingToServer) View.VISIBLE else View.GONE
            accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        host.addView(banner,LinearLayout.LayoutParams(-1,-2))
        host.addView(view,LinearLayout.LayoutParams(-1,0,1f))
        if(edgeToEdge) ViewCompat.setOnApplyWindowInsetsListener(host) { _,insets ->
            val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars())
            banner.setPadding(dp(16),dp(12)+bars.top,dp(16),dp(12)); insets
        }
        connectionBanner=banner; setContentView(host)
    }

    private fun runAction(action: suspend () -> Unit) {
        if (busy || !appAvailable) return
        val generation = ++actionGeneration
        busy = true; buttons.forEach { it.isEnabled = false }; designedBusy?.invoke(true); showMessage("")
        actionJob = lifecycleScope.launch {
            try { action() } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) {
                if (appAvailable && generation == actionGeneration) {
                    if (restoreAfterPrompt) { restoreAfterPrompt = false; runCatching { renderDashboard() } }
                    showMessage(friendlyError(error))
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

    private fun friendlyError(error: Exception): String = when (error) {
        is androidx.credentials.exceptions.GetCredentialCancellationException,
        is androidx.credentials.exceptions.CreateCredentialCancellationException -> "Phone verification was cancelled. Try again when you are ready."
        is androidx.credentials.exceptions.NoCredentialException -> "No attendance passkey was available. Use the phone or passkey you enrolled, or contact HR for help."
        is com.google.firebase.auth.FirebaseAuthInvalidUserException -> if (error.errorCode == "ERROR_USER_DISABLED")
            "This account is disabled. Contact HR for account recovery."
            else "Email or password was not accepted. Register if this is your first time, or reset your app password."
        is com.google.firebase.auth.FirebaseAuthInvalidCredentialsException -> if (error.errorCode == "ERROR_INVALID_EMAIL")
            "Enter a valid work email address."
            else "Email or password was not accepted. Register if this is your first time, or reset your app password."
        is com.google.firebase.auth.FirebaseAuthUserCollisionException -> "This email already has an attendance account. Sign in or reset your app password."
        is com.google.firebase.FirebaseNetworkException -> "Could not connect. Check your internet connection and try again."
        is com.google.firebase.FirebaseTooManyRequestsException -> "Too many attempts. Wait a little before trying again."
        else -> error.message ?: "The operation failed. Please try again."
    }
    private fun renderLogin() {
        if (!appAvailable) return
        verificationJob?.cancel(); verificationScreen = null; dashboardScreen = null; viewerScreen = null
        val binding = getSharedPreferences("browser_binding", MODE_PRIVATE).getString("bound_email", "").orEmpty()
        val screen = AuthScreen(this, binding, AuthActions(
            onSignIn = { email, password -> runAction {
                auth.signInWithEmailAndPassword(email, password).await(); authScreen?.clearPassword()
                auth.currentUser?.reload()?.await()
                if (auth.currentUser?.isEmailVerified == true) establishSession() else renderVerification()
            } },
            onRegister = { email, password -> runAction {
                auth.createUserWithEmailAndPassword(email, password).await(); authScreen?.clearPassword()
                renderVerification()
                sendVerificationEmail()
            } },
            onReset = { email -> runAction { auth.sendPasswordResetEmail(email).await(); showNotice("If this email has an account, a reset link has been sent. Check your inbox and spam folder, then return to sign in.") } }
        ))
        authScreen = screen
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
    private fun verificationWait(): Int {
        val uid = auth.currentUser?.uid ?: return 0
        val saved = getSharedPreferences("verification_cooldown", MODE_PRIVATE)
        if (!saved.contains("$uid:epoch")) return 0
        return VerificationCooldown(saved.getLong("$uid:epoch", 0), saved.getLong("$uid:elapsed", 0))
            .secondsRemaining(System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime())
    }
    private fun startVerificationCooldown(uid: String) {
        getSharedPreferences("verification_cooldown", MODE_PRIVATE).edit()
            .putLong("$uid:epoch", System.currentTimeMillis())
            .putLong("$uid:elapsed", android.os.SystemClock.elapsedRealtime()).apply()
        verificationScreen?.updateCooldown(verificationWait())
    }
    private suspend fun sendVerificationEmail() {
        val user = auth.currentUser ?: throw IllegalStateException("Your sign-in has ended. Sign out and sign in again before requesting verification.")
        verificationScreen?.setOperation(VerificationOperation.SENDING)
        try {
            user.sendEmailVerification().await()
        } catch (error: com.google.firebase.FirebaseTooManyRequestsException) {
            startVerificationCooldown(user.uid)
            throw IllegalStateException("Firebase has temporarily limited verification requests. Wait before retrying; its limit may last longer than the displayed cooldown.", error)
        }
        startVerificationCooldown(user.uid)
        showNotice("Verification email sent. Check your inbox and spam folder. Open its link, then return and check your status.")
    }
    private suspend fun checkEmailVerification() {
        val user = auth.currentUser ?: throw IllegalStateException("Your sign-in has ended. Sign out and sign in again to check verification.")
        verificationScreen?.setOperation(VerificationOperation.CHECKING)
        user.reload().await()
        val refreshed = auth.currentUser
        check(refreshed?.uid == user.uid) { "Your account changed. Sign in again to check verification." }
        if (refreshed?.isEmailVerified == true) {
            verificationScreen?.markVerified()
            establishSession()
        } else verificationScreen?.showUnverified()
    }
    private fun renderVerification() {
        if (!appAvailable) return
        authScreen = null; dashboardScreen = null; viewerScreen = null; verificationJob?.cancel()
        val screen = VerificationScreen(this, auth.currentUser?.email.orEmpty(), verificationWait(), VerificationActions(
            onVerified = { runAction { checkEmailVerification() } },
            onResend = { if (verificationWait() == 0) runAction {
                if (auth.currentUser?.isEmailVerified == true) checkEmailVerification() else sendVerificationEmail()
            } },
            onSignOut = { auth.signOut(); session = null; renderLogin() }
        ))
        verificationScreen = screen
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
        verificationJob = lifecycleScope.launch {
            while (verificationScreen === screen && appAvailable) { screen.updateCooldown(verificationWait()); kotlinx.coroutines.delay(1000) }
        }
    }
    private suspend fun establishSession() {
        if (!appAvailable) return
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
        if (!appAvailable) return
        verificationJob?.cancel(); verificationScreen = null; authScreen = null; dashboardScreen = null; viewerScreen = null
        lateinit var screen: EmployeeApprovalScreen
        screen = EmployeeApprovalScreen(this, auth.currentUser?.email.orEmpty(), status, ApprovalActions(
            onRequest = { name -> runAction {
                screen.setOperation(ApprovalOperation.REQUESTING)
                try {
                    api.json("/registration/request", "POST", JSONObject().put("fullName", name))
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    if (error is ApiException && error.status == 400) throw error
                    screen.markStatusUnavailable()
                    throw IllegalStateException("The request could not be confirmed. Check approval status before trying again. ${friendlyError(error)}", error)
                }
                // A successful POST must not leave a duplicate form if the following GET fails.
                screen.markStatusUnavailable(); screen.setOperation(ApprovalOperation.CHECKING)
                val latest = try { api.json("/registration/status") }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    throw IllegalStateException("The request service responded, but the latest status could not be loaded. Tap Check approval status. ${friendlyError(error)}", error)
                }
                renderEmployeeApproval(latest)
                when (ApprovalPresentation.state(latest.opt("status") as? String, latest.opt("approved") as? Boolean)) {
                    EmployeeApprovalState.APPROVED -> establishSession()
                    EmployeeApprovalState.PENDING -> showNotice("Your request is pending HR review. Check your status after HR reviews your employee profile.")
                    else -> Unit
                }
            } },
            onRefresh = { runAction {
                screen.setOperation(ApprovalOperation.CHECKING)
                val latest = try { api.json("/registration/status") }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { screen.markStatusUnavailable(); throw error }
                renderEmployeeApproval(latest)
                if (ApprovalPresentation.state(latest.opt("status") as? String, latest.opt("approved") as? Boolean) == EmployeeApprovalState.APPROVED) establishSession()
            } },
            onSignOut = { auth.signOut(); session = null; renderLogin() }
        ), emailVerified = auth.currentUser?.isEmailVerified == true)
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
    private suspend fun renderDashboard(celebrateEventId: String = "") {
        if (!appAvailable) return
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
                officeConnectionObserved(record), record.opt("locationVerified") == true)
        }
        val todayReceipts = EmployeePresentation.receipts(uid, today.map { it.optString("id") }.toSet(), receipts)
        val sessions = today.filter { it.optBoolean("checkInOpen") || todayReceipts.containsKey(it.optString("id")) }
        val onsite = true
        val model = EmployeeDashboardModel(
            employee.optString("fullName"), employee.optString("email"), employee.optString("department"), employee.optString("team"),
            session?.optJSONObject("venue")?.optString("address") ?: "2nd floor, Srivari Arcade, Bengaluru",
            onsite,
            registeredPasskey, biometricConfigured, sessions.map { DashboardSession(it.getString("id"), it.optString("title"), it.optString("date"), it.opt("checkInOpen") == true) }, todayReceipts,
            "Checked on submission",
            if (!onsite) "Not required" else if (runCatching { AttendanceWifi.requireConnected(this) }.isSuccess) "Connected now" else "Not confirmed",
            TrackingService.status.current.forUser(uid).message, employee.optBoolean("canViewAllAttendance"), employee.optString("role") == "committee", preferredAttendanceSession,
            employeeUid = uid, sharingSnapshot = TrackingService.status.current, celebrateEventId = celebrateEventId)
        mountDashboard(model)
    }
    private suspend fun refreshDashboard() {
        preferredAttendanceSession = dashboardScreen?.currentSessionId() ?: preferredAttendanceSession
        try { renderDashboard() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { dashboardScreen?.invalidateCheckIn(); throw error }
    }
    private fun mountDashboard(model: EmployeeDashboardModel) {
        readinessJob?.cancel(); readinessJob=null
        lastDashboardModel = model
        val screen = EmployeeDashboardScreen(this, model, EmployeeDashboardActions(
            onRefresh = { runAction { refreshDashboard() } },
            onEnroll = { runAction { enrollPasskey(); renderDashboard(); showNotice("Phone passkey enrolled.") } },
            onSubmit = { eventId, consent -> submitAttendance(eventId, consent) },
            onViewAttendance = { runAction { renderAttendanceReport() } },
            onHrControls = { runAction { renderHrControls() } },
            onStartSharing = { consent -> startDailySharing(consent) },
            onStopSharing = { stopDailySharing() },
            onMovementReport = { runAction { renderMovementReport() } },
            onSignOut = { signOutAccount() },
            onMaps = { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.app.goo.gl/1t5uN5hefMxJEWKdA"))) },
            onCheckReadiness = { screen ->
                if(!busy && pendingPermissions==null) requestPermissionsThen(false) {
                    if(dashboardScreen===screen && screen.root.isAttachedToWindow) { screen.enableReadiness(); startReadiness(screen) }
                }
            },
            onReadinessVisibility = { screen, visible ->
                if(dashboardScreen===screen) {
                    if(visible && screen.readinessEnabled) startReadiness(screen)
                    else if(!visible) stopReadiness()
                }
            }
        ))
        dashboardScreen = screen; viewerScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
    private fun officeConnectionObserved(record: JSONObject): Boolean = record.optJSONObject("wifi")?.let {
        it.optString("ssid") == WifiRule.REQUIRED_SSID && it.optString("verification") in setOf("native-client-observation", "native-observation-and-request-ip")
    } == true
    private fun attendanceVenue(): VenueGate.Venue {
        val venue = session?.optJSONObject("venue")
        return VenueGate.Venue(venue?.optDouble("latitude",Double.NaN) ?: Double.NaN,
            venue?.optDouble("longitude",Double.NaN) ?: Double.NaN,
            venue?.optDouble("radiusMeters",Double.NaN) ?: Double.NaN,
            venue?.optDouble("maxAccuracyMeters",Double.NaN) ?: Double.NaN, venue?.opt("configured") == true)
    }
    private fun locationDecision(point: android.location.Location): VenueGate.Decision {
        @Suppress("DEPRECATION") val mocked = point.isFromMockProvider
        val age = (android.os.SystemClock.elapsedRealtimeNanos()-point.elapsedRealtimeNanos)/1000000
        return VenueGate.evaluate(VenueGate.Fix(point.latitude,point.longitude,point.accuracy.toDouble(),point.time,age,mocked),attendanceVenue())
    }
    private fun stopReadiness() { readinessJob?.cancel(); readinessJob=null; dashboardScreen?.resetReadiness() }
    private fun startReadiness(screen: EmployeeDashboardScreen) {
        readinessJob?.cancel()
        if(!screen.readinessEnabled || dashboardScreen!==screen || !screen.root.isAttachedToWindow ||
            screen.employeeUid != auth.currentUser?.uid || !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) return
        readinessJob=lifecycleScope.launch {
            kotlinx.coroutines.coroutineScope {
                fun visible() = dashboardScreen===screen && screen.root.isAttachedToWindow &&
                    screen.employeeUid==auth.currentUser?.uid && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
                launch {
                    while(visible()) {
                        if(!busy) {
                            AttendanceWifi.startObserving(this@MainActivity)
                            val connection=runCatching { AttendanceWifi.requireConnected(this@MainActivity) }
                            screen.updateConnection(ReadinessSignal(if(connection.isSuccess) ReadinessState.READY else ReadinessState.UNKNOWN,
                                if(connection.isSuccess) "Connected" else connection.exceptionOrNull()?.message ?: "Connection unavailable", System.currentTimeMillis()))
                        }
                        kotlinx.coroutines.delay(2000)
                    }
                }
                while(visible()) {
                    if(!busy) {
                        screen.checkingGps()
                        try {
                            val point=LocationAccess.current(this@MainActivity)
                            if(!visible()) break
                            val decision=locationDecision(point)
                            screen.updateGps(ReadinessSignal(if(decision.allowed) ReadinessState.READY else if(decision.outside) ReadinessState.FAILED else ReadinessState.UNKNOWN,decision.reason,point.time))
                        } catch(cancelled: CancellationException) { throw cancelled }
                        catch(error: Exception) { if(visible()) screen.updateGps(ReadinessSignal(detail=error.message ?: "Location unavailable")) }
                    }
                    kotlinx.coroutines.delay(5000)
                }
            }
        }
    }
    private class CheckInFailure(val feedback: AttendanceFailure): Exception(feedback.primary)
    private fun submitAttendance(eventId: String, consent: Boolean) {
        if (!consent) { showMessage("Confirm the attendance statement first."); return }
        if (!registeredPasskey || !biometricConfigured) { showMessage("Enroll a phone passkey first."); return }
        val expectedUid=auth.currentUser?.uid ?: return
        val screen=dashboardScreen ?: return
        val submit: () -> Unit = { runAction {
            stopReadiness(); screen.clearVerification()
            var started=0L; var submitted=false
            var gpsDetail="Not checked"; var connectionDetail="Not checked"
            suspend fun transition() {
                if(started>0) kotlinx.coroutines.delay(AttendanceFeedback.remainingTransition(
                    android.os.SystemClock.elapsedRealtime()-started,android.animation.ValueAnimator.areAnimatorsEnabled()))
            }
            try {
                val proof = verifyPasskey(eventId) {
                    started=android.os.SystemClock.elapsedRealtime()
                    screen.showVerifyingOffice()
                }
                AttendanceWifi.startObserving(this@MainActivity)
                val connection=runCatching { AttendanceWifi.requireConnected(this@MainActivity) }
                connectionDetail=if(connection.isSuccess) "Connected to Shikshavertex_5G" else connection.exceptionOrNull()?.message ?: "Office connection unavailable"
                val location = try { LocationAccess.current(this@MainActivity) }
                catch(cancelled: CancellationException) { throw cancelled }
                catch(error: Exception) { throw CheckInFailure(AttendanceFailure(AttendanceFailureKind.LOCATION_UNAVAILABLE,
                    error.message ?: "Fresh precise location unavailable",connectionDetail,"Enable precise location, move inside the office and retry. No check-in was submitted.")) }
                val decision=locationDecision(location); gpsDetail=decision.reason
                screen.updateGps(ReadinessSignal(if(decision.allowed) ReadinessState.READY else if(decision.outside) ReadinessState.FAILED else ReadinessState.UNKNOWN,decision.reason,location.time))
                screen.updateConnection(ReadinessSignal(if(connection.isSuccess) ReadinessState.READY else ReadinessState.FAILED,connectionDetail,System.currentTimeMillis()))
                if(!decision.allowed) throw CheckInFailure(AttendanceFailure(if(decision.outside) AttendanceFailureKind.OUTSIDE else AttendanceFailureKind.LOCATION_UNAVAILABLE,
                    gpsDetail,connectionDetail,"Move inside the office and obtain a fresh, accurate reading before retrying."))
                if(connection.isFailure) throw CheckInFailure(AttendanceFailure(AttendanceFailureKind.CONNECTION,gpsDetail,connectionDetail,"Connect this phone to Shikshavertex_5G in Android network settings, then retry."))
                check(auth.currentUser?.uid==expectedUid) { "Your account changed. Sign in and refresh attendance." }
                val body = JSONObject().put("eventId", eventId).put("biometricProof", proof).put("location",LocationAccess.point(location))
                submitted=true
                val response = api.json("/attendance", "POST", body)
                val record = response.getJSONObject("attendance")
                check(AttendanceFeedback.receiptAccepted(response.opt("success")==true,record.optString("uid"),expectedUid,
                    record.optString("eventId"),eventId,record.optString("timestamp"))) { "The server receipt could not be confirmed. Refresh attendance." }
                savedReceipts["$expectedUid:$eventId"] = record
                preferredAttendanceSession = eventId
                transition()
                try { renderDashboard(if(response.opt("alreadyMarked")==false) eventId else "") }
                catch(cancelled: CancellationException) { throw cancelled }
                catch(_: Exception) { showRecordedReceipt(record,eventId,response.opt("alreadyMarked")==false) }
            } catch(cancelled: CancellationException) { throw cancelled }
            catch(error: Exception) {
                transition()
                if(dashboardScreen!==screen || auth.currentUser?.uid!=expectedUid) throw error
                screen.clearVerification(); restoreAfterPrompt=false
                if(error is CheckInFailure) screen.showAttendanceFailure(error.feedback)
                else if(started>0) {
                    val uncertain=AttendanceFeedback.serviceFailureKind(submitted,(error as? ApiException)?.status)==AttendanceFailureKind.UNCONFIRMED
                    screen.showAttendanceFailure(AttendanceFailure(if(uncertain) AttendanceFailureKind.UNCONFIRMED else AttendanceFailureKind.SERVICE,
                        gpsDetail,connectionDetail,if(uncertain) "The request may have reached the server. Refresh attendance before retrying; any original timestamp is preserved."
                        else friendlyError(error)))
                } else throw error // A cancelled phone prompt never claims an outside-office failure.
            }
        } }
        requestPermissionsThen(false, submit)
    }
    private fun showRecordedReceipt(record: JSONObject, eventId: String, celebrate: Boolean = false) {
        check(record.optString("uid") == auth.currentUser?.uid) { "Refresh attendance to load your own receipt." }
        val model = lastDashboardModel
        if (model != null && model.employeeUid == record.optString("uid") && model.events.any { it.id == eventId }) {
            val receipt = DashboardReceipt(record.optString("timestamp"), record.optString("attendanceMode", "legacy"),
                phoneVerified = record.optJSONObject("verification")?.optString("method") == "passkey-user-verification",
                venueWifiObserved = officeConnectionObserved(record), venueLocationVerified = record.opt("locationVerified")==true)
            mountDashboard(model.copy(receipts = model.receipts + (eventId to receipt), preferredSessionId = eventId,
                refreshRequired = true, trackingStatus = TrackingService.status.current.message, sharingSnapshot = TrackingService.status.current,
                celebrateEventId = if(celebrate) eventId else ""))
            showNotice("Attendance recorded. Your original receipt is shown. Refresh attendance when connected to confirm the latest dashboard settings.")
            return
        }
        layout(); heading("Attendance recorded")
        val firstTime = runCatching { DateTimeFormatter.ofPattern("d MMM yyyy · h:mm:ss a 'IST'").withZone(Workday.zone).format(Instant.parse(record.optString("timestamp"))) }.getOrDefault("Original record time unavailable")
        text("Original check-in: $firstTime")
        text(if (record.optString("attendanceMode") == "setup") "Historical check-in · location not verified." else "Your original attendance record is preserved.")
        text("Your check-in succeeded. The dashboard could not refresh; retry when connected.")
        button("Refresh attendance") { runAction { renderDashboard() } }
    }
    private fun startDailySharing(consent: Boolean) {
        if (!consent) { showMessage("Read and agree to workday location sharing first."); return }
        if (!Workday.contains()) { showMessage("Sharing can start only from 10:30 AM to 8:30 PM, India time."); return }
        if (busy || !appAvailable || pendingPermissions != null) { showMessage("Finish the current request before starting location sharing."); return }
        val user = auth.currentUser
        if (user?.isEmailVerified != true) { showMessage("Sign in and verify your email before starting sharing."); return }
        val date = Workday.date()
        val token = TrackingService.status.begin(user.uid, date)
        if (token == null) { showMessage("A sharing operation is already running or its stop still needs confirmation."); return }
        sharingStartToken = token; pendingSharingPermission = token
        try {
            requestPermissionsThen(true) {
                if (TrackingService.status.isCurrent(token)) sharingStartJob = lifecycleScope.launch {
                    try {
                        awaitSharingStartReady(token, user.uid, date)
                        TrackingService.status.starting(token, "Saving today's explicit location-sharing consent.")
                        val response = api.json("/tracking/start", "POST", JSONObject().put("consent", true))
                        val saved = response.optJSONObject("session")
                        check(response.opt("withinWindow") == true && saved != null && saved.optString("date") == date && saved.has("stoppedAt") && saved.isNull("stoppedAt")) {
                            "Today's location-sharing consent was not confirmed."
                        }
                        awaitSharingStartReady(token, user.uid, date)
                        TrackingService.status.starting(token, "Consent confirmed. Starting the visible location service.")
                        ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, TrackingService::class.java)
                            .setAction(TrackingService.ACTION_START).putExtra(TrackingService.EXTRA_RUN_TOKEN, token))
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        if (TrackingService.status.isCurrent(token)) {
                            val stop = TrackingService.stopOnPhone(this@MainActivity, "Sharing did not start. ${friendlyError(error)}", true)
                            TrackingService.confirmServerStop(this@MainActivity, stop, sharingStartJob)
                        }
                    } finally {
                        if (sharingStartToken == token) { sharingStartToken = null; sharingStartJob = null }
                    }
                }
            }
        } catch (error: Exception) {
            pendingSharingPermission = null; sharingStartToken = null
            TrackingService.status.failed(token, "Sharing did not start. ${friendlyError(error)}")
        }
    }
    private suspend fun awaitSharingStartReady(token: Long, uid: String, date: String) {
        val ready = kotlinx.coroutines.withTimeoutOrNull(30000) {
            while (true) {
                check(TrackingService.status.isCurrent(token)) { "The location-sharing start was cancelled." }
                check(auth.currentUser?.uid == uid && auth.currentUser?.isEmailVerified == true) { "Your sign-in changed. Give consent again after signing in." }
                check(Workday.contains() && Workday.date() == date) { "The location-sharing window ended. Give consent again during the next workday." }
                if (appAvailable && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) break
                kotlinx.coroutines.delay(100)
            }
            true
        }
        check(ready == true) { "Return to the app and allow venue access before starting location sharing." }
        check(TrackingService.permissionsReady(this)) { "Allow precise location and notifications, including the sharing notification channel, before starting." }
    }
    private fun stopDailySharing(): Job? {
        val starting = sharingStartJob
        sharingStartJob = null; sharingStartToken = null
        starting?.cancel()
        if (pendingSharingPermission != null) { pendingPermissions = null; pendingSharingPermission = null }
        val token = TrackingService.stopOnPhone(this)
        return TrackingService.confirmServerStop(this, token, starting)
    }
    private fun signOutAccount() { runAction {
        if (session?.optJSONObject("user")?.optString("role") != "attendance-viewer" || TrackingService.status.current.collecting)
            stopDailySharing()?.join()
        auth.signOut(); session = null; savedReceipts.clear(); lastDashboardModel = null; preferredAttendanceSession = ""; renderLogin()
    } }
    private suspend fun renderHrControls() {
        if (!appAvailable || session?.optJSONObject("user")?.optString("role") != "committee") return
        val events = api.array("/events")
        val requests = api.array("/registration-requests")
        val employees = api.array("/employees")
        val loadedDay = Workday.date()
        val dailyEvents = (0 until events.length()).map { events.getJSONObject(it) }.filter { it.optString("date") == loadedDay && it.optString("title") == "Daily employee attendance" }
        check(dailyEvents.size <= 1) { "Multiple daily attendance sessions need review in the web portal before changing today's attendance." }
        val daily = dailyEvents.firstOrNull()
        val desiredOpen = HrProfileMatch.desiredSessionState(daily?.opt("checkInOpen") == true)
        lateinit var screen: HrControlsScreen
        screen = HrControlsScreen(this, daily?.opt("checkInOpen") == true, requests, employees, HrActions(
            onToggleSession = { runAction {
                if (Workday.date() != loadedDay) {
                    screen.markUnavailable(); renderHrControls()
                    showMessage("The attendance day changed. Review today's session before changing it.")
                } else saveHrChange(screen, if (desiredOpen) "Today's attendance is open." else "Today's attendance is closed. Existing records are preserved.") {
                    val latest = api.array("/events")
                    val matching = (0 until latest.length()).map { latest.getJSONObject(it) }.filter { it.optString("date") == loadedDay && it.optString("title") == "Daily employee attendance" }
                    check(matching.size <= 1) { "Multiple daily sessions need review. Refresh HR controls." }
                    val existing = matching.firstOrNull()
                    check(daily == null || existing?.optString("id") == daily.optString("id")) { "The daily session changed. Refresh HR controls before changing it." }
                    check(Workday.date() == loadedDay) { "The attendance day changed. Refresh HR controls." }
                    val event = existing ?: api.json("/events", "POST", JSONObject().put("title", "Daily employee attendance").put("date", loadedDay).put("isMandatory", true))
                    check(Workday.date() == loadedDay) { "The attendance day changed. Refresh HR controls." }
                    // Apply the action the administrator saw, even if another admin already applied it.
                    if (event.opt("checkInOpen") != desiredOpen)
                        api.json("/events/${event.getString("id")}", "PATCH", JSONObject().put("checkInOpen", desiredOpen))
                }
            } },
            onApprove = { requestId, employeeId -> runAction { saveHrChange(screen, "Employee approved. They can refresh their approval status.") {
                api.json("/registration-requests/$requestId/approve", "POST", JSONObject().put("employeeId", employeeId))
            } } },
            onReject = { requestId, reason -> runAction { saveHrChange(screen, "Request rejected. No employee access was granted.") {
                api.json("/registration-requests/$requestId/reject", "POST", JSONObject().put("reason", reason))
            } } },
            onRefresh = { runAction {
                try { renderHrControls() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { screen.markUnavailable(); throw error }
            } },
            onBack = { runAction { renderDashboard() } }, onViewAttendance = { runAction { renderAttendanceReport() } }
        ))
        dashboardScreen = null; viewerScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
    private suspend fun saveHrChange(screen: HrControlsScreen, savedMessage: String, write: suspend () -> Unit) {
        try { write() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            screen.markUnavailable()
            throw IllegalStateException("The change could not be confirmed. Refresh HR controls before trying again. ${friendlyError(error)}", error)
        }
        screen.markUnavailable()
        try { renderHrControls(); showNotice(savedMessage) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { showNotice("$savedMessage The change succeeded, but current HR data could not refresh. Use Refresh HR controls to continue.") }
    }
    private suspend fun renderAttendanceReport(date: String = Workday.date(), eventId: String = "") {
        val filters = viewerScreen?.currentFilters() ?: ViewerFilters()
        val report = api.json("/attendance-report?date=${Uri.encode(date)}${if (eventId.isNotBlank()) "&eventId=${Uri.encode(eventId)}" else ""}")
        ViewerReportValidator.validate(report, date, eventId)
        if (!appAvailable) return
        val screen = AttendanceViewerScreen(this, report, date, eventId, AttendanceViewerActions(
            onLoad = { day, event -> runAction { renderAttendanceReport(day, event) } },
            onBack = { if (session?.optJSONObject("user")?.optString("role") == "attendance-viewer") finish() else runAction { renderDashboard() } },
            onSignOut = { signOutAccount() }
        ), filters)
        viewerScreen = screen; dashboardScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
    private suspend fun enrollPasskey() {
        if (!appAvailable) return
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
    private suspend fun verifyPasskey(eventId: String, onPromptComplete: () -> Unit = {}): String {
        val options = api.json("/biometrics/authentication/options", "POST", JSONObject().put("eventId", eventId))
        restoreAfterPrompt = dashboardScreen != null
        ceremonyInProgress = true
        val result = try {
            CredentialManager.create(this).getCredential(this,
                GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options.getJSONObject("options").toString()))))
        } catch (error: Exception) { ceremonyInProgress = false; throw error }
        try { awaitVenueAfterSystemPrompt() } finally { ceremonyInProgress = false }
        val credential = result.credential as? PublicKeyCredential ?: throw IllegalStateException("A phone passkey is required.")
        onPromptComplete()
        val verified = api.json("/biometrics/authentication/verify", "POST", JSONObject().put("challengeId", options.getString("challengeId")).put("response", JSONObject(credential.authenticationResponseJson)))
        return verified.getString("proof")
    }
    private suspend fun awaitVenueAfterSystemPrompt() {
        // Returning from the system prompt never requires an app-unlock location.
        kotlinx.coroutines.withTimeout(30000) {
            while (!lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) kotlinx.coroutines.delay(100)
        }
    }
    private fun requestPermissionsThen(tracking: Boolean, action: () -> Unit) {
        val needed = mutableListOf<String>()
        if (!LocationAccess.precisePermission(this)) needed.addAll(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        if (tracking && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        if (needed.isEmpty()) { pendingSharingPermission = null; action() }
        else { pendingPermissions = action; permissionRequest.launch(needed.toTypedArray()) }
    }
    private suspend fun renderMovementReport(date: String = Workday.date()) {
        val uid = auth.currentUser?.uid ?: error("Sign in before opening movement history.")
        val report = api.json("/tracking/report?date=${Uri.encode(date)}")
        check(auth.currentUser?.uid == uid) { "Your account changed. Reload your movement report." }
        MovementReportValidator.validate(report, date, uid)
        if (!appAvailable) return
        val employee = session?.optJSONObject("user")
        val screen = MovementReportScreen(this, report, MovementReportActions(
            onBack = { runAction { renderDashboard() } },
            onRefresh = { runAction { renderMovementReport(date) } },
            onOpenMap = { url -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        ), employee?.optString("fullName").orEmpty(), employee?.optString("email").orEmpty())
        dashboardScreen = null; viewerScreen = null
        mountDesigned(screen.root, screen::setBusy, screen::showMessage, screen::showNotice)
    }
}

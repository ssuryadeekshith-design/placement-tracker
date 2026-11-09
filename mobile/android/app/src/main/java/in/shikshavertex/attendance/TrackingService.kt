package `in`.shikshavertex.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/** Starts only from an explicit, visible, consented Activity action; never restarts itself. */
class TrackingService : Service(), LocationListener {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var locations: LocationManager
    private lateinit var api: ApiClient
    private val points = PendingSamples()
    private val sending = Mutex()
    private var started = false
    private var stopping = false
    private var day = ""
    private var uid = ""
    private var runToken = -1L
    private var lastSampleElapsed = 0L
    private var collectionStartedAt = Long.MAX_VALUE

    override fun onCreate() {
        super.onCreate()
        instance = this
        locations = getSystemService(LocationManager::class.java)
        api = ApiClient(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Workday location sharing", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val token = stopOnPhone(this)
            confirmServerStop(this, token)
            return START_NOT_STICKY
        }
        val requestedToken = intent?.getLongExtra(EXTRA_RUN_TOKEN, -1L) ?: -1L
        if (started) return START_NOT_STICKY
        val user = FirebaseAuth.getInstance().currentUser
        if (intent?.action != ACTION_START || !status.isCurrent(requestedToken) || !Workday.contains() ||
            !permissionsReady(this) || user?.isEmailVerified != true || status.current.uid != user.uid || status.current.date != Workday.date()) {
            if (status.isCurrent(requestedToken)) {
                val token = stopOnPhone(this, "Sharing did not start. Check precise location, notifications and today's consent.", true)
                confirmServerStop(this, token)
            }
            stopSelf()
            return START_NOT_STICKY
        }
        runToken = requestedToken; uid = user.uid; day = Workday.date()
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Starting — checking your daily consent…"),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        } catch (_: Exception) {
            stopTracking("Sharing could not start its visible notification. Check notification and location settings.", true)
            return START_NOT_STICKY
        }
        started = true
        scope.launch {
            try {
                val response = api.json("/tracking/status")
                if (stopping || !status.isCurrent(runToken)) return@launch
                val session = response.optJSONObject("session")
                if (response.opt("withinWindow") != true || session == null || !session.has("stoppedAt") || !session.isNull("stoppedAt") || session.optString("date") != day) {
                    stopTracking("Sharing requires today's confirmed consent. Start again from the app.", true)
                    return@launch
                }
                collectionStartedAt = System.currentTimeMillis()
                beginLocationUpdates()
                if (!status.collectorStarted(runToken)) { stopLocally(); return@launch }
                refreshNotification()
                var lastFlush = android.os.SystemClock.elapsedRealtime()
                while (!stopping && status.isCurrent(runToken)) {
                    delay(1000)
                    if (!Workday.contains() || Workday.date() != day) { stopTracking("The 8:30 PM workday window ended. Sharing stopped on this phone."); break }
                    if (!permissionsReady(this@TrackingService) || FirebaseAuth.getInstance().currentUser?.uid != uid || FirebaseAuth.getInstance().currentUser?.isEmailVerified != true) {
                        stopTracking("Sharing stopped because permission, notifications or sign-in changed."); break
                    }
                    val sampled = status.current.lastSampleAt
                    if (sampled != null && System.currentTimeMillis() - sampled > 90_000 && status.current.phase == SharingPhase.ACTIVE) {
                        status.waiting(runToken); refreshNotification()
                    }
                    val elapsed = android.os.SystemClock.elapsedRealtime()
                    if (elapsed - lastFlush >= 30_000) { lastFlush = elapsed; flush() }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (!stopping) stopTracking("Sharing could not start. Check your connection, permissions and daily consent.", true) }
        }
        return START_NOT_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun beginLocationUpdates() {
        if (!LocationAccess.precisePermission(this)) throw SecurityException("Precise location is required.")
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { locations.isProviderEnabled(it) }
        if (providers.isEmpty()) throw IllegalStateException("Location is switched off.")
        providers.forEach { locations.requestLocationUpdates(it, 60000L, 0f, this, Looper.getMainLooper()) }
    }

    override fun onLocationChanged(location: Location) {
        if (stopping || !status.isCurrent(runToken)) return
        if (!permissionsReady(this) || FirebaseAuth.getInstance().currentUser?.uid != uid) { stopTracking("Sharing stopped because permission or sign-in changed."); return }
        if (location.time < collectionStartedAt) return
        if (!Workday.contains() || Workday.date() != day) { stopTracking("The workday window ended. Sharing stopped on this phone."); return }
        if (!Workday.contains(location.time) || Workday.date(location.time) != day) return
        val age = System.currentTimeMillis() - location.time
        @Suppress("DEPRECATION") val mocked = location.isFromMockProvider
        if (age !in -5000..300000 || !location.hasAccuracy() || !location.accuracy.isFinite() || location.accuracy <= 0 || mocked) return
        val elapsed = android.os.SystemClock.elapsedRealtime()
        if (lastSampleElapsed > 0 && elapsed - lastSampleElapsed < 45000L) return
        lastSampleElapsed = elapsed
        points.offer(LocationSample(location.latitude, location.longitude, location.accuracy.toDouble(), location.time), System.currentTimeMillis())
        status.sampled(runToken, location.time); refreshNotification()
        scope.launch { flush() }
    }

    private suspend fun flush() = sending.withLock {
        if (stopping || !status.isCurrent(runToken)) return@withLock
        if (FirebaseAuth.getInstance().currentUser?.uid != uid || FirebaseAuth.getInstance().currentUser?.isEmailVerified != true) {
            stopTracking("Sharing stopped because your sign-in changed."); return@withLock
        }
        if (!Workday.contains() || Workday.date() != day) { stopTracking("The workday window ended. Sharing stopped on this phone."); return@withLock }
        val batch = points.batch(System.currentTimeMillis())
        if (batch.isEmpty()) return@withLock
        try {
            val response = api.json("/tracking/points", "POST", JSONObject().put("points", JSONArray(batch.map {
                JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("accuracyMeters", it.accuracyMeters).put("capturedAt", it.capturedAt)
            })))
            if (stopping || !status.isCurrent(runToken)) return@withLock
            val accepted = response.opt("accepted") as? Number
            val duplicates = response.opt("duplicates") as? Number
            if (accepted == null || duplicates == null || accepted.toDouble() < 0 || duplicates.toDouble() < 0 ||
                accepted.toDouble() != accepted.toInt().toDouble() || duplicates.toDouble() != duplicates.toInt().toDouble() ||
                accepted.toDouble() + duplicates.toDouble() != batch.size.toDouble()) throw IllegalStateException("Upload was not confirmed.")
            points.acknowledge(batch)
            status.uploaded(runToken, System.currentTimeMillis()); refreshNotification()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: ApiException) {
            if (error.status in listOf(400, 401, 403, 409)) stopTracking("Sharing stopped because the attendance service could not accept this session.", true)
            else uploadDelayed()
        } catch (_: Exception) { uploadDelayed() }
    }
    private fun uploadDelayed() {
        if (stopping || !status.isCurrent(runToken)) return
        status.delayed(runToken, "Uploads delayed. This phone is still collecting; unconfirmed or missing observations may become unknown gaps.")
        refreshNotification()
    }
    private fun stopTracking(message: String, failed: Boolean = false) {
        if (stopping) return
        val token = stopOnPhone(this, message, failed)
        confirmServerStop(this, token)
    }
    private fun stopLocally() {
        if (stopping) return
        stopping = true
        runCatching { locations.removeUpdates(this) }
        points.clear()
        scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    private fun refreshNotification() {
        if (!stopping && status.isCurrent(runToken) && permissionsReady(this))
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification(status.current.message))
    }
    private fun notification(message: String) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_location)
        .setContentTitle(if (status.current.collecting) "Location sharing service running" else "Location sharing is starting")
        .setContentText(message).setStyle(NotificationCompat.BigTextStyle().bigText(message))
        .setOngoing(true).setOnlyAlertOnce(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .addAction(0, "Stop Sharing", PendingIntent.getService(this, 1, Intent(this, TrackingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .build()

    override fun onDestroy() {
        val interrupted = !stopping && status.isCurrent(runToken)
        stopping = true
        runCatching { locations.removeUpdates(this) }; points.clear(); scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        if (instance === this) instance = null
        if (interrupted) {
            val token = status.stop(uid, "Sharing was interrupted and is stopped on this phone. Start again only with new consent.")
            confirmServerStop(this, token)
        }
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onProviderDisabled(provider: String) {
        if (!stopping && status.isCurrent(runToken)) {
            status.delayed(runToken, "A location provider is off. The service is running; fresh location observations may be unavailable.")
            refreshNotification()
        }
    }
    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    companion object {
        const val ACTION_START = "in.shikshavertex.attendance.START_TRACKING"
        const val ACTION_STOP = "in.shikshavertex.attendance.STOP_TRACKING"
        const val EXTRA_RUN_TOKEN = "sharing_run_token"
        private const val CHANNEL = "attendance_location"
        private const val NOTIFICATION_ID = 1030
        val status = SharingStateStore()
        private var instance: TrackingService? = null
        private val stopScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        private var confirmationJob: Job? = null
        private var confirmationToken = -1L

        fun permissionsReady(context: Context): Boolean {
            val notificationPermission = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            return LocationAccess.precisePermission(context) && notificationPermission && NotificationManagerCompat.from(context).areNotificationsEnabled() &&
                context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        }
        /** Synchronous local stop: callbacks removed, queue cleared, notification removed before network work. */
        fun stopOnPhone(context: Context, message: String = "Sharing stopped on this phone. No new locations are being collected.", failed: Boolean = false): Long {
            val owner = status.current.uid.ifBlank { FirebaseAuth.getInstance().currentUser?.uid.orEmpty() }
            val token = if (status.current.stopPending && !status.current.collecting && status.current.phase != SharingPhase.STARTING)
                status.current.token else status.stop(owner, message, failed)
            instance?.stopLocally()
            context.applicationContext.stopService(Intent(context.applicationContext, TrackingService::class.java))
            return token
        }
        fun confirmServerStop(context: Context, token: Long, afterStart: Job? = null): Job? {
            if (!status.stopRequestStarted(token)) return if (confirmationToken == token) confirmationJob else null
            val owner = status.current.uid
            val application = context.applicationContext
            confirmationToken = token
            val job = stopScope.launch {
                try {
                    // Finish/cancel the older consent request before closing its server session.
                    afterStart?.join()
                    if (status.current.token != token) return@launch
                    check(FirebaseAuth.getInstance().currentUser?.uid == owner) { "Sign in to confirm the server stop." }
                    val response = ApiClient(application).json("/tracking/stop", "POST", JSONObject())
                    val session = response.optJSONObject("session")
                    check(response.has("session") && (response.isNull("session") || (session != null && session.has("stoppedAt") && !session.isNull("stoppedAt")))) {
                        "Server stop was not confirmed."
                    }
                    status.stopConfirmed(token)
                } catch (cancelled: CancellationException) { status.stopUnconfirmed(token); throw cancelled }
                catch (_: Exception) { status.stopUnconfirmed(token) }
            }
            confirmationJob = job
            return job
        }
    }
}

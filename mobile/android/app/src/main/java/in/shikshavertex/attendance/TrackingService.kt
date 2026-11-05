package `in`.shikshavertex.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/** Started only by the visible Activity after daily consent and runtime permissions. */
class TrackingService : Service(), LocationListener {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var locations: LocationManager
    private lateinit var api: ApiClient
    private val points = PendingSamples() // Memory-only; never an indefinite movement archive.
    private val sending = Mutex()
    private var started = false
    private var stopping = false
    private var day = ""
    private var lastSampleElapsed = 0L
    private var collectionStartedAt = Long.MAX_VALUE

    override fun onCreate() {
        super.onCreate()
        locations = getSystemService(LocationManager::class.java)
        api = ApiClient(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Attendance location tracking", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking("Location tracking stopped.", true)
            return START_NOT_STICKY
        }
        // The OS must not restart collection after a kill, boot, or a null restart intent.
        if (intent?.action != ACTION_START || !Workday.contains() || !permissionsReady() || FirebaseAuth.getInstance().currentUser?.isEmailVerified != true) {
            state.value = "Tracking is stopped. Open the app to start with consent during 10:30 AM–8:30 PM."
            stopSelf()
            return START_NOT_STICKY
        }
        if (started) return START_NOT_STICKY
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Starting — checking your daily consent…"), if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        started = true
        day = Workday.date()
        scope.launch {
            try {
                val status = api.json("/tracking/status")
                val session = status.optJSONObject("session")
                val stopped = session?.let { it.has("stoppedAt") && !it.isNull("stoppedAt") } ?: true
                if (!status.optBoolean("withinWindow") || session == null || stopped || session.optString("date") != day) {
                    stopTracking("Tracking requires today's consent. Open the app to start.", false)
                    return@launch
                }
                collectionStartedAt = System.currentTimeMillis()
                beginLocationUpdates()
                update("Tracking active until 8:30 PM. Tap Stop to end sharing.")
                while (!stopping) {
                    delay(30000L)
                    if (!Workday.contains() || Workday.date() != day) { stopTracking("Workday ended. Location tracking stopped.", true); break }
                    if (!permissionsReady() || FirebaseAuth.getInstance().currentUser == null) { stopTracking("Tracking stopped because permission or sign-in changed.", true); break }
                    flush()
                }
            } catch (error: Exception) {
                stopTracking(error.message ?: "Tracking could not start. Try again from the app.", false)
            }
        }
        return START_NOT_STICKY
    }

    private fun permissionsReady(): Boolean {
        val notificationPermission = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        return LocationAccess.precisePermission(this) && notificationPermission && NotificationManagerCompat.from(this).areNotificationsEnabled() &&
            getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    @SuppressLint("MissingPermission")
    private fun beginLocationUpdates() {
        if (!LocationAccess.precisePermission(this)) throw SecurityException("Precise location permission is required.")
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { locations.isProviderEnabled(it) }
        if (providers.isEmpty()) throw IllegalStateException("Location is switched off. Enable it and start again.")
        providers.forEach { locations.requestLocationUpdates(it, 60000L, 0f, this, Looper.getMainLooper()) }
    }

    override fun onLocationChanged(location: Location) {
        if (stopping) return
        if (!permissionsReady()) { stopTracking("Tracking stopped because location or notification permission changed.", true); return }
        if (location.time < collectionStartedAt) return
        if (!Workday.contains() || Workday.date() != day) { stopTracking("Workday ended. Location tracking stopped.", true); return }
        if (!Workday.contains(location.time) || Workday.date(location.time) != day) return
        val age = System.currentTimeMillis() - location.time
        @Suppress("DEPRECATION")
        val mocked = location.isFromMockProvider
        if (age !in -5000..300000 || !location.hasAccuracy() || location.accuracy <= 0 || mocked) return
        val elapsed = android.os.SystemClock.elapsedRealtime()
        if (lastSampleElapsed > 0 && elapsed - lastSampleElapsed < 45000L) return
        lastSampleElapsed = elapsed
        points.offer(LocationSample(location.latitude, location.longitude, location.accuracy.toDouble(), location.time), System.currentTimeMillis())
        scope.launch { flush() }
    }

    private suspend fun flush() = sending.withLock {
        if (stopping) return@withLock
        if (!Workday.contains() || Workday.date() != day) { stopTracking("Workday ended. Location tracking stopped.", true); return@withLock }
        val batch = points.batch(System.currentTimeMillis())
        if (batch.isEmpty()) return@withLock
        try {
            api.json("/tracking/points", "POST", JSONObject().put("points", JSONArray(batch.map { JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("accuracyMeters", it.accuracyMeters).put("capturedAt", it.capturedAt) })))
            points.acknowledge(batch)
            update("Tracking active. Last location sent ${java.time.LocalTime.now(Workday.zone).withNano(0)} IST.")
        } catch (error: ApiException) {
            if (error.status in listOf(400, 401, 403, 409)) {
                stopTracking("Tracking stopped: ${error.message}", false)
            } else update("Connection unavailable. Missing periods will appear as gaps.")
        } catch (_: Exception) {
            update("Connection unavailable. Missing periods will appear as gaps.")
        }
    }

    private fun stopTracking(message: String, notifyBackend: Boolean) {
        if (stopping) return
        stopping = true
        locations.removeUpdates(this)
        points.clear()
        state.value = message
        scope.launch {
            if (notifyBackend) runCatching { api.json("/tracking/stop", "POST", JSONObject()) }
            ServiceCompat.stopForeground(this@TrackingService, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun update(message: String) {
        if (stopping) return // A late upload/provider callback must not revive the stopped notification.
        state.value = message
        if (permissionsReady()) NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification(message))
    }
    private fun notification(message: String) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_location)
        .setContentTitle("Attendance location tracking is active")
        .setContentText(message)
        .setStyle(NotificationCompat.BigTextStyle().bigText(message))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .addAction(0, "Stop sharing location", PendingIntent.getService(this, 1, Intent(this, TrackingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .build()

    override fun onDestroy() {
        val interrupted = !stopping
        stopping = true
        locations.removeUpdates(this)
        points.clear()
        scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        if (interrupted) state.value = "Tracking stopped or was interrupted. Open the app to resume with consent."
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onProviderDisabled(provider: String) { update("A location provider is off. Missing or inaccurate periods will appear as gaps.") }
    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    companion object {
        const val ACTION_START = "in.shikshavertex.attendance.START_TRACKING"
        const val ACTION_STOP = "in.shikshavertex.attendance.STOP_TRACKING"
        private const val CHANNEL = "attendance_location"
        private const val NOTIFICATION_ID = 1030
        val state = MutableStateFlow("Tracking is stopped. No background locations are being collected.")
    }
}

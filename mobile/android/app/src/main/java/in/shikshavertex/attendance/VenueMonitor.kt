package `in`.shikshavertex.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Foreground access checks only. Daily background sharing belongs to TrackingService. */
object VenueAccessState {
    var point: JSONObject? = null; private set
    private var capturedElapsed = 0L
    var generation = 0L; private set
    var token: String? = null; private set
    var expiresAt = 0L; private set
    fun accept(location: Location) {
        point = LocationAccess.point(location)
        capturedElapsed = location.elapsedRealtimeNanos / 1000000L
    }
    fun lock() { point = null; token = null; expiresAt = 0; generation++ }
    fun current(): JSONObject {
        val value = point ?: throw ApiException(403, "The app is locked. Return to the venue and get a new precise location.")
        if (SystemClock.elapsedRealtime() - capturedElapsed !in 0..VenueGate.MAX_AGE_MILLIS || System.currentTimeMillis() - value.optLong("capturedAt") !in -5000..VenueGate.MAX_AGE_MILLIS) {
            lock(); throw ApiException(403, "Venue location expired. Wait for a new location.")
        }
        return value
    }
    fun lease(value: String, end: Long, expectedGeneration: Long) {
        current()
        if (generation != expectedGeneration) throw ApiException(403, "Venue access was locked while checking location.")
        token = value; expiresAt = end
    }
}

class VenueMonitor(private val context: Context, private val changed: (Boolean, String) -> Unit) : LocationListener {
    private val manager = context.getSystemService(LocationManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var resumedAt = 0L
    private var last: Location? = null
    private var allowed = false
    private var reason = ""
    private val tick = object : Runnable {
        override fun run() { if (running) { evaluate(); handler.postDelayed(this, 1000) } }
    }
    @SuppressLint("MissingPermission")
    fun start() {
        stop()
        running = true; resumedAt = SystemClock.elapsedRealtimeNanos(); last = null
        report(false, "Main screens are locked until a new precise location confirms you are at the venue.")
        if (!LocationAccess.precisePermission(context)) { report(false, "Allow precise location to unlock the app at the venue."); return }
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager.isProviderEnabled(it) }
        if (providers.isEmpty()) { report(false, "Location is switched off. Enable it and retry."); return }
        try { providers.forEach { manager.requestLocationUpdates(it, 5000L, 0f, this, Looper.getMainLooper()) }; handler.post(tick) }
        catch (_: SecurityException) { report(false, "Precise location permission is required.") }
    }
    fun stop() {
        running = false; last = null; allowed = false
        handler.removeCallbacks(tick); manager.removeUpdates(this); VenueAccessState.lock()
    }
    private fun report(value: Boolean, message: String) {
        if (!value) VenueAccessState.lock()
        if (value != allowed || message != reason) { allowed = value; reason = message; changed(value, message) }
    }
    private fun evaluate() {
        if (!LocationAccess.precisePermission(context)) { report(false, "Precise location permission was removed. The app is locked."); return }
        val location = last
        @Suppress("DEPRECATION")
        val fix = location?.let { VenueGate.Fix(it.latitude, it.longitude, if (it.hasAccuracy()) it.accuracy.toDouble() else 0.0,
            it.time, (SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos) / 1000000L, it.isFromMockProvider) }
        val decision = VenueGate.evaluate(fix)
        if (decision.allowed && location != null) VenueAccessState.accept(location)
        report(decision.allowed, decision.reason)
    }
    override fun onLocationChanged(location: Location) {
        if (!running || location.elapsedRealtimeNanos < resumedAt) return
        last = location; evaluate()
    }
    override fun onProviderDisabled(provider: String) { last = null; report(false, "A location provider was disabled. Get a new precise location to unlock.") }
    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
}

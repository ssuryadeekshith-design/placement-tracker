package `in`.shikshavertex.attendance

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/** Subscribes only while the Activity is resumed, independent of consented workday tracking. */
class ForegroundVenueMonitor(private val context: Context, private val changed: (Location?, String?) -> Unit) : LocationListener {
    private val manager = context.getSystemService(LocationManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var afterElapsedNanos = 0L
    private var latest: Location? = null
    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            if (!LocationAccess.precisePermission(context)) { changed(null, "Allow precise location to unlock the main screens."); stop(); return }
            val enabled = manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            changed(if (enabled) latest else null, if (enabled) null else "Location is switched off. Enable it to unlock.")
            if (running) handler.postDelayed(this, 1000)
        }
    }
    @SuppressLint("MissingPermission")
    fun start() {
        stop()
        if (!LocationAccess.precisePermission(context)) { changed(null, "Allow precise location to unlock the main screens."); return }
        afterElapsedNanos = SystemClock.elapsedRealtimeNanos()
        running = true
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager.isProviderEnabled(it) }
        if (providers.isEmpty()) { changed(null, "Location is switched off. Enable it to unlock."); stop(); return }
        try {
            providers.forEach { manager.requestLocationUpdates(it, 5000L, 0f, this, Looper.getMainLooper()) }
            handler.post(tick)
        } catch (_: SecurityException) { changed(null, "Precise location permission is required."); stop() }
    }
    fun stop() {
        running = false; latest = null
        handler.removeCallbacks(tick)
        runCatching { manager.removeUpdates(this) }
    }
    override fun onLocationChanged(location: Location) {
        if (!running || location.elapsedRealtimeNanos < afterElapsedNanos) return
        latest = location
        changed(location, null)
    }
    override fun onProviderDisabled(provider: String) { if (running) changed(null, "Location provider changed. Waiting for a new precise location."); latest = null }
    override fun onProviderEnabled(provider: String) { if (running) changed(null, "Waiting for a new precise location.") }
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
}

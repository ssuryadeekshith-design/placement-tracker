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
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object LocationAccess {
    fun precisePermission(context: Context) = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun point(location: Location) = JSONObject()
        .put("latitude", location.latitude)
        .put("longitude", location.longitude)
        .put("accuracyMeters", location.accuracy.toDouble())
        .put("capturedAt", location.time)

    @SuppressLint("MissingPermission")
    suspend fun current(context: Context): Location = suspendCancellableCoroutine { continuation ->
        if (!precisePermission(context)) {
            continuation.resumeWithException(SecurityException("Allow precise location to check in."))
            return@suspendCancellableCoroutine
        }
        val manager = context.getSystemService(LocationManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        var completed = false
        lateinit var listener: LocationListener
        val timeout = Runnable {
            if (!completed) {
                completed = true
                manager.removeUpdates(listener)
                continuation.resumeWithException(IllegalStateException("A fresh precise location could not be obtained. Enable GPS, move near a window and try again."))
            }
        }
        listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (completed || !continuation.isActive) return
                val age = System.currentTimeMillis() - location.time
                @Suppress("DEPRECATION")
                val mocked = location.isFromMockProvider
                if (age !in -5000..60000 || !location.hasAccuracy() || location.accuracy <= 0 || location.accuracy > 50 || mocked) return
                completed = true
                handler.removeCallbacks(timeout)
                manager.removeUpdates(this)
                continuation.resume(location)
            }
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
        }
        continuation.invokeOnCancellation {
            completed = true
            handler.removeCallbacks(timeout)
            manager.removeUpdates(listener)
        }
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager.isProviderEnabled(it) }
        if (providers.isEmpty()) {
            completed = true
            continuation.resumeWithException(IllegalStateException("Location is switched off. Enable it in Android settings."))
        } else {
            try {
                providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
                handler.postDelayed(timeout, 25000L)
            } catch (error: Exception) {
                completed = true
                manager.removeUpdates(listener)
                continuation.resumeWithException(error)
            }
        }
    }
}

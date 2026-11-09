package `in`.shikshavertex.attendance

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** A conservative horizontal geofence. It deliberately makes no floor claim. */
object VenueGate {
    data class Venue(
        val latitude: Double = 12.912773610440954,
        val longitude: Double = 77.62322878099566,
        val radiusMeters: Double = 100.0,
        val maxAccuracyMeters: Double = 50.0,
        val configured: Boolean = true
    )
    data class Fix(val latitude: Double, val longitude: Double, val accuracyMeters: Double,
                   val capturedAt: Long, val elapsedAgeMillis: Long, val mocked: Boolean = false)
    data class Decision(val allowed: Boolean, val reason: String, val outside: Boolean = false)
    const val MAX_AGE_MILLIS = 15000L

    fun evaluate(fix: Fix?, venue: Venue = Venue(), now: Long = System.currentTimeMillis()): Decision {
        if (!venue.configured || !venue.latitude.isFinite() || !venue.longitude.isFinite() ||
            venue.latitude !in -90.0..90.0 || venue.longitude !in -180.0..180.0 || venue.radiusMeters <= 0 || !venue.radiusMeters.isFinite() || venue.maxAccuracyMeters <= 0 || !venue.maxAccuracyMeters.isFinite()) {
            return Decision(false, "The venue is not configured. Contact the administrator.")
        }
        if (fix == null) return Decision(false, "Venue GPS has not been checked. Obtain a fresh precise location.")
        if (fix.mocked) return Decision(false, "A simulated location cannot verify office presence.")
        if (!fix.latitude.isFinite() || !fix.longitude.isFinite() || !fix.accuracyMeters.isFinite() ||
            fix.latitude !in -90.0..90.0 || fix.longitude !in -180.0..180.0 || fix.accuracyMeters <= 0) {
            return Decision(false, "The location is invalid. Get a new precise location.")
        }
        if (now - fix.capturedAt !in -5000..MAX_AGE_MILLIS || fix.elapsedAgeMillis !in 0..MAX_AGE_MILLIS) {
            return Decision(false, "Venue GPS has expired. Obtain a fresh location.")
        }
        if (fix.accuracyMeters > venue.maxAccuracyMeters) return Decision(false, "Location is too uncertain. Enable precise location and move near a window.")
        val distance = distanceMeters(fix.latitude, fix.longitude, venue.latitude, venue.longitude)
        if (distance + fix.accuracyMeters > venue.radiusMeters) return Decision(false,
            if (distance - fix.accuracyMeters > venue.radiusMeters) "Venue GPS places this phone outside the office perimeter."
            else "Venue GPS uncertainty overlaps the office perimeter. Move further inside and retry.",
            outside = distance - fix.accuracyMeters > venue.radiusMeters)
        return Decision(true, "Fresh location is within the venue area.")
    }

    fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        fun rad(value: Double) = value * Math.PI / 180
        val a = sin(rad(toLat - fromLat) / 2).let { it * it } + cos(rad(fromLat)) * cos(rad(toLat)) * sin(rad(toLng - fromLng) / 2).let { it * it }
        return 6371000 * 2 * atan2(sqrt(a), sqrt((1 - a).coerceAtLeast(0.0)))
    }
}

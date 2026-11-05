package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class VenueGateTest {
    private val now = 1800000000000L
    private val venue = VenueGate.Venue()
    private fun fix(latitude: Double = venue.latitude, longitude: Double = venue.longitude, accuracy: Double = 5.0,
                    capturedAt: Long = now, age: Long = 0L, mocked: Boolean = false) = VenueGate.Fix(latitude, longitude, accuracy, capturedAt, age, mocked)
    @Test fun requiresFreshPositionInsideVenue() {
        assertTrue(VenueGate.evaluate(fix(), venue, now).allowed)
        assertFalse(VenueGate.evaluate(null, venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(latitude = venue.latitude + .01), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(capturedAt = now - 15001), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(age = 15001), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(capturedAt = now + 5001), venue, now).allowed)
    }
    @Test fun uncertainBoundaryAndLowQualityOrMockedFixRemainLocked() {
        assertFalse(VenueGate.evaluate(fix(latitude = venue.latitude + .00072, accuracy = 30.0), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(accuracy = 51.0), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(accuracy = 0.0), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(latitude = Double.NaN), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(mocked = true), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(), venue.copy(configured = false), now).allowed)
    }
    @Test fun freshNewFixCanUnlockAgainAfterLeavingButOldFixCannot() {
        assertFalse(VenueGate.evaluate(fix(latitude = venue.latitude + .01), venue, now).allowed)
        assertFalse(VenueGate.evaluate(fix(capturedAt = now - 16000, age = 16000), venue, now).allowed)
        assertTrue(VenueGate.evaluate(fix(), venue, now).allowed)
    }
}

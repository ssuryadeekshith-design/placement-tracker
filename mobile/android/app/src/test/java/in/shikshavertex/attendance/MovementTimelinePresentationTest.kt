package `in`.shikshavertex.attendance

import org.junit.Assert.*
import org.junit.Test

class MovementTimelinePresentationTest {
    @Test fun laterHoursStaySeparateFromElapsedUnknownTime() {
        val result = MovementTimelinePresentation.segments(0, 600000, 300000, emptyList())
        assertEquals(2, result.size)
        assertEquals(300.0, result.filterNot { it.future }.sumOf { it.seconds }, 0.001)
        assertEquals(300.0, result.filter { it.future }.sumOf { it.seconds }, 0.001)
        assertTrue(result.all { it.state == "unknown" })
    }
    @Test fun conflictingAndMissingIntervalsNeverBecomeVenueOrAwayTime() {
        val result = MovementTimelinePresentation.segments(0, 600000, 600000, listOf(
            MovementInterval(0, 120000, "inside"), MovementInterval(60000, 180000, "away")
        ))
        assertEquals(listOf("inside", "unknown", "away", "unknown"), result.map { it.state })
        assertEquals(480.0, result.filter { it.state == "unknown" }.sumOf { it.seconds }, 0.001)
        assertEquals(600.0, result.sumOf { it.seconds }, 0.001)
    }
    @Test fun invalidIntervalsAndTimeAfterCutoffCannotCreatePresence() {
        val result = MovementTimelinePresentation.segments(0, 600000, 60000, listOf(
            MovementInterval(0, -1, "inside"), MovementInterval(120000, 180000, "inside")
        ))
        assertTrue(result.all { it.state == "unknown" })
        assertEquals("<1 min", MovementTimelinePresentation.duration(12.0))
        assertEquals("Unavailable", MovementTimelinePresentation.duration(Double.NaN))
    }
}

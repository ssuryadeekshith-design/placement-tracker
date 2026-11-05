package `in`.shikshavertex.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class PendingSamplesTest {
    private val noon = Instant.parse("2026-11-04T06:30:00Z").toEpochMilli()
    private fun sample(time: Long) = LocationSample(12.9, 77.6, 10.0, time)
    @Test fun staleFutureAndOffHoursSamplesCannotQueue() {
        val queue = PendingSamples()
        queue.offer(sample(noon - 300001), noon)
        queue.offer(sample(noon + 5001), noon)
        queue.offer(sample(Instant.parse("2026-11-04T04:59:00Z").toEpochMilli()), noon)
        assertTrue(queue.batch(noon).isEmpty())
        queue.offer(sample(noon), noon)
        assertEquals(1, queue.batch(noon).size)
        assertTrue(queue.batch(noon + 300001).isEmpty())
    }
    @Test fun stoppingOrEndingWindowDropsAllPendingCoordinates() {
        val queue = PendingSamples()
        queue.offer(sample(noon), noon)
        queue.clear()
        assertTrue(queue.batch(noon).isEmpty())
        val end = Instant.parse("2026-11-04T15:00:00Z").toEpochMilli()
        queue.offer(sample(end - 1000), end - 1000)
        assertTrue(queue.batch(end).isEmpty())
    }
    @Test fun retriesKeepFirstSampleAndQueueHasBoundedMemory() {
        val queue = PendingSamples()
        for (index in 0..39) queue.offer(sample(noon + index), noon + 100)
        assertEquals(30, queue.batch(noon + 100).size)
        val first = queue.batch(noon + 100).first()
        queue.offer(first.copy(latitude = 0.0), noon + 100)
        assertEquals(first, queue.batch(noon + 100).first())
        val accepted = queue.batch(noon + 100)
        queue.acknowledge(accepted)
        assertTrue(queue.batch(noon + 100).isEmpty())
    }
}

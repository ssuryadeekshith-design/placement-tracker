package `in`.shikshavertex.attendance

/** Memory-only queue: preserve the first sample per timestamp and never retain stale/off-hours points. */
data class LocationSample(val latitude: Double, val longitude: Double, val accuracyMeters: Double, val capturedAt: Long)
class PendingSamples {
    private val samples = mutableListOf<LocationSample>()
    fun offer(sample: LocationSample, now: Long) {
        prune(now)
        if (!Workday.contains(now) || !Workday.contains(sample.capturedAt) || Workday.date(sample.capturedAt) != Workday.date(now) ||
            now - sample.capturedAt !in -5000..300000 || samples.any { it.capturedAt == sample.capturedAt }) return
        if (samples.size >= 30) samples.removeAt(0)
        samples.add(sample)
    }
    fun batch(now: Long): List<LocationSample> { prune(now); return samples.toList() }
    fun acknowledge(accepted: List<LocationSample>) { samples.removeAll(accepted.toSet()) }
    fun clear() { samples.clear() }
    private fun prune(now: Long) {
        if (!Workday.contains(now)) { clear(); return }
        samples.removeAll { now - it.capturedAt !in -5000..300000 || Workday.date(it.capturedAt) != Workday.date(now) }
    }
}

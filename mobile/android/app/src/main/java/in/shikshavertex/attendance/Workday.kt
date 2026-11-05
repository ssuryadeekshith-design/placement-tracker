package `in`.shikshavertex.attendance

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** No local location collection is permitted outside this window. Server validates it independently. */
object Workday {
    val zone: ZoneId = ZoneId.of("Asia/Kolkata")
    private val start = LocalTime.of(10, 30)
    private val end = LocalTime.of(20, 30)
    fun contains(epochMillis: Long = System.currentTimeMillis()): Boolean {
        val time = Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalTime()
        return time >= start && time < end
    }
    fun date(epochMillis: Long = System.currentTimeMillis()): String = Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate().toString()
}

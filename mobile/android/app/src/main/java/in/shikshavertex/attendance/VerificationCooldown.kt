package `in`.shikshavertex.attendance

/** Local resend pacing only. Firebase still controls delivery and server rate limits. */
data class VerificationCooldown(val sentAtEpochMs: Long, val sentAtElapsedMs: Long) {
    fun secondsRemaining(nowEpochMs: Long, nowElapsedMs: Long): Int {
        // Monotonic time handles a wall-clock rollback; wall time also covers a phone restart.
        val age = maxOf((nowEpochMs - sentAtEpochMs).coerceAtLeast(0),
            (nowElapsedMs - sentAtElapsedMs).coerceAtLeast(0))
        return ((DURATION_MS - age).coerceIn(0, DURATION_MS) + 999).div(1000).toInt()
    }

    companion object { const val DURATION_MS = 60_000L }
}

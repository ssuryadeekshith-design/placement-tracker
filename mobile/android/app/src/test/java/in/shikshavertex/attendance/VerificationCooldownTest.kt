package `in`.shikshavertex.attendance

import org.junit.Assert.assertEquals
import org.junit.Test

class VerificationCooldownTest {
    private val epoch = 1_800_000_000_000L
    private val elapsed = 120_000L

    @Test fun countdownRoundsUpUntilTheFullMinuteHasElapsed() {
        val cooldown = VerificationCooldown(epoch, elapsed)
        assertEquals(60, cooldown.secondsRemaining(epoch, elapsed))
        assertEquals(60, cooldown.secondsRemaining(epoch + 999, elapsed + 999))
        assertEquals(1, cooldown.secondsRemaining(epoch + 59_999, elapsed + 59_999))
        assertEquals(0, cooldown.secondsRemaining(epoch + 60_000, elapsed + 60_000))
        assertEquals(0, cooldown.secondsRemaining(epoch + 120_000, elapsed + 120_000))
    }

    @Test fun reopeningUsesSavedTimestampsWithoutStartingAnotherMinute() {
        val recreated = VerificationCooldown(epoch, elapsed)
        assertEquals(37, recreated.secondsRemaining(epoch + 23_000, elapsed + 23_000))
    }

    @Test fun monotonicTimePreventsClockRollbackExtendingTheWait() {
        assertEquals(15, VerificationCooldown(epoch, elapsed).secondsRemaining(epoch - 10_000, elapsed + 45_000))
        assertEquals(0, VerificationCooldown(epoch, elapsed).secondsRemaining(epoch - 10_000, elapsed + 65_000))
    }

    @Test fun wallTimeCoversRestartWithAnEarlierUptime() {
        assertEquals(40, VerificationCooldown(epoch, elapsed).secondsRemaining(epoch + 20_000, 5_000))
        assertEquals(0, VerificationCooldown(epoch, elapsed).secondsRemaining(epoch + 90_000, 5_000))
    }
}

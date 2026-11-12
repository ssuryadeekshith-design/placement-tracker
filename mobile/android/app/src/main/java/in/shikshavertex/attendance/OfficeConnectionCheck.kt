package `in`.shikshavertex.attendance

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** Await an asynchronous Android observation, never retry an attendance write. */
object OfficeConnectionCheck {
    suspend fun <T> await(attempts: Int = 11, pause: suspend () -> Unit = { delay(200) }, read: () -> T): T {
        require(attempts > 0)
        repeat(attempts) { attempt ->
            try { return read() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: IllegalStateException) { if (attempt == attempts - 1) throw error }
            pause()
        }
        error("Office connection could not be confirmed.")
    }
}

package `in`.shikshavertex.attendance

import java.io.IOException
import javax.net.ssl.SSLException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Only the read-only health probe is retried, never an attendance submission. */
class ServerConnectionGate(
    private val probe: suspend () -> Boolean,
    private val onConnecting: (Boolean) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) {
    companion object { const val MESSAGE = "Connecting to the server. Please wait a moment..." }
    private val mutex = Mutex()
    private var healthyAt: Long? = null
    suspend fun awaitReady() = mutex.withLock {
        if (healthyAt?.let { clock()-it in 0..30000 } == true) return@withLock
        onConnecting(true)
        try {
            repeat(4) { attempt ->
                val ready = try { probe() }
                catch(error: SSLException) { throw error }
                catch(_: IOException) { false }
                if(ready) { healthyAt=clock(); return@withLock }
                if(attempt<3) pause(1500)
            }
            throw IOException("Could not connect to the attendance service. Check your internet connection and try again.")
        } finally { onConnecting(false) }
    }
}

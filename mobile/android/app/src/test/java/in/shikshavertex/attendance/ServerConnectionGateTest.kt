package `in`.shikshavertex.attendance

import java.io.IOException
import javax.net.ssl.SSLException
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class ServerConnectionGateTest {
    @Test fun wakeupRemainsConnectingUntilHealthIsReady()=runBlocking {
        val states=mutableListOf<Boolean>(); var attempts=0
        val gate=ServerConnectionGate({ ++attempts>=3 },{ states.add(it) },pause={})
        gate.awaitReady()
        assertEquals(listOf(true,false),states); assertEquals(3,attempts)
        gate.awaitReady();assertEquals(3,attempts)
        assertEquals("Connecting to the server. Please wait a moment...",ServerConnectionGate.MESSAGE)
    }
    @Test fun transientTimeoutsAreBoundedAndNeverReplayAnOperation()=runBlocking {
        var probes=0;var writes=0;val states=mutableListOf<Boolean>()
        val gate=ServerConnectionGate({probes++;throw IOException("timeout")},{states.add(it)},pause={})
        try {gate.awaitReady();writes++;fail("Expected unavailable service")} catch(_: IOException) {}
        assertEquals(4,probes);assertEquals(0,writes);assertEquals(listOf(true,false),states)
    }
    @Test fun concurrentCallsShareTheWakeupCheck()=runBlocking {
        var probes=0
        val gate=ServerConnectionGate({probes++;delay(10);true})
        coroutineScope { repeat(4) { launch {gate.awaitReady()} } }
        assertEquals(1,probes)
    }
    @Test fun permanentErrorsAndCancellationAreNotRetried()=runBlocking {
        for(error in listOf(SSLException("certificate"),CancellationException("cancelled"),IllegalStateException("configuration"))) {
            var probes=0;val states=mutableListOf<Boolean>()
            val gate=ServerConnectionGate({probes++;throw error},{states.add(it)},pause={})
            try {gate.awaitReady();fail("Must propagate")}catch(actual:Exception){assertSame(error,actual)}
            assertEquals(1,probes);assertEquals(listOf(true,false),states)
        }
    }
    @Test fun expiredHealthIsProbedAgain()=runBlocking {
        var now=0L;var probes=0
        val gate=ServerConnectionGate({probes++;true},clock={now})
        gate.awaitReady();now=30001;gate.awaitReady();assertEquals(2,probes)
    }
}

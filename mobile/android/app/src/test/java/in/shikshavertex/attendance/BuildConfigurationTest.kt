package `in`.shikshavertex.attendance

import java.net.URI
import org.junit.Assert.*
import org.junit.Test

class BuildConfigurationTest {
    @Test fun compiledAppHasAUsableAttendanceServiceAddress() {
        val url = BuildConfig.API_BASE_URL
        assertTrue("Attendance API address must be compiled into the APK", url.isNotBlank())
        val uri = URI(url)
        assertNotNull(uri.host)
        assertNull(uri.userInfo)
        assertNull(uri.query)
        assertNull(uri.fragment)
        val localDebug = BuildConfig.DEBUG && uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2")
        assertTrue("The service must use HTTPS", uri.scheme == "https" || localDebug)
    }
}

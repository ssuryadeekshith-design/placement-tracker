package `in`.shikshavertex.attendance

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class ApiException(val status: Int, message: String, val code: String? = null) : Exception(message)

class ApiClient(context: Context) {
    private val applicationContext = context.applicationContext
    private val preferences = context.applicationContext.getSharedPreferences("browser_binding", Context.MODE_PRIVATE)
    private val base = BuildConfig.API_BASE_URL.trimEnd('/')

    init {
        val uri = URI(base)
        val debugLocal = BuildConfig.DEBUG && uri.scheme == "http" && uri.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
        require((uri.scheme == "https" || debugLocal) && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "The API must use HTTPS. Only the emulator/local host may use HTTP in debug builds."
        }
    }

    suspend fun json(path: String, method: String = "GET", body: JSONObject? = null): JSONObject = JSONObject(request(path, method, body))
    suspend fun array(path: String): JSONArray = JSONArray(request(path))

    private fun needsVenue(path: String): Boolean = path.substringBefore('?') !in setOf("/registration/request", "/registration/status", "/session", "/me", "/access/verify", "/access/lock", "/tracking/status", "/tracking/points", "/tracking/stop")

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): String {
        require(path.startsWith('/') && !path.startsWith("//"))
        val user = FirebaseAuth.getInstance().currentUser ?: throw ApiException(401, "Sign in first.")
        if (!user.isEmailVerified) throw ApiException(403, "Verify your email before continuing.")
        val attendance = path.substringBefore('?') in setOf("/attendance", "/attendance/manual")
        if (attendance) AttendanceWifi.requireConnected(applicationContext)
        val interactive = needsVenue(path)
        val generation = VenueAccessState.generation
        var accessToken: String? = null
        if (interactive) {
            val point = VenueAccessState.current()
            if (VenueAccessState.token == null || VenueAccessState.expiresAt < System.currentTimeMillis() + 3000) {
                val lease = JSONObject(request("/access/verify", "POST", JSONObject().put("location", point)))
                VenueAccessState.lease(lease.getString("token"), lease.getLong("expiresAt"), generation)
            }
            accessToken = VenueAccessState.token
        }
        for (attempt in 0..1) {
            val token = user.getIdToken(attempt == 1).await().token ?: throw ApiException(401, "Sign in again.")
            val response = withContext(Dispatchers.IO) {
                // Bind the submission to the verified Wi-Fi Network so Android
                // cannot silently fall back to cellular if Wi-Fi drops.
                val wifi = if (attendance) AttendanceWifi.requireConnected(applicationContext) else null
                val connection = (wifi?.network?.openConnection(URL(base + path)) ?: URL(base + path).openConnection()) as HttpURLConnection
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.setRequestProperty("Authorization", "Bearer $token")
                if (accessToken != null) connection.setRequestProperty("X-Venue-Access", accessToken)
                preferences.getString("placement_device", null)?.let { connection.setRequestProperty("Cookie", it) }
                try {
                    if (method != "GET") {
                        connection.doOutput = true
                        connection.setRequestProperty("Content-Type", "application/json")
                        val payload = if (body != null) JSONObject(body.toString()) else JSONObject()
                        if (wifi != null) {
                            val latest = AttendanceWifi.requireConnected(applicationContext)
                            if (latest.network != wifi.network) throw IllegalStateException("Wi-Fi changed before submission. Reconnect and try again.")
                            payload.put("wifi", latest.observation())
                        }
                        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                    }
                    val status = connection.responseCode
                    val result = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                    if (status in 200..299) {
                        connection.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten().forEach { value ->
                            val cookie = value.substringBefore(';')
                            if (cookie.startsWith("placement_device=")) preferences.edit().putString("placement_device", cookie).apply()
                        }
                    }
                    status to result
                } finally { connection.disconnect() }
            }
            if (interactive) {
                VenueAccessState.current()
                if (generation != VenueAccessState.generation) throw ApiException(403, "Venue access was locked. Return to the venue to continue.")
            }
            if (response.first in 200..299) return response.second
            if (response.first == 401 && attempt == 0) continue
            val details = runCatching { JSONObject(response.second) }.getOrNull()
            val message = details?.optString("error") ?: ""
            throw ApiException(response.first, message.ifBlank { "The service is unavailable (${response.first}). Try again." }, details?.optString("code"))
        }
        throw ApiException(401, "Your session has expired. Sign in again.")
    }
}

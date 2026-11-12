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

class ApiClient(context: Context, onConnecting: (Boolean) -> Unit = {}) {
    private val applicationContext = context.applicationContext
    private val preferences = context.applicationContext.getSharedPreferences("browser_binding", Context.MODE_PRIVATE)
    private val base = BuildConfig.API_BASE_URL.trimEnd('/')

    private val server = ServerConnectionGate(probe = {
        withContext(Dispatchers.IO) {
            val connection=URL("$base/health").openConnection() as HttpURLConnection
            connection.instanceFollowRedirects=false
            connection.connectTimeout=10000; connection.readTimeout=20000
            try {
                when(val status=connection.responseCode) {
                    200 -> JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optString("status")=="ok"
                    502,503,504 -> false
                    else -> throw ApiException(status,"The attendance service could not be reached. Please retry or contact HR.")
                }
            } finally { connection.disconnect() }
        }
    }, onConnecting=onConnecting)

    init {
        val uri = URI(base)
        val debugLocal = BuildConfig.DEBUG && uri.scheme == "http" && uri.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
        require((uri.scheme == "https" || debugLocal) && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "The API must use HTTPS. Only the emulator/local host may use HTTP in debug builds."
        }
    }

    suspend fun json(path: String, method: String = "GET", body: JSONObject? = null): JSONObject = JSONObject(request(path, method, body))
    suspend fun array(path: String): JSONArray = JSONArray(request(path))

    suspend fun loadPolicy(): AttendancePolicy {
        server.awaitReady()
        return withContext(Dispatchers.IO) {
        val connection = URL("$base/venue").openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15000
        connection.readTimeout = 20000
        try {
            if (connection.responseCode != 200) throw IllegalStateException("Could not load attendance settings. Retry in a moment; the service may be waking up.")
            val venue = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            fun flag(json: JSONObject?, key: String): Boolean? = json?.opt(key) as? Boolean
            AttendancePolicy.fromFlags(venue.optString("attendanceMode"), flag(venue, "accessRequired"),
                flag(venue, "locationRequired"), flag(venue.optJSONObject("attendanceWifi"), "required"), flag(venue, "requiresRoomCode"))
        } finally { connection.disconnect() }
    }

    }

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): String {
        require(path.startsWith('/') && !path.startsWith("//"))
        val user = FirebaseAuth.getInstance().currentUser ?: throw ApiException(401, "Sign in first.")
        if (!user.isEmailVerified) throw ApiException(403, "Verify your email before continuing.")
        server.awaitReady()
        val attendance = path.substringBefore('?') in setOf("/attendance", "/attendance/manual")
        if (attendance) AttendanceWifi.awaitConnected(applicationContext)
        for (attempt in 0..1) {
            val token = user.getIdToken(attempt == 1).await().token ?: throw ApiException(401, "Sign in again.")
            val response = withContext(Dispatchers.IO) {
                // Bind the submission to the verified office connection Network so Android
                // cannot silently fall back to cellular if office connection drops.
                val wifi = if (attendance) AttendanceWifi.awaitConnected(applicationContext) else null
                val connection = (wifi?.network?.openConnection(URL(base + path)) ?: URL(base + path).openConnection()) as HttpURLConnection
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.setRequestProperty("Authorization", "Bearer $token")
                preferences.getString("placement_device", null)?.let { connection.setRequestProperty("Cookie", it) }
                try {
                    if (method != "GET") {
                        connection.doOutput = true
                        connection.setRequestProperty("Content-Type", "application/json")
                        val payload = if (body != null) JSONObject(body.toString()) else JSONObject()
                        if (wifi != null) {
                            val latest = AttendanceWifi.awaitConnected(applicationContext)
                            if (latest.network != wifi.network) throw IllegalStateException("The office connection changed before submission. Reconnect and try again.")
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
            if (response.first in 200..299) return response.second
            if (response.first == 401 && attempt == 0) continue
            val details = runCatching { JSONObject(response.second) }.getOrNull()
            val message = details?.optString("error") ?: ""
            throw ApiException(response.first, message.ifBlank { "The service is unavailable (${response.first}). Try again." }, details?.optString("code"))
        }
        throw ApiException(401, "Your session has expired. Sign in again.")
    }
}

package `in`.shikshavertex.attendance

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class ViewerCheckIn(
    val session: String,
    val timestamp: String,
    val method: String,
    val mode: String,
    val locationChecked: Boolean,
    val phoneVerified: Boolean = false,
    val venueWifiObserved: Boolean = false,
)

data class ViewerEmployee(
    val name: String,
    val email: String,
    val department: String,
    val team: String,
    val marked: Boolean,
    val checkIns: List<ViewerCheckIn>,
)

enum class ViewerStatusFilter { ALL, MARKED, NOT_MARKED }
enum class ViewerModeFilter { ALL, SETUP, ONSITE, OVERRIDE, LEGACY }
data class ViewerFilters(val query: String = "", val department: String = "", val team: String = "",
                         val status: ViewerStatusFilter = ViewerStatusFilter.ALL, val mode: ViewerModeFilter = ViewerModeFilter.ALL)

object ViewerPresentation {
    private val india = ZoneId.of("Asia/Kolkata")
    private val time = DateTimeFormatter.ofPattern("h:mm:ss a", Locale.ENGLISH).withZone(india)
    private val refreshed = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.ENGLISH).withZone(india)

    fun time(value: String): String = runCatching { time.format(Instant.parse(value)) }.getOrDefault("Time unavailable")
    fun checkInTime(value: String): String = time(value).let { if (it == "Time unavailable") it else "$it IST" }
    fun validRowState(status: String?, count: Int?): Boolean = count != null && count >= 0 &&
        ((status == "marked" && count > 0) || (status == "not-marked" && count == 0))
    fun refreshed(value: String): String = runCatching { refreshed.format(Instant.parse(value)) + " IST" }.getOrDefault("Update time unavailable")

    fun initials(employee: ViewerEmployee): String {
        val source = employee.name.trim().ifBlank { employee.email.substringBefore('@').replace('_', ' ').replace('.', ' ') }
        return source.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).map { it.take(1) }.joinToString("").uppercase(Locale.ROOT).ifBlank { "?" }
    }

    fun matchesMode(checkIn: ViewerCheckIn, filter: ViewerModeFilter): Boolean = when (filter) {
        ViewerModeFilter.ALL -> true
        ViewerModeFilter.OVERRIDE -> checkIn.method == "committee" || checkIn.method == "manual"
        ViewerModeFilter.SETUP -> checkIn.method !in listOf("committee", "manual") && checkIn.mode == "setup"
        ViewerModeFilter.ONSITE -> checkIn.method !in listOf("committee", "manual") && checkIn.mode == "onsite"
        ViewerModeFilter.LEGACY -> checkIn.method !in listOf("committee", "manual") && checkIn.mode !in listOf("setup", "onsite")
    }

    fun matches(
        employee: ViewerEmployee,
        query: String = "",
        department: String = "",
        team: String = "",
        status: ViewerStatusFilter = ViewerStatusFilter.ALL,
        mode: ViewerModeFilter = ViewerModeFilter.ALL,
    ): Boolean = listOf(employee.name, employee.email, employee.department, employee.team).joinToString(" ").lowercase(Locale.ROOT).contains(query.trim().lowercase(Locale.ROOT)) &&
        (department.isEmpty() || employee.department == department) && (team.isEmpty() || employee.team == team) &&
        (status == ViewerStatusFilter.ALL || (status == ViewerStatusFilter.MARKED) == employee.marked) &&
        (mode == ViewerModeFilter.ALL || employee.checkIns.any { matchesMode(it, mode) })

    fun evidence(checkIn: ViewerCheckIn): String = when {
        checkIn.method in listOf("committee", "manual") -> "Committee override · location not verified"
        checkIn.mode == "setup" -> "Setup mode · location not verified"
        checkIn.mode == "onsite" && checkIn.locationChecked -> "Onsite location check recorded"
        checkIn.mode == "onsite" -> "Onsite mode · location not verified"
        else -> "Legacy record · verification unavailable"
    }
}

package `in`.shikshavertex.attendance

/** UI eligibility only; approval transactions still recheck every identity and access binding. */
object HrProfileMatch {
    fun eligible(active: Boolean, employeeId: String, profileUid: String?, profileEmail: String?, requestUid: String, requestEmail: String): Boolean =
        active && employeeId.matches(Regex("SV[0-9]{3}")) && requestUid.isNotBlank() && requestEmail.isNotBlank() &&
            (profileUid.isNullOrBlank() || profileUid == requestUid) && (profileEmail.isNullOrBlank() || profileEmail == requestEmail)

    fun desiredSessionState(loadedOpen: Boolean) = !loadedOpen
}

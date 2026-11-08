package `in`.shikshavertex.attendance

/** Only an explicit, consistent server setup policy can relax venue checks. */
data class AttendancePolicy(val onsiteRequired: Boolean = true) {
    companion object {
        fun fromFlags(mode: String?, access: Boolean?, location: Boolean?, wifi: Boolean?, room: Boolean?) =
            AttendancePolicy(!(mode == "setup" && access == false && location == false && wifi == false && room == false))
    }
}

object AttendancePolicyState {
    @Volatile var current = AttendancePolicy()
}

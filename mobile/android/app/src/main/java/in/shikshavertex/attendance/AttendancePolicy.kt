package `in`.shikshavertex.attendance

/** Account screens open anywhere. Attendance always checks venue presence. */
data class AttendancePolicy(val onsiteRequired: Boolean = true) {
    companion object {
        fun fromFlags(mode: String?, access: Boolean?, location: Boolean?, wifi: Boolean?, room: Boolean?) =
            AttendancePolicy(onsiteRequired = true)
    }
}

object AttendancePolicyState {
    @Volatile var current = AttendancePolicy()
}

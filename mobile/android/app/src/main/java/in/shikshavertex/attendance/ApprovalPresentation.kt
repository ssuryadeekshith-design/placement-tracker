package `in`.shikshavertex.attendance

enum class EmployeeApprovalState { REQUEST, PENDING, REJECTED, RECOVERY, APPROVED, UNAVAILABLE }

/** Presentation only; server approval and the authenticated session still control access. */
object ApprovalPresentation {
    fun state(status: String?, approved: Boolean?): EmployeeApprovalState {
        if (approved == null) return EmployeeApprovalState.UNAVAILABLE
        if (approved) return if (status == "approved") EmployeeApprovalState.APPROVED else EmployeeApprovalState.UNAVAILABLE
        return when (status) {
            "not-requested" -> EmployeeApprovalState.REQUEST
            "pending" -> EmployeeApprovalState.PENDING
            "rejected" -> EmployeeApprovalState.REJECTED
            "access-unavailable" -> EmployeeApprovalState.RECOVERY
            else -> EmployeeApprovalState.UNAVAILABLE
        }
    }

    fun validName(value: String) = value.trim().length in 2..120 && value.length <= 120
}

# Additional HR administrator

The owner authorized `hr_kowshik@shikshavertex.in` and
`surya_deekshith@shikshavertex.in` to have the same application HR permissions as
`hr@shikshavertex.in`. All three receive the existing `committee` role:
employee approvals/rejections, session management, all-employee attendance and CSV
reports, audited manual attendance overrides, and HR movement-report access.
Attendance overrides retain the same office checks and audit requirements.

After deploying this update, the additional administrator registers with that
exact email, verifies the verification email, and signs in. If already signed in,
sign out and sign in again to refresh the role. No APK update is required for this
server-side permission change. No password or biometric data needs to be shared.

The server verifies both the Firebase ID token and the live Firebase account,
including verified ownership and disabled-account status. The grant is recorded
once in `System/additional-hr-admin-<email digest>` and bound to the verified UID.
It preserves other custom claims and does not overwrite employee/device links.
Revoked mailbox access and previously completed grants are not automatically
restored. Existing administrator access and all other employee roles remain as
they were. No Firebase Console, Render, GitHub or Google Workspace privileges
are granted by this application role.

The default additional-mailbox list contains only the two owner-authorized mailboxes.
Operators can override it with `HR_ADDITIONAL_ADMIN_EMAILS`; an empty value disables
new additional grants. This setting is never read from a client request.

# Attendance viewers and dashboard

The owner selected three verified work mailboxes:

| Email | Access |
| --- | --- |
| hr@shikshavertex.in | Existing HR administrator, plus attendance dashboard |
| surya_deekshith@shikshavertex.in | Existing employee access, plus read-only access to everyone's attendance |
| hr_pallavi@shikshavertex.in | Read-only attendance viewer; no employee or HR approval is fabricated |

These are the default `ATTENDANCE_VIEWER_EMAILS` in the server configuration. An explicit comma-separated Render environment value overrides the defaults; an empty value disables these configured viewer grants. Existing server-verified committee administrators continue to have attendance access. Job title, email prefix and client-submitted flags grant no permissions.

## Deploy and open the browser dashboard

1. Merge this branch into `main` and deploy the backend on Render.
2. Under **Placement Tracker → Environment**, set `ATTENDANCE_VIEWER_EMAILS=hr@shikshavertex.in,surya_deekshith@shikshavertex.in,hr_pallavi@shikshavertex.in`. Keep the existing `HR_ADMIN_EMAIL`, Firebase Admin credential, cookie secret and temporary setup-mode configuration. Do not put Admin credentials in frontend variables.
3. The website requires its public Firebase web configuration. From **Firebase → Project settings → General → Your apps**, select/register a web app in `placementtracker-a1a87`. In Render set `REACT_APP_FIREBASE_API_KEY` to the web config's `apiKey`, `REACT_APP_FIREBASE_AUTH_DOMAIN` to its `authDomain`, and `REACT_APP_FIREBASE_PROJECT_ID` to `placementtracker-a1a87`. Ensure any API-key restrictions allow this web app. Android's JSON alone does not build/configure the React site.
4. With Render's root directory still `server`, use build command `npm ci && npm --prefix ../client ci && npm --prefix ../client run build`, and start command `node server.js`. The server serves `client/build` and the API from the same origin. Leave `REACT_APP_API_URL` unset for this arrangement, or set it to `/api`. A separate frontend host requires deliberately configured origins/cookies.
5. Add `placement-tracker-lyjf.onrender.com` to **Firebase Authentication → Settings → Authorized domains**, as appropriate for the deployed web app. Save/rebuild/deploy Render, then open `https://placement-tracker-lyjf.onrender.com` in a browser.
6. Each selected person registers with their own email/password if needed, opens their email-verification link, and signs in again. No password or Firebase Authentication user is created by this code. The owner already authorized viewing for these mailboxes, so Pallavi does not need to be incorrectly linked to someone in the employee roster to view reports.
7. Open **Everyone’s attendance**, choose **Attendance date** and optionally **Attendance session**. Use search, department, team and status filters. Tap **Refresh attendance records** to retrieve new check-ins. **Download attendance CSV** exports the filtered rows for Excel.

The dashboard shows names where linked, emails, departments/teams, check-in times in India time, and setup/onsite/override evidence labels. An all-sessions report counts an account as marked if it checked into any session that day. Selecting a particular session narrows that rule. “Not marked yet” is not an absence, leave, late-arrival, working-hours or payroll decision. The report includes current approved registered accounts plus historical check-ins for the selected day. Unregistered roster entries are excluded; disabled/deleted accounts' recorded check-ins remain reportable. Missing employee names are labelled as not linked instead of guessed.

The attendance CSV contains selected-day identity/check-in fields, ISO timestamps and India-time display values. Spreadsheet-formula prefixes are neutralized. No coordinates, device identifiers, passkey credentials, override reasons or movement-history samples are included in this viewer endpoint/export.

## Android interface

Version **1.4** adds **View everyone's attendance** to authorized employee/HR dashboards. A viewer-only account opens a smaller dashboard with that action and Sign out, without employee check-in, HR controls or location-sharing controls. The report has date/session selection, a search field, a marked-only filter and explicit refresh. Attendance CSV export is in the browser dashboard. Surya retains his own employee attendance and explicitly consented tracking features; viewing other people's movement reports remains restricted to existing HR administrators.

The APK build and unit tests can be checked locally, but publication is still blocked by the previously reported missing version 1.2 signing key. This feature does not recover or rotate that private key. The signing-certificate guard remains in place; do not remove it or publish a random replacement key as an in-place update. Browser deployment does not require a new APK. Phone installation and native interaction still require testing after a correctly signed build is available.

## Authorization and recovery

Viewer access uses a verified, revocation-checked Firebase token, the explicit server email configuration and the existing signed browser/app profile binding. On first verified sign-in, `AttendanceViewers/{email}` records the UID and enabled flag. The grant is bound to that first UID. Disabled grants, disabled employee access and account recreation are not silently repaired. A viewer-only session never creates `AllowedEmails` employee approval or grants a committee custom claim.

To revoke only viewing for Surya, remove the email from the server configuration and redeploy, or set that viewer document's `enabled` to `false`. His existing employee approval is preserved. A disabled viewer-only grant prevents that account entering the attendance dashboard. Removing HR's viewer configuration does not remove its independently granted HR administrator privileges. Operator recovery is required to change an existing grant's UID. This change does not revoke any pre-existing committee role; use the existing administrator recovery process for that.

`GET /api/attendance-report` requires viewer/admin authorization on every request, including refresh and export-source loading. When onsite enforcement is enabled, existing venue access checks also apply. Ordinary employees continue to receive only their own attendance from the original summary endpoint. Read-only viewers cannot manage events, approve employees, mark someone else's attendance or read another person's tracking report. Viewer-only accounts cannot use employee attendance/biometric/tracking APIs until independently approved as employees.

Viewer API data is labelled and projected explicitly; raw Firestore records are never exposed. The endpoint does not offer a write method. In the web UI, a failed/revoked refresh clears displayed records and disables export. Data already downloaded to a viewer's computer cannot be remotely revoked.

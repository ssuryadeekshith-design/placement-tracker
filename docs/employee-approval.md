# Shiksha Vertex employee onboarding

**Current temporary setup mode:** venue location, Wi-Fi and room-code checks are disabled until the owner enables `ENFORCE_ONSITE_ATTENDANCE=true`. Email verification, HR approval, passkeys and open-event/date rules remain. The venue requirements below describe onsite mode. Follow [the current phone installation and HR steps](temporary-setup-mode.md).

`server/employees.json` contains the 64 employee profiles provided by the owner: full name, designation, department and team. Whitespace is trimmed; source spelling and team/department inconsistencies are preserved for HR review. Stable IDs SV001–SV064 distinguish profiles without using a job title as an authorization role. Emails are initially null; none were invented from names.

Startup and `npm run seed:employees` create missing `Employees` records. The repeatable seed never overwrites an HR edit, account/email binding or inactive flag and never creates Firebase Authentication accounts or grants permissions. Existing legacy eight approved emails continue to work and are not silently assigned to names. HR must verify identity before creating any additional binding.

## Employee flow

1. Install the updated Android app, visit the venue and register with your real `@shikshavertex.in` email and your own password.
2. Open the verification email and confirm it. Registration alone does not grant attendance access.
3. Enter your full employee name and request HR approval. The API uses the verified token's UID/email, never a client-provided identity/role/approval flag.
4. Until approval, only your own request/status endpoints are available; no roster, attendance or movement history is disclosed. Refresh status after HR acts.
5. HR selects the actual employee profile, checks the email/name match and approves or rejects with a reason. Approval links one employee ID to one verified account. Job title, seniority and department never grant admin rights.
6. After approval, attendance still requires venue access, the specified Wi-Fi, passkey, open event and room code. No registration/approval action marks attendance.

Pending requests cannot approve themselves, rejected requests cannot overwrite their decisions, and revoked or recreated identities require operator recovery instead of self-service reapproval. There is no automatic public company-wide allowlist. The app exposes no unauthenticated employee directory or registration-name dropdown; directory API access is authenticated and venue-gated. The supplied roster is a repository seed file.

## First HR administrator

The owner explicitly selected **hr@shikshavertex.in**. The default `HR_ADMIN_EMAIL` is this address; an empty environment value disables bootstrap. Verification of this mailbox is required. On its first approval-status check, the server rechecks the Firebase account, records its UID and grants the existing server-verified `committee: true` admin claim. The Android app and website then refresh the signed token before entering HR controls.

`System/initial-hr-admin` records the one-time provisioning. Once granted, ordinary sign-ins do not restore removed claims. A disabled allowlist record cannot be re-enabled by bootstrap, and another UID cannot take over the recorded administrator. The account can administer the roster without being fabricated as a 65th employee. Job-title holders such as HR team leads do not automatically inherit this mailbox's access.

Use the Firebase project associated with the app and ensure the backend's Admin credential has Authentication user/claim and Firestore permissions. Never put Admin credentials in an APK or chat. Bootstrap is code/configuration prepared here, not evidence that the live HR account has been created or granted access.

HR controls are available in the Android app's **Review employee approval requests** button and the website's **Employee directory and HR approvals** panel. Both require verified administrator access and fresh venue access. Rejection requires a reason. To revoke access, disable the AllowedEmails record and, for an administrator, remove the admin claim and revoke refresh tokens through an authorized operator. Do not delete/recreate users to bypass an existing binding.

## Android installation and signing

The app now defaults to `https://placement-tracker-lyjf.onrender.com/api` as already configured in the upstream project. Live health returned HTTP 200/status ok during this work, and the public Android association endpoint returned HTTP 200. This is not a phone sign-in, Wi-Fi or passkey test.

The GitHub APK workflow now caches its **development** debug signing identity and serializes builds to reduce certificate changes between CI runs. The first run using this cache will still have a new certificate compared with older, uncached builds. Download `render-passkeys.env` and `certificate.txt` alongside the APK from the Actions artifact and set Render's `ANDROID_SHA256_CERT_FINGERPRINTS` to that installed APK's public SHA-256 certificate (include older approved certificates if older installations must continue). The backend association and installed APK certificate must match for passkeys.

If Android reports a signing mismatch while replacing an older test app, do not treat the APK as an update signed by the old key. An uninstall/reinstall creates a fresh app profile and may require a new binding/passkey; perform that only deliberately. For deployment beyond testing, use a stable private release keystore or Play App Signing rather than an ephemeral debug identity. No private signing key is committed here. A cache is a development convenience, not a production release key-management solution.

After merging/deploying the code, install the corresponding APK and test HR registration, email verification, approval, rejection, identity collision, Wi-Fi disconnection and actual on-site attendance on representative phones. Confirm the backend and app use the same Firebase project and that retention policies are enabled. Never claim success on a physical phone based only on build/unit tests.

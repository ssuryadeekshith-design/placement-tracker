# Shiksha Vertex attendance

The owner-selected attendance viewers are `hr@shikshavertex.in`, `surya_deekshith@shikshavertex.in` and `hr_pallavi@shikshavertex.in`. The first keeps existing HR permissions; the latter two gain read-only attendance viewing without new HR or other-person movement-history rights. See [viewer access, dashboard use and deployment](docs/attendance-viewers.md).

Email-verified attendance with signed phone user verification, a room code, venue proximity and an Android app for explicitly consented daily location reporting.

Venue: **2nd floor, Srivari Arcade, NGR Layout, Roopena Agrahara, Bommanahalli, Bengaluru, Karnataka 560068**. Owner-confirmed pin: **12.912773610440954, 77.62322878099566**. Default radius: 100 m.

**Temporary setup mode is now the default at the owner's request.** Approved employees can open the app and mark self-reported attendance without GPS, venue Wi-Fi or a room code. Verified email, HR approval, phone passkey and an open event for today remain required. Records explicitly state that location was not verified. See [deployment, APK transfer and HR steps](docs/temporary-setup-mode.md). Set `ENFORCE_ONSITE_ATTENDANCE=true` on the backend and redeploy to restore the venue restrictions described below.

## Venue-only access

The native app and website now lock their main screens until a new precise position is inside the venue area. Outside, stale, missing or uncertain positions lock access again. The Android app checks foreground fixes roughly every five seconds, expires them after 15 seconds and requires a new fix after resuming. The website asks before foreground monitoring and locks when hidden. API access is also checked with short-lived account/profile-bound location tokens; this is not only a hidden button in the UI.

The locked shell retains location permission/retry, venue Maps, stop-sharing and sign-out controls. A previously consented workday tracking service continues while away so it can report departures and returns. Unlocking the app does not automatically start that service. The Android launcher can still open the locked shell; an app cannot forbid the OS from starting its process.

There is no installed indoor equipment, as confirmed by the owner. The 100 m fence cannot identify the second floor. The supplied research informed the separation of positioning/access/tracking, freshness and uncertainty checks, and native execution. BLE/RTT/UWB and calibrated pressure-based floor evidence are not enabled without real infrastructure and a site survey. See [research application and lock details](docs/venue-access.md).

## Employee directory and HR approval

The provided 64 Shiksha Vertex employee profiles are included with their names, designations, departments and teams. Newly verified company-email accounts request HR approval; an administrator links the request to a specific employee before attendance access is granted. The original eight approved accounts remain approved. No emails are guessed from names and no managerial title grants app permissions.

The owner selected `hr@shikshavertex.in` as the initial HR administrator, provisioned once after verified ownership. Android and web HR controls support approval/rejection and a private directory. Startup safely seeds missing employee records without overwriting HR changes. See [onboarding, bootstrap, signing and rollout](docs/employee-approval.md).

## Required attendance Wi-Fi

Attendance now also requires the native Android phone's active connection to **Shikshavertex_5G**. Members connect through Android Wi-Fi settings; the app does not store the password. It checks the connected SSID before submission and binds the attendance HTTP request to that Wi-Fi network, so a disconnect cannot silently fall back to mobile data. Unavailable/redacted names, another network or stale observations are rejected. Browsers cannot observe SSIDs, so browser attendance and browser overrides are unavailable while this rule is active; use the Android app.

The API validates the recent native observation for both self and committee submissions. An SSID/BSSID can be copied or fabricated by a modified client; this alone is not independent proof of the specific router or second floor. Optional approved BSSIDs and trusted public egress-IP restrictions are supported, but no router identifiers/IPs were supplied or configured. See [Wi-Fi enforcement, limitations and phone tests](docs/wifi-attendance.md). Previously consented away tracking is separate and may continue on mobile data.

## Attendance and phone verification

- Only the eight addresses in `server/allowed-emails.json` are initially approved. Each member creates their own Firebase Authentication email/password account and verifies the email.
- The first verified sign-in binds an opaque signed cookie to the email in Firestore. A browser or native app cannot switch that binding to another email. Signing out retains it.
- A member enrolls a phone/platform passkey. The server verifies real WebAuthn signatures with required user verification, exact relying-party/origin checks, expiring challenges and replay prevention. Public keys are stored; fingerprint/face images, biometric templates and device PINs are never collected.
- Phone user verification can use a fingerprint, face **or the device PIN**, depending on the operating system. Passkeys are not a guarantee that only a specific biometric was used. Accounts can have up to five credentials for recovery/device migration; this does not establish unique physical-device identity.
- Committee members create an event for today (India time), open check-in and display a six-digit room code in the room. The code expires after 60 seconds; a new code invalidates the old one.
- A self check-in requires the signed phone proof, event, current room code and a fresh accurate location. A single-use proof is bound to the account, browser/app and event; it expires after 60 seconds. The location accuracy circle must fit inside the venue radius, accuracy must be at most 50 m, and capture time must be no older than 60 seconds.
- Attendance and phone-proof consumption commit in one transaction. Duplicate check-ins cannot overwrite the first time/location. An authorized committee override requires a reason and is explicitly recorded without claimed GPS/passkey verification; it still requires the submitting device’s Wi-Fi check. The browser cannot make this submission while Wi-Fi is required.

**GPS cannot prove a floor or prevent spoofing.** A shared room code is not proof of second-floor presence. The system supplies checks and evidence, not a guarantee that someone is physically in the room. Phone biometric verification confirms an operating-system user-verification operation, not continuous identity or device ownership.

**A website/app cannot permanently identify a physical phone.** Clearing browser cookies/app data, uninstalling, private browsing or another browser can create a new binding. Synced passkeys also are not unique hardware identifiers. Do not claim this prevents all multiple-account use on one phone. Stronger requirements need managed devices and a separate enrollment/attestation design. Keep `DEVICE_COOKIE_SECRET` stable; changing it invalidates existing bindings.

## Daily tracking: 10:30 AM to 8:30 PM India time

`mobile/android` is a native Android application. A web tab cannot reliably collect location with the screen locked or the site closed. The website supplies the venue-gated reporting dashboard and account/passkey setup. Required Wi-Fi attendance is submitted from the native Android app, not the browser. It is not a background browser collector. Foreground access monitoring is separate from daily tracking.

The member explicitly starts tracking and agrees to the daily location disclosure. The native app requests location and notification permissions and runs a location foreground service with a persistent visible notification and stop action. It samples approximately once per minute, including away from the venue, only during **10:30–20:30 Asia/Kolkata**. It does not silently start at boot or start a new day without the member taking action. If a member starts late, earlier time is unknown.

Stopping tracking stops local collection and requests server-side revocation of that consent period. Collection also stops at the daily cutoff. Screen lock support requires actual-device validation. A force-stopped app, powered-off phone, denied permission, lost network, missing GPS or OS battery restrictions can interrupt collection. There is no promise of uninterrupted tracking. Online uploads accept at most five-minute-old samples; long offline gaps are not backfilled or represented as attendance. Users must see and understand this before starting.

Reports include:

- Estimated departures/returns and the observation windows in which a crossing could have occurred.
- Observed venue time, observed away time and **unknown time**, separately. Two consecutive compatible samples no more than five minutes apart are needed for an interval estimate. Missing/inaccurate/uncertain boundary intervals remain unknown.
- Offsite visits estimated from nearby samples spanning at least three minutes, with estimated dwell time, coordinates and Maps links.
- Location samples and gaps. A route is a set of samples, not a proven exact journey.

**Place/business names are not inferred.** Reports label visits by approximate coordinates and open them on Maps. A separately configured address/map service or approved named-location catalog is needed to add human-readable destination names. No reverse-geocoding credentials or external location sharing are configured here.

At the venue, members can view their own report. Only server-verified committee members can select another registered member, and they also need fresh venue access. The dashboard supports date selection and explicit CSV download. Tracking stops by 20:30; a final report can be viewed then. Persistent daily reports are finalized after a five-minute grace period (20:35 IST). The hosted server checks once a minute and catches up the previous seven days on startup. It must be running on an always-on host; no emails/messages are sent automatically.

For an external scheduler or manual catch-up:

```sh
cd server
node --env-file=.env scripts/finalize-reports.js 2026-11-04
```

Use a completed date. The operation is idempotent. Larger-than-1000-member days are reported as truncated and need a batching extension; do not claim those were completely finalized.

## Data retention and access

Tracking records include explicit consent periods, identity, reported coordinates/accuracy and server receive times. Device user-verification evidence contains a public credential identifier and verification time, never a biometric template. Existing attendance records are retained; legacy roll-number-only records are not automatically attributed to new email accounts.

Tracking days, points and finalized reports have **30-day `expiresAt` metadata**. Configure Firestore TTL policies on the `expiresAt` field for the `TrackingDays`, `TrackingPoints` and `DailyReports` collection groups. Enable TTL on `expiresAtDate` for `BiometricChallenges`, `BiometricProofs`, `VenueAccessLeases` and `VenueAccessState`. Runtime code enforces challenge/proof expiry even before TTL cleanup. **TTL metadata alone does not delete anything**; actual TTL policies and cleanup monitoring are a deployment step. Firestore TTL deletion is asynchronous. Attendance records have no automatic retention rule in this version; choose and communicate that policy separately.

Publish the supplied `firestore.rules` after review: direct client reads/writes are denied and all data access goes through the authenticated backend. If this Firebase project serves other apps, merge their required rules deliberately. Restrict administrator access, explain who can see location history and how long it is retained, and provide a recovery/contact process before rollout.

## Firebase setup

The Android app now includes the supplied public Firebase configuration for `placementtracker-a1a87` in `mobile/android/app/google-services.json`. This does not supply backend Admin/ADC credentials or a hosted API address. No live email accounts, database records, rules or custom claims were created by these code changes.

1. Open [Firebase Console](https://console.firebase.google.com/) and select the existing placement project, or create a development project for testing.
2. In the **left sidebar**, open **Security → Authentication** in the newer console navigation. In older console versions, expand **Build → Authentication**. The product search also finds “Authentication”. If the sidebar is collapsed, open the **☰** menu. Enable **Email/Password** under Sign-in method. Under Authentication settings, add the deployed domain (and `localhost` for local development) to authorized domains. Configure the email-verification template/return URL.
3. Create Firestore under **Build → Firestore Database** if needed. Review and publish `firestore.rules` and enable the TTL policies above.
4. Register a web app in **Project settings → General → Your apps**. Copy public web config into `client/.env.local` using `client/.env.example`. Never place an Admin service-account key in the client.
5. Register the Android package **`in.shikshavertex.attendance`** in the same Firebase project. Place its public configuration in `mobile/android/app/google-services.json` (the supplied matching file is already installed). Configure only `ATTENDANCE_API_URL` separately using `mobile/android/config.properties.example`. The Android README explains build/install and signing. Private Admin keys must never enter an APK.
6. Backend: use host-provided Application Default Credentials or set `GOOGLE_APPLICATION_CREDENTIALS` to a securely mounted Admin service-account JSON file. The ignored legacy `server/serviceAccountKey.json` remains supported. Set `GCLOUD_PROJECT` to your project ID and use appropriate least-privilege Firestore/Firebase Authentication permissions, including token revocation checks.
7. Copy `server/.env.example` to `server/.env`. Generate a stable random cookie secret (at least 32 characters) on your own trusted computer: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it in host secret settings and out of source/chat.
8. The confirmed venue pin is already configured. During temporary setup keep `ENFORCE_ONSITE_ATTENDANCE=false`. When ready for onsite enforcement, set it to `true`, retain `REQUIRE_ROOM_CODE=true`, and test the radius/indoor accuracy on site. Override `VENUE_LATITUDE` and `VENUE_LONGITUDE` together if required; a partial override disables onsite check-in.

`npm run seed:emails` creates exactly the eight approved-email records; startup also runs it. It does not create passwords or Firebase Authentication accounts. Repeating the seed preserves disabled members, UID ownership and unrelated approved members. A new `Users` record is created only after a verified approved member signs in.

For production Firebase communication, allow HTTPS access needed by your Auth/Firestore configuration, including `oauth2.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `www.googleapis.com` and `firestore.googleapis.com` where applicable. Configuration is not proof of connectivity; validate the actual project.

## Passkey domain and Android association

Passkeys require a stable HTTPS hostname in production. Configure:

```env
WEBAUTHN_RP_ID=attendance.example.org
WEBAUTHN_EXPECTED_ORIGINS=https://attendance.example.org
ANDROID_APP_ID=in.shikshavertex.attendance
ANDROID_SHA256_CERT_FINGERPRINTS=YOUR_PUBLIC_SHA256_SIGNING_CERTIFICATE_FINGERPRINT
```

Replace the example hostname/fingerprint. `WEBAUTHN_RP_ID` is a hostname, not a URL. Origins must match it and are checked exactly. The certificate fingerprint is public signing-certificate metadata, **not a private signing key**. For Play distribution use the Play App Signing certificate; use the exact certificate that signs the installed build. Debug and release certificates differ.

The backend serves `/.well-known/assetlinks.json` from this configuration and derives the corresponding exact `android:apk-key-hash:...` origins. Host this path over HTTPS on the RP domain with no authentication or redirect. It associates the named Android package and signing certificate with the passkey RP. Configure the Android app's API URL to the same hosted service. Verify real Credential Manager enrollment/assertions on the signed app before rollout.

Attendance phone verification remains required and fails closed when the RP/origin configuration is missing. No `biometric: true` client flag can bypass it. Development defaults are `localhost` web origins only; they do not establish an Android RP association. Use a trusted development HTTPS domain for native testing.

## Development and deployment

Validated Node 24/npm 11. From the repository root:

```sh
npm ci --prefix server
npm ci --prefix client
```

Run API and UI in separate terminals during local development:

```sh
cd server
node --env-file=.env server.js
```

```sh
cd client
BROWSER=none npm start
```

The development proxy forwards `/api` to port 5001. Keep the API URL `/api` for a single-origin web deployment. CORS is optional for specifically configured origins, not a substitute for the cookie and authorization checks.

Grant committee privileges only to an explicitly chosen, approved and verified member; no supplied student is automatically made an administrator:

```sh
cd server
node --env-file=.env scripts/grant-committee.js chosen-member@example.com
```

The member signs out/in to refresh the claim. To revoke committee privileges, remove the custom claim and revoke refresh tokens through Firebase Admin.

For operation without a laptop, host Express and the compiled React app as **one always-on web service**:

- Build: `npm ci --prefix server && npm ci --prefix client && npm run build --prefix client`.
- Start: `npm start --prefix server`.
- Supply public `REACT_APP_FIREBASE_*` values at build time. Changing them requires rebuilding the web app.
- Supply server settings/private credentials at runtime; mount Admin JSON as a secret file. Never put it in a public build folder.
- Set `NODE_ENV=production`. The host supplies `PORT`. Use HTTPS for web location, secure cookies, passkeys and Android association.
- Set `TRUST_PROXY_HOPS` only to the documented trusted proxy count. The included request limiter is per process; multiple instances need a shared gateway/limiter.
- Install the signed Android app on members’ phones; the server deployment alone does not install a mobile app or grant permissions.

Build and test the Android app using [its README](mobile/android/README.md). An SDK build/test is not proof of real biometric/GPS/background delivery.

## Validation and release checks

```sh
npm test --prefix server
CI=true npm test --prefix client -- --watchAll=false --runInBand
npm run build --prefix client
```

Backend tests use injected Firestore/Auth and real generated P256 WebAuthn signatures. They exercise authorization, expiry/replay, browser binding, location gates, immutable duplicates, consent windows, uncertain intervals, visit estimates and idempotent finalization. They do not connect to live Firebase or use a real phone sensor.

Before release, test approved/unapproved accounts and email verification, proper Firestore rules, real phone passkey enrollment and cancellation, account switching rejection, and on-site/outside venue check-in. In the native app test denied permissions, notification/stop action, logout while tracking, screen lock, 20:30 cutoff, force-stop, battery restrictions, airplane mode, network recovery, gaps and the next day requiring explicit start. Confirm no points are collected outside consent hours and that no template/PIN appears in network traffic or database records. Check committee-only access, CSV contents and TTL cleanup. Do not describe floor, physical-device identity, destination names or uninterrupted tracking as proven.

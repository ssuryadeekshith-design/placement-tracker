# Shiksha Vertex Android attendance

A native Android companion to the same authenticated attendance API. Package name: **`in.shikshavertex.attendance`**. The app implements verified email registration/sign-in, phone passkey enrollment and attendance, explicit daily location sharing through a visible foreground service, and readable daily movement reports.

This app is not a hidden tracker. It never starts location tracking at boot, cannot collect before consent, does not restart collection after a process kill, and has a persistent notification with **Stop sharing location**. It requests precise location and notification permissions before starting. The local collector and server accept tracking only **10:30 AM–8:30 PM Asia/Kolkata**; there is no collection before or after that workday window. A user must start each day themselves from the visible app. Force-stop, lost connectivity, Android power management, switched-off GPS or revoked permissions produce gaps. Do not promise uninterrupted tracking on every Android handset.

## Temporary setup mode

Version 1.1 reads the backend's explicit policy before opening account screens. Setup mode skips venue monitoring, location permission, Wi-Fi and room-code checks for attendance. Email verification, HR approval and phone passkeys still apply. HR can open/close today's daily attendance from the phone. Check-ins are labelled as location-unverified. Daily location sharing remains opt-in and separate. See [deployment and APK transfer steps](../../docs/temporary-setup-mode.md). Older APKs must be updated.

The following venue/Wi-Fi requirements apply after `ENFORCE_ONSITE_ATTENDANCE=true` is deployed on the backend.

## Venue access lock

The app opens a locked shell until it receives a new precise inside position. Before showing login, attendance or reports it checks the owner-confirmed pin (12.912773610440954, 77.62322878099566), a 100 m radius, maximum 50 m uncertainty and maximum 15-second fix age. The full accuracy circle must fit inside the radius. Out-of-area, inaccurate, stale, unavailable, denied or known mock positions leave it locked. Foreground location checks run roughly every five seconds and stop when the Activity pauses. Returning requires a new fix. These checks do not start daily background tracking.

The API independently checks fresh venue access before interactive requests; the native client attaches the short-lived `X-Venue-Access` token automatically. Token issuance/revocation does not store access coordinates. Stop-sharing controls stay accessible while locked. An already-consented foreground tracking service continues away from the building so departure/return reporting remains possible. Android can launch the locked shell; this does not prohibit the OS from launching the app process.

No BLE/RTT/UWB hardware is installed. There is no second-floor detector enabled. GPS proximity cannot distinguish floors or stop sophisticated spoofing. See [the research application notes](../../docs/venue-access.md). The initial local fence is compiled from the confirmed owner pin; a different venue requires updating the native pin as well as server configuration. Server mismatch fails closed for data access.

Pausing covers private content and protects task previews. A pending Credential Manager system prompt is allowed to finish, but its result is not sent to the API until the app has resumed and obtained a new inside fix. Test this lifecycle on real phones before release.

## Required attendance Wi-Fi

Connect the phone to **Shikshavertex_5G** in Android's Wi-Fi settings before marking attendance. The dashboard has settings/check buttons. The password is not embedded in the APK or sent to the API. Precise-location permission and enabled Location services are required to read the connected SSID; unknown/redacted values fail closed.

The native client verifies the current active Wi-Fi before submitting, checks again after the passkey prompt and binds the request to that Wi-Fi Network. Mobile data, VPN default, saved-only networks, another SSID and a disconnect cannot satisfy the condition. Existing email, venue, passkey and room-code checks remain required. Workday sharing/stop controls are not restricted to this Wi-Fi, so consented away-time reporting remains possible.

The API records a recent native connection observation with attendance. SSID names and BSSIDs are not secure proof of router identity or floor; a modified client can fabricate them. Optional server-observed public venue egress restrictions need actual network details and correct proxy configuration. See [Wi-Fi details and actual-phone test steps](../../docs/wifi-attendance.md). No router access or physical-phone Wi-Fi validation has been performed in this environment.

## What biometric attendance means

Android Credential Manager creates/uses a passkey and sends a cryptographic WebAuthn assertion to the API. The API verifies the signature, the configured app origin/RP, user-verification flag and a single-use challenge. Attendance consumes the short-lived proof for that specific user, app binding and event. It never trusts a client-provided `biometric: true` flag.

The fingerprint/face template and device PIN are never read or uploaded. Depending on Android/device settings, user verification can use a fingerprint, face or screen-lock PIN. This app **does not guarantee fingerprint-only authentication**. Enrolled passkeys may be synchronized by the user's credential provider. As with browser profiles, clearing application data or reinstalling creates a new app profile; this is not a permanent physical-device identifier.

Use a phone supporting Android Credential Manager passkeys (Android 9+ with a supported credential provider/Google Play services and a configured screen lock; recent Android versions recommended). Unsupported phones cannot satisfy the passkey check; authorized committee members may use a recorded manual override in the web dashboard. Native app-store attestation, managed-device enrollment, and protection against rooted phones/GPS spoofing are not supplied by this version.

## Android Firebase configuration

The supplied **`app/google-services.json`** is configured for Firebase project **`placementtracker-a1a87`** and package **`in.shikshavertex.attendance`**. The root Gradle build pins Google Services plugin **4.4.4**, the app applies it, and Firebase Authentication **23.1.0** is already included. The plugin validates the package and generates Firebase resource values for each build variant. Firebase's initialization provider loads those resources before the application starts; there are no duplicate Firebase keys in BuildConfig.

For a different Firebase project, download its matching Android app configuration and replace `app/google-services.json` deliberately. A mismatched package must fail the build; never fix it by silently changing the Android application ID. This is public client configuration, not a service-account key. Review Firebase/API-key application restrictions and signing certificates for the actual installed app. Never place Admin credentials or private signing keys in this file.

The Firebase file does **not** include the attendance API address. Supply the public HTTPS backend URL separately:

```sh
./gradlew :app:assembleDebug -PATTENDANCE_API_URL=https://your-attendance.example.com/api
```

Use an actual hosted address including `/api`; the example hostname is not a deployed service. Version 1.2 defaults to `https://placement-tracker-lyjf.onrender.com/api`. Nonblank Gradle properties take priority over a nonblank environment value; blank values fall back to the hosted default. Invalid URL settings fail the build. The Actions workflow explicitly supplies this hosted address, tests the compiled configuration, checks the APK's DEX contents for that address and includes `build-info.txt` with its commit/run/API. This makes an older artifact distinguishable from the intended new build. Updating Firebase alone does not configure an older APK's API address.

Enable **Email/Password** Authentication in this same Firebase project. A backend using a different Firebase project cannot verify these users' tokens. The server still needs its own securely provided Admin/ADC credentials, Firestore database/rules, approved emails and passkey domain association. The public Android JSON grants none of those server permissions. Actual sign-in/email verification and database operations require runtime validation against the configured service.

The API sets its browser/app binding cookie after first verified sign-in; keep the backend's `DEVICE_COOKIE_SECRET` stable. No Admin key, password or server cookie secret belongs in Android build settings. `localhost` on a physical phone refers to the phone itself; debug emulator-only builds may use `http://10.0.2.2:5001/api`. Release builds require HTTPS.

## Associate the production website with the Android app

Android passkeys require Digital Asset Links. You need an HTTPS domain you control and the SHA-256 fingerprint of the certificate that signs the installed APK.

- Set the API's `WEBAUTHN_RP_ID` and `WEBAUTHN_EXPECTED_ORIGINS` for your website and the expected Android app origin as described in the root deployment guide.
- Publish `https://YOUR_RP_DOMAIN/.well-known/assetlinks.json` for package `in.shikshavertex.attendance`, using your **release signing certificate** SHA-256 fingerprint. The backend can serve this using `ANDROID_SHA256_CERT_FINGERPRINTS` when hosted on the RP domain. Verify the route matches the configured RP domain, not merely a different API subdomain.
- The Android WebAuthn expected origin is `android:apk-key-hash:` followed by **base64url without padding** of the raw SHA-256 signing-certificate digest. It is not the colon-separated hexadecimal fingerprint. Include that exact origin in the API's expected-origin configuration.
- If Play App Signing is enabled, use the app-signing certificate users actually receive, not only the upload certificate. Debug and release certificates differ; allow debug origins only in a separate development environment.
- Obtain fingerprints using Android Studio's signing report or `./gradlew :app:signingReport`. This reports public certificate fingerprints; never share or commit the private signing key.

Follow the matching environment-variable names in the current root `README.md` and `server/.env.example` when configuring the RP. Building includes the public Firebase client configuration, but does not enable Firebase providers, grant server permissions, publish association files or configure release signing.

## Build

Open this directory in Android Studio with Android SDK 35/build-tools 35.0.0 and JDK 17+ (the verified development build used Java 21 running Gradle 8.9 with JVM target 17). The Gradle wrapper pins version 8.9 and its official SHA-256 checksum. Do not disable TLS/checksum verification.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Build outputs and local SDK configuration are ignored. Distribute only a release APK/AAB signed with a private release key after configuring Firebase, the production API, passkey RP/origins and asset links. The debug APK includes Firebase configuration but still needs the hosted API setting; it is a development build, not a deployed attendance service.

## Tracking and report behavior

The service uses Android LocationManager in a `location` foreground service. It requests roughly one location per minute. Android chooses the actual delivery cadence; this is sampled observation, not continuous proof. Only recent samples (five minutes) are held in memory while offline. Samples are never written to a persistent local movement log and are dropped when stale, when the user stops, on sign-out, or after the workday ends. The server checks consent/device ownership, timestamps and window independently.

The notification's stop action and the app's stop/sign-out controls remove GPS subscriptions locally before waiting for any network call. A network failure cannot keep local collection running. In-flight requests can finish, but no new samples are collected after stop; the server rejects out-of-window/revoked-session uploads. The service uses `START_NOT_STICKY`: Android killing it does not restart it silently. A user must return to the app to resume explicitly.

Reports show observed inside/away/unknown durations, estimated departure/return times, approximate offsite stops and dwell intervals with map links. They use the API's conservative gap accounting: no GPS/data is **unknown**, not an assumption the person stayed at the last point. Coordinates cannot identify the business or address visited without a configured geocoding provider. A Maps link opens only when the user taps it. The API applies the configured report/location retention policy; follow the root guide to enable Firestore TTL and restrict committee access.

## Required actual-phone validation

Compilation/unit tests do not validate phone GPS, a passkey provider, Firebase email delivery, or Android background power behavior. Before release on representative phones:

1. Register an approved email, verify it, and sign in. Attempt another account in the same app profile and confirm refusal.
2. Enroll a passkey using the configured production RP/Digital Asset Links. Check the server accepts a real signed assertion and rejects a replay/wrong event.
3. Check in using a valid room code and fresh precise position. Denied/cancelled passkey or location permission must not mark attendance.
4. Grant daily tracking consent and notifications. Lock the screen for at least 15 minutes and verify location samples continue as permitted by that phone's OS. Keep the tracking notification visible.
5. Stop using both the app and notification action, revoke location permission, sign out, force-stop, disable network, and disable GPS. Confirm collection stops or reports show gaps as appropriate; no unsupported uptime claim.
6. Test exactly before 10:30 AM and at/after 8:30 PM India time, including while offline/screen-locked. Confirm no out-of-hours points are accepted.
7. Compare reports against a known visit: outside/inside uncertainty and gaps must remain explicit. Test second-floor versus ground-floor positions; GPS cannot prove a floor.

# Shikshavertex for iPhone and iPad

The iOS app reuses the hosted employee and HR screens: registration, password
reset, email verification, HR approval, attendance history, directory, session
controls, read-only attendance reports and movement report viewing. Native code
collects a fresh precise location and current office connection **only after an
employee chooses check-in**, then submits over a session with cellular access
disabled. An Android APK cannot be installed on an iPhone.

## Build and distribute

1. On a Mac, install Xcode and open it once to install its iOS components.
   Install XcodeGen with `brew install xcodegen`.
2. From `mobile/ios`, run `xcodegen generate`, then open
   `Shikshavertex.xcodeproj`. The generated project is excluded from Git.
3. Select the **Shikshavertex** target → **Signing & Capabilities**. Choose your
   paid Apple Developer team and enable automatic signing. Register the bundle
   identifier `in.shikshavertex.attendance` with that team. Keep both
   **Associated Domains** and **Access WiFi Information** capabilities enabled.
   The app does not store or automatically enter the office network password.
4. In Render → Placement Tracker → Environment, add `IOS_APP_IDS` with
   `YOUR10CHARTEAMID.in.shikshavertex.attendance`, using the real Apple Team ID.
   Multiple authorized app IDs may be comma-separated. Save and redeploy.
   Confirm `https://placement-tracker-lyjf.onrender.com/.well-known/apple-app-site-association`
   returns this exact ID under `webcredentials.apps` before installing.
5. Connect an iPhone running iOS 16.4 or newer. Select it as the Xcode run
   destination and run the app. Use the validation checklist below.
6. In Xcode choose **Product → Archive**, then **Distribute App → App Store
   Connect → Upload**. In App Store Connect, create the app using the same
   bundle ID and invite employee testers through **TestFlight**. External
   testing may require Apple's beta review. Share the TestFlight invitation
   link through WhatsApp; a ZIP or unsigned IPA will not install for employees.
   Use App Store distribution after the required review for a general release.

No Apple membership, signing certificate or provisioning profile is included in
this repository. No iPhone installer is published by the simulator-check job.
Do not put signing credentials or employee email imports in public source.

## Checks

The `iPhone app checks` GitHub Actions workflow builds the app and runs its
policy tests on an iPhone simulator without signing. Locally:

```sh
xcodegen generate
xcodebuild -project Shikshavertex.xcodeproj -scheme Shikshavertex \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO test
```

Choose a simulator installed on the Mac. Simulator checks do not verify real
office connectivity, passkey association, biometric prompts or GPS accuracy.

## Physical iPhone validation required before employee rollout

- Open the workspace away from the venue: account and permitted reports open
  without requesting location. Verify registration, reset, verification email
  and pending HR approval. HR uses the existing explicit profile matching flow.
- Verify passkey registration and check-in prompts after the association file
  and signing capabilities are live. The app receives no biometric templates.
- At the venue, connect to `Shikshavertex_5G`, allow location **While Using the
  App** and **Precise Location**, and check into today's open session.
  Confirm the server receipt and original timestamp in history and HR reports.
- Try another network, no connection, denied/approximate location, outside the
  venue, a closed session and a non-approved account: no new attendance is saved.
- Repeat check-in: confirm the original timestamp is retained. Interrupt the
  request, then refresh history before retrying; submissions are not auto-retried.
- Verify HR filters, CSV export through the iOS share sheet and read-only viewer
  restrictions. Test sign-out and reopening on each supported iOS version.

## Current limits

This first iOS version supports check-in and viewing movement reports. It does
**not** collect daily movement in the background; there is no iOS background
sharing consent or “sharing active” claim. Android's separately consented daily
sharing remains available. Missing samples remain unknown gaps in reports.
Office connection observations are client observations, not proof supplied by
the router. GPS cannot identify the second floor. Opening the app is unrestricted.

Safari and Mac browsers can already use the hosted account/HR/report screens.
On iPhone: Safari → open the workspace → Share → Add to Home Screen. This web
shortcut cannot confirm the connected office network and cannot mark attendance.

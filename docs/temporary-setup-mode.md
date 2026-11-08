# Temporary attendance setup mode

The owner requested that employees can open the app and mark attendance before venue Wi-Fi/location setup is ready. This version defaults to **setup mode**. Self check-ins remain authenticated, email-verified, HR-approved, profile-bound, passkey-verified and limited to an open event dated today in India time. The existing eight approved work emails retain their access.

Setup mode skips foreground venue access, the GPS check-in position, Wi-Fi observation and room code. It never substitutes the venue coordinates for an employee's location. New records contain `attendanceMode: setup`, `locationVerified: false`, `location: null` and no Wi-Fi evidence. The UI identifies these as self-reported attendance. Existing records and revocations are preserved. Workday tracking remains a separate, explicitly consented action with permissions and a visible notification; opening the app or checking in does not start it.

## Deploy this version

1. Merge the updated branch into GitHub `main`.
2. In Render, open **Placement Tracker → Environment → Add environment variable**. Set `ENFORCE_ONSITE_ATTENDANCE` to `false`, then **Save, rebuild, and deploy** (or save/redeploy using the available equivalent). Wait for **Live**. This version also defaults to `false` when the variable is absent.
3. Visit `https://placement-tracker-lyjf.onrender.com/api/venue`. Confirm `attendanceMode` is `setup`; `accessRequired`, `locationRequired`, `attendanceWifi.required` and `requiresRoomCode` should all be `false`. This endpoint is public configuration, not a credential or attendance history. A free Render instance may take time to wake.
4. Download the artifact from the **new** successful **Build attendance APK** Actions run on a signed-in computer and extract it. The old APK always enforced location and must be replaced. Version 1.1 reads the explicit policy from the configured HTTPS API before opening account screens. Missing/failed policy does not silently relax access.
5. Keep Render's `ANDROID_SHA256_CERT_FINGERPRINTS` consistent with `render-passkeys.env` from that same artifact; retain older approved fingerprints if needed. The file contains public certificate information. Keep the existing Firebase Admin credentials on the server only.

## Transfer the APK when GitHub times out on the phone

1. On your computer, open `https://drive.google.com` with a Google account you use on the Android phone.
2. Click **New → File upload**, choose the extracted `app-debug.apk` and wait for upload to finish. Keep it private; public link sharing is unnecessary.
3. On the phone, open **Google Drive**, switch to that same Google account and find `app-debug.apk` under **Recent**.
4. Tap the file's **⋮ → Download**. Open Android **Files/My Files → Downloads → app-debug.apk**.
5. If prompted that this source cannot install apps, tap **Settings**, allow installs for the specific Files/Drive app, go back and tap **Install** or **Update**. Menu names vary by phone. Restore that source's permission after installation. Keep Play Protect enabled.
6. Open **Shiksha Vertex Attendance**. It should display the temporary setup-mode notice without asking for venue location/Wi-Fi. Normal internet is still required. Only the APK is installed; `certificate.txt` and `render-passkeys.env` are administrator files.

An update requires the same signing key. If a replacement fails, do not blindly uninstall or clear app data: doing so resets the app profile/binding/passkey context. Check the certificate and recover the account deliberately. This remains a development APK, not a Play Store production release.

## HR and employee steps

1. On the designated HR phone, register `hr@shikshavertex.in` with a password chosen privately by HR, open the verification email and follow its link. Return and tap **I have verified my email**. If the account already exists, sign in instead.
2. This verified mailbox is the configured first administrator. Tap **Open today's attendance** on its dashboard. The app creates/reuses today's **Daily employee attendance** event and opens check-in; HR can also close it there. Event date checks use India time.
3. Each employee installs the updated APK on their own phone, registers their real work email, verifies it, enters their full name and taps **Request HR approval**. A job title never grants administrator access.
4. HR opens **Review employee approval requests**, matches each verified email with the correct supplied roster profile, and approves it. Employees tap **Check approval status** afterward. Existing approved users need no new request.
5. Employees enroll their phone passkey, select today's open attendance, confirm the self-attendance statement and tap **Verify phone and mark attendance**. Android can use a fingerprint, face or device PIN; biometric templates are never uploaded. Tap **Refresh attendance** if HR opened the event after you signed in.

## Restore venue requirements later

Set `ENFORCE_ONSITE_ATTENDANCE=true` in Render and redeploy. Keep `REQUIRE_ROOM_CODE=true`. Close/reopen the updated app or reload the website to fetch the strict policy. The API independently rejects an unleased client after strict deployment. GPS, the required `Shikshavertex_5G` connection and room code become required again; setup records remain labelled unverified. Test this at the site before relying on it. These checks cannot establish the second floor without indoor infrastructure.

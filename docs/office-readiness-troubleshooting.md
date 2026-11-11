# Office readiness on Android 1.11

Earlier builds created a new, initially disabled readiness check each time the
dashboard was rebuilt. A refresh could therefore show “Not checked” even when
precise-location permission had already been granted and the phone was connected.

Version 1.11 automatically starts local readiness checks on the active employee
dashboard when precise-location permission is already granted. Checks resume
after refresh, returning from Android Settings, or phone verification. Without
permission, the card explains that precise-location access is needed and offers
an explicit permission button. The app does not repeatedly launch a permission
dialog automatically.

Install the signed update over the existing app using **Update**. Do not uninstall
or clear app storage for this fix. Open the dashboard and wait for a fresh GPS
reading. **Refresh office readiness** requests an immediate new check if needed.
On Samsung: Settings → Apps → Shikshavertex → Permissions → Location → Allow only
while using the app, with **Use precise location** enabled. Also enable the phone's
Location switch and connect to `Shikshavertex_5G`. A denied permission, switched-off
GPS, weak fix or wrong network is shown as a diagnostic rather than a saved setup.

GPS and network observations are temporary, not permanent registrations. Readiness
is refreshed while the dashboard is active and expires when stale. Sensor work
is cancelled when the dashboard detaches or the activity pauses; an old screen
cannot stop a newer dashboard's checks. These observations remain on the phone.
They do not mark attendance or start daily movement sharing. Submitting attendance
still requires a fresh accurate location, approved active office connection,
phone verification, approved account and today's open session. GPS cannot identify
the second floor. Daily sharing retains its separate consent and Stop Sharing.

Automated compilation, unit and lint checks do not replace physical-phone
validation. Confirm on a real phone: refresh the dashboard, return from Settings,
deny/re-enable precise location, disconnect/reconnect the office network, leave
the dashboard, and complete/cancel the phone verification prompt. The card should
update without a repeated setup step, and check-in must remain blocked when the
required office conditions are not met.

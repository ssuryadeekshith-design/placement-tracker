# Android 1.12 office connection status

This update addresses connection-status errors after returning from phone
verification and separates the saved check-in from current readiness.

- Allow up to two seconds for Android's asynchronous, location-sensitive network
  callback to refresh before declaring the connection unconfirmed. Only local
  observations are retried; attendance submissions are not replayed by this check.
- Read the current connection after the GPS lookup instead of retaining an
  earlier failure captured immediately after the phone verification prompt.
- Use `WifiInfo` from the same active Wi-Fi `Network` as association evidence.
  Modern Android can redact legacy network ID/supplicant fields independently.
  The deprecated fallback still needs completed-association evidence.
- Ignore callbacks from a retired observer after pause/resume. A missing SSID
  remains unconfirmed and cannot unlock attendance, but the diagnostic explains
  that Android has not supplied the name rather than asserting disconnection.
- The receipt retains its first timestamp and the office evidence saved by the
  server. The readiness card describes the connection **now**. A later network
  change or unavailable reading does not delete or invalidate a saved check-in.

Exact office SSID, active Wi-Fi transport, precise-location permission, valid
venue location, approved account, phone verification and an open session remain
required. Submissions remain bound to the verified network and cannot silently
fall back to cellular. VPN/default-route restrictions are preserved.

Update the existing installation to version 1.12. Do not uninstall or clear app
data. Validate on the affected Samsung phone: save a check-in, refresh readiness,
leave/return to the app, switch between office/guest networks, and revoke/restore
precise location. Unknown evidence must remain amber/unconfirmed; a saved
receipt must remain unchanged. Automated checks cannot establish the phone's
actual router state or reproduce every Samsung network-setting combination.

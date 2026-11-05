# Required Wi-Fi for attendance

The required Wi-Fi network name (SSID) is **Shikshavertex_5G**. The supplied password is not included in source, Android resources, API configuration, logs or database records. Members connect using Android's normal Wi-Fi settings, which manage the credential separately from this app. No automatic connection, Wi-Fi scan or router configuration is performed by the app.

## App behavior

Self attendance still needs the verified approved email, bound app profile, venue location, phone/passkey proof, open event and current room code. The Wi-Fi condition is an additional requirement. It applies to attendance submissions, not to the existing background movement collector: previously consented away tracking and stop controls can still work on mobile data.

The native app reads the **active** network and currently associated Wi-Fi name. It compares the exact, case-sensitive SSID. A saved network, similar name, redacted `<unknown ssid>`, disconnected Wi-Fi, mobile-data default or VPN default is rejected. The dashboard links to Android Wi-Fi settings and provides a connection check button.

Immediately before the actual attendance request, the client checks again and attaches the current SSID, observation time and BSSID when Android exposes it. The HTTP request is bound to that Android Wi-Fi `Network`. It cannot silently fall back to mobile data if Wi-Fi disconnects mid-request. A network change requires reconnecting and retrying. Observations older than ten seconds are rejected by the API.

Android 12+ identifier access uses an explicitly location-sensitive `NetworkCallback`; older/compatible paths use the connected `WifiInfo`. The app already needs precise-location permission for venue access. Location services must be enabled or Android may redact the SSID. The app does not request scanning or collect a list of nearby networks. On devices where the identifier remains unavailable, attendance fails closed with a reconnect/permission message.

The website cannot read the current Wi-Fi SSID through browser APIs. It therefore directs self check-in to the Android app and disables browser committee overrides while this rule is active. Event administration and report viewing remain available subject to their existing venue and account checks. API committee/manual submissions must satisfy the Wi-Fi condition too; there is no Wi-Fi bypass through the override route. A manual override checks the submitting device, not the target student's phone, and remains explicitly recorded as a committee action.

Successful attendance stores `wifi.ssid`, observation time, optional BSSID and the verification method. The password is never requested by the API or stored with attendance. A rejected Wi-Fi attempt cannot create a new attendance record or consume a phone proof.

## What this proves and optional stronger restrictions

An SSID is a broadcast network name, not a secret or a unique router identity. Another access point can advertise the same name. The server validates the submitted observation, but cannot independently verify a phone's Wi-Fi association from its HTTPS payload alone. A modified/rooted client can fabricate a claimed SSID/BSSID. This check must not be described as cryptographic proof of venue or floor presence. Signals may also reach other floors.

Two optional, non-secret deployment restrictions are supported in `server/.env` or host settings:

```env
WIFI_ATTENDANCE_BSSIDS=aa:bb:cc:dd:ee:ff
WIFI_ATTENDANCE_ALLOWED_IPS=203.0.113.42
```

These are examples, not configured router details. Leave them empty until the actual values are confirmed.

- `WIFI_ATTENDANCE_BSSIDS`: comma-separated public radio/access-point identifiers. Include every approved mesh node/radio that can serve this SSID. Other, missing or Android-redacted BSSIDs then fail. BSSIDs are still client-observed and can be spoofed; they do not make the payload authoritative.
- `WIFI_ATTENDANCE_ALLOWED_IPS`: comma-separated exact public venue Internet egress addresses. The API checks the observed request IP, not an address supplied in JSON. IPv4 and IPv6 are supported. A fixed venue egress address and correct, trusted reverse-proxy configuration are necessary. Set `TRUST_PROXY_HOPS` only according to the hosting provider's documented network; otherwise forwarded headers may be untrusted or the host's proxy address may be mistaken for the venue address. Dynamic IP changes, multiple uplinks and tunnels need explicit operational handling. Do not whitelist an entire hosting proxy shared by offsite clients.

With only the supplied SSID, both additional lists are empty. Strict, independently verified on-site Wi-Fi enforcement would need controlled network infrastructure, such as a venue gateway issuing short-lived authenticated challenges, or a correctly configured fixed egress restriction. This version does not provision or claim such a gateway.

## Actual-phone checks before rollout

1. Connect to the required network, grant precise location, enable Location services and satisfy the other attendance checks. Verify exactly one record and its Wi-Fi observation.
2. Try mobile data, a guest network, a similar SSID, no Wi-Fi, a saved-but-not-connected network and a VPN. They must not create attendance.
3. Change networks or turn Wi-Fi off while the passkey prompt is visible and immediately before submission. Retry only after reconnecting. Confirm cellular fallback does not submit.
4. Deny/revoke precise-location access or disable Location services; a hidden/unreadable SSID must not be accepted.
5. Test representative Android versions (especially Android 12+), roaming/mesh nodes, and Wi-Fi with no usable Internet. Network/API failures must not show success.
6. If optional restrictions are enabled, test unapproved BSSIDs, changed egress IPs and forged forwarded headers through the actual hosting proxy.

The build and unit/HTTP tests do not connect to the physical venue router or establish real SSID behavior on a handset.

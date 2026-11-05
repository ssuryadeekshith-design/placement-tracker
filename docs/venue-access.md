# Venue-only access and the supplied indoor research

The two pasted research attachments are identical (SHA-256 `8866898c30ff9fdcd26b90b2d555b0a36ceff28f08a43f8a5e6221f03da1b7ff`). They discuss Wi-Fi RTT, BLE, UWB, pressure, dead reckoning, site mapping and native background execution. Their numerical accuracy examples and research-study claims are not deployment guarantees, and the pasted text does not contain enough traceable citations or site measurements to validate them for Srivari Arcade.

The owner confirmed **no indoor equipment is installed**. This implementation therefore uses a conservative horizontal venue fence, not an invented floor estimate. It does not scan for nonexistent beacons or assume that ordinary Wi-Fi supports RTT. It does not turn GPS altitude or uncalibrated pressure into a claim that someone is on the second floor.

## What was applied

- Native Android foreground service for previously consented workday tracking, with visible status and stop controls. It is separate from interactive screen access.
- Foreground-only access monitoring while the Activity is visible. A location engine makes the allow/lock decision independently of authentication and the daily background collector.
- Accuracy and freshness checks rather than treating every sensor result as certain. The whole reported accuracy circle must fit inside the venue fence. Unknown or missing readings lock access.
- Explicit consent, limited collection periods and honest reporting gaps. Access verification itself creates no raw-coordinate history.
- A path to site-calibrated indoor positioning without pretending a sensor is present or calibrated.

## Current lock behavior

The configured center is `12.912773610440954, 77.62322878099566`, radius **100 m**, maximum horizontal uncertainty **50 m**. These are proximity settings, not the outline of the building. Phones near other floors or nearby buildings can still be inside this horizontal fence.

The Android app shows a locked shell before login/dashboard access. It requests precise location and subscribes to fresh foreground readings roughly every five seconds. It checks the last fix every second; wall-clock and monotonic age must both be at most 15 seconds. Known mock-provider fixes, invalid coordinates, inaccurate readings, disabled permission, uncertain boundary or outside positions keep it locked. A new acceptable inside reading can unlock it again.

Pausing/backgrounding covers the Activity, clears interactive access and stops its foreground access monitor. The recent-app preview is protected with `FLAG_SECURE`. Returning requires a new fix captured after resuming. Android Credential Manager can temporarily pause the Activity: its pending ceremony is preserved, its content remains covered, and its result is not submitted until a fresh inside reading is acquired again. In-flight data responses cannot redraw private content after the gate locks.

The website similarly requires an explicit location-check action before displaying app screens, monitors only while visible, and unmounts private screens when the position is outside, uncertain, stale or the page is hidden. This does not start browser background tracking.

## Server enforcement

After email/device registration, `POST /api/access/verify` validates a fresh inside position and returns a random account/profile-bound token. Interactive API requests must send it as `X-Venue-Access`. Its lifetime is at most 30 seconds and never extends past the accepted fix's 15-second freshness bound. Invalid/outside verification or `POST /api/access/lock` revokes the current token. Reopening after a rejected reading requires a newer fix. Tokens and expiry metadata are stored; access coordinates are not.

Events, roster, biometric enrollment/assertion endpoints, attendance, attendance history, daily tracking start and movement reports require access. There is no committee exemption. Session binding, public venue configuration, tracking status, previously consented point uploads and stopping sharing remain available outside. This preserves the earlier requirement to record departures/returns while hiding interactive attendance data away from the venue. Stop controls are never hidden behind the venue lock.

Enable Firestore TTL on `VenueAccessLeases.expiresAtDate` and `VenueAccessState.expiresAtDate` to clean transient access metadata. Runtime expiration/revocation is enforced independently of TTL. Revocation cannot arrive instantly over a disconnected network; the fix-age bound limits outstanding access. Position checks use client-reported coordinates and are not hardware attestation or spoof-proof evidence.

The operating system can always launch an installed app's Activity; the application can show a locked screen rather than its main contents. It cannot prevent Android itself from launching the process. The already-consented tracking service deliberately continues outside the venue to measure away time, until the user stops it or the workday ends.

## Before second-floor enforcement can be added

1. Survey the building, floor heights, neighboring signals, entrances, stairs and lifts with representative phones. Establish actual ground truth and error rates.
2. Choose and install supported infrastructure: for example, provisioned BLE anchors on the second floor and adjacent floors, or surveyed Wi-Fi RTT/UWB anchors with compatible phones. Ordinary GPS and a shared Wi-Fi name do not identify a floor.
3. If pressure sensing is used, require an independently verified reference floor and drift/weather handling. Some phones lack a pressure sensor. Pressure change measures relative height, not a reliable absolute floor by itself. Do not copy the research's illustrative pressure threshold into an access rule without measured calibration.
4. Test signal leakage through ceilings, stairs/lifts, false unlocks, missing equipment and spoof/replay attacks. Beacon RSSI proximity alone is not cryptographic proof of presence.
5. Only then enable a separate floor-evidence requirement that fails closed when the evidence or required hardware is absent. Keep permission/recovery/stop controls available even when locked.

Actual on-site GPS, screen-lock, Android Credential Manager and hardware floor tests remain required. Build/unit tests alone cannot establish physical presence or second-floor accuracy.

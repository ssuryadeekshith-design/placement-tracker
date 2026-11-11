const crypto = require('node:crypto');
const { ATTENDANCE_SSID, normalizeIp } = require('./wifi-attendance');

const VENUE_ADDRESS = '2nd floor, Srivari Arcade, NGR Layout, Roopena Agrahara, Bommanahalli, Bengaluru, Karnataka 560068';
const MAPS_URL = 'https://maps.app.goo.gl/1t5uN5hefMxJEWKdA';

// Public signing certificate for the attendance APK from Actions run 41976631021.
const HOSTED_DOMAIN = 'placement-tracker-lyjf.onrender.com';
const HOSTED_ANDROID_CERT = '00:7B:DE:0F:51:51:01:8D:31:C5:6C:E0:F4:F6:7D:64:31:00:11:17:65:9F:57:BD:C0:4A:62:A3:1F:E7:58:59';

function numeric(value, fallback, min, max, name) {
    if (value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid ${name}`);
    return number;
}

function loadConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const attendanceViewerEmails = (env.ATTENDANCE_VIEWER_EMAILS ?? 'hr@shikshavertex.in,surya_deekshith@shikshavertex.in,hr_pallavi@shikshavertex.in').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    if (attendanceViewerEmails.some(v => !/^[^\s/@]+@shikshavertex\.in$/.test(v))) throw new Error('Invalid ATTENDANCE_VIEWER_EMAILS');
    // Opening the workspace is unrestricted. Physical checks apply only to attendance.
    // Retired setup-mode environment overrides must never relax these checks.
    const hosted = env.RENDER_EXTERNAL_HOSTNAME === HOSTED_DOMAIN;
    const cookieSecret = env.DEVICE_COOKIE_SECRET || (!production && crypto.randomBytes(32).toString('hex'));
    if (!cookieSecret || cookieSecret.length < 32) throw new Error('DEVICE_COOKIE_SECRET must contain at least 32 characters');
    // Exact pin supplied by the venue owner. Partial overrides must not mix two locations.
    const hasVenueOverride = Boolean(env.VENUE_LATITUDE || env.VENUE_LONGITUDE);
    const latitude = numeric(env.VENUE_LATITUDE, hasVenueOverride ? null : 12.912773610440954, -90, 90, 'VENUE_LATITUDE');
    const longitude = numeric(env.VENUE_LONGITUDE, hasVenueOverride ? null : 77.62322878099566, -180, 180, 'VENUE_LONGITUDE');
    const fingerprints = (env.ANDROID_SHA256_CERT_FINGERPRINTS ?? (hosted ? HOSTED_ANDROID_CERT : '')).split(',').map(value => value.trim()).filter(Boolean).map(value => {
        const hex = value.replaceAll(':', '');
        if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error('Invalid ANDROID_SHA256_CERT_FINGERPRINTS');
        return hex.toUpperCase().match(/.{2}/g).join(':');
    });
    const rpID = env.WEBAUTHN_RP_ID || (hosted ? HOSTED_DOMAIN : (!production ? 'localhost' : ''));
    if (rpID && !/^[A-Za-z0-9.-]+$/.test(rpID)) throw new Error('Invalid WEBAUTHN_RP_ID');
    const webOrigins = (env.WEBAUTHN_EXPECTED_ORIGINS || (hosted ? `https://${HOSTED_DOMAIN}` : (!production ? 'http://localhost:3000,http://localhost:5001' : ''))).split(',').map(value => value.trim()).filter(Boolean);
    for (const origin of webOrigins) {
        const url = new URL(origin);
        if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost' && !production)) ||
            !(url.hostname === rpID || url.hostname.endsWith(`.${rpID}`))) throw new Error('WebAuthn origins must match the RP hostname and use HTTPS in production');
    }
    const androidOrigins = fingerprints.map(value => `android:apk-key-hash:${Buffer.from(value.replaceAll(':', ''), 'hex').toString('base64url')}`);
    const androidAppId = env.ANDROID_APP_ID || 'in.shikshavertex.attendance';
    const iosAppIds = (env.IOS_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (iosAppIds.some(value => !/^[A-Z0-9]{10}\.[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/.test(value))) throw new Error('Invalid IOS_APP_IDS: use TEAMID.bundle.identifier');
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(androidAppId)) throw new Error('Invalid ANDROID_APP_ID');
    const allowedBssids = (env.WIFI_ATTENDANCE_BSSIDS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (allowedBssids.some(value => !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value) || ['02:00:00:00:00:00', '00:00:00:00:00:00'].includes(value))) throw new Error('Invalid WIFI_ATTENDANCE_BSSIDS');
    const allowedIps = (env.WIFI_ATTENDANCE_ALLOWED_IPS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
        const normalized = normalizeIp(value);
        if (!normalized) throw new Error('Invalid WIFI_ATTENDANCE_ALLOWED_IPS');
        return normalized;
    });
    const bootstrapHrEmail = (env.HR_ADMIN_EMAIL ?? 'hr@shikshavertex.in').trim().toLowerCase();
    if (bootstrapHrEmail && !/^[^\s/@]+@shikshavertex\.in$/.test(bootstrapHrEmail)) throw new Error('Invalid HR_ADMIN_EMAIL');
    // Additional administrator explicitly authorized by the application owner.
    // These mailboxes get the same role, after verified ownership, once per UID.
    const additionalHrAdminEmails = (env.HR_ADDITIONAL_ADMIN_EMAILS ?? 'hr_kowshik@shikshavertex.in').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (additionalHrAdminEmails.some(value => !/^[^\s/@]+@shikshavertex\.in$/.test(value))) throw new Error('Invalid HR_ADDITIONAL_ADMIN_EMAILS');
    return {
        production,
        deploymentCommit: /^[0-9a-f]{7,40}$/i.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : null,
        attendanceViewerEmails: [...new Set(attendanceViewerEmails)],
        bootstrapHrEmail,
        additionalHrAdminEmails: [...new Set(additionalHrAdminEmails)],
        wifi: { required: true, ssid: ATTENDANCE_SSID, allowedBssids, allowedIps },
        access: { required: false, leaseSeconds: 30, maxLocationAgeMs: 15000 },
        biometrics: {
            required: true,
            configured: Boolean(rpID && (webOrigins.length || androidOrigins.length)),
            rpID, expectedOrigins: [...webOrigins, ...androidOrigins],
            rpName: 'Shiksha Vertex Attendance'
        },
        android: { appId: androidAppId, fingerprints },
        ios: { appIds: [...new Set(iosAppIds)] },
        cookieSecret,
        port: numeric(env.PORT, 5001, 1, 65535, 'PORT'),
        trustProxy: numeric(env.TRUST_PROXY_HOPS, 0, 0, 10, 'TRUST_PROXY_HOPS'),
        allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
        venue: {
            attendanceMode: 'onsite',
            accessRequired: false,
            locationRequired: true,
            attendanceWifi: { required: true, ssid: ATTENDANCE_SSID },
            address: VENUE_ADDRESS,
            mapsUrl: MAPS_URL,
            configured: latitude !== null && longitude !== null,
            latitude,
            longitude,
            radiusMeters: numeric(env.VENUE_RADIUS_METERS, 100, 10, 500, 'VENUE_RADIUS_METERS'),
            maxAccuracyMeters: numeric(env.VENUE_MAX_ACCURACY_METERS, 50, 1, 100, 'VENUE_MAX_ACCURACY_METERS'),
            requiresRoomCode: false
        }
    };
}

module.exports = { loadConfig, VENUE_ADDRESS, MAPS_URL };

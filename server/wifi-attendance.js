const { isIP } = require('node:net');
const { HttpError } = require('./security');

const ATTENDANCE_SSID = 'Shikshavertex_5G';
const BSSID = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
function normalizeIp(value) {
    if (typeof value !== 'string') return null;
    if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
    if (isIP(value) === 4) return value;
    if (isIP(value) === 6) return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    return null;
}

// This validates a native client's observation, not an attestation from the
// router. Optional trusted request-IP restrictions add a server-observed gate.
function checkAttendanceWifi(observation, settings = {}, time, requestIp) {
    if (settings.required === false) return null;
    const ssid = settings.ssid || ATTENDANCE_SSID;
    const { transport, observedAt, bssid } = observation || {};
    if (!observation || transport !== 'wifi' || observation.ssid !== ssid) {
        throw new HttpError(403, `Connect the Android phone to office network ${ssid} before marking attendance. Browser check-in cannot verify the connected office network name.`);
    }
    if (!Number.isFinite(time) || typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt < time - 10000 || observedAt > time + 5000) {
        throw new HttpError(403, 'The office network connection check expired. Reconnect to the required office network and try again.');
    }
    const normalizedBssid = typeof bssid === 'string' && BSSID.test(bssid) && bssid !== '02:00:00:00:00:00' && bssid !== '00:00:00:00:00:00' ? bssid.toLowerCase() : null;
    if (settings.allowedBssids?.length && (!normalizedBssid || !settings.allowedBssids.includes(normalizedBssid))) {
        throw new HttpError(403, 'The phone is not connected to an approved venue office network access point.');
    }
    if (settings.allowedIps?.length && !settings.allowedIps.includes(normalizeIp(requestIp))) {
        throw new HttpError(403, 'Attendance must be submitted through the approved venue Internet connection.');
    }
    return {
        ssid, observedAt: new Date(observedAt).toISOString(),
        ...(normalizedBssid ? { bssid: normalizedBssid } : {}),
        verification: settings.allowedIps?.length ? 'native-observation-and-request-ip' : 'native-client-observation'
    };
}

module.exports = { ATTENDANCE_SSID, checkAttendanceWifi, normalizeIp };
